import { isIP } from 'net';
/** The only settings the validator reads; satisfied by both the parsed and the raw `dashboardAuth` config. */
export interface DashboardSettingsInput {
  enabled?: boolean | undefined;
  dashboardUrl?: string | undefined;
  issuer?: string | undefined;
  audience?: string | undefined;
}

/**
 * Environment-aware validation of the `dashboardAuth` settings and the exchange credential. It runs when
 * the issuer is built (a problem makes the issuer `unavailable`: nothing is issued) and before the "Open
 * dashboard" entry is advertised. Problems are stable codes, never values.
 *
 * "Local development" means `NODE_ENV` is `development` or `test`. Anything else, including an unset
 * `NODE_ENV`, is treated as non-local, so a missing variable can only make validation stricter.
 */
export type DashboardSettingsProblem =
  | 'DASHBOARD_URL_INVALID'
  | 'DASHBOARD_URL_NOT_HTTPS'
  | 'DASHBOARD_URL_LOCAL_HOST'
  | 'DASHBOARD_URL_PLACEHOLDER'
  | 'ISSUER_INVALID'
  | 'ISSUER_NOT_HTTPS'
  | 'ISSUER_LOCAL_HOST'
  | 'ISSUER_PLACEHOLDER'
  | 'AUDIENCE_INVALID'
  | 'EXCHANGE_SECRET_PLACEHOLDER';

/** Template markers from `librechat.example.yaml` and `.env.example`, and reserved example domains. */
const PLACEHOLDER =
  /[<>]|change[-_ ]?me|replace[-_ ]?(me|with)|placeholder|your[-_](domain|host|key)|\.invalid\b|\bexample\.(com|org|net)\b/i;
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
/**
 * Reserved or non-public names that cannot be a real production host. Matched against the normalised host
 * (see `normalizedHost`), so `corp.lan` and `corp.lan.` are treated alike.
 */
const NON_PUBLIC_NAME = /(^|\.)(test|localhost|local|internal|invalid|lan)$|(^|\.)home\.arpa$/i;

/**
 * The host as it must be judged. The URL parser already lower-cases it. One trailing dot (`localhost.`) is
 * the absolute form of the same name and is removed, so it cannot be used to slip past a check; a second
 * trailing dot or an empty label is malformed and yields `undefined`.
 */
function normalizedHost(url: URL): string | undefined {
  const host = url.hostname.endsWith('.') ? url.hostname.slice(0, -1) : url.hostname;
  return host === '' || host.endsWith('.') || host.includes('..') ? undefined : host;
}

export const isLocalEnvironment = (env: NodeJS.ProcessEnv): boolean =>
  env.NODE_ENV === 'development' || env.NODE_ENV === 'test';

function checkUrl(
  value: string,
  local: boolean,
  codes: {
    invalid: DashboardSettingsProblem;
    notHttps: DashboardSettingsProblem;
    localHost: DashboardSettingsProblem;
    placeholder: DashboardSettingsProblem;
  },
): DashboardSettingsProblem[] {
  const problems: DashboardSettingsProblem[] = [];
  // Check for a template marker before parsing: `https://<chat-host>` does not parse as a URL, and
  // "still a placeholder" is a more useful diagnosis than "invalid".
  if (PLACEHOLDER.test(value)) {
    problems.push(codes.placeholder);
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return [...problems, codes.invalid];
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return [...problems, codes.invalid];
  }
  if (url.username || url.password || url.search || url.hash) {
    problems.push(codes.invalid);
  }
  const host = normalizedHost(url);
  if (host === undefined) {
    return [...problems, codes.invalid];
  }
  const isLoopback = LOCAL_HOSTS.has(host);
  if (local) {
    // Local development: https anywhere, or plain http only on loopback.
    if (url.protocol === 'http:' && !isLoopback) {
      problems.push(codes.notHttps);
    }
    return problems;
  }
  if (url.protocol !== 'https:') {
    problems.push(codes.notHttps);
  }
  // A public name has at least two labels; a single label (`intranet`) resolves only inside a private network.
  const singleLabel = !host.includes('.') && !host.startsWith('[');
  if (
    isLoopback ||
    singleLabel ||
    isIP(host.replace(/^\[|\]$/g, '')) !== 0 ||
    NON_PUBLIC_NAME.test(host)
  ) {
    problems.push(codes.localHost);
  }
  return problems;
}

export function validateDashboardAuthSettings(
  settings: DashboardSettingsInput | undefined,
  env: NodeJS.ProcessEnv = process.env,
): DashboardSettingsProblem[] {
  if (!settings?.enabled) {
    return [];
  }
  const local = isLocalEnvironment(env);
  const problems: DashboardSettingsProblem[] = [];

  if (settings.dashboardUrl != null) {
    problems.push(
      ...checkUrl(settings.dashboardUrl, local, {
        invalid: 'DASHBOARD_URL_INVALID',
        notHttps: 'DASHBOARD_URL_NOT_HTTPS',
        localHost: 'DASHBOARD_URL_LOCAL_HOST',
        placeholder: 'DASHBOARD_URL_PLACEHOLDER',
      }),
    );
  }

  if (settings.issuer != null) {
    // The issuer is an exact-match string; in production it is chat's https URL.
    if (/^[a-z][a-z0-9+.-]*:/i.test(settings.issuer)) {
      problems.push(
        ...checkUrl(settings.issuer, local, {
          invalid: 'ISSUER_INVALID',
          notHttps: 'ISSUER_NOT_HTTPS',
          localHost: 'ISSUER_LOCAL_HOST',
          placeholder: 'ISSUER_PLACEHOLDER',
        }),
      );
    } else if (PLACEHOLDER.test(settings.issuer)) {
      problems.push('ISSUER_PLACEHOLDER');
    } else if (!local) {
      problems.push('ISSUER_INVALID');
    }
  }

  if (
    settings.audience != null &&
    (settings.audience.trim() === '' ||
      /\s/.test(settings.audience) ||
      PLACEHOLDER.test(settings.audience))
  ) {
    problems.push('AUDIENCE_INVALID');
  }

  for (const name of ['DASHBOARD_EXCHANGE_SECRET', 'DASHBOARD_EXCHANGE_SECRET_PREVIOUS'] as const) {
    const secret = env[name];
    if (secret && PLACEHOLDER.test(secret)) {
      problems.push('EXCHANGE_SECRET_PLACEHOLDER');
      break;
    }
  }
  return [...new Set(problems)];
}
