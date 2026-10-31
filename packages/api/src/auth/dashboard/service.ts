import { SYSTEM_TENANT_ID, logger, runAsSystem } from '@librechat/data-schemas';
import { DashboardAuthErrorCode } from 'librechat-data-provider';
import type { DashboardCodeMethods } from '@librechat/data-schemas';
import type { DashboardKeyRing } from './keys';
import {
  hashDashboardCode,
  generateDashboardSid,
  hashDashboardHandle,
  generateDashboardCode,
  generateDashboardHandle,
  isWellFormedDashboardSecret,
} from './codes';
import { mintDashboardToken } from './token';

/** Extra retention beyond the last time a record is needed, so replay stays detectable. */
const PURGE_GRACE_MS = 60_000;

export interface DashboardServiceConfig {
  issuer: string;
  audience: string;
  tokenTtlSeconds: number;
  codeTtlSeconds: number;
  /** When set, only codes bound to this tenant can be issued or redeemed. */
  expectedTenantId?: string;
  /** Tenant value when tenant isolation is not in use. */
  singleTenantId: string;
  /** `TENANT_ISOLATION_STRICT`: a user without a real tenant has no dashboard access. */
  strictTenant: boolean;
}

/** Plain view of a chat user; the caller maps its storage shape to this. */
export interface DashboardUser {
  id: string;
  tenantId?: string;
  role?: string;
  /** Set while account deletion is in progress; such an account is disabled for dashboard access. */
  agentTriggerDeletionStartedAt?: Date | null;
}

export type DashboardCodeStore = Pick<
  DashboardCodeMethods,
  | 'createDashboardCode'
  | 'consumeDashboardCode'
  | 'findDashboardCode'
  | 'deletePendingDashboardCodes'
  | 'revokeDashboardHandle'
  | 'revokeDashboardHandleByCode'
>;

export interface DashboardServiceDeps {
  config: DashboardServiceConfig;
  ring: DashboardKeyRing;
  store: DashboardCodeStore;
  /** Returns `null` for a missing user; a lookup failure must throw, never return `null`. */
  findUserById: (userId: string) => Promise<DashboardUser | null>;
  now?: () => Date;
}

export type DashboardResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: { code: DashboardAuthErrorCode } };

const fail = (code: DashboardAuthErrorCode): { ok: false; error: { code: DashboardAuthErrorCode } } => ({
  ok: false,
  error: { code },
});

export interface IssuedCode {
  code: string;
  expiresIn: number;
}

export interface RedeemedToken {
  token: string;
  expiresIn: number;
  sessionHandle: string;
}

export interface DashboardAuthService {
  issueCode: (
    user: Pick<DashboardUser, 'id' | 'tenantId'>,
    contextTenantId?: string,
  ) => Promise<DashboardResult<IssuedCode>>;
  redeemCode: (code: unknown) => Promise<DashboardResult<RedeemedToken>>;
  revokeHandle: (handle: unknown) => Promise<DashboardResult<{ revoked: boolean }>>;
}

export function resolveDashboardTenant(
  candidate: string | undefined,
  config: Pick<DashboardServiceConfig, 'singleTenantId' | 'strictTenant'>,
): string | undefined {
  const tenantId = candidate?.trim();
  if (tenantId && tenantId !== SYSTEM_TENANT_ID) {
    return tenantId;
  }
  return config.strictTenant ? undefined : config.singleTenantId;
}

