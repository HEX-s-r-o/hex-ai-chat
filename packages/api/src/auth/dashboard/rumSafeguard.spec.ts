import { applyDashboardRumSafeguard } from './rumSafeguard';

const rum = {
  provider: 'hyperdx',
  url: '/api/rum',
  advancedNetworkCapture: true,
  consoleCapture: false,
};

describe('applyDashboardRumSafeguard', () => {
  it('switches advanced network capture off when the dashboard issuer is enabled', () => {
    const result = applyDashboardRumSafeguard(rum, { enabled: true });
    expect(result.overridden).toBe(true);
    expect(result.rum).toEqual({ ...rum, advancedNetworkCapture: false });
  });

  it('does not mutate its input', () => {
    const input = { ...rum };
    applyDashboardRumSafeguard(input, { enabled: true });
    expect(input.advancedNetworkCapture).toBe(true);
  });

  it.each([
    ['issuer disabled', { enabled: false }],
    ['issuer unconfigured', undefined],
  ])('leaves capture as configured when the %s', (_n, dashboardAuth) => {
    const result = applyDashboardRumSafeguard(rum, dashboardAuth);
    expect(result).toEqual({ rum, overridden: false });
  });

  it('is a no-op when capture is already off or RUM is absent', () => {
    const off = { ...rum, advancedNetworkCapture: false };
    expect(applyDashboardRumSafeguard(off, { enabled: true })).toEqual({
      rum: off,
      overridden: false,
    });
    expect(applyDashboardRumSafeguard(undefined, { enabled: true })).toEqual({
      rum: undefined,
      overridden: false,
    });
  });

  it('keeps every other RUM option, including console capture, untouched', () => {
    const result = applyDashboardRumSafeguard({ ...rum, consoleCapture: true }, { enabled: true });
    expect(result.rum).toMatchObject({
      consoleCapture: true,
      provider: 'hyperdx',
      url: '/api/rum',
    });
  });
});
