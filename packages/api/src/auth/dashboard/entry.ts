import { buildDashboardCallbackUrl } from 'librechat-data-provider';
import type { DashboardAuthConfig } from 'librechat-data-provider';

export interface DashboardEntryUser {
  tenantId?: string | null;
}

/**
 * Decides whether to advertise the "Open dashboard" entry point to a signed-in user. This is a
 * convenience filter that mirrors the issuer's rules (enabled, not an OpenID-reuse session, tenant
 * the dashboard serves); the issuer still enforces everything, and the UI handles its refusals.
 * Returns only the callback URL: never keys, the exchange credential or the expected tenant.
 */
export function resolveDashboardEntry(
  settings: Partial<DashboardAuthConfig> | undefined,
  user: DashboardEntryUser | undefined,
  authStrategy?: string,
): { callbackUrl: string } | undefined {
  if (!settings?.enabled || !settings.dashboardUrl || !user) {
    return undefined;
  }
  if (authStrategy === 'openidJwt') {
    return undefined;
  }
  if (settings.expectedTenantId != null) {
    const tenant = user.tenantId || settings.singleTenantId || 'legacy';
    if (tenant !== settings.expectedTenantId) {
      return undefined;
    }
  }
  return { callbackUrl: buildDashboardCallbackUrl(settings.dashboardUrl) };
}
