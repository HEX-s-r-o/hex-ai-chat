import { logger } from '@librechat/data-schemas';
import type { DashboardRuntimeDeps } from './config';
import { createFakeStore, generateTestEd25519 } from './dashboard.helper';
import { createDashboardRuntimeResolver } from './config';

jest.mock('@librechat/data-schemas', () => ({
  ...jest.requireActual('@librechat/data-schemas'),
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

const key = generateTestEd25519();
const SECRET = 's'.repeat(48);

function resolver(
  dashboardAuth: Record<string, unknown> | undefined,
  env: Record<string, string | undefined>,
) {
  const deps: DashboardRuntimeDeps = {
    getAppConfig: async () => ({ config: { version: '1', dashboardAuth } }) as never,
    store: createFakeStore(),
    findUserById: async () => null,
    env: env as NodeJS.ProcessEnv,
  };
  return createDashboardRuntimeResolver(deps);
}

const goodEnv = {
  /** These tests run as local development: https `.test` hosts are fine here (validate.spec.ts covers production). */
  NODE_ENV: 'test',
  DASHBOARD_JWT_KEYS: JSON.stringify({ 'kid-1': key.privatePem }),
  DASHBOARD_JWT_KID: 'kid-1',
  DASHBOARD_EXCHANGE_SECRET: SECRET,
};
const goodSettings = { enabled: true, issuer: 'https://chat.example.test' };

describe('createDashboardRuntimeResolver', () => {
  beforeEach(() => jest.clearAllMocks());

  it('is disabled by default and reads no key', async () => {
    expect((await resolver(undefined, {})()).status).toBe('disabled');
    expect((await resolver({ enabled: false }, goodEnv)()).status).toBe('disabled');
  });

  it('is ready with valid settings, secrets and an env-selected kid', async () => {
    const runtime = await resolver(goodSettings, goodEnv)();
    expect(runtime.status).toBe('ready');
    if (runtime.status === 'ready') {
      expect(runtime.verifyCredential(`Bearer ${SECRET}`)).toBe(true);
      expect(runtime.verifyCredential('Bearer wrong')).toBe(false);
      expect(runtime.limits).toEqual({
        codeRequestsPerFiveMinutes: 10,
        exchangeRequestsPerMinute: 60,
      });
    }
  });

  it('prefers the yaml activeKid over the environment kid', async () => {
    const second = generateTestEd25519();
    const env = {
      ...goodEnv,
      DASHBOARD_JWT_KEYS: JSON.stringify({ 'kid-1': key.privatePem, 'kid-2': second.privatePem }),
    };
    expect((await resolver({ ...goodSettings, activeKid: 'kid-2' }, env)()).status).toBe('ready');
    expect((await resolver({ ...goodSettings, activeKid: 'missing' }, env)()).status).toBe(
      'unavailable',
    );
  });

  it.each([
    ['no issuer', { enabled: true }, goodEnv],
    ['no keys', goodSettings, { ...goodEnv, DASHBOARD_JWT_KEYS: undefined }],
    ['bad keys', goodSettings, { ...goodEnv, DASHBOARD_JWT_KEYS: '{"k":"junk"}' }],
    ['no active kid', goodSettings, { ...goodEnv, DASHBOARD_JWT_KID: undefined }],
    ['no credential', goodSettings, { ...goodEnv, DASHBOARD_EXCHANGE_SECRET: undefined }],
    ['weak credential', goodSettings, { ...goodEnv, DASHBOARD_EXCHANGE_SECRET: 'weak' }],
  ])('fails closed (unavailable) with %s', async (_name, settings, env) => {
    expect((await resolver(settings, env)()).status).toBe('unavailable');
    expect(logger.error).toHaveBeenCalledWith(
      '[dashboardAuth] disabled by invalid configuration',
      expect.objectContaining({ reason: expect.any(String) }),
    );
  });

  it('logs a reason code only, never key or credential values', async () => {
    await resolver(goodSettings, { ...goodEnv, DASHBOARD_JWT_KEYS: `{"kid-1":"${SECRET}"}` })();
    const logged = JSON.stringify((logger.error as jest.Mock).mock.calls);
    expect(logged).not.toContain(SECRET);
    expect(logged).not.toContain(key.privatePem.split('\n')[1]);
  });

  it('applies configured limits and only rebuilds when configuration changes', async () => {
    const env = { ...goodEnv };
    const resolve = resolver(
      { ...goodSettings, rateLimits: { exchangeRequestsPerMinute: 5 } },
      env,
    );
    const first = await resolve();
    expect(await resolve()).toBe(first);
    expect(first.status === 'ready' && first.limits.exchangeRequestsPerMinute).toBe(5);
    env.DASHBOARD_EXCHANGE_SECRET = 't'.repeat(48);
    const rotated = await resolve();
    expect(rotated).not.toBe(first);
    expect(rotated.status === 'ready' && rotated.verifyCredential(`Bearer ${'t'.repeat(48)}`)).toBe(
      true,
    );
  });
});

describe('fail-closed settings validation', () => {
  const prodEnv = { ...goodEnv, NODE_ENV: 'production' };
  const prodSettings = {
    enabled: true,
    issuer: 'https://chat.acme-internal.dev',
    dashboardUrl: 'https://dashboard.acme-internal.dev',
    audience: 'hex-dashboard',
  };
  beforeEach(() => jest.clearAllMocks());

  it('is ready with a valid production configuration', async () => {
    expect((await resolver(prodSettings, prodEnv)()).status).toBe('ready');
  });

  it.each([
    [
      'plain-http dashboardUrl',
      { dashboardUrl: 'http://dashboard.acme-internal.dev' },
      'DASHBOARD_URL_NOT_HTTPS',
    ],
    ['localhost dashboardUrl', { dashboardUrl: 'https://localhost' }, 'DASHBOARD_URL_LOCAL_HOST'],
    [
      'placeholder dashboardUrl',
      { dashboardUrl: 'https://dashboard.example.com' },
      'DASHBOARD_URL_PLACEHOLDER',
    ],
    ['http issuer', { issuer: 'http://chat.acme-internal.dev' }, 'ISSUER_NOT_HTTPS'],
    ['placeholder issuer', { issuer: 'https://chat.example.com' }, 'ISSUER_PLACEHOLDER'],
  ])(
    'issues nothing with a %s, even with valid keys and credential',
    async (_n, override, code) => {
      expect((await resolver({ ...prodSettings, ...override }, prodEnv)()).status).toBe(
        'unavailable',
      );
      expect(logger.error).toHaveBeenCalledWith(
        '[dashboardAuth] disabled by invalid configuration',
        {
          reason: expect.stringContaining(code),
        },
      );
    },
  );

  it.each([
    ['dashboardUrl', { dashboardUrl: 'https://localhost.' }, 'DASHBOARD_URL_LOCAL_HOST'],
    ['dashboardUrl', { dashboardUrl: 'https://dash.corp.internal.' }, 'DASHBOARD_URL_LOCAL_HOST'],
    ['dashboardUrl', { dashboardUrl: 'https://dash.corp.lan' }, 'DASHBOARD_URL_LOCAL_HOST'],
    ['dashboardUrl', { dashboardUrl: 'https://dashboard' }, 'DASHBOARD_URL_LOCAL_HOST'],
    ['issuer', { issuer: 'https://localhost.' }, 'ISSUER_LOCAL_HOST'],
    ['issuer', { issuer: 'https://chat.corp.home.arpa' }, 'ISSUER_LOCAL_HOST'],
    ['issuer', { issuer: 'https://chat' }, 'ISSUER_LOCAL_HOST'],
  ])('issues nothing for a trailing-dot or non-public %s %j', async (_field, override, code) => {
    expect((await resolver({ ...prodSettings, ...override }, prodEnv)()).status).toBe(
      'unavailable',
    );
    expect(logger.error).toHaveBeenCalledWith('[dashboardAuth] disabled by invalid configuration', {
      reason: expect.stringContaining(code),
    });
  });

  it('still issues for a public name with one trailing dot', async () => {
    const settings = {
      ...prodSettings,
      issuer: 'https://chat.acme-internal.dev.',
      dashboardUrl: 'https://dashboard.acme-internal.dev.',
    };
    expect((await resolver(settings, prodEnv)()).status).toBe('ready');
  });

  it('refuses a placeholder exchange credential even when it is long enough', async () => {
    const env = {
      ...prodEnv,
      DASHBOARD_EXCHANGE_SECRET: 'change-me-to-at-least-32-random-characters',
    };
    expect((await resolver(prodSettings, env)()).status).toBe('unavailable');
  });

  it('applies the strict rules when NODE_ENV is unset, and relaxes only for development and test', async () => {
    const { NODE_ENV: _omit, ...unset } = goodEnv;
    const local = {
      ...prodSettings,
      dashboardUrl: 'http://127.0.0.1:5273',
      issuer: 'http://127.0.0.1:3080',
    };
    expect((await resolver(local, unset)()).status).toBe('unavailable');
    expect((await resolver(local, { ...goodEnv, NODE_ENV: 'development' })()).status).toBe('ready');
    expect((await resolver(local, { ...goodEnv, NODE_ENV: 'production' })()).status).toBe(
      'unavailable',
    );
  });

  it('logs reason codes only, never a configured value', async () => {
    await resolver(
      { ...prodSettings, dashboardUrl: 'https://user:LEAKYPASSWORD@localhost/x' },
      prodEnv,
    )();
    const logged = JSON.stringify((logger.error as jest.Mock).mock.calls);
    expect(logged).not.toMatch(/LEAKYPASSWORD|localhost/);
  });

  it('re-validates when NODE_ENV changes (it is part of the cached configuration)', async () => {
    const env = { ...goodEnv, NODE_ENV: 'development' } as Record<string, string | undefined>;
    const local = {
      ...prodSettings,
      dashboardUrl: 'http://127.0.0.1:5273',
      issuer: 'http://127.0.0.1:3080',
    };
    const resolve = resolver(local, env);
    expect((await resolve()).status).toBe('ready');
    env.NODE_ENV = 'production';
    expect((await resolve()).status).toBe('unavailable');
  });
});
