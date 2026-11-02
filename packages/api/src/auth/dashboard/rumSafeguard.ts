/**
 * The dashboard one-time code is returned in the body of `POST /api/auth/dashboard/code`. The browser RUM
 * SDK's `advancedNetworkCapture` records request and response bodies for every fetch/XHR and cannot
 * exclude a single URL, so the only way to guarantee the code cannot reach observability tooling is to
 * switch that capture off whenever the dashboard issuer is enabled.
 *
 * This runs on the server and applies to every startup-config response (before and after login), because
 * the SDK initialises once, possibly on the login page, and never re-reads its options. `consoleCapture`
 * is untouched: the dashboard code path never writes to the console.
 */
export interface RumCaptureOptions {
  advancedNetworkCapture?: boolean;
}

export function applyDashboardRumSafeguard<T extends RumCaptureOptions>(
  rum: T | undefined,
  dashboardAuth: { enabled?: boolean | undefined } | undefined,
): { rum: T | undefined; overridden: boolean } {
  if (!rum || !dashboardAuth?.enabled || rum.advancedNetworkCapture !== true) {
    return { rum, overridden: false };
  }
  return { rum: { ...rum, advancedNetworkCapture: false }, overridden: true };
}
