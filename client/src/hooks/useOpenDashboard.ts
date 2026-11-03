import { useCallback, useRef, useState } from 'react';
import { useToastContext } from '@librechat/client';
import { dataService, withDashboardCode } from 'librechat-data-provider';
import type { DashboardFailure } from '~/utils/dashboard';
import {
  classifyDashboardFailure,
  isSafeDashboardCallbackUrl,
  navigateTo,
} from '~/utils/dashboard';
import { NotificationSeverity } from '~/common';
import useLocalize from './useLocalize';

const MESSAGES: Record<DashboardFailure, Parameters<ReturnType<typeof useLocalize>>[0]> = {
  session_expired: 'com_ui_dashboard_error_session',
  forbidden: 'com_ui_dashboard_error_forbidden',
  unavailable: 'com_ui_dashboard_error_unavailable',
  rate_limited: 'com_ui_dashboard_error_rate_limited',
  network: 'com_ui_dashboard_error_network',
  unknown: 'com_ui_dashboard_error_unknown',
};

/**
 * Requests a one-time dashboard code and navigates to the dashboard callback with it.
 *
 * The code lives only in a local variable for the duration of the call: it is not put in state, a
 * query/mutation cache, storage, a log or an analytics event, and the redirect URL is built at the
 * moment of navigation. A second activation while a request is in flight is ignored, because a new
 * code supersedes the previous one on the server.
 */
export default function useOpenDashboard(callbackUrl: string | undefined) {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const inFlight = useRef(false);
  const [isOpening, setIsOpening] = useState(false);

  const fail = useCallback(
    (failure: DashboardFailure) => {
      showToast({ message: localize(MESSAGES[failure]), severity: NotificationSeverity.ERROR });
    },
    [localize, showToast],
  );

  const openDashboard = useCallback(async () => {
    if (inFlight.current) {
      return;
    }
    if (!isSafeDashboardCallbackUrl(callbackUrl)) {
      fail('unavailable');
      return;
    }
    inFlight.current = true;
    setIsOpening(true);
    try {
      const { code } = await dataService.requestDashboardCode();
      if (typeof code !== 'string' || code.length === 0) {
        fail('unknown');
        return;
      }
      navigateTo(withDashboardCode(callbackUrl, code));
    } catch (error) {
      fail(classifyDashboardFailure(error));
    } finally {
      inFlight.current = false;
      setIsOpening(false);
    }
  }, [callbackUrl, fail]);

  return { openDashboard, isOpening };
}
