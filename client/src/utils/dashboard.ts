import { isValidDashboardBaseUrl } from 'librechat-data-provider';

/** User-facing failure classes for requesting a dashboard code; each maps to one localized message. */
export type DashboardFailure =
  | 'session_expired'
  | 'forbidden'
  | 'unavailable'
  | 'rate_limited'
  | 'network'
  | 'unknown';

interface ErrorLike {
  response?: { status?: number } | null;
  request?: unknown;
}

/**
 * Classifies a failed `POST /api/auth/dashboard/code` by HTTP status only. The response body, URL and
 * headers are never read, so nothing request- or response-derived can reach the UI or a log.
 */
export function classifyDashboardFailure(error: unknown): DashboardFailure {
  if (error == null || typeof error !== 'object') {
    return 'unknown';
  }
  const { response, request } = error as ErrorLike;
  if (response == null) {
    return request != null ? 'network' : 'unknown';
  }
  switch (response.status) {
    case 401:
      return 'session_expired';
    case 403:
      return 'forbidden';
    case 404:
    case 503:
      return 'unavailable';
    case 429:
      return 'rate_limited';
    default:
      return 'unknown';
  }
}

/** Only a clean https (or local http) callback may receive the code; anything else is not followed. */
export function isSafeDashboardCallbackUrl(url: unknown): url is string {
  return typeof url === 'string' && isValidDashboardBaseUrl(url);
}

/** Separate from the hook so tests can observe navigation without a real page load. */
export function navigateTo(url: string): void {
  window.location.assign(url);
}
