import {
  withDashboardCode,
  isValidDashboardBaseUrl,
  dashboardAuthConfigSchema,
  buildDashboardCallbackUrl,
} from './dashboardAuth';

describe('dashboard URL helpers', () => {
  it.each([
    'https://dash.example.test',
    'https://dash.example.test/base/',
    'http://localhost:5173',
    'http://127.0.0.1:5173',
  ])('accepts %s', (url) => {
    expect(isValidDashboardBaseUrl(url)).toBe(true);
  });

  it.each([
    'http://dash.example.test',
    'ftp://dash.example.test',
    'javascript:alert(1)',
    'https://user:pw@dash.example.test',
    'https://dash.example.test?x=1',
    'https://dash.example.test/#frag',
    'not a url',
    '',
  ])('rejects %s', (url) => {
    expect(isValidDashboardBaseUrl(url)).toBe(false);
  });

  it('builds the callback URL and appends the code only at navigation time', () => {
    expect(buildDashboardCallbackUrl('https://dash.example.test/')).toBe(
      'https://dash.example.test/auth/callback',
    );
    expect(buildDashboardCallbackUrl('https://dash.example.test/app')).toBe(
      'https://dash.example.test/app/auth/callback',
    );
    expect(withDashboardCode('https://dash.example.test/auth/callback', 'a_b-c')).toBe(
      'https://dash.example.test/auth/callback?code=a_b-c',
    );
  });

  it('encodes a code that would otherwise alter the URL', () => {
    const url = withDashboardCode('https://dash.example.test/auth/callback', 'x&y=1#z');
    expect(new URL(url).searchParams.get('code')).toBe('x&y=1#z');
    expect(new URL(url).hash).toBe('');
  });
});

describe('dashboardAuthConfigSchema dashboardUrl', () => {
  it('is disabled and URL-less by default', () => {
    const parsed = dashboardAuthConfigSchema.parse({});
    expect(parsed.enabled).toBe(false);
    expect(parsed.dashboardUrl).toBeUndefined();
  });

  it('accepts a clean https URL and rejects unsafe ones', () => {
    expect(
      dashboardAuthConfigSchema.safeParse({ dashboardUrl: 'https://dash.example.test' }).success,
    ).toBe(true);
    expect(
      dashboardAuthConfigSchema.safeParse({ dashboardUrl: 'http://dash.example.test' }).success,
    ).toBe(false);
    expect(
      dashboardAuthConfigSchema.safeParse({ dashboardUrl: 'https://dash.example.test?a=1' })
        .success,
    ).toBe(false);
  });
});
