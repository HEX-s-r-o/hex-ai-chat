import '@testing-library/jest-dom/extend-expect';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import OpenDashboardButton from '../OpenDashboardButton';
import { useGetStartupConfig } from '~/data-provider';

const CALLBACK = 'https://chat.example.test/dashboard/auth/callback';
const mockRequestDashboardCode = jest.fn();
const mockNavigateTo = jest.fn();
const mockShowToast = jest.fn();

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
jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
  useOpenDashboard: jest.requireActual('~/hooks/useOpenDashboard').default,
}));
jest.mock('~/hooks/useLocalize', () => ({ __esModule: true, default: () => (key: string) => key }));
jest.mock('~/utils/dashboard', () => ({
  ...jest.requireActual('~/utils/dashboard'),
  navigateTo: (...args: unknown[]) => mockNavigateTo(...args),
}));
jest.mock('~/data-provider', () => ({ useGetStartupConfig: jest.fn() }));

const mockConfig = (data: unknown) => (useGetStartupConfig as jest.Mock).mockReturnValue({ data });

describe('OpenDashboardButton', () => {
  beforeEach(() => jest.clearAllMocks());

  it('renders nothing when the server does not advertise a dashboard (signed out, disabled, wrong tenant)', () => {
    mockConfig({});
    const { container } = render(<OpenDashboardButton />);
    expect(container).toBeEmptyDOMElement();
    mockConfig(undefined);
    const again = render(<OpenDashboardButton />);
    expect(again.container).toBeEmptyDOMElement();
  });

  it('is a labelled link to the dashboard home, reachable by keyboard', () => {
    mockConfig({ dashboard: { callbackUrl: CALLBACK } });
    render(<OpenDashboardButton />);
    const link = screen.getByRole('link', { name: 'com_ui_dashboard_open_button' });
    expect(link).toHaveAttribute('href', 'https://chat.example.test/dashboard/');
    expect(link).toHaveAttribute('data-testid', 'nav-open-dashboard-button');
    link.focus();
    expect(link).toHaveFocus();
  });

  it('a plain click signs in with a one-time code and navigates this tab to the callback', async () => {
    mockConfig({ dashboard: { callbackUrl: CALLBACK } });
    mockRequestDashboardCode.mockResolvedValue({ code: 'synthetic-code' });
    render(<OpenDashboardButton />);
    fireEvent.click(screen.getByRole('link', { name: 'com_ui_dashboard_open_button' }));
    await waitFor(() => expect(mockNavigateTo).toHaveBeenCalledTimes(1));
    expect(mockNavigateTo).toHaveBeenCalledWith(`${CALLBACK}?code=synthetic-code`);
  });

  it.each([
    ['ctrl', { ctrlKey: true }],
    ['meta', { metaKey: true }],
    ['shift', { shiftKey: true }],
    ['alt', { altKey: true }],
    ['middle button', { button: 1 }],
  ])('a %s click follows the link as a normal navigation and requests no code', (_name, init) => {
    mockConfig({ dashboard: { callbackUrl: CALLBACK } });
    render(<OpenDashboardButton />);
    fireEvent.click(screen.getByRole('link', { name: 'com_ui_dashboard_open_button' }), init);
    expect(mockRequestDashboardCode).not.toHaveBeenCalled();
    expect(mockNavigateTo).not.toHaveBeenCalled();
  });
});
