import { renderHook, act } from '@testing-library/react';
import useOpenDashboard from '../useOpenDashboard';

const TEST_CODE = 'test-code-0123456789abcdefghijklmnopqrstuvwxyzA';
const CALLBACK = 'https://dash.example.test/auth/callback';

const mockRequestDashboardCode = jest.fn();
const mockShowToast = jest.fn();
const mockNavigateTo = jest.fn();

jest.mock('librechat-data-provider', () => {
  const actual = jest.requireActual('librechat-data-provider');
  return {
    ...actual,
    dataService: {
      ...actual.dataService,
      requestDashboardCode: (...args: unknown[]) => mockRequestDashboardCode(...args),
    },
  };
});
jest.mock('@librechat/client', () => ({
  ...jest.requireActual('@librechat/client'),
  useToastContext: () => ({ showToast: mockShowToast }),
}));
jest.mock('~/hooks/useLocalize', () => ({
  __esModule: true,
  default: () => (key: string) => key,
}));
jest.mock('~/utils/dashboard', () => ({
  ...jest.requireActual('~/utils/dashboard'),
  navigateTo: (...args: unknown[]) => mockNavigateTo(...args),
}));

const httpError = (status: number) => ({ response: { status, data: { code: 'IGNORED' } } });

describe('useOpenDashboard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
  });

  it('requests a code and navigates to the callback with it', async () => {
    mockRequestDashboardCode.mockResolvedValue({ code: TEST_CODE, expires_in: 60 });
    const { result } = renderHook(() => useOpenDashboard(CALLBACK));

    await act(async () => {
      await result.current.openDashboard();
    });

    expect(mockNavigateTo).toHaveBeenCalledTimes(1);
    expect(mockNavigateTo).toHaveBeenCalledWith(`${CALLBACK}?code=${TEST_CODE}`);
    expect(mockShowToast).not.toHaveBeenCalled();
    expect(result.current.isOpening).toBe(false);
  });

  it('never writes the code to browser storage or the console', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) =>
      jest.spyOn(console, m).mockImplementation(() => undefined),
    );
    mockRequestDashboardCode.mockResolvedValue({ code: TEST_CODE, expires_in: 60 });
    const { result } = renderHook(() => useOpenDashboard(CALLBACK));

    await act(async () => {
      await result.current.openDashboard();
    });

    expect(JSON.stringify({ ...localStorage })).not.toContain(TEST_CODE);
    expect(JSON.stringify({ ...sessionStorage })).not.toContain(TEST_CODE);
    expect(JSON.stringify(spies.map((s) => s.mock.calls))).not.toContain(TEST_CODE);
    spies.forEach((s) => s.mockRestore());
  });

  it.each([
    ['401 session expired', httpError(401), 'com_ui_dashboard_error_session'],
    ['403 not permitted', httpError(403), 'com_ui_dashboard_error_forbidden'],
    ['404 issuer disabled', httpError(404), 'com_ui_dashboard_error_unavailable'],
    ['503 issuer unavailable', httpError(503), 'com_ui_dashboard_error_unavailable'],
    ['429 rate limited', httpError(429), 'com_ui_dashboard_error_rate_limited'],
    ['500 unexpected', httpError(500), 'com_ui_dashboard_error_unknown'],
    [
      'network failure',
      { request: {}, message: 'Network Error' },
      'com_ui_dashboard_error_network',
    ],
    ['non-error rejection', 'boom', 'com_ui_dashboard_error_unknown'],
  ])('shows a localized, actionable error and does not navigate: %s', async (_n, error, key) => {
    mockRequestDashboardCode.mockRejectedValue(error);
    const { result } = renderHook(() => useOpenDashboard(CALLBACK));

    await act(async () => {
      await result.current.openDashboard();
    });

    expect(mockNavigateTo).not.toHaveBeenCalled();
    expect(mockShowToast).toHaveBeenCalledTimes(1);
    expect(mockShowToast).toHaveBeenCalledWith({ message: key, severity: 'error' });
    expect(result.current.isOpening).toBe(false);
  });

  it('lets the user retry after a failure', async () => {
    mockRequestDashboardCode.mockRejectedValueOnce(httpError(429));
    mockRequestDashboardCode.mockResolvedValueOnce({ code: TEST_CODE, expires_in: 60 });
    const { result } = renderHook(() => useOpenDashboard(CALLBACK));

    await act(async () => {
      await result.current.openDashboard();
    });
    await act(async () => {
      await result.current.openDashboard();
    });

    expect(mockNavigateTo).toHaveBeenCalledTimes(1);
  });

  it('ignores a second activation while a request is in flight', async () => {
    let resolve!: (value: { code: string; expires_in: number }) => void;
    mockRequestDashboardCode.mockReturnValue(new Promise((r) => (resolve = r)));
    const { result } = renderHook(() => useOpenDashboard(CALLBACK));

    let first!: Promise<void>;
    await act(async () => {
      first = result.current.openDashboard();
      await result.current.openDashboard();
    });
    expect(result.current.isOpening).toBe(true);
    await act(async () => {
      resolve({ code: TEST_CODE, expires_in: 60 });
      await first;
    });

    expect(mockRequestDashboardCode).toHaveBeenCalledTimes(1);
    expect(mockNavigateTo).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['plain http', 'http://dash.example.test/auth/callback'],
    ['javascript scheme', 'javascript:alert(1)'],
    ['credentials in URL', 'https://user:pw@dash.example.test/auth/callback'],
    ['preset query', 'https://dash.example.test/auth/callback?x=1'],
    ['missing', undefined],
  ])('refuses to request a code for an unsafe callback URL: %s', async (_n, url) => {
    const { result } = renderHook(() => useOpenDashboard(url as string | undefined));

    await act(async () => {
      await result.current.openDashboard();
    });

    expect(mockRequestDashboardCode).not.toHaveBeenCalled();
    expect(mockNavigateTo).not.toHaveBeenCalled();
    expect(mockShowToast).toHaveBeenCalledWith({
      message: 'com_ui_dashboard_error_unavailable',
      severity: 'error',
    });
  });

  it('rejects a response without a code', async () => {
    mockRequestDashboardCode.mockResolvedValue({ expires_in: 60 });
    const { result } = renderHook(() => useOpenDashboard(CALLBACK));

    await act(async () => {
      await result.current.openDashboard();
    });

    expect(mockNavigateTo).not.toHaveBeenCalled();
    expect(mockShowToast).toHaveBeenCalledWith({
      message: 'com_ui_dashboard_error_unknown',
      severity: 'error',
    });
  });
});