export function createDashboardAuthService(deps: DashboardServiceDeps): DashboardAuthService {
  const { config, ring, store } = deps;
  const now = deps.now ?? (() => new Date());

  async function issueCode(
    user: Pick<DashboardUser, 'id' | 'tenantId'>,
    contextTenantId?: string,
  ): Promise<DashboardResult<IssuedCode>> {
    const tenantId = resolveDashboardTenant(user.tenantId ?? contextTenantId, config);
    if (!tenantId) {
      return fail(DashboardAuthErrorCode.TenantRequired);
    }
    if (config.expectedTenantId != null && config.expectedTenantId !== tenantId) {
      return fail(DashboardAuthErrorCode.PrincipalForbidden);
    }
    const issuedAt = now();
    const code = generateDashboardCode();
    const expiresAt = new Date(issuedAt.getTime() + config.codeTtlSeconds * 1000);
    await store.deletePendingDashboardCodes(user.id, tenantId);
    await store.createDashboardCode({
      codeHash: hashDashboardCode(code),
      userId: user.id,
      tenantId,
      expiresAt,
      purgeAt: new Date(expiresAt.getTime() + PURGE_GRACE_MS),
    });
    return { ok: true, value: { code, expiresIn: config.codeTtlSeconds } };
  }

  async function redeemCode(rawCode: unknown): Promise<DashboardResult<RedeemedToken>> {
    if (!isWellFormedDashboardSecret(rawCode)) {
      return fail(DashboardAuthErrorCode.CodeInvalid);
    }
    const codeHash = hashDashboardCode(rawCode);
    const redeemedAt = now();
    const handle = generateDashboardHandle();
    const handleHash = hashDashboardHandle(handle);
    const handleExpiresAt = new Date(redeemedAt.getTime() + config.tokenTtlSeconds * 1000);
    const claimed = await store.consumeDashboardCode({
      codeHash,
      now: redeemedAt,
      sid: generateDashboardSid(),
      handleHash,
      handleExpiresAt,
      purgeAt: new Date(handleExpiresAt.getTime() + PURGE_GRACE_MS),
    });

    if (!claimed) {
      const existing = await store.findDashboardCode(codeHash);
      if (existing?.consumedAt != null) {
        /** Replay: whoever redeemed first may be the attacker, so kill the session it received. */
        await store.revokeDashboardHandleByCode(codeHash, redeemedAt);
        logger.warn('[dashboardAuth] code redemption rejected', { reason: 'reused' });
      } else {
        logger.debug('[dashboardAuth] code redemption rejected', {
          reason: existing ? 'expired' : 'unknown',
        });
      }
      return fail(DashboardAuthErrorCode.CodeInvalid);
    }

    /** The code is spent from here on. Any refusal below also revokes the handle just created. */
    const refuse = async (reason: string): Promise<DashboardResult<RedeemedToken>> => {
      await store.revokeDashboardHandle(handleHash, redeemedAt);
      logger.warn('[dashboardAuth] code redemption refused', { reason });
      return fail(DashboardAuthErrorCode.PrincipalForbidden);
    };

    if (config.expectedTenantId != null && claimed.tenantId !== config.expectedTenantId) {
      return refuse('tenant_mismatch');
    }
    const user = await deps.findUserById(claimed.userId);
    if (!user) {
      return refuse('user_missing');
    }
    if (user.agentTriggerDeletionStartedAt != null) {
      return refuse('user_disabled');
    }
    const currentTenant = resolveDashboardTenant(user.tenantId, config);
    if (currentTenant !== claimed.tenantId) {
      return refuse('tenant_mismatch');
    }

    const { token, expiresIn } = mintDashboardToken({
      ring,
      issuer: config.issuer,
      audience: config.audience,
      ttlSeconds: config.tokenTtlSeconds,
      now: redeemedAt,
      userId: claimed.userId,
      tenantId: claimed.tenantId,
      role: user.role ?? 'USER',
      sid: claimed.sid as string,
    });
    return { ok: true, value: { token, expiresIn, sessionHandle: handle } };
  }

  async function revokeHandle(rawHandle: unknown): Promise<DashboardResult<{ revoked: boolean }>> {
    if (!isWellFormedDashboardSecret(rawHandle)) {
      return fail(DashboardAuthErrorCode.BadRequest);
    }
    const revoked = await store.revokeDashboardHandle(hashDashboardHandle(rawHandle), now());
    return { ok: true, value: { revoked } };
  }

  return { issueCode, redeemCode, revokeHandle };
}

/**
 * Adapts the chat user lookup to the plain {@link DashboardUser} shape. The lookup runs outside any
 * tenant context (the dashboard backend's request has none), so tenant agreement is checked
 * explicitly by the service rather than by the storage layer.
 */
export function createDashboardUserLookup(
  getUserById: (userId: string, fields?: string | string[] | null) => Promise<{
    _id?: { toString(): string };
    tenantId?: string;
    role?: string;
    agentTriggerDeletionStartedAt?: Date;
  } | null>,
): (userId: string) => Promise<DashboardUser | null> {
  return async (userId) => {
    const user = await runAsSystem(() =>
      getUserById(userId, 'role tenantId +agentTriggerDeletionStartedAt'),
    );
    if (!user) {
      return null;
    }
    return {
      id: user._id?.toString() ?? userId,
      tenantId: user.tenantId,
      role: user.role,
      agentTriggerDeletionStartedAt: user.agentTriggerDeletionStartedAt ?? null,
    };
  };
}
