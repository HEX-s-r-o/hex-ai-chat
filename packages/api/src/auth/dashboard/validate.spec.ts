import { isLocalEnvironment, validateDashboardAuthSettings } from './validate';

const prod = { NODE_ENV: 'production' } as NodeJS.ProcessEnv;
const dev = { NODE_ENV: 'development' } as NodeJS.ProcessEnv;
const good = {
  enabled: true,
  issuer: 'https://chat.acme-internal.dev',
  dashboardUrl: 'https://dashboard.acme-internal.dev',
  audience: 'hex-dashboard',
};
const problems = (over: Record<string, unknown>, env = prod) =>
  validateDashboardAuthSettings({ ...good, ...over }, env);

describe('environment classification', () => {
  it.each([
    ['development', true],
    ['test', true],
    ['production', false],
    ['staging', false],
    [undefined, false],
    ['', false],
  ])('NODE_ENV=%p is local: %p (an unset variable is never treated as local)', (value, local) => {
    expect(isLocalEnvironment({ NODE_ENV: value } as NodeJS.ProcessEnv)).toBe(local);
  });
});

describe('validateDashboardAuthSettings', () => {
  it('accepts a complete production configuration', () => {
    expect(problems({})).toEqual([]);
  });

  it('does nothing while the issuer is disabled or unset', () => {
    expect(validateDashboardAuthSettings(undefined, prod)).toEqual([]);
    expect(
      validateDashboardAuthSettings({ enabled: false, dashboardUrl: 'http://localhost' }, prod),
    ).toEqual([]);
  });

  describe('dashboardUrl outside local development', () => {
    it.each([
      ['plain http', 'http://dashboard.acme-internal.dev', 'DASHBOARD_URL_NOT_HTTPS'],
      ['localhost', 'https://localhost', 'DASHBOARD_URL_LOCAL_HOST'],
      ['loopback IP', 'https://127.0.0.1', 'DASHBOARD_URL_LOCAL_HOST'],
      ['private IP', 'https://10.0.0.5', 'DASHBOARD_URL_LOCAL_HOST'],
      ['IPv6 loopback', 'https://[::1]', 'DASHBOARD_URL_LOCAL_HOST'],
      ['http localhost', 'http://localhost:5273', 'DASHBOARD_URL_NOT_HTTPS'],
      ['reserved .test host', 'https://dashboard.corp.test', 'DASHBOARD_URL_LOCAL_HOST'],
      ['.local host', 'https://dashboard.corp.local', 'DASHBOARD_URL_LOCAL_HOST'],
      [
        'credentials in the URL',
        'https://user:pw@dashboard.acme-internal.dev',
        'DASHBOARD_URL_INVALID',
      ],
      ['a query string', 'https://dashboard.acme-internal.dev?x=1', 'DASHBOARD_URL_INVALID'],
      ['a fragment', 'https://dashboard.acme-internal.dev/#f', 'DASHBOARD_URL_INVALID'],
      ['not a URL', 'dashboard', 'DASHBOARD_URL_INVALID'],
      ['javascript scheme', 'javascript:alert(1)', 'DASHBOARD_URL_INVALID'],
      ['template example.com', 'https://dashboard.example.com', 'DASHBOARD_URL_PLACEHOLDER'],
      ['angle-bracket placeholder', 'https://<dashboard-host>', 'DASHBOARD_URL_INVALID'],
      ['.invalid placeholder', 'https://dashboard.corp.invalid', 'DASHBOARD_URL_PLACEHOLDER'],
      ['change-me', 'https://change-me.acme-internal.dev', 'DASHBOARD_URL_PLACEHOLDER'],
    ])('rejects %s', (_name, dashboardUrl, code) => {
      expect(problems({ dashboardUrl })).toContain(code);
    });
  });

  describe('local development', () => {
    it.each([
      'http://localhost:5273',
      'http://127.0.0.1:5273',
      'https://dashboard.acme-internal.dev',
      'http://[::1]:5273',
    ])('allows %s', (dashboardUrl) => {
      expect(problems({ dashboardUrl, issuer: 'http://127.0.0.1:3080' }, dev)).toEqual([]);
    });

    it('still refuses plain http to a non-loopback host, credentials, and placeholders', () => {
      expect(problems({ dashboardUrl: 'http://dashboard.acme-internal.dev' }, dev)).toContain(
        'DASHBOARD_URL_NOT_HTTPS',
      );
      expect(problems({ dashboardUrl: 'https://u:p@localhost' }, dev)).toContain(
        'DASHBOARD_URL_INVALID',
      );
      expect(problems({ dashboardUrl: 'https://dashboard.example.com' }, dev)).toContain(
        'DASHBOARD_URL_PLACEHOLDER',
      );
      expect(problems({ issuer: 'https://<chat-host>' }, dev)).toEqual(
        expect.arrayContaining(['ISSUER_PLACEHOLDER']),
      );
    });

    it('treats NODE_ENV=test as local too', () => {
      expect(
        problems({ dashboardUrl: 'http://localhost:5273' }, {
          NODE_ENV: 'test',
        } as NodeJS.ProcessEnv),
      ).toEqual([]);
    });
  });

  it('applies the strict rules when NODE_ENV is unset', () => {
    expect(problems({ dashboardUrl: 'http://localhost:5273' }, {})).toEqual(
      expect.arrayContaining(['DASHBOARD_URL_NOT_HTTPS', 'DASHBOARD_URL_LOCAL_HOST']),
    );
  });

  describe('issuer', () => {
    it.each([
      ['http', 'http://chat.acme-internal.dev', 'ISSUER_NOT_HTTPS'],
      ['localhost', 'https://localhost:3080', 'ISSUER_LOCAL_HOST'],
      ['placeholder', 'https://chat.example.com', 'ISSUER_PLACEHOLDER'],
      ['not a URL in production', 'hex-chat', 'ISSUER_INVALID'],
      ['credentials', 'https://u:p@chat.acme-internal.dev', 'ISSUER_INVALID'],
    ])('rejects %s in production', (_name, issuer, code) => {
      expect(problems({ issuer })).toContain(code);
    });

    it('allows a non-URL issuer string only in local development', () => {
      expect(problems({ issuer: 'hex-chat-dev' }, dev)).toEqual([]);
    });
  });

  it.each(['', '  ', 'has space', '<audience>', 'change-me'])(
    'rejects the audience %p',
    (audience) => {
      expect(problems({ audience })).toContain('AUDIENCE_INVALID');
    },
  );

  it('rejects a template placeholder used as the exchange credential, current or previous, in any environment', () => {
    for (const env of [prod, dev]) {
      expect(
        validateDashboardAuthSettings(good, {
          ...env,
          DASHBOARD_EXCHANGE_SECRET: 'change-me-to-at-least-32-random-characters',
        }),
      ).toContain('EXCHANGE_SECRET_PLACEHOLDER');
      expect(
        validateDashboardAuthSettings(good, {
          ...env,
          DASHBOARD_EXCHANGE_SECRET_PREVIOUS: '<previous-credential-placeholder>',
        }),
      ).toContain('EXCHANGE_SECRET_PLACEHOLDER');
    }
    expect(
      validateDashboardAuthSettings(good, {
        ...prod,
        DASHBOARD_EXCHANGE_SECRET: 'Qm7vK2xRtB9sLp4WzYc8NfHd3JgA6eUo',
      }),
    ).toEqual([]);
  });

  it('reports every problem once, as codes only, and never echoes a value', () => {
    const result = validateDashboardAuthSettings(
      {
        enabled: true,
        dashboardUrl: 'http://localhost',
        issuer: 'https://u:SECRETPW@chat.example.com',
        audience: 'a b',
      },
      { ...prod, DASHBOARD_EXCHANGE_SECRET: 'change-me-SECRETVALUE' },
    );
    expect(new Set(result).size).toBe(result.length);
    expect(result.length).toBeGreaterThan(4);
    for (const code of result) expect(code).toMatch(/^[A-Z_]+$/);
    expect(JSON.stringify(result)).not.toMatch(/SECRETPW|SECRETVALUE|localhost/);
  });
});
