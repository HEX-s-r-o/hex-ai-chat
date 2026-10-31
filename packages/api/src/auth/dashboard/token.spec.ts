import { verify, createPublicKey } from 'crypto';
import { loadDashboardKeyRing } from './keys';
import { mintDashboardToken } from './token';
import { decodeJwt, generateTestEd25519 } from './dashboard.helper';

const a = generateTestEd25519();
const b = generateTestEd25519();
const keysJson = JSON.stringify({ 'kid-a': a.privatePem, 'kid-b': b.privatePem });
const NOW = new Date('2026-01-01T00:00:00.000Z');
const NOW_S = Math.floor(NOW.getTime() / 1000);

const params = (activeKid: string, overrides: Record<string, unknown> = {}) => ({
  ring: loadDashboardKeyRing({ keysJson, activeKid }),
  issuer: 'https://chat.example.test',
  audience: 'hex-dashboard',
  ttlSeconds: 300,
  now: NOW,
  userId: 'user-1',
  tenantId: 'tenant-1',
  role: 'USER',
  sid: 'sid-1',
  ...overrides,
});

describe('mintDashboardToken', () => {
  it('emits the contract claims, EdDSA header and a 5 minute lifetime', () => {
    const { token, expiresIn } = mintDashboardToken(params('kid-a'));
    const { header, claims } = decodeJwt(token);
    expect(header).toEqual({ alg: 'EdDSA', typ: 'JWT', kid: 'kid-a' });
    expect(claims).toEqual({
      iss: 'https://chat.example.test',
      aud: 'hex-dashboard',
      sub: 'user-1',
      sid: 'sid-1',
      jti: expect.stringMatching(/^[0-9a-f-]{36}$/),
      iat: NOW_S,
      nbf: NOW_S,
      exp: NOW_S + 300,
      ver: 1,
      tenant_id: 'tenant-1',
      chat_role: 'USER',
      principal_source: 'chat_session',
    });
    expect(expiresIn).toBe(300);
  });

  it('carries no email, username or permission claims', () => {
    const { claims } = decodeJwt(mintDashboardToken(params('kid-a')).token);
    for (const forbidden of ['email', 'username', 'name', 'permissions', 'roles', 'scope']) {
      expect(claims).not.toHaveProperty(forbidden);
    }
  });

  it('signs with the active key only and the signature verifies under that public key', () => {
    for (const [kid, key] of [
      ['kid-a', a.publicKey],
      ['kid-b', b.publicKey],
    ] as const) {
      const { header, signingInput, signature } = decodeJwt(mintDashboardToken(params(kid)).token);
      expect(header.kid).toBe(kid);
      expect(verify(null, Buffer.from(signingInput), key, signature)).toBe(true);
      const other = kid === 'kid-a' ? b.publicKey : a.publicKey;
      expect(verify(null, Buffer.from(signingInput), other, signature)).toBe(false);
    }
  });

  it('is not verifiable with a symmetric secret or by the derived public key of another kid', () => {
    const { signingInput, signature } = decodeJwt(mintDashboardToken(params('kid-a')).token);
    const otherPublic = createPublicKey(b.privatePem);
    expect(verify(null, Buffer.from(signingInput), otherPublic, signature)).toBe(false);
  });

  it('clamps any configured lifetime to 300 seconds and rejects non-positive ones', () => {
    const long = mintDashboardToken(params('kid-a', { ttlSeconds: 3600 }));
    expect(decodeJwt(long.token).claims.exp).toBe(NOW_S + 300);
    expect(() => mintDashboardToken(params('kid-a', { ttlSeconds: 0 }))).toThrow();
    expect(() => mintDashboardToken(params('kid-a', { ttlSeconds: -5 }))).toThrow();
  });

  it('gives every token a unique jti', () => {
    const jtis = new Set(
      Array.from({ length: 50 }, () => decodeJwt(mintDashboardToken(params('kid-a')).token).claims.jti),
    );
    expect(jtis.size).toBe(50);
  });
});
