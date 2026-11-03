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

/**
 * Regression table for the hostname bypass found in review: `https://localhost.` and the other
 * trailing-dot or non-public forms were accepted outside local development. These are the 32 forms that were
 * probed against the validator; every one is checked as `dashboardUrl` and as `issuer`.
 */
describe('hostname policy outside local development (regression table)', () => {
  const REJECT = 'reject';
  const ACCEPT = 'accept';
  type Expectation = typeof REJECT | typeof ACCEPT;
  const forms: Array<[url: string, expected: Expectation, why: string]> = [
    ['https://localhost', REJECT, 'loopback name'],
    ['https://LOCALHOST', REJECT, 'loopback name, upper case'],
    ['https://localhost.', REJECT, 'loopback name, trailing dot'],
    ['https://localhost:8443', REJECT, 'loopback name with a port'],
    ['https://foo.localhost', REJECT, '.localhost'],
    ['https://foo.localhost.', REJECT, '.localhost, trailing dot'],
    ['https://127.0.0.1', REJECT, 'loopback IPv4'],
    ['https://127.1', REJECT, 'IPv4 shorthand'],
    ['https://0x7f000001', REJECT, 'IPv4 hex'],
    ['https://2130706433', REJECT, 'IPv4 integer'],
    ['https://[::1]', REJECT, 'loopback IPv6'],
    ['https://[::ffff:127.0.0.1]', REJECT, 'IPv4-mapped IPv6'],
    ['https://0.0.0.0', REJECT, 'unspecified address'],
    ['https://10.0.0.5', REJECT, 'private IPv4'],
    ['https://192.168.1.10', REJECT, 'private IPv4'],
    ['https://169.254.169.254', REJECT, 'link-local IPv4'],
    ['https://[fd00::1]', REJECT, 'unique-local IPv6'],
    ['https://dash.corp.test', REJECT, '.test'],
    ['https://dash.corp.test.', REJECT, '.test, trailing dot'],
    ['https://dash.corp.local.', REJECT, '.local, trailing dot'],
    ['https://dash.corp.internal', REJECT, '.internal'],
    ['https://dash.corp.internal.', REJECT, '.internal, trailing dot'],
    ['https://dash.corp.lan', REJECT, '.lan'],
    ['https://dash.corp.home.arpa', REJECT, 'home.arpa'],
    ['https://intranet', REJECT, 'single label'],
    ['https://dashboard', REJECT, 'single label'],
    ['https://dash.example.com.', REJECT, 'template host, trailing dot'],
    ['https://EXAMPLE.COM', REJECT, 'template host, upper case'],
    ['https://dash.example.org/path', REJECT, 'template host with a path'],
    ['https://example.net', REJECT, 'template host'],
    ['https://dashboard.acme-internal.dev', ACCEPT, 'ordinary public name'],
    ['https://dashboard.acme-internal.dev.', ACCEPT, 'ordinary public name, one trailing dot'],
  ];

  it('covers exactly the 32 forms that were probed', () => {
    expect(forms).toHaveLength(32);
    expect(new Set(forms.map(([url]) => url)).size).toBe(32);
    expect(forms.filter(([, expected]) => expected === ACCEPT)).toHaveLength(2);
  });

  describe.each([
    ['dashboardUrl', (url: string) => ({ dashboardUrl: url }), /^DASHBOARD_URL_/],
    ['issuer', (url: string) => ({ issuer: url }), /^ISSUER_/],
  ] as const)('%s', (_field, build, codePattern) => {
    it.each(forms)('%s is %s (%s)', (url, expected) => {
      const found = problems(build(url));
      if (expected === ACCEPT) {
        expect(found).toEqual([]);
      } else {
        expect(found.length).toBeGreaterThan(0);
        for (const code of found) expect(code).toMatch(codePattern);
      }
    });
  });

  it.each([
    ['https://dashboard.acme-internal.dev', 'ordinary two-label domain'],
    ['https://dashboard.acme-internal.dev.', 'ordinary domain with one trailing dot'],
    ['https://app.dash.acme-internal.dev', 'several labels'],
    ['https://app.dash.acme-internal.dev./', 'several labels, trailing dot, explicit root path'],
    ['https://dash.acme.io:8443', 'a port'],
    ['https://xn--dashbord-q3a.acme-internal.dev', 'punycode label'],
    ['https://lan.acme-internal.dev', 'a label named lan that is not the last one'],
    ['https://local.acme-internal.dev', 'a label named local that is not the last one'],
    ['https://test.acme-internal.dev', 'a label named test that is not the last one'],
    ['https://internal.acme-internal.dev', 'a label named internal that is not the last one'],
    ['https://home.arpa.acme-internal.dev', 'home.arpa as a non-final part'],
  ])('keeps accepting %s (%s)', (url) => {
    expect(problems({ dashboardUrl: url, issuer: url })).toEqual([]);
  });

  it.each([
    ['https://localhost..', 'two trailing dots'],
    ['https://dashboard.acme-internal.dev..', 'two trailing dots on a public name'],
    ['https://dash..acme-internal.dev', 'an empty label'],
    ['https://127.0.0.1.', 'IPv4 with a trailing dot'],
    ['https://dash.corp.lan.', '.lan, trailing dot'],
    ['https://dash.corp.home.arpa.', 'home.arpa, trailing dot'],
    ['https://home.arpa', 'home.arpa itself'],
    ['https://intranet.', 'single label, trailing dot'],
    ['https://LOCALHOST.', 'loopback name, upper case and trailing dot'],
    ['http://dashboard.acme-internal.dev.', 'plain http on a public name'],
    ['https://u:p@dashboard.acme-internal.dev.', 'credentials with a trailing dot'],
    ['https://dash.example.com./', 'template host, trailing dot, root path'],
  ])('also rejects %s (%s)', (url) => {
    expect(problems({ dashboardUrl: url }).length).toBeGreaterThan(0);
    expect(problems({ issuer: url }).length).toBeGreaterThan(0);
  });

  it('reports a malformed double dot as invalid, and keeps the specific codes for the common cases', () => {
    expect(problems({ dashboardUrl: 'https://localhost..' })).toContain('DASHBOARD_URL_INVALID');
    expect(problems({ dashboardUrl: 'https://localhost.' })).toContain('DASHBOARD_URL_LOCAL_HOST');
    expect(problems({ dashboardUrl: 'https://intranet' })).toContain('DASHBOARD_URL_LOCAL_HOST');
    expect(problems({ dashboardUrl: 'https://dash.corp.lan' })).toContain(
      'DASHBOARD_URL_LOCAL_HOST',
    );
    expect(problems({ issuer: 'https://dash.corp.home.arpa' })).toContain('ISSUER_LOCAL_HOST');
    expect(problems({ dashboardUrl: 'http://dashboard.acme-internal.dev.' })).toContain(
      'DASHBOARD_URL_NOT_HTTPS',
    );
  });

  it.each([undefined, '', 'staging', 'CI', 'production'])(
    'applies the same policy when NODE_ENV is %p',
    (nodeEnv) => {
      const env = { NODE_ENV: nodeEnv } as NodeJS.ProcessEnv;
      expect(problems({ dashboardUrl: 'https://localhost.' }, env)).toContain(
        'DASHBOARD_URL_LOCAL_HOST',
      );
      expect(problems({ dashboardUrl: 'https://intranet' }, env)).toContain(
        'DASHBOARD_URL_LOCAL_HOST',
      );
      expect(problems({ dashboardUrl: 'https://dashboard.acme-internal.dev.' }, env)).toEqual([]);
    },
  );

  describe('local development stays permissive where it was', () => {
    it.each(['development', 'test'])('NODE_ENV=%s', (nodeEnv) => {
      const env = { NODE_ENV: nodeEnv } as NodeJS.ProcessEnv;
      const local = (url: string, issuer = 'http://127.0.0.1:3080') =>
        problems({ dashboardUrl: url, issuer }, env);
      expect(local('http://localhost:5273')).toEqual([]);
      expect(local('http://localhost.:5273')).toEqual([]); // trailing dot is the same loopback name
      expect(local('http://127.0.0.1:5273')).toEqual([]);
      expect(local('https://intranet')).toEqual([]); // single label is fine for a developer machine
      expect(local('https://dash.corp.lan')).toEqual([]);
      expect(local('https://dashboard.acme-internal.dev.')).toEqual([]);
      // Still refused locally: plain http to a non-loopback name, credentials, placeholders, malformed hosts.
      expect(local('http://dash.corp.lan')).toContain('DASHBOARD_URL_NOT_HTTPS');
      expect(local('https://u:p@localhost')).toContain('DASHBOARD_URL_INVALID');
      expect(local('https://dashboard.example.com.')).toContain('DASHBOARD_URL_PLACEHOLDER');
      expect(local('https://localhost..')).toContain('DASHBOARD_URL_INVALID');
    });
  });

  it('never echoes a hostname in the reported codes', () => {
    const result = problems({
      dashboardUrl: 'https://secret-host.corp.lan.',
      issuer: 'https://user:pw@intranet.',
    });
    expect(JSON.stringify(result)).not.toMatch(/secret-host|corp|intranet|user|pw/);
  });
});
