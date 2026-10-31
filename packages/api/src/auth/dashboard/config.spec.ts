import { logger } from '@librechat/data-schemas';
import type { DashboardRuntimeDeps } from './config';
import { createDashboardRuntimeResolver } from './config';
import { createFakeStore, generateTestEd25519 } from './dashboard.helper';

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
      expect(runtime.limits).toEqual({ codeRequestsPerFiveMinutes: 10, exchangeRequestsPerMinute: 60 });
    }
  });

  it('prefers the yaml activeKid over the environment kid', async () => {
    const second = generateTestEd25519();
    const env = {
      ...goodEnv,
      DASHBOARD_JWT_KEYS: JSON.stringify({ 'kid-1': key.privatePem, 'kid-2': second.privatePem }),
    };
    expect((await resolver({ ...goodSettings, activeKid: 'kid-2' }, env)()).status).toBe('ready');
    expect((await resolver({ ...goodSettings, activeKid: 'missing' }, env)()).status).toBe('unavailable');
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
    const resolve = resolver({ ...goodSettings, rateLimits: { exchangeRequestsPerMinute: 5 } }, env);
    const first = await resolve();
    expect(await resolve()).toBe(first);
    expect(first.status === 'ready' && first.limits.exchangeRequestsPerMinute).toBe(5);
    env.DASHBOARD_EXCHANGE_SECRET = 't'.repeat(48);
    const rotated = await resolve();
    expect(rotated).not.toBe(first);
    expect(rotated.status === 'ready' && rotated.verifyCredential(`Bearer ${'t'.repeat(48)}`)).toBe(true);
  });
});
