import { createHash, timingSafeEqual } from 'crypto';

/** Exchange credentials shorter than this are rejected at startup: they must be random, not chosen. */
export const MIN_EXCHANGE_SECRET_LENGTH = 32;
const MAX_AUTHORIZATION_HEADER_LENGTH = 1024;

const digest = (value: string): Buffer => createHash('sha256').update(value, 'utf8').digest();

export class DashboardCredentialError extends Error {
  constructor(public readonly code: 'CREDENTIAL_MISSING' | 'CREDENTIAL_TOO_SHORT') {
    super(`Dashboard exchange credential configuration is invalid (${code})`);
    this.name = 'DashboardCredentialError';
  }
}

/**
 * Verifies the dashboard backend's server-to-server credential (`Authorization: Bearer <secret>`).
 * Accepts the current secret plus an optional previous one, so the credential can be rotated
 * without a coordinated outage. Comparison is constant time over fixed-length digests and always
 * checks every configured secret, so neither length nor position leaks.
 */
export function createDashboardCredentialVerifier(
  secrets: readonly (string | undefined)[],
): (authorizationHeader: unknown) => boolean {
  const configured = secrets.filter((s): s is string => typeof s === 'string' && s !== '');
  if (configured.length === 0) {
    throw new DashboardCredentialError('CREDENTIAL_MISSING');
  }
  if (configured.some((s) => s.length < MIN_EXCHANGE_SECRET_LENGTH)) {
    throw new DashboardCredentialError('CREDENTIAL_TOO_SHORT');
  }
  const digests = configured.map(digest);

  return (authorizationHeader) => {
    if (
      typeof authorizationHeader !== 'string' ||
      authorizationHeader.length > MAX_AUTHORIZATION_HEADER_LENGTH
    ) {
      return false;
    }
    const match = /^Bearer ([^\s]+)$/.exec(authorizationHeader);
    if (!match) {
      return false;
    }
    const presented = digest(match[1]);
    let ok = false;
    for (const candidate of digests) {
      ok = timingSafeEqual(presented, candidate) || ok;
    }
    return ok;
  };
}
