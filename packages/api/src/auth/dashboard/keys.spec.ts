import { createPrivateKey, generateKeyPairSync } from 'crypto';
import { loadDashboardKeyRing, getDashboardPublicJwks, DashboardKeyError } from './keys';
import { generateTestEd25519 } from './dashboard.helper';

describe('loadDashboardKeyRing', () => {
  const a = generateTestEd25519();
  const b = generateTestEd25519();
  const ringJson = JSON.stringify({ 'k-2026-01': a.privatePem, 'k-2026-02': b.privatePem });

  it('loads a PEM ring and selects the configured active key', () => {
    const ring = loadDashboardKeyRing({ keysJson: ringJson, activeKid: 'k-2026-02' });
    expect(ring.activeKid).toBe('k-2026-02');
    expect([...ring.keys.keys()]).toEqual(['k-2026-01', 'k-2026-02']);
  });

  it('accepts a private JWK and the base64 form', () => {
    const jwk = createPrivateKey(a.privatePem).export({ format: 'jwk' });
    const ring = loadDashboardKeyRing({
      keysBase64: Buffer.from(JSON.stringify({ k1: jwk })).toString('base64'),
      activeKid: 'k1',
    });
    expect(ring.keys.get('k1')?.asymmetricKeyType).toBe('ed25519');
  });

  it('accepts PEM newlines escaped as \\n, as env files store them', () => {
    const escaped = a.privatePem.trim().replace(/\n/g, '\\n');
    const ring = loadDashboardKeyRing({
      keysJson: JSON.stringify({ k1: escaped }),
      activeKid: 'k1',
    });
    expect(ring.keys.has('k1')).toBe(true);
  });

  it('exports only public halves, keyed by kid', () => {
    const ring = loadDashboardKeyRing({ keysJson: ringJson, activeKid: 'k-2026-01' });
    const jwks = getDashboardPublicJwks(ring);
    expect(jwks.map((k) => k.kid)).toEqual(['k-2026-01', 'k-2026-02']);
    for (const jwk of jwks) {
      expect(jwk).toMatchObject({ kty: 'OKP', crv: 'Ed25519', alg: 'EdDSA', use: 'sig' });
      expect(jwk).not.toHaveProperty('d');
    }
  });

  const failure = (source: Parameters<typeof loadDashboardKeyRing>[0]) => {
    try {
      loadDashboardKeyRing(source);
    } catch (error) {
      return error as DashboardKeyError;
    }
    throw new Error('expected failure');
  };

  it.each([
    ['no keys', {}, 'KEYS_MISSING'],
    ['empty ring', { keysJson: '{}', activeKid: 'x' }, 'KEYS_MISSING'],
    ['not JSON', { keysJson: 'not-json', activeKid: 'x' }, 'KEYS_MALFORMED'],
    ['array', { keysJson: '[]', activeKid: 'x' }, 'KEYS_MALFORMED'],
    ['no active kid', { keysJson: ringJson }, 'ACTIVE_KID_MISSING'],
    ['unknown active kid', { keysJson: ringJson, activeKid: 'nope' }, 'ACTIVE_KID_UNKNOWN'],
    [
      'bad kid',
      { keysJson: JSON.stringify({ 'bad kid!': a.privatePem }), activeKid: 'x' },
      'KID_INVALID',
    ],
    [
      'garbage key',
      { keysJson: JSON.stringify({ k1: 'garbage' }), activeKid: 'k1' },
      'KEY_INVALID',
    ],
    ['non-string key', { keysJson: JSON.stringify({ k1: 7 }), activeKid: 'k1' }, 'KEY_INVALID'],
    [
      'same key under two kids',
      { keysJson: JSON.stringify({ k1: a.privatePem, k2: a.privatePem }), activeKid: 'k1' },
      'DUPLICATE_KEY_MATERIAL',
    ],
  ])('rejects %s', (_name, source, code) => {
    expect(failure(source as Parameters<typeof loadDashboardKeyRing>[0]).code).toBe(code);
  });

  it('rejects non-Ed25519 keys', () => {
    const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 })
      .privateKey.export({ format: 'pem', type: 'pkcs8' })
      .toString();
    expect(failure({ keysJson: JSON.stringify({ k1: rsa }), activeKid: 'k1' }).code).toBe(
      'KEY_NOT_ED25519',
    );
  });

  it('never echoes key material in an error', () => {
    const secretish = 'SECRET-MARKER-' + a.privatePem.split('\n')[1];
    for (const source of [
      { keysJson: `{"k1": "${secretish}`, activeKid: 'k1' },
      { keysJson: JSON.stringify({ k1: secretish }), activeKid: 'k1' },
    ]) {
      const error = failure(source);
      expect(error.message).not.toContain('SECRET-MARKER');
      expect(error.message).not.toContain(a.privatePem.split('\n')[1]);
    }
  });
});
