import { createHash, randomBytes } from 'crypto';

const CODE_BYTES = 32;
const HANDLE_BYTES = 32;
const SID_BYTES = 16;

/** base64url of 32 random bytes is exactly 43 characters; anything else is rejected before lookup. */
const SECRET_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** 256-bit single-use redemption code. */
export function generateDashboardCode(): string {
  return randomBytes(CODE_BYTES).toString('base64url');
}

/** 256-bit opaque handle the dashboard presents to revoke; stored hashed. */
export function generateDashboardHandle(): string {
  return randomBytes(HANDLE_BYTES).toString('base64url');
}

/** Opaque session id embedded as `sid`. Not a secret and not a database id. */
export function generateDashboardSid(): string {
  return randomBytes(SID_BYTES).toString('base64url');
}

export function isWellFormedDashboardSecret(value: unknown): value is string {
  return typeof value === 'string' && SECRET_PATTERN.test(value);
}

/**
 * The inputs are 256-bit random values, so a single SHA-256 is a sufficient one-way function
 * (there is nothing to brute-force). The domain prefix keeps a code hash from ever equalling a
 * handle hash.
 */
export function hashDashboardCode(code: string): string {
  return createHash('sha256').update(`hex-dashboard:code:v1:${code}`, 'utf8').digest('hex');
}

export function hashDashboardHandle(handle: string): string {
  return createHash('sha256').update(`hex-dashboard:handle:v1:${handle}`, 'utf8').digest('hex');
}
