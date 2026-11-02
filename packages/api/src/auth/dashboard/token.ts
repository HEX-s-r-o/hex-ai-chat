import { randomUUID, sign as cryptoSign } from 'crypto';
import {
  DASHBOARD_TOKEN_VERSION,
  DASHBOARD_PRINCIPAL_SOURCE,
  DASHBOARD_MAX_TOKEN_TTL_SECONDS,
} from 'librechat-data-provider';
import type { DashboardTokenClaims } from 'librechat-data-provider';
import type { DashboardKeyRing } from './keys';

export interface DashboardTokenParams {
  ring: DashboardKeyRing;
  issuer: string;
  audience: string;
  ttlSeconds: number;
  now: Date;
  userId: string;
  tenantId: string;
  role: string;
  sid: string;
}

const base64Url = (value: Buffer | string): string => Buffer.from(value).toString('base64url');

/**
 * Mints the dashboard JWT (ADR-0006, version 1). The algorithm is pinned to EdDSA and the lifetime
 * is clamped to 300 s here as well as in configuration, so a bad config cannot mint a long token.
 * Email, username and permissions are never claims.
 */
export function mintDashboardToken(params: DashboardTokenParams): {
  token: string;
  claims: DashboardTokenClaims;
  expiresIn: number;
} {
  const ttl = Math.min(Math.floor(params.ttlSeconds), DASHBOARD_MAX_TOKEN_TTL_SECONDS);
  if (!(ttl > 0)) {
    throw new Error('Dashboard token lifetime must be positive');
  }
  const key = params.ring.keys.get(params.ring.activeKid);
  if (!key) {
    throw new Error('Dashboard active signing key is not loaded');
  }
  const iat = Math.floor(params.now.getTime() / 1000);
  const claims: DashboardTokenClaims = {
    iss: params.issuer,
    aud: params.audience,
    sub: params.userId,
    sid: params.sid,
    jti: randomUUID(),
    iat,
    nbf: iat,
    exp: iat + ttl,
    ver: DASHBOARD_TOKEN_VERSION,
    tenant_id: params.tenantId,
    chat_role: params.role,
    principal_source: DASHBOARD_PRINCIPAL_SOURCE,
  };
  const header = { alg: 'EdDSA', typ: 'JWT', kid: params.ring.activeKid };
  const signingInput = `${base64Url(JSON.stringify(header))}.${base64Url(JSON.stringify(claims))}`;
  const signature = cryptoSign(null, Buffer.from(signingInput), key);
  return { token: `${signingInput}.${base64Url(signature)}`, claims, expiresIn: ttl };
}
