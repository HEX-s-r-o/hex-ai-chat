import { createHash } from 'crypto';
import { logger } from '@librechat/data-schemas';
import {
  DASHBOARD_DEFAULT_AUDIENCE,
  DASHBOARD_MAX_CODE_TTL_SECONDS,
  DASHBOARD_MAX_TOKEN_TTL_SECONDS,
} from 'librechat-data-provider';
import type { AppConfig } from '@librechat/data-schemas';
import type {
  DashboardAuthService,
  DashboardCodeStore,
  DashboardServiceConfig,
  DashboardUser,
} from './service';
import { createDashboardCredentialVerifier, DashboardCredentialError } from './credential';
import { loadDashboardKeyRing, DashboardKeyError } from './keys';
import { validateDashboardAuthSettings } from './validate';
import { createDashboardAuthService } from './service';
import { isEnabled } from '~/utils/common';

export interface DashboardRateLimits {
  codeRequestsPerFiveMinutes: number;
  exchangeRequestsPerMinute: number;
}

export type DashboardRuntime =
  | { status: 'disabled' }
  | { status: 'unavailable' }
  | {
      status: 'ready';
      service: DashboardAuthService;
      verifyCredential: (authorizationHeader: unknown) => boolean;
      limits: DashboardRateLimits;
    };

export interface DashboardRuntimeDeps {
  /** Returns the base application config; `config.dashboardAuth` holds the non-secret settings. */
  getAppConfig: () => Promise<Pick<AppConfig, 'config'>>;
  store: DashboardCodeStore;
  findUserById: (userId: string) => Promise<DashboardUser | null>;
  env?: NodeJS.ProcessEnv;
  now?: () => Date;
}

const DEFAULT_LIMITS: DashboardRateLimits = {
  codeRequestsPerFiveMinutes: 10,
  exchangeRequestsPerMinute: 60,
};

export const DISABLED_RUNTIME: DashboardRuntime = { status: 'disabled' };
const UNAVAILABLE_RUNTIME: DashboardRuntime = { status: 'unavailable' };

/**
 * Builds the issuer from `dashboardAuth` (non-secret, `librechat.yaml`) and environment secrets:
 *
 * - `DASHBOARD_JWT_KEYS` / `DASHBOARD_JWT_KEYS_BASE64`: key ring `{ kid: private key }`
 * - `DASHBOARD_JWT_KID`: active key when `dashboardAuth.activeKid` is not set
 * - `DASHBOARD_EXCHANGE_SECRET` (+ optional `DASHBOARD_EXCHANGE_SECRET_PREVIOUS`): BFF credential
 *
 * Disabled means no key is read. Enabled but unusable means `unavailable`: endpoints answer 503 and
 * nothing is issued, so a misconfiguration can never degrade into weaker auth. Only a reason code
 * is logged, once per distinct configuration.
 */
export function createDashboardRuntimeResolver(
  deps: DashboardRuntimeDeps,
): () => Promise<DashboardRuntime> {
  const env = deps.env ?? process.env;
  let cachedSignature: string | undefined;
  let cachedRuntime: DashboardRuntime = DISABLED_RUNTIME;

  return async () => {
    const settings = (await deps.getAppConfig()).config?.dashboardAuth;
    if (!settings?.enabled) {
      return DISABLED_RUNTIME;
    }

    const signature = createHash('sha256')
      .update(
        JSON.stringify([
          settings,
          env.DASHBOARD_JWT_KEYS,
          env.DASHBOARD_JWT_KEYS_BASE64,
          env.DASHBOARD_JWT_KID,
          env.DASHBOARD_EXCHANGE_SECRET,
          env.DASHBOARD_EXCHANGE_SECRET_PREVIOUS,
          env.TENANT_ISOLATION_STRICT,
          env.NODE_ENV,
        ]),
      )
      .digest('hex');
    if (signature === cachedSignature) {
      return cachedRuntime;
    }

    cachedSignature = signature;
    cachedRuntime = build(settings);
    return cachedRuntime;
  };

  function build(
    settings: NonNullable<NonNullable<AppConfig['config']>['dashboardAuth']>,
  ): DashboardRuntime {
    /** Placeholder, plain-http, localhost or malformed settings outside local development: issue nothing. */
    const problems = validateDashboardAuthSettings(settings, env);
    if (problems.length > 0) {
      logger.error('[dashboardAuth] disabled by invalid configuration', {
        reason: problems.join(','),
      });
      return UNAVAILABLE_RUNTIME;
    }
    try {
      if (!settings.issuer) {
        throw new Error('ISSUER_MISSING');
      }
      const ring = loadDashboardKeyRing({
        keysJson: env.DASHBOARD_JWT_KEYS,
        keysBase64: env.DASHBOARD_JWT_KEYS_BASE64,
        activeKid: settings.activeKid ?? env.DASHBOARD_JWT_KID,
      });
      const verifyCredential = createDashboardCredentialVerifier([
        env.DASHBOARD_EXCHANGE_SECRET,
        env.DASHBOARD_EXCHANGE_SECRET_PREVIOUS,
      ]);
      const config: DashboardServiceConfig = {
        issuer: settings.issuer,
        audience: settings.audience ?? DASHBOARD_DEFAULT_AUDIENCE,
        tokenTtlSeconds: Math.min(settings.tokenTtlSeconds ?? 300, DASHBOARD_MAX_TOKEN_TTL_SECONDS),
        codeTtlSeconds: Math.min(settings.codeTtlSeconds ?? 60, DASHBOARD_MAX_CODE_TTL_SECONDS),
        expectedTenantId: settings.expectedTenantId,
        singleTenantId: settings.singleTenantId ?? 'legacy',
        strictTenant: isEnabled(env.TENANT_ISOLATION_STRICT),
      };
      return {
        status: 'ready',
        service: createDashboardAuthService({
          config,
          ring,
          store: deps.store,
          findUserById: deps.findUserById,
          now: deps.now,
        }),
        verifyCredential,
        limits: { ...DEFAULT_LIMITS, ...settings.rateLimits },
      };
    } catch (error) {
      let reason = 'UNEXPECTED';
      if (error instanceof DashboardKeyError || error instanceof DashboardCredentialError) {
        reason = error.code;
      } else if (error instanceof Error && error.message === 'ISSUER_MISSING') {
        reason = 'ISSUER_MISSING';
      }
      logger.error('[dashboardAuth] disabled by invalid configuration', { reason });
      return UNAVAILABLE_RUNTIME;
    }
  }
}
