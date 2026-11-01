import '@testing-library/jest-dom/extend-expect';
import * as Menu from '@ariakit/react/menu';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import AccountSettings, { OpenDashboardMenuItem } from '../AccountSettings';
import { useGetStartupConfig, useGetUserBalance } from '~/data-provider';
import { useAuthContext } from '~/hooks/AuthContext';

const CALLBACK = 'https://dash.example.test/auth/callback';
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
jest.mock('~/data-provider', () => ({
  useGetStartupConfig: jest.fn(),
  useGetUserBalance: jest.fn(),
}));
jest.mock('~/hooks/AuthContext', () => ({ useAuthContext: jest.fn() }));
jest.mock('~/store', () => ({ showShortcutsDialog: {} }));
jest.mock('recoil', () => ({ useSetRecoilState: () => jest.fn() }));
jest.mock('../Settings', () => ({ __esModule: true, default: () => null }));
jest.mock('~/components/Nav/SettingsTabs/General/ArchivedChatsModal', () => ({
  ArchivedChatsModal: () => null,
}));

function renderItem() {
  return render(
    <Menu.MenuProvider open>
      <Menu.Menu>
        <OpenDashboardMenuItem callbackUrl={CALLBACK} />
      </Menu.Menu>
    </Menu.MenuProvider>,
  );
}

describe('OpenDashboardMenuItem', () => {
  beforeEach(() => jest.clearAllMocks());

  it('is a real link to the dashboard home, same-origin /dashboard/ included', () => {
    const { rerender } = renderItem();
    expect(screen.getByRole('menuitem', { name: 'com_ui_dashboard_open' })).toHaveAttribute(
      'href',
      'https://dash.example.test/',
    );
    rerender(
      <Menu.MenuProvider open>
        <Menu.Menu>
          <OpenDashboardMenuItem callbackUrl="https://chat.staging.example.test/dashboard/auth/callback" />
        </Menu.Menu>
      </Menu.MenuProvider>,
    );
    expect(screen.getByRole('menuitem', { name: 'com_ui_dashboard_open' })).toHaveAttribute(
      'href',
      'https://chat.staging.example.test/dashboard/',
    );
  });

  it.each([{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { button: 1 }])(
    'follows the link without requesting a code for a modified click %j',
    (init) => {
      renderItem();
      fireEvent.click(screen.getByRole('menuitem', { name: 'com_ui_dashboard_open' }), init);
      expect(mockRequestDashboardCode).not.toHaveBeenCalled();
      expect(mockNavigateTo).not.toHaveBeenCalled();
    },
  );

  it('labels the action and redirects with the one-time code on success', async () => {
    mockRequestDashboardCode.mockResolvedValue({ code: 'one-time-code-value', expires_in: 60 });
    renderItem();

    fireEvent.click(screen.getByRole('menuitem', { name: 'com_ui_dashboard_open' }));

    await waitFor(() =>
      expect(mockNavigateTo).toHaveBeenCalledWith(`${CALLBACK}?code=one-time-code-value`),
    );
  });

  it.each([
    [403, 'com_ui_dashboard_error_forbidden'],
    [429, 'com_ui_dashboard_error_rate_limited'],
    [503, 'com_ui_dashboard_error_unavailable'],
  ])('reports a %s rejection to the user and stays on the page', async (status, key) => {
    mockRequestDashboardCode.mockRejectedValue({ response: { status } });
    renderItem();

    fireEvent.click(screen.getByTestId('nav-open-dashboard'));

    await waitFor(() =>
      expect(mockShowToast).toHaveBeenCalledWith({ message: key, severity: 'error' }),
    );
    expect(mockNavigateTo).not.toHaveBeenCalled();
  });

  it('is disabled with progress copy while the request is pending', async () => {
    mockRequestDashboardCode.mockReturnValue(new Promise(() => undefined));
    renderItem();

    fireEvent.click(screen.getByTestId('nav-open-dashboard'));

    await waitFor(() =>
      expect(screen.getByTestId('nav-open-dashboard')).toHaveTextContent(
        'com_ui_dashboard_opening',
      ),
    );
    expect(screen.getByTestId('nav-open-dashboard')).toHaveAttribute('aria-disabled', 'true');
  });
});

describe('AccountSettings dashboard entry', () => {
  const openMenu = (startupConfig: unknown) => {
    (useGetStartupConfig as jest.Mock).mockReturnValue({ data: startupConfig });
    (useGetUserBalance as jest.Mock).mockReturnValue({ data: undefined });
    (useAuthContext as jest.Mock).mockReturnValue({
      user: { name: 'Test User' },
      isAuthenticated: true,
      logout: jest.fn(),
    });
    render(<AccountSettings />);
    fireEvent.click(screen.getByTestId('nav-user'));
  };

  beforeEach(() => jest.clearAllMocks());

  it('shows "Open dashboard" only when the server advertises a callback for this user', async () => {
    openMenu({ dashboard: { callbackUrl: CALLBACK } });
    expect(await screen.findByTestId('nav-open-dashboard')).toBeInTheDocument();
  });

  it.each([[{}], [{ dashboard: undefined }], [undefined]])(
    'hides the entry point when no dashboard is advertised (%j)',
    async (startupConfig) => {
      openMenu(startupConfig);
      expect(await screen.findByTestId('nav-settings')).toBeInTheDocument();
      expect(screen.queryByTestId('nav-open-dashboard')).not.toBeInTheDocument();
    },
  );
});
