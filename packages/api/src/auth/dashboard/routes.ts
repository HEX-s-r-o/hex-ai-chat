import { Router } from 'express';
import { logger } from '@librechat/data-schemas';
import { getTenantId } from '@librechat/data-schemas';
import { rateLimit, ipKeyGenerator } from 'express-rate-limit';
import { DashboardAuthErrorCode } from 'librechat-data-provider';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { Store } from 'express-rate-limit';
import type { ServerRequest } from '~/types/http';
import type { DashboardRuntime } from './config';
import { getSafeErrorMetadata } from '~/utils/errors';

const STATUS: Record<DashboardAuthErrorCode, number> = {
  [DashboardAuthErrorCode.Disabled]: 404,
  [DashboardAuthErrorCode.Unavailable]: 503,
  [DashboardAuthErrorCode.ClientUnauthorized]: 401,
  [DashboardAuthErrorCode.BadRequest]: 400,
  [DashboardAuthErrorCode.CodeInvalid]: 400,
  [DashboardAuthErrorCode.PrincipalForbidden]: 403,
  [DashboardAuthErrorCode.RateLimited]: 429,
  [DashboardAuthErrorCode.TenantRequired]: 403,
  [DashboardAuthErrorCode.Internal]: 500,
};

/** Fixed copy per code: nothing request- or exception-derived ever reaches a response. */
const MESSAGE: Record<DashboardAuthErrorCode, string> = {
  [DashboardAuthErrorCode.Disabled]: 'Dashboard authentication is not enabled.',
  [DashboardAuthErrorCode.Unavailable]: 'Dashboard authentication is unavailable.',
  [DashboardAuthErrorCode.ClientUnauthorized]: 'Client credential rejected.',
  [DashboardAuthErrorCode.BadRequest]: 'Invalid request.',
  [DashboardAuthErrorCode.CodeInvalid]: 'Code is invalid or expired.',
  [DashboardAuthErrorCode.PrincipalForbidden]: 'Access to the dashboard is not permitted.',
  [DashboardAuthErrorCode.RateLimited]: 'Too many requests. Try again later.',
  [DashboardAuthErrorCode.TenantRequired]: 'A tenant is required for dashboard access.',
  [DashboardAuthErrorCode.Internal]: 'Dashboard authentication failed.',
};

function sendError(res: Response, code: DashboardAuthErrorCode): void {
  res.setHeader('Cache-Control', 'no-store');
  if (code === DashboardAuthErrorCode.ClientUnauthorized) {
    res.setHeader('WWW-Authenticate', 'Bearer');
  }
  res.status(STATUS[code]).json({ code, message: MESSAGE[code] });
}

export interface DashboardRouterOptions {
  getRuntime: () => Promise<DashboardRuntime>;
  /**
   * The chat app's existing user gate for `POST /code` (JWT auth, which carries the 2FA, terms and
   * deletion checks, plus the ban check). Injected so this module owns no auth wiring.
   */
  userMiddleware: RequestHandler[];
  /** Creates a limiter store by name (Redis when configured); omitted in tests. */
  limiterStore?: (name: string) => Store | undefined;
}

type ReadyRuntime = Extract<DashboardRuntime, { status: 'ready' }>;
type Handler = (req: Request, res: Response, runtime: ReadyRuntime) => Promise<void>;

