import express from 'express';
import request from 'supertest';
import mongoose from 'mongoose';
import { verify } from 'crypto';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { DashboardAuthErrorCode } from 'librechat-data-provider';
import { createModels, createMethods } from '@librechat/data-schemas';
import type { AllMethods } from '@librechat/data-schemas';
import type { RequestHandler } from 'express';
import { createFakeClock, decodeJwt, generateTestEd25519 } from './dashboard.helper';
import { createDashboardRuntimeResolver } from './config';
import { createDashboardUserLookup } from './service';
import { createDashboardAuthRouter } from './routes';

jest.mock('@librechat/data-schemas', () => ({
  ...jest.requireActual('@librechat/data-schemas'),
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

const ISSUER = 'https://chat.example.test';
const SECRET = 'x'.repeat(48);
const key = generateTestEd25519();
const clock = createFakeClock(new Date());

let mongoServer: MongoMemoryServer;
let methods: AllMethods;
let settings: Record<string, unknown>;
let env: Record<string, string | undefined>;

/** Stand-in for requireJwtAuth: trusts a header, but only for users that exist in Mongo. */
const fakeUserAuth: RequestHandler = async (req, res, next) => {
  const id = req.get('x-test-user');
  const user = id
    ? await mongoose.models.User.findOne({ _id: id }).setOptions({ tenantId: undefined }).lean()
    : null;
  if (!user) {
    res.sendStatus(401);
    return;
  }
  Object.assign(req, { user: { ...user, id: String(user._id) } });
  next();
};

function buildApp() {
  const getRuntime = createDashboardRuntimeResolver({
    getAppConfig: async () => ({ config: { version: '1', dashboardAuth: settings } }) as never,
    store: methods,
    findUserById: createDashboardUserLookup(methods.getUserById as never),
    env: env as NodeJS.ProcessEnv,
    now: clock.now,
  });
  const app = express();
  app.use(express.json());
  app.use(
    '/api/auth/dashboard',
    createDashboardAuthRouter({ getRuntime, userMiddleware: [fakeUserAuth] }),
  );
  return app;
}

async function createUser(overrides: Record<string, unknown> = {}): Promise<string> {
  const doc = await mongoose.models.User.create({
    name: 'Test User',
    email: `${new mongoose.Types.ObjectId()}@example.test`,
    provider: 'local',
    ...overrides,
  });
  return String(doc._id);
}

const bff = (req: request.Test) => req.set('Authorization', `Bearer ${SECRET}`);

async function obtainCode(app: express.Express, userId: string): Promise<string> {
  const res = await request(app)
    .post('/api/auth/dashboard/code')
    .set('x-test-user', userId)
    .expect(200);
  return res.body.code as string;
}

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
  createModels(mongoose);
  methods = createMethods(mongoose);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

beforeEach(async () => {
  settings = {
    enabled: true,
    issuer: ISSUER,
    activeKid: 'kid-1',
    rateLimits: { exchangeRequestsPerMinute: 1000, codeRequestsPerFiveMinutes: 1000 },
  };
  env = {
    DASHBOARD_JWT_KEYS: JSON.stringify({ 'kid-1': key.privatePem }),
    DASHBOARD_EXCHANGE_SECRET: SECRET,
  };
  await mongoose.models.User.deleteMany({});
  await mongoose.models.DashboardCode.deleteMany({});
});

describe('POST /api/auth/dashboard/token', () => {
  it('exchanges a single-use code for a correctly claimed, correctly signed 5 minute JWT', async () => {
    const app = buildApp();
    const userId = await createUser({ role: 'USER' });
    const issued = await request(app)
      .post('/api/auth/dashboard/code')
      .set('x-test-user', userId)
      .expect(200);
    expect(issued.body.expires_in).toBe(60);
    expect(issued.headers['cache-control']).toBe('no-store');

    const res = await bff(request(app).post('/api/auth/dashboard/token'))
      .send({ grant: 'code', code: issued.body.code })
      .expect(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(Object.keys(res.body).sort()).toEqual(['expires_in', 'session_handle', 'token']);
    expect(res.body.expires_in).toBe(300);

    const { header, claims, signingInput, signature } = decodeJwt(res.body.token);
    expect(verify(null, Buffer.from(signingInput), key.publicKey, signature)).toBe(true);
    expect(header).toEqual({ alg: 'EdDSA', typ: 'JWT', kid: 'kid-1' });
    expect(claims).toMatchObject({
      iss: ISSUER,
      aud: 'hex-dashboard',
      sub: userId,
      tenant_id: 'legacy',
      chat_role: 'USER',
      ver: 1,
      principal_source: 'chat_session',
    });
    expect(claims.exp).toBe((claims.iat as number) + 300);
    expect(claims.nbf).toBe(claims.iat);
    expect(typeof claims.sid).toBe('string');
    expect(typeof claims.jti).toBe('string');
    expect(claims).not.toHaveProperty('email');

    const stored = await mongoose.models.DashboardCode.findOne({}).lean();
    expect(JSON.stringify(stored)).not.toContain(issued.body.code);
    expect(JSON.stringify(stored)).not.toContain(res.body.session_handle);
  });

  it('binds the tenant of a tenant-scoped user', async () => {
    settings.expectedTenantId = 'tenant-a';
    const app = buildApp();
    const userId = await createUser({ tenantId: 'tenant-a' });
    const code = await obtainCode(app, userId);
    const res = await bff(request(app).post('/api/auth/dashboard/token'))
      .send({ grant: 'code', code })
      .expect(200);
    expect(decodeJwt(res.body.token).claims.tenant_id).toBe('tenant-a');
  });

  it('rejects a reused code and revokes the session its first redemption created', async () => {
    const app = buildApp();
    const code = await obtainCode(app, await createUser());
    const first = await bff(request(app).post('/api/auth/dashboard/token'))
      .send({ grant: 'code', code })
      .expect(200);
    const replay = await bff(request(app).post('/api/auth/dashboard/token'))
      .send({ grant: 'code', code })
      .expect(400);
    expect(replay.body).toEqual({
      code: DashboardAuthErrorCode.CodeInvalid,
      message: 'Code is invalid or expired.',
    });
    const row = await mongoose.models.DashboardCode.findOne({}).lean();
    expect(row?.revokedAt).toBeInstanceOf(Date);
    // The handle from the first redemption is already revoked, so revoking again reports nothing new.
    await bff(request(app).post('/api/auth/dashboard/revoke'))
      .send({ session_handle: first.body.session_handle })
      .expect(200);
  });

  it('rejects an expired code', async () => {
    const app = buildApp();
    const code = await obtainCode(app, await createUser());
    clock.advanceSeconds(61);
    const res = await bff(request(app).post('/api/auth/dashboard/token'))
      .send({ grant: 'code', code })
      .expect(400);
    expect(res.body.code).toBe(DashboardAuthErrorCode.CodeInvalid);
  });

  it('rejects unknown and malformed codes identically', async () => {
    const app = buildApp();
    for (const code of ['A'.repeat(43), 'short', 12, null]) {
      const res = await bff(request(app).post('/api/auth/dashboard/token'))
        .send({ grant: 'code', code })
        .expect(400);
      expect(res.body.code).toBe(DashboardAuthErrorCode.CodeInvalid);
    }
  });

  it('rejects a missing, wrong or malformed BFF credential before touching the code', async () => {
    const app = buildApp();
    const code = await obtainCode(app, await createUser());
    for (const auth of [undefined, 'Bearer nope', `Basic ${SECRET}`, `Bearer ${SECRET}x`]) {
      const req = request(app).post('/api/auth/dashboard/token');
      const res = await (auth ? req.set('Authorization', auth) : req)
        .send({ grant: 'code', code })
        .expect(401);
      expect(res.body.code).toBe(DashboardAuthErrorCode.ClientUnauthorized);
      expect(res.headers['www-authenticate']).toBe('Bearer');
    }
    // The code survived those attempts and still redeems.
    await bff(request(app).post('/api/auth/dashboard/token'))
      .send({ grant: 'code', code })
      .expect(200);
  });

  it('does not accept a browser session or chat bearer as the BFF credential', async () => {
    const app = buildApp();
    const userId = await createUser();
    const code = await obtainCode(app, userId);
    const res = await request(app)
      .post('/api/auth/dashboard/token')
      .set('x-test-user', userId)
      .send({ grant: 'code', code })
      .expect(401);
    expect(res.body.code).toBe(DashboardAuthErrorCode.ClientUnauthorized);
    // The rejected attempt did not spend the code.
    expect((await mongoose.models.DashboardCode.findOne({}).lean())?.consumedAt).toBeUndefined();
  });

  it('accepts the previous credential during rotation and the new one after', async () => {
    env.DASHBOARD_EXCHANGE_SECRET = 'n'.repeat(48);
    env.DASHBOARD_EXCHANGE_SECRET_PREVIOUS = SECRET;
    const app = buildApp();
    const userId = await createUser();
    const withPrevious = await bff(request(app).post('/api/auth/dashboard/token'))
      .send({ grant: 'code', code: await obtainCode(app, userId) })
      .expect(200);
    const withCurrent = await request(app)
      .post('/api/auth/dashboard/token')
      .set('Authorization', `Bearer ${'n'.repeat(48)}`)
      .send({ grant: 'code', code: await obtainCode(app, userId) })
      .expect(200);
    expect(decodeJwt(withPrevious.body.token).claims.sub).toBe(userId);
    expect(decodeJwt(withCurrent.body.token).claims.sub).toBe(userId);
  });

  it('refuses a user disabled between issue and redeem, and the code cannot be retried', async () => {
    const app = buildApp();
    const userId = await createUser();
    const code = await obtainCode(app, userId);
    await mongoose.models.User.updateOne(
      { _id: userId },
      { $set: { agentTriggerDeletionStartedAt: new Date() } },
    );
    const res = await bff(request(app).post('/api/auth/dashboard/token'))
      .send({ grant: 'code', code })
      .expect(403);
    expect(res.body.code).toBe(DashboardAuthErrorCode.PrincipalForbidden);
    const retry = await bff(request(app).post('/api/auth/dashboard/token'))
      .send({ grant: 'code', code })
      .expect(400);
    expect(retry.body.code).toBe(DashboardAuthErrorCode.CodeInvalid);
  });

  it('refuses a deleted user', async () => {
    const app = buildApp();
    const userId = await createUser();
    const code = await obtainCode(app, userId);
    await mongoose.models.User.deleteOne({ _id: userId });
    const res = await bff(request(app).post('/api/auth/dashboard/token'))
      .send({ grant: 'code', code })
      .expect(403);
    expect(res.body.code).toBe(DashboardAuthErrorCode.PrincipalForbidden);
  });

  it('refuses a tenant mismatch: user moved tenants after the code was issued', async () => {
    settings.singleTenantId = 'tenant-a';
    const app = buildApp();
    const userId = await createUser({ tenantId: 'tenant-a' });
    const code = await obtainCode(app, userId);
    // The tenant-isolation plugin strips tenantId mutations, so move the user at the driver level.
    await mongoose.models.User.collection.updateOne(
      { _id: new mongoose.Types.ObjectId(userId) },
      { $set: { tenantId: 'tenant-b' } },
    );
    const moved = await mongoose.models.User.collection.findOne({
      _id: new mongoose.Types.ObjectId(userId),
    });
    expect(moved?.tenantId).toBe('tenant-b');
    const res = await bff(request(app).post('/api/auth/dashboard/token'))
      .send({ grant: 'code', code })
      .expect(403);
    expect(res.body.code).toBe(DashboardAuthErrorCode.PrincipalForbidden);
  });

  it('refuses a tenant mismatch: code for a tenant this dashboard does not serve', async () => {
    const app = buildApp();
    const userId = await createUser({ tenantId: 'tenant-b' });
    const code = await obtainCode(app, userId);
    settings.expectedTenantId = 'tenant-a';
    const res = await bff(request(app).post('/api/auth/dashboard/token'))
      .send({ grant: 'code', code })
      .expect(403);
    expect(res.body.code).toBe(DashboardAuthErrorCode.PrincipalForbidden);
    await request(app).post('/api/auth/dashboard/code').set('x-test-user', userId).expect(403);
  });

  it('rejects unsupported grants and bodies', async () => {
    const app = buildApp();
    for (const body of [{ grant: 'refresh', session_handle: 'x' }, { code: 'x' }, {}]) {
      const res = await bff(request(app).post('/api/auth/dashboard/token')).send(body).expect(400);
      expect(res.body.code).toBe(DashboardAuthErrorCode.BadRequest);
    }
  });

  it('lets only one of two concurrent redemptions succeed', async () => {
    const app = buildApp();
    const code = await obtainCode(app, await createUser());
    const statuses = (
      await Promise.all(
        [1, 2, 3, 4].map(() =>
          bff(request(app).post('/api/auth/dashboard/token')).send({ grant: 'code', code }),
        ),
      )
    ).map((r) => r.status);
    expect(statuses.filter((s) => s === 200)).toHaveLength(1);
  });
});

describe('POST /api/auth/dashboard/code', () => {
  it('requires an authenticated chat user', async () => {
    const anonymous = await request(buildApp()).post('/api/auth/dashboard/code').expect(401);
    const unknown = await request(buildApp())
      .post('/api/auth/dashboard/code')
      .set('x-test-user', String(new mongoose.Types.ObjectId()))
      .expect(401);
    expect(anonymous.body).not.toHaveProperty('code');
    expect(unknown.body).not.toHaveProperty('code');
    expect(await mongoose.models.DashboardCode.countDocuments()).toBe(0);
  });

  it('rate limits per user with a stable code', async () => {
    settings.rateLimits = { codeRequestsPerFiveMinutes: 2 };
    const app = buildApp();
    const userId = await createUser();
    await request(app).post('/api/auth/dashboard/code').set('x-test-user', userId).expect(200);
    await request(app).post('/api/auth/dashboard/code').set('x-test-user', userId).expect(200);
    const res = await request(app)
      .post('/api/auth/dashboard/code')
      .set('x-test-user', userId)
      .expect(429);
    expect(res.body.code).toBe(DashboardAuthErrorCode.RateLimited);
  });
});

describe('POST /api/auth/dashboard/revoke', () => {
  it('revokes a handle for the BFF only, idempotently', async () => {
    const app = buildApp();
    const code = await obtainCode(app, await createUser());
    const { body } = await bff(request(app).post('/api/auth/dashboard/token'))
      .send({ grant: 'code', code })
      .expect(200);
    await request(app)
      .post('/api/auth/dashboard/revoke')
      .send({ session_handle: body.session_handle })
      .expect(401);
    await bff(request(app).post('/api/auth/dashboard/revoke'))
      .send({ session_handle: body.session_handle })
      .expect(200);
    await bff(request(app).post('/api/auth/dashboard/revoke'))
      .send({ session_handle: body.session_handle })
      .expect(200);
    const row = await mongoose.models.DashboardCode.findOne({}).lean();
    expect(row?.revokedAt).toBeInstanceOf(Date);
    await bff(request(app).post('/api/auth/dashboard/revoke'))
      .send({ session_handle: 'bad' })
      .expect(400);
  });
});

describe('configuration states', () => {
  it('answers 404 on every route when disabled, before any auth', async () => {
    settings.enabled = false;
    const app = buildApp();
    for (const path of ['code', 'token', 'revoke']) {
      const res = await request(app).post(`/api/auth/dashboard/${path}`).expect(404);
      expect(res.body.code).toBe(DashboardAuthErrorCode.Disabled);
    }
  });

  it('answers 503 and issues nothing when enabled with a broken key ring', async () => {
    env.DASHBOARD_JWT_KEYS = '{"kid-1":"junk"}';
    const app = buildApp();
    const userId = await createUser();
    const res = await request(app)
      .post('/api/auth/dashboard/code')
      .set('x-test-user', userId)
      .expect(503);
    expect(res.body.code).toBe(DashboardAuthErrorCode.Unavailable);
    expect(await mongoose.models.DashboardCode.countDocuments()).toBe(0);
  });

  it('never returns raw error text when storage fails', async () => {
    const app = buildApp();
    const code = await obtainCode(app, await createUser());
    await mongoose.models.DashboardCode.collection.drop();
    const spy = jest
      .spyOn(methods, 'consumeDashboardCode')
      .mockRejectedValueOnce(new Error('mongo secret connection string'));
    const res = await bff(request(app).post('/api/auth/dashboard/token'))
      .send({ grant: 'code', code })
      .expect(500);
    expect(res.body).toEqual({
      code: DashboardAuthErrorCode.Internal,
      message: 'Dashboard authentication failed.',
    });
    expect(JSON.stringify(res)).not.toContain('mongo secret');
    spy.mockRestore();
  });
});

describe('rotation', () => {
  it('signs with the newly active kid while the old public key stays valid for tokens already issued', async () => {
    const second = generateTestEd25519();
    env.DASHBOARD_JWT_KEYS = JSON.stringify({
      'kid-1': key.privatePem,
      'kid-2': second.privatePem,
    });
    const app1 = buildApp();
    const userId = await createUser();
    const before = await bff(request(app1).post('/api/auth/dashboard/token'))
      .send({ grant: 'code', code: await obtainCode(app1, userId) })
      .expect(200);

    settings.activeKid = 'kid-2';
    const app2 = buildApp();
    const after = await bff(request(app2).post('/api/auth/dashboard/token'))
      .send({ grant: 'code', code: await obtainCode(app2, userId) })
      .expect(200);

    const b = decodeJwt(before.body.token);
    const a = decodeJwt(after.body.token);
    expect(b.header.kid).toBe('kid-1');
    expect(a.header.kid).toBe('kid-2');
    expect(verify(null, Buffer.from(b.signingInput), key.publicKey, b.signature)).toBe(true);
    expect(verify(null, Buffer.from(a.signingInput), second.publicKey, a.signature)).toBe(true);
    expect(verify(null, Buffer.from(a.signingInput), key.publicKey, a.signature)).toBe(false);
  });
});

describe('logging hygiene', () => {
  it('never logs secrets, codes, tokens or identifiers', async () => {
    const { logger } = jest.requireMock('@librechat/data-schemas') as {
      logger: Record<string, jest.Mock>;
    };
    Object.values(logger).forEach((fn) => fn.mockClear());
    const app = buildApp();
    const userId = await createUser();
    const code = await obtainCode(app, userId);
    const ok = await bff(request(app).post('/api/auth/dashboard/token'))
      .send({ grant: 'code', code })
      .expect(200);
    await bff(request(app).post('/api/auth/dashboard/token'))
      .send({ grant: 'code', code })
      .expect(400);
    await request(app)
      .post('/api/auth/dashboard/token')
      .set('Authorization', 'Bearer wrong')
      .send({ grant: 'code', code })
      .expect(401);
    const logged = JSON.stringify(Object.values(logger).map((fn) => fn.mock.calls));
    for (const secret of [
      SECRET,
      code,
      ok.body.token,
      ok.body.session_handle,
      userId,
      key.privatePem.split('\n')[1],
    ]) {
      expect(logged).not.toContain(secret);
    }
  });
});
