import {
  hashDashboardCode,
  hashDashboardHandle,
  generateDashboardCode,
  generateDashboardHandle,
  isWellFormedDashboardSecret,
} from './codes';

describe('dashboard codes', () => {
  it('generates distinct 256-bit url-safe values', () => {
    const codes = new Set(Array.from({ length: 200 }, generateDashboardCode));
    expect(codes.size).toBe(200);
    for (const code of codes) {
      expect(code).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(isWellFormedDashboardSecret(code)).toBe(true);
    }
  });

  it('hashes to a stable hex digest that does not contain the input', () => {
    const code = generateDashboardCode();
    const hash = hashDashboardCode(code);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).toBe(hashDashboardCode(code));
    expect(hash).not.toContain(code);
    expect(hashDashboardCode(generateDashboardCode())).not.toBe(hash);
  });

  it('domain-separates code hashes from handle hashes', () => {
    const value = generateDashboardCode();
    expect(hashDashboardCode(value)).not.toBe(hashDashboardHandle(value));
    expect(isWellFormedDashboardSecret(generateDashboardHandle())).toBe(true);
  });

  it.each([undefined, null, 5, '', 'short', 'a'.repeat(44), `${'a'.repeat(42)}!`, `${'a'.repeat(42)}\n`])(
    'rejects malformed secret %p',
    (value) => {
      expect(isWellFormedDashboardSecret(value)).toBe(false);
    },
  );
});