export function createDashboardAuthRouter(options: DashboardRouterOptions): Router {
  const router = Router();

  /** Resolves the runtime once per request and stops disabled or broken deployments cold. */
  const gate: RequestHandler = async (req, res, next) => {
    try {
      const runtime = await options.getRuntime();
      if (runtime.status === 'disabled') {
        return sendError(res, DashboardAuthErrorCode.Disabled);
      }
      if (runtime.status === 'unavailable') {
        return sendError(res, DashboardAuthErrorCode.Unavailable);
      }
      res.locals.dashboardRuntime = runtime;
      next();
    } catch (error) {
      logger.error('[dashboardAuth] runtime resolution failed', getSafeErrorMetadata(error));
      sendError(res, DashboardAuthErrorCode.Unavailable);
    }
  };

  const runtimeOf = (res: Response): ReadyRuntime => res.locals.dashboardRuntime as ReadyRuntime;

  const limiter = (
    name: string,
    windowMs: number,
    max: (runtime: ReadyRuntime) => number,
    key: (req: Request) => string,
  ): RequestHandler =>
    rateLimit({
      windowMs,
      max: (_req, res) => max(runtimeOf(res)),
      standardHeaders: true,
      legacyHeaders: false,
      keyGenerator: key,
      handler: (_req, res) => sendError(res, DashboardAuthErrorCode.RateLimited),
      store: options.limiterStore?.(name),
      validate: { keyGeneratorIpFallback: false },
    });

  const byIp = (req: Request): string => {
    const ip = req.ip ?? req.socket.remoteAddress;
    return ip == null ? 'unknown' : ipKeyGenerator(ip);
  };
  const byUser = (req: Request): string => {
    const user = (req as ServerRequest).user;
    return JSON.stringify([user?.tenantId ?? null, user?.id ?? user?._id?.toString() ?? null]);
  };

  const codeLimiter = limiter(
    'dashboard_code_user_limiter',
    5 * 60 * 1000,
    (rt) => rt.limits.codeRequestsPerFiveMinutes,
    byUser,
  );
  const exchangeLimiter = limiter(
    'dashboard_exchange_ip_limiter',
    60 * 1000,
    (rt) => rt.limits.exchangeRequestsPerMinute,
    byIp,
  );

  /** Wraps a handler so no exception ever becomes an echoed message or a 200. */
  const guarded =
    (handler: Handler): RequestHandler =>
    async (req, res) => {
      try {
        await handler(req, res, runtimeOf(res));
      } catch (error) {
        logger.error('[dashboardAuth] request failed', getSafeErrorMetadata(error));
        sendError(res, DashboardAuthErrorCode.Internal);
      }
    };

  const requireExchangeCredential: RequestHandler = (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    if (!runtimeOf(res).verifyCredential(req.headers.authorization)) {
      logger.warn('[dashboardAuth] exchange credential rejected');
      return sendError(res, DashboardAuthErrorCode.ClientUnauthorized);
    }
    next();
  };

  /** Browser-facing: an authenticated chat user asks for a one-time code. */
  router.post(
    '/code',
    gate,
    ...options.userMiddleware,
    codeLimiter,
    guarded(async (req, res, runtime) => {
      const user = (req as ServerRequest).user;
      const userId = user?.id ?? user?._id?.toString();
      if (!userId) {
        return sendError(res, DashboardAuthErrorCode.ClientUnauthorized);
      }
      const result = await runtime.service.issueCode(
        { id: userId, tenantId: user?.tenantId != null ? String(user.tenantId) : undefined },
        getTenantId(),
      );
      if (!result.ok) {
        return sendError(res, result.error.code);
      }
      res.setHeader('Cache-Control', 'no-store');
      res.status(200).json({ code: result.value.code, expires_in: result.value.expiresIn });
    }),
  );

  /** Server-to-server: the dashboard backend redeems a code for the 5-minute JWT. */
  router.post(
    '/token',
    gate,
    exchangeLimiter,
    requireExchangeCredential,
    guarded(async (req, res, runtime) => {
      const body = req.body as { grant?: unknown; code?: unknown } | undefined;
      if (body == null || typeof body !== 'object' || body.grant !== 'code') {
        return sendError(res, DashboardAuthErrorCode.BadRequest);
      }
      const result = await runtime.service.redeemCode(body.code);
      if (!result.ok) {
        return sendError(res, result.error.code);
      }
      res.setHeader('Cache-Control', 'no-store');
      res.status(200).json({
        token: result.value.token,
        expires_in: result.value.expiresIn,
        session_handle: result.value.sessionHandle,
      });
    }),
  );

  /** Server-to-server: dashboard logout. Idempotent; an unknown handle is not an error. */
  router.post(
    '/revoke',
    gate,
    exchangeLimiter,
    requireExchangeCredential,
    guarded(async (req, res, runtime) => {
      const body = req.body as { session_handle?: unknown } | undefined;
      const result = await runtime.service.revokeHandle(body?.session_handle);
      if (!result.ok) {
        return sendError(res, result.error.code);
      }
      res.setHeader('Cache-Control', 'no-store');
      res.status(200).json({});
    }),
  );

  return router;
}
