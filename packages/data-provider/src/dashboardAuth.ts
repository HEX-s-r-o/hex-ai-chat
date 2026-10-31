import { z } from 'zod';

/**
 * Dashboard token issuer contract (ADR-0006). Shared by the chat server and any typed consumer;
 * the dashboard backend implements the same shapes independently.
 */

/** Hard ceilings enforced in code regardless of configuration. */
export const DASHBOARD_MAX_TOKEN_TTL_SECONDS = 300;
export const DASHBOARD_MAX_CODE_TTL_SECONDS = 60;
export const DASHBOARD_DEFAULT_AUDIENCE = 'hex-dashboard';
export const DASHBOARD_TOKEN_VERSION = 1;
export const DASHBOARD_PRINCIPAL_SOURCE = 'chat_session';

/** `kid` values appear in JWT headers and JWKS; keep them URL- and log-safe. */
export const DASHBOARD_KID_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;

/** Stable, machine-readable error codes returned by the dashboard auth endpoints. */
export enum DashboardAuthErrorCode {
  /** Feature switched off in configuration. */
  Disabled = 'DASHBOARD_AUTH_DISABLED',
  /** Enabled but key or credential configuration is unusable; fails closed. */
  Unavailable = 'DASHBOARD_AUTH_UNAVAILABLE',
  /** Missing or wrong dashboard BFF exchange credential. */
  ClientUnauthorized = 'DASHBOARD_CLIENT_UNAUTHORIZED',
  /** Malformed request body or unsupported grant. */
  BadRequest = 'DASHBOARD_BAD_REQUEST',
  /** Unknown, expired, malformed or already-used code. Deliberately not distinguished. */
  CodeInvalid = 'DASHBOARD_CODE_INVALID',
  /** The code's user is disabled or the user/tenant binding no longer holds. */
  PrincipalForbidden = 'DASHBOARD_PRINCIPAL_FORBIDDEN',
  /** Per-user or per-IP budget exhausted. */
  RateLimited = 'DASHBOARD_RATE_LIMITED',
  /** The chat user could not be given a tenant binding. */
  TenantRequired = 'DASHBOARD_TENANT_REQUIRED',
  /** Unexpected server failure; details are never exposed. */
  Internal = 'DASHBOARD_INTERNAL_ERROR',
}

export interface DashboardAuthErrorResponse {
  code: DashboardAuthErrorCode;
  message: string;
}

/** `POST /api/auth/dashboard/code` response (chat web client, authenticated user). */
export interface DashboardCodeResponse {
  code: string;
  expires_in: number;
}

/** `POST /api/auth/dashboard/token` request (dashboard backend). */
export interface DashboardTokenRequest {
  grant: 'code';
  code: string;
}

/** `POST /api/auth/dashboard/token` response (dashboard backend). */
export interface DashboardTokenResponse {
  token: string;
  expires_in: number;
  session_handle: string;
}

/** `POST /api/auth/dashboard/revoke` request (dashboard backend). */
export interface DashboardRevokeRequest {
  session_handle: string;
}

/** Claims in the dashboard JWT, version 1. Email, username and permissions are excluded on purpose. */
export interface DashboardTokenClaims {
  iss: string;
  aud: string;
  sub: string;
  sid: string;
  jti: string;
  iat: number;
  nbf: number;
  exp: number;
  ver: typeof DASHBOARD_TOKEN_VERSION;
  tenant_id: string;
  chat_role: string;
  principal_source: typeof DASHBOARD_PRINCIPAL_SOURCE;
}

/** Path on the dashboard that exchanges the one-time code (dashboard `CALLBACK_PATH`). */
export const DASHBOARD_CALLBACK_PATH = '/auth/callback';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/** A base URL is safe to receive a code only if it is https (or local http) and carries nothing extra. */
export function isValidDashboardBaseUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const secure =
      url.protocol === 'https:' || (url.protocol === 'http:' && LOCAL_HOSTS.has(url.hostname));
    return secure && !url.username && !url.password && !url.search && !url.hash;
  } catch {
    return false;
  }
}

/** `<base>/auth/callback`, normalising a trailing slash on the base. */
export function buildDashboardCallbackUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, '')}${DASHBOARD_CALLBACK_PATH}`;
}

/** Callback URL carrying the one-time code. Built at navigation time and never stored. */
export function withDashboardCode(callbackUrl: string, code: string): string {
  const url = new URL(callbackUrl);
  url.searchParams.set('code', code);
  return url.toString();
}

/**
 * Non-secret issuer settings (`dashboardAuth` in `librechat.yaml`). Private keys and the BFF
 * credential are secrets and come only from the environment; see docs/dashboard-auth.md.
 */
export const dashboardAuthConfigSchema = z.object({
  /** Off by default: endpoints answer 404 and no key is loaded. */
  enabled: z.boolean().optional().default(false),
  /** Exact `iss` value; required when enabled (no default, so it is never guessed). */
  issuer: z.string().min(1).optional(),
  /** Exact `aud` value, a string. */
  audience: z.string().min(1).optional().default(DASHBOARD_DEFAULT_AUDIENCE),
  /** Which key in the configured key ring signs new tokens (rotation switch). */
  activeKid: z.string().regex(DASHBOARD_KID_PATTERN).optional(),
  /** JWT lifetime; capped at 300 s. */
  tokenTtlSeconds: z
    .number()
    .int()
    .min(30)
    .max(DASHBOARD_MAX_TOKEN_TTL_SECONDS)
    .optional()
    .default(DASHBOARD_MAX_TOKEN_TTL_SECONDS),
  /** Redemption code lifetime; capped at 60 s. */
  codeTtlSeconds: z
    .number()
    .int()
    .min(10)
    .max(DASHBOARD_MAX_CODE_TTL_SECONDS)
    .optional()
    .default(DASHBOARD_MAX_CODE_TTL_SECONDS),
  /**
   * Public base URL of the dashboard that receives the sign-in code (no hard-coded default).
   * https only, except http on localhost for local development. No credentials, query or fragment.
   */
  dashboardUrl: z
    .string()
    .refine(isValidDashboardBaseUrl, { message: 'dashboardUrl must be a clean https URL' })
    .optional(),
  /** Tenant a dashboard deployment serves. When set, codes of any other tenant are refused. */
  expectedTenantId: z.string().min(1).optional(),
  /** Tenant value for deployments without tenant isolation. Ignored when TENANT_ISOLATION_STRICT. */
  singleTenantId: z.string().min(1).optional().default('legacy'),
  rateLimits: z
    .object({
      codeRequestsPerFiveMinutes: z.number().int().min(1).optional().default(10),
      exchangeRequestsPerMinute: z.number().int().min(1).optional().default(60),
    })
    .optional(),
});

export type DashboardAuthConfig = z.infer<typeof dashboardAuthConfigSchema>;
