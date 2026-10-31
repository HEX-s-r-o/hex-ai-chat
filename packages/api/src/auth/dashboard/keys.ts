import { createPrivateKey, createPublicKey } from 'crypto';
import { DASHBOARD_KID_PATTERN } from 'librechat-data-provider';
import type { JsonWebKey, KeyObject } from 'crypto';

/**
 * Key ring for the dashboard token signer. It holds Ed25519 private keys only, from secrets that
 * are used for nothing else (never `JWT_SECRET`, never the Code API key). Errors name the problem
 * and never echo key material: a JSON/PEM parse failure can quote the offending text.
 */
export interface DashboardKeyRing {
  activeKid: string;
  /** Private keys by `kid`; only `activeKid` signs. Others stay for rollback and public-key export. */
  keys: ReadonlyMap<string, KeyObject>;
}

export type DashboardKeyErrorCode =
  | 'KEYS_MISSING'
  | 'KEYS_MALFORMED'
  | 'KEY_INVALID'
  | 'KEY_NOT_ED25519'
  | 'KID_INVALID'
  | 'ACTIVE_KID_MISSING'
  | 'ACTIVE_KID_UNKNOWN'
  | 'DUPLICATE_KEY_MATERIAL';

export class DashboardKeyError extends Error {
  constructor(public readonly code: DashboardKeyErrorCode) {
    super(`Dashboard signing key configuration is invalid (${code})`);
    this.name = 'DashboardKeyError';
  }
}

export interface DashboardKeySource {
  /** JSON object `{ "<kid>": "<PEM>" | <private JWK> }`. */
  keysJson?: string;
  /** Same JSON, base64-encoded, for secret stores that mangle newlines. */
  keysBase64?: string;
  activeKid?: string;
}

function readKeysJson(source: DashboardKeySource): string {
  const inline = source.keysJson?.trim();
  if (inline) {
    return inline;
  }
  const encoded = source.keysBase64?.trim();
  if (encoded) {
    return Buffer.from(encoded, 'base64').toString('utf8');
  }
  throw new DashboardKeyError('KEYS_MISSING');
}

function loadPrivateKey(material: unknown): KeyObject {
  try {
    if (typeof material === 'string') {
      return createPrivateKey(material.replace(/\\n/g, '\n').trim());
    }
    if (material != null && typeof material === 'object' && !Array.isArray(material)) {
      return createPrivateKey({ key: material as JsonWebKey, format: 'jwk' });
    }
  } catch {
    throw new DashboardKeyError('KEY_INVALID');
  }
  throw new DashboardKeyError('KEY_INVALID');
}

export function loadDashboardKeyRing(source: DashboardKeySource): DashboardKeyRing {
  const raw = readKeysJson(source);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new DashboardKeyError('KEYS_MALFORMED');
  }
  if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new DashboardKeyError('KEYS_MALFORMED');
  }

  const keys = new Map<string, KeyObject>();
  const publicThumbprints = new Set<string>();
  for (const [kid, material] of Object.entries(parsed)) {
    if (!DASHBOARD_KID_PATTERN.test(kid)) {
      throw new DashboardKeyError('KID_INVALID');
    }
    const key = loadPrivateKey(material);
    if (key.asymmetricKeyType !== 'ed25519') {
      throw new DashboardKeyError('KEY_NOT_ED25519');
    }
    const publicX = String(createPublicKey(key).export({ format: 'jwk' }).x);
    if (publicThumbprints.has(publicX)) {
      /** Two kids over one key would defeat rotation: retiring a kid would not retire the key. */
      throw new DashboardKeyError('DUPLICATE_KEY_MATERIAL');
    }
    publicThumbprints.add(publicX);
    keys.set(kid, key);
  }
  if (keys.size === 0) {
    throw new DashboardKeyError('KEYS_MISSING');
  }

  const activeKid = source.activeKid?.trim();
  if (!activeKid) {
    throw new DashboardKeyError('ACTIVE_KID_MISSING');
  }
  if (!keys.has(activeKid)) {
    throw new DashboardKeyError('ACTIVE_KID_UNKNOWN');
  }
  return { activeKid, keys };
}

export interface DashboardPublicJwk {
  kty: 'OKP';
  crv: 'Ed25519';
  x: string;
  kid: string;
  alg: 'EdDSA';
  use: 'sig';
}

/** Public halves of every key in the ring, in the shape the dashboard pins (`{ kid: JWK }`). */
export function getDashboardPublicJwks(ring: DashboardKeyRing): DashboardPublicJwk[] {
  return [...ring.keys.entries()].map(([kid, key]) => {
    const jwk = createPublicKey(key).export({ format: 'jwk' });
    return { kty: 'OKP', crv: 'Ed25519', x: String(jwk.x), kid, alg: 'EdDSA', use: 'sig' };
  });
}
