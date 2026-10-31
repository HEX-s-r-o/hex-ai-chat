import { resolveDashboardEntry } from './entry';

const base = { enabled: true, dashboardUrl: 'https://dash.example.test/' };

describe('resolveDashboardEntry', () => {
  it('returns the callback URL for an eligible user and normalises the trailing slash', () => {
    expect(resolveDashboardEntry(base, { tenantId: 't1' })).toEqual({
      callbackUrl: 'https://dash.example.test/auth/callback',
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
