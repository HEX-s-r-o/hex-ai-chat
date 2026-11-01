import { resolveDashboardEntry } from './entry';

/** A public https host is valid in every environment, so these cases do not depend on the ambient NODE_ENV (CI runs with NODE_ENV=CI). */
const base = { enabled: true, dashboardUrl: 'https://dashboard.acme-internal.dev/' };

describe('resolveDashboardEntry', () => {
  it('returns the callback URL for an eligible user and normalises the trailing slash', () => {
    expect(resolveDashboardEntry(base, { tenantId: 't1' })).toEqual({
      callbackUrl: 'https://dashboard.acme-internal.dev/auth/callback',
    });
  });

  it.each([
    ['no settings', undefined],
    ['disabled', { ...base, enabled: false }],
    ['no dashboard url', { enabled: true }],
  ])('hides the entry with %s', (_n, settings) => {
    expect(resolveDashboardEntry(settings, { tenantId: 't1' })).toBeUndefined();
  });

  it('hides the entry without a signed-in user and for OpenID-reuse sessions', () => {
    expect(resolveDashboardEntry(base, undefined)).toBeUndefined();
    expect(resolveDashboardEntry(base, { tenantId: 't1' }, 'openidJwt')).toBeUndefined();
    expect(resolveDashboardEntry(base, { tenantId: 't1' }, 'jwt')).toBeDefined();
  });

  it('applies the expected-tenant filter, defaulting to the single tenant', () => {
    const scoped = { ...base, expectedTenantId: 'tenant-a' };
    expect(resolveDashboardEntry(scoped, { tenantId: 'tenant-a' })).toBeDefined();
    expect(resolveDashboardEntry(scoped, { tenantId: 'tenant-b' })).toBeUndefined();
    expect(resolveDashboardEntry(scoped, {})).toBeUndefined();
    expect(
      resolveDashboardEntry({ ...scoped, singleTenantId: 'tenant-a' }, { tenantId: undefined }),
    ).toBeDefined();
  });

  it('exposes nothing but the callback URL', () => {
    const result = resolveDashboardEntry({ ...base, expectedTenantId: 't1' }, { tenantId: 't1' });
    expect(Object.keys(result ?? {})).toEqual(['callbackUrl']);
  });
});

describe('resolveDashboardEntry honours the settings validator', () => {
  const prod = { NODE_ENV: 'production' } as NodeJS.ProcessEnv;
  const valid = {
    enabled: true,
    dashboardUrl: 'https://dashboard.acme-internal.dev',
    issuer: 'https://chat.acme-internal.dev',
  };

  it('advertises a valid production configuration', () => {
    expect(resolveDashboardEntry(valid, { tenantId: 't1' }, undefined, prod)).toEqual({
      callbackUrl: 'https://dashboard.acme-internal.dev/auth/callback',
    });
  });

  it.each([
    ['plain http', { dashboardUrl: 'http://dashboard.acme-internal.dev' }],
    ['localhost', { dashboardUrl: 'http://localhost:5273' }],
    ['placeholder', { dashboardUrl: 'https://dashboard.example.com' }],
    ['placeholder issuer', { issuer: 'https://chat.example.com' }],
  ])('advertises nothing for %s outside local development', (_n, override) => {
    expect(
      resolveDashboardEntry({ ...valid, ...override }, { tenantId: 't1' }, undefined, prod),
    ).toBeUndefined();
  });

  it('still allows loopback http in local development', () => {
    const settings = { enabled: true, dashboardUrl: 'http://localhost:5273' };
    const dev = { NODE_ENV: 'development' } as NodeJS.ProcessEnv;
    expect(resolveDashboardEntry(settings, { tenantId: 't1' }, undefined, dev)).toEqual({
      callbackUrl: 'http://localhost:5273/auth/callback',
    });
  });
});

describe('resolveDashboardEntry does not depend on the ambient NODE_ENV', () => {
  const user = { tenantId: 't1' };

  it.each(['production', 'CI', 'staging', 'development', 'test', undefined])(
    'advertises a production-valid configuration when NODE_ENV is %p',
    (nodeEnv) => {
      const env = { NODE_ENV: nodeEnv } as NodeJS.ProcessEnv;
      expect(resolveDashboardEntry(base, user, undefined, env)).toEqual({
        callbackUrl: 'https://dashboard.acme-internal.dev/auth/callback',
      });
    },
  );

  it.each([
    ['production', false],
    ['CI', false],
    ['staging', false],
    [undefined, false],
    ['development', true],
    ['test', true],
  ])(
    'a reserved .test host is advertised only in local development (NODE_ENV=%p -> %p)',
    (nodeEnv, advertised) => {
      const env = { NODE_ENV: nodeEnv } as NodeJS.ProcessEnv;
      const settings = { enabled: true, dashboardUrl: 'https://dash.example.test' };
      expect(resolveDashboardEntry(settings, user, undefined, env) !== undefined).toBe(advertised);
    },
  );
});
