import { logger } from '@librechat/data-schemas';
import { DashboardAuthErrorCode } from 'librechat-data-provider';
import type { DashboardServiceConfig, DashboardUser } from './service';
import {
  createFakeClock,
  createFakeStore,
  decodeJwt,
  generateTestEd25519,
} from './dashboard.helper';
import { createDashboardAuthService, resolveDashboardTenant } from './service';
import { hashDashboardCode, hashDashboardHandle } from './codes';
import { loadDashboardKeyRing } from './keys';

jest.mock('@librechat/data-schemas', () => ({
  ...jest.requireActual('@librechat/data-schemas'),
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

const key = generateTestEd25519();
const ring = loadDashboardKeyRing({
  keysJson: JSON.stringify({ 'kid-1': key.privatePem }),
  activeKid: 'kid-1',
});

const baseConfig: DashboardServiceConfig = {
  issuer: 'https://chat.example.test',
  audience: 'hex-dashboard',
  tokenTtlSeconds: 300,
  codeTtlSeconds: 60,
  singleTenantId: 'legacy',
  strictTenant: false,
};

function setup(
  overrides: {
    config?: Partial<DashboardServiceConfig>;
    users?: Record<string, DashboardUser>;
  } = {},
) {
  const clock = createFakeClock();
  const store = createFakeStore();
  const users: Record<string, DashboardUser> = overrides.users ?? {
    u1: { id: 'u1', tenantId: 'tenant-1', role: 'USER' },
  };
  const findUserById = jest.fn(async (id: string) => users[id] ?? null);
  const service = createDashboardAuthService({
    config: { ...baseConfig, ...overrides.config },
    ring,
    store,
    findUserById,
    now: clock.now,
  });
  return { clock, store, users, service, findUserById };
}

const ok = <T>(result: { ok: boolean; value?: T; error?: unknown }): T => {
  if (!result.ok) {
    throw new Error('expected ok result');
  }
  return result.value as T;
};
const errorCode = (result: { ok: boolean; error?: { code: string } }) =>
  result.ok ? undefined : result.error?.code;

describe('dashboard auth service', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('issueCode', () => {
    it('returns a 60 second code and stores only its hash, bound to user and tenant', async () => {
      const { service, store, clock } = setup();
      const issued = ok(await service.issueCode({ id: 'u1', tenantId: 'tenant-1' }));
      expect(issued.expiresIn).toBe(60);
      expect(store.rows.has(issued.code)).toBe(false);
      const row = store.rows.get(hashDashboardCode(issued.code));
      expect(row).toMatchObject({ userId: 'u1', tenantId: 'tenant-1' });
      expect(row?.expiresAt).toEqual(new Date(clock.now().getTime() + 60_000));
      expect(JSON.stringify([...store.rows.values()])).not.toContain(issued.code);
    });

    it('caps outstanding codes: a new code supersedes an unredeemed one', async () => {
      const { service } = setup();
      const first = ok(await service.issueCode({ id: 'u1', tenantId: 'tenant-1' }));
      const second = ok(await service.issueCode({ id: 'u1', tenantId: 'tenant-1' }));
      expect(errorCode(await service.redeemCode(first.code))).toBe(
        DashboardAuthErrorCode.CodeInvalid,
      );
      expect((await service.redeemCode(second.code)).ok).toBe(true);
    });

    it('uses the single-tenant value when tenant isolation is not in use', async () => {
      const { service, store } = setup();
      const issued = ok(await service.issueCode({ id: 'u1' }));
      expect(store.rows.get(hashDashboardCode(issued.code))?.tenantId).toBe('legacy');
    });

    it('refuses without a real tenant under strict isolation and ignores the system tenant', async () => {
      const { service } = setup({ config: { strictTenant: true } });
      expect(errorCode(await service.issueCode({ id: 'u1' }))).toBe(
        DashboardAuthErrorCode.TenantRequired,
      );
      expect(errorCode(await service.issueCode({ id: 'u1' }, '__SYSTEM__'))).toBe(
        DashboardAuthErrorCode.TenantRequired,
      );
      expect((await service.issueCode({ id: 'u1' }, 'tenant-1')).ok).toBe(true);
    });

    it('refuses to issue for a tenant other than the one the dashboard serves', async () => {
      const { service } = setup({ config: { expectedTenantId: 'tenant-2' } });
      expect(errorCode(await service.issueCode({ id: 'u1', tenantId: 'tenant-1' }))).toBe(
        DashboardAuthErrorCode.PrincipalForbidden,
      );
    });
  });

  describe('redeemCode', () => {
    it('exchanges a valid code for a 5 minute token with bound claims and a revocable handle', async () => {
      const { service, store, clock } = setup();
      const { code } = ok(await service.issueCode({ id: 'u1', tenantId: 'tenant-1' }));
      clock.advanceSeconds(10);
      const redeemed = ok(await service.redeemCode(code));
      const { claims, header } = decodeJwt(redeemed.token);
      expect(header).toMatchObject({ alg: 'EdDSA', kid: 'kid-1' });
      expect(claims).toMatchObject({
        iss: baseConfig.issuer,
        aud: 'hex-dashboard',
        sub: 'u1',
        tenant_id: 'tenant-1',
        chat_role: 'USER',
        ver: 1,
      });
      expect((claims.exp as number) - (claims.iat as number)).toBe(300);
      expect(claims.sid).toBe(store.rows.get(hashDashboardCode(code))?.sid);
      expect(claims.sid).not.toBe(redeemed.sessionHandle);
      expect(store.rows.get(hashDashboardCode(code))?.handleHash).toBe(
        hashDashboardHandle(redeemed.sessionHandle),
      );
      expect(redeemed.expiresIn).toBe(300);
    });

    it('is single use: a replay fails and revokes the session the first redemption created', async () => {
      const { service, store } = setup();
      const { code } = ok(await service.issueCode({ id: 'u1', tenantId: 'tenant-1' }));
      ok(await service.redeemCode(code));
      expect(errorCode(await service.redeemCode(code))).toBe(DashboardAuthErrorCode.CodeInvalid);
      expect(store.rows.get(hashDashboardCode(code))?.revokedAt).toBeInstanceOf(Date);
      expect(logger.warn).toHaveBeenCalledWith('[dashboardAuth] code redemption rejected', {
        reason: 'reused',
      });
    });

    it('rejects an expired code, including exactly at the boundary', async () => {
      const { service, clock } = setup();
      const { code } = ok(await service.issueCode({ id: 'u1', tenantId: 'tenant-1' }));
      clock.advanceSeconds(60);
      expect(errorCode(await service.redeemCode(code))).toBe(DashboardAuthErrorCode.CodeInvalid);
    });

    it('accepts a code one second before expiry', async () => {
      const { service, clock } = setup();
      const { code } = ok(await service.issueCode({ id: 'u1', tenantId: 'tenant-1' }));
      clock.advanceSeconds(59);
      expect((await service.redeemCode(code)).ok).toBe(true);
    });

    it.each([undefined, null, 42, '', 'short', 'A'.repeat(43)])(
      'rejects an unknown or malformed code %p without a lookup leak',
      async (code) => {
        const { service } = setup();
        expect(errorCode(await service.redeemCode(code))).toBe(DashboardAuthErrorCode.CodeInvalid);
      },
    );

    it('refuses a disabled user, one with deletion in progress, and a missing user — and revokes', async () => {
      const cases: Array<[string, DashboardUser | undefined]> = [
        ['deleting', { id: 'u1', tenantId: 'tenant-1', agentTriggerDeletionStartedAt: new Date() }],
        ['missing', undefined],
      ];
      for (const [, user] of cases) {
        const { service, users, store } = setup();
        const { code } = ok(await service.issueCode({ id: 'u1', tenantId: 'tenant-1' }));
        if (user) {
          users.u1 = user;
        } else {
          delete users.u1;
        }
        const result = await service.redeemCode(code);
        expect(errorCode(result)).toBe(DashboardAuthErrorCode.PrincipalForbidden);
        expect(store.rows.get(hashDashboardCode(code))?.revokedAt).toBeInstanceOf(Date);
        expect(errorCode(await service.redeemCode(code))).toBe(DashboardAuthErrorCode.CodeInvalid);
      }
    });

    it('refuses when the user moved tenant between issue and redeem', async () => {
      const { service, users } = setup();
      const { code } = ok(await service.issueCode({ id: 'u1', tenantId: 'tenant-1' }));
      users.u1 = { id: 'u1', tenantId: 'tenant-2' };
      expect(errorCode(await service.redeemCode(code))).toBe(
        DashboardAuthErrorCode.PrincipalForbidden,
      );
    });

    it('refuses a code whose tenant is not the tenant the dashboard serves', async () => {
      const issuer = setup();
      const { code } = ok(await issuer.service.issueCode({ id: 'u1', tenantId: 'tenant-1' }));
      // Same store, stricter deployment config.
      const strict = createDashboardAuthService({
        config: { ...baseConfig, expectedTenantId: 'tenant-2' },
        ring,
        store: issuer.store,
        findUserById: issuer.findUserById,
        now: issuer.clock.now,
      });
      expect(errorCode(await strict.redeemCode(code))).toBe(
        DashboardAuthErrorCode.PrincipalForbidden,
      );
      expect(issuer.findUserById).not.toHaveBeenCalled();
    });

    it('lets a user lookup failure propagate instead of reading as "not found"', async () => {
      const { service, findUserById } = setup();
      const { code } = ok(await service.issueCode({ id: 'u1', tenantId: 'tenant-1' }));
      findUserById.mockRejectedValueOnce(new Error('db down'));
      await expect(service.redeemCode(code)).rejects.toThrow('db down');
    });

    it('lets exactly one of two concurrent redemptions win', async () => {
      const { service } = setup();
      const { code } = ok(await service.issueCode({ id: 'u1', tenantId: 'tenant-1' }));
      const results = await Promise.all([service.redeemCode(code), service.redeemCode(code)]);
      expect(results.filter((r) => r.ok)).toHaveLength(1);
    });

    it('never logs codes, handles or tokens', async () => {
      const { service } = setup();
      const { code } = ok(await service.issueCode({ id: 'u1', tenantId: 'tenant-1' }));
      const redeemed = ok(await service.redeemCode(code));
      await service.redeemCode(code);
      const logged = JSON.stringify(
        [logger.warn, logger.error, logger.info, logger.debug].map(
          (fn) => (fn as jest.Mock).mock.calls,
        ),
      );
      for (const secret of [code, redeemed.token, redeemed.sessionHandle, 'u1', 'tenant-1']) {
        expect(logged).not.toContain(secret);
      }
    });
  });

  describe('revokeHandle', () => {
    it('revokes once and is idempotent', async () => {
      const { service } = setup();
      const { code } = ok(await service.issueCode({ id: 'u1', tenantId: 'tenant-1' }));
      const { sessionHandle } = ok(await service.redeemCode(code));
      expect(ok(await service.revokeHandle(sessionHandle)).revoked).toBe(true);
      expect(ok(await service.revokeHandle(sessionHandle)).revoked).toBe(false);
    });

    it('rejects malformed handles', async () => {
      const { service } = setup();
      expect(errorCode(await service.revokeHandle('nope'))).toBe(DashboardAuthErrorCode.BadRequest);
      expect(errorCode(await service.revokeHandle(undefined))).toBe(
        DashboardAuthErrorCode.BadRequest,
      );
    });
  });
});

describe('resolveDashboardTenant', () => {
  const lax = { singleTenantId: 'legacy', strictTenant: false };
  it('prefers a real tenant, falls back to the single tenant, and honours strict mode', () => {
    expect(resolveDashboardTenant('t1', lax)).toBe('t1');
    expect(resolveDashboardTenant('  ', lax)).toBe('legacy');
    expect(resolveDashboardTenant('__SYSTEM__', lax)).toBe('legacy');
    expect(resolveDashboardTenant(undefined, { ...lax, strictTenant: true })).toBeUndefined();
  });
});
