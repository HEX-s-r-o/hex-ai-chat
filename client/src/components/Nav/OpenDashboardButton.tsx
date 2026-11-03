import { LayoutDashboard } from 'lucide-react';
import { Button, TooltipAnchor } from '@librechat/client';
import { useLocalize, useOpenDashboard } from '~/hooks';
import { useGetStartupConfig } from '~/data-provider';
import { dashboardHomeUrl } from '~/utils/dashboard';

/**
 * "Open Dashboard" icon in the sidebar rail, beside new chat and the marketplace. Self-gated on the same
 * server signal as the account-menu entry (`startupConfig.dashboard`: enabled, signed in, allowed tenant),
 * so a deployment or user without the dashboard sees no button at all rather than a broken one.
 *
 * It reuses the account-menu entry's behaviour and nothing else: a real link to the dashboard home
 * (`/dashboard/` in the same-origin deployment); a plain click goes through `useOpenDashboard` (requests a
 * one-time code and navigates in this tab), while modified clicks (new tab, window, download) follow the
 * link as an ordinary navigation and never request a code.
 */
export default function OpenDashboardButton() {
  const localize = useLocalize();
  const { data: startupConfig } = useGetStartupConfig();
  const callbackUrl = startupConfig?.dashboard?.callbackUrl;
  const { openDashboard, isOpening } = useOpenDashboard(callbackUrl);

  if (callbackUrl == null) {
    return null;
  }

  const home = dashboardHomeUrl(callbackUrl);
  const label = localize('com_ui_dashboard_open_button');

  return (
    <TooltipAnchor
      side="right"
      description={label}
      render={
        <Button
          asChild
          variant="ghost"
          size="icon"
          className="h-9 w-9 shrink-0"
          aria-disabled={isOpening}
        >
          <a
            href={home}
            data-testid="nav-open-dashboard-button"
            aria-label={label}
            onClick={(event) => {
              if (
                event.button !== 0 ||
                event.ctrlKey ||
                event.metaKey ||
                event.shiftKey ||
                event.altKey
              ) {
                return;
              }
              event.preventDefault();
              void openDashboard();
            }}
          >
            <LayoutDashboard className="text-text-primary h-5 w-5" aria-hidden="true" />
          </a>
        </Button>
      }
    />
  );
}
