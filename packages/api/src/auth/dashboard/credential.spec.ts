import { createDashboardCredentialVerifier, DashboardCredentialError } from './credential';

const CURRENT = 'c'.repeat(40);
const PREVIOUS = 'p'.repeat(40);

describe('createDashboardCredentialVerifier', () => {
  it('accepts the current and the previous secret (rotation window)', () => {
    const verify = createDashboardCredentialVerifier([CURRENT, PREVIOUS]);
    expect(verify(`Bearer ${CURRENT}`)).toBe(true);
    expect(verify(`Bearer ${PREVIOUS}`)).toBe(true);
  });

  it('accepts only the current secret once the previous one is dropped', () => {
    const verify = createDashboardCredentialVerifier([CURRENT, undefined]);
    expect(verify(`Bearer ${CURRENT}`)).toBe(true);
    expect(verify(`Bearer ${PREVIOUS}`)).toBe(false);
  });

  it.each([
    ['missing header', undefined],
    ['non-string', 42],
    ['wrong secret', `Bearer ${'x'.repeat(40)}`],
    ['prefix of the secret', `Bearer ${CURRENT.slice(0, 39)}`],
    ['secret with suffix', `Bearer ${CURRENT}x`],
    ['wrong scheme', `Basic ${CURRENT}`],
    ['lowercase scheme', `bearer ${CURRENT}`],
    ['no scheme', CURRENT],
    ['extra whitespace', `Bearer  ${CURRENT}`],
    ['two tokens', `Bearer ${CURRENT} ${CURRENT}`],
    ['empty token', 'Bearer '],
    ['oversized header', `Bearer ${'a'.repeat(5000)}`],
  ])('rejects %s', (_name, header) => {
    expect(createDashboardCredentialVerifier([CURRENT])(header)).toBe(false);
  });

  it('refuses to start without a strong credential', () => {
    expect(() => createDashboardCredentialVerifier([undefined, ''])).toThrow(
      DashboardCredentialError,
    );
    expect(() => createDashboardCredentialVerifier(['short'])).toThrow(DashboardCredentialError);
    expect(() => createDashboardCredentialVerifier([CURRENT, 'short'])).toThrow(
      DashboardCredentialError,
    );
  });

  it('never includes the secret in its error', () => {
    try {
      createDashboardCredentialVerifier(['short-secret-value']);
    } catch (error) {
      expect((error as Error).message).not.toContain('short-secret-value');
    }
  });
});
