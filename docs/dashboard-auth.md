# Dashboard token issuer (ADR-0006, chat side)

Status: implemented on branch `feat/dashboard-token-issuer`, **not deployed**, awaiting human security
review. The dashboard repository is unchanged. This note is the chat half of ADR-0006.

## What it does

An authenticated chat user asks for a one-time **code**. The dashboard **backend** (BFF) redeems the
code server to server for a **5-minute EdDSA JWT**. The browser never holds the JWT. Disabled by
default (`dashboardAuth.enabled: false`): every route answers `404` and no key is read.

## Trust boundary

| Party | Holds | Can do |
| --- | --- | --- |
| Chat user (browser) | Chat session | Request a code for themselves |
| Dashboard backend | `DASHBOARD_EXCHANGE_SECRET`, **public** keys | Redeem a code it was handed; revoke a handle |
| Chat server | Private signing keys, code hashes | Mint tokens |

- Compromise of the dashboard backend cannot mint tokens (no private key), and the exchange secret alone
  cannot either: a valid single-use code is also required.
- The signing key is dedicated. It is Ed25519 only (loader rejects anything else), is not `JWT_SECRET`
  (HS256) and is not the `CODEAPI_JWT_*` key; two kids over one key are refused.
- Residual risk: whoever holds a valid chat session can obtain a dashboard session, so dashboard security
  is bounded by chat account security (see ADR-0006).

## Endpoint contract

All routes are under `/api/auth/dashboard`, `Cache-Control: no-store`, errors are
`{ "code": "<STABLE_CODE>", "message": "<fixed text>" }` and never carry exception text, stack, query,
header, body or credential content.

### `POST /code` — chat user

Auth: existing `requireJwtAuth` (2FA, terms, deletion gates) + `checkBan`, then a per-user rate limit.
Response `200`: `{ "code": "<43-char base64url>", "expires_in": 60 }`.
The code is 256-bit random, stored **only** as `sha256("hex-dashboard:code:v1:" + code)`, bound to the
user id and resolved tenant, valid for `codeTtlSeconds` (max 60). A new code supersedes an earlier
unredeemed one for the same user and tenant.

### `POST /token` — dashboard backend

Auth: `Authorization: Bearer <DASHBOARD_EXCHANGE_SECRET>` (constant-time compare; current and optional
previous secret). Per-IP rate limit runs **before** the credential check.
Request: `{ "grant": "code", "code": "<code>" }`. Only `grant: "code"` exists; there is no refresh.
Response `200`: `{ "token": "<jwt>", "expires_in": 300, "session_handle": "<43-char base64url>" }`.
`session_handle` is 256-bit random, stored hashed, used only for revocation.

### `POST /revoke` — dashboard backend

Same credential. Request `{ "session_handle": "<handle>" }`. Always `200 {}` for a well-formed handle,
whether or not it existed (idempotent). Malformed handle: `400 DASHBOARD_BAD_REQUEST`.

### Error codes

| HTTP | `code` | Meaning |
| --- | --- | --- |
| 404 | `DASHBOARD_AUTH_DISABLED` | Feature off |
| 503 | `DASHBOARD_AUTH_UNAVAILABLE` | Enabled but keys/credential/issuer unusable (fails closed, nothing issued) |
| 401 | `DASHBOARD_CLIENT_UNAUTHORIZED` | Missing/wrong BFF credential (`WWW-Authenticate: Bearer`) |
| 400 | `DASHBOARD_BAD_REQUEST` | Bad body, unsupported grant, malformed handle |
| 400 | `DASHBOARD_CODE_INVALID` | Unknown, malformed, expired **or reused** code (deliberately indistinguishable) |
| 403 | `DASHBOARD_PRINCIPAL_FORBIDDEN` | User missing or deletion in progress, or tenant mismatch |
| 403 | `DASHBOARD_TENANT_REQUIRED` | No tenant under `TENANT_ISOLATION_STRICT` |
| 429 | `DASHBOARD_RATE_LIMITED` | Budget exhausted |
| 500 | `DASHBOARD_INTERNAL_ERROR` | Unexpected failure, details logged without content |

## JWT

Header `{"alg":"EdDSA","typ":"JWT","kid":"<active kid>"}`.

| Claim | Value |
| --- | --- |
| `iss` | `dashboardAuth.issuer` |
| `aud` | `dashboardAuth.audience` (string, default `hex-dashboard`) |
| `sub` | chat user id |
| `sid` | random opaque session id (not a database id) |
| `jti` | UUID, unique per token |
| `iat`, `nbf` | mint time |
| `exp` | `iat + tokenTtlSeconds` (hard cap 300, also clamped in code) |
| `ver` | `1` |
| `tenant_id` | tenant bound to the code (never empty) |
| `chat_role` | chat role, informational |
| `principal_source` | `chat_session` |

No email, username, name or permissions are ever claims.

## Redemption rules (all fail closed)

1. Malformed code: `CODE_INVALID`, no database read.
2. **Atomic consume**: one `findOneAndUpdate` on `{codeHash, unconsumed, expiresAt > now}`. Exactly one
   concurrent caller wins (tested with 12 and 4 racers).
3. Miss: expired/unknown/reused all return `CODE_INVALID`. A **reuse** also revokes the handle created by
   the first redemption.
4. After consume, any refusal revokes the freshly created handle and returns `PRINCIPAL_FORBIDDEN`:
   code tenant ≠ `expectedTenantId`; user missing; deletion in progress; user's current tenant ≠ code tenant.
5. User lookup *failure* throws (500), never reads as "not found".

"Disabled user" = missing user or account deletion in progress (`agentTriggerDeletionStartedAt`), the same
signal `JwtStrategy` uses. Chat bans are enforced at code issue time via `checkBan`.

## Key rotation

Keys live in `DASHBOARD_JWT_KEYS` as `{ "<kid>": "<PEM or private JWK>" }`; `dashboardAuth.activeKid`
(or `DASHBOARD_JWT_KID`) selects the signer.

1. Generate a new Ed25519 key; add it to the ring under a new kid; keep `activeKid` on the old kid. Deploy.
2. Add the new **public** key to the dashboard's trusted set. Confirm.
3. Set `activeKid` to the new kid. Deploy. New tokens carry the new `kid`.
4. After one token lifetime plus leeway (≥ 6 min), remove the old key from the dashboard, then from the ring.
5. Compromise: remove the key from the dashboard first, then rotate as above. Blast radius is the
   dashboard only.

BFF credential rotation: set the new value as `DASHBOARD_EXCHANGE_SECRET` and the old one as
`DASHBOARD_EXCHANGE_SECRET_PREVIOUS`; update the dashboard; then remove `_PREVIOUS`.

## Secret handling

- Private keys and the credential come only from the environment / a secret store. `librechat.yaml`
  holds non-secret settings only. Nothing is committed; tests generate keys per run.
- Key and credential loaders throw coded errors (`KEY_INVALID`, `CREDENTIAL_TOO_SHORT`, …) that never
  contain input text, because parse errors can quote key material.
- Logs carry reason codes only: no code, handle, JWT, key, credential, cookie, email or user/tenant id.
  Tests assert this against captured logger calls.
- Credential minimum length is 32 characters, enforced at config load.

## Known limits

- No refresh grant (the dashboard does not refresh yet); sessions end at token expiry.
- No JWKS endpoint; the dashboard pins public keys (ADR phase 1). `getDashboardPublicJwks(ring)` exports them.
- The code is not bound to a specific chat refresh session, only to user and tenant; chat logout stops new
  codes but does not revoke an issued token earlier than its 5-minute expiry. The handle is revocable via
  `/revoke`; a back-channel is a later ADR phase.
- Rate-limit stores use Redis when chat is configured for it, otherwise process memory.

## Local runbook (no production secrets)

Everything below runs on localhost with throwaway values.

```bash
# 1. Throwaway signing key and credential (never reuse for anything real)
node -e "
const {generateKeyPairSync}=require('crypto');
const {privateKey,publicKey}=generateKeyPairSync('ed25519');
console.log('DASHBOARD_JWT_KEYS='+JSON.stringify({'dash-local-1':privateKey.export({format:'pem',type:'pkcs8'})}));
console.log('DASHBOARD_JWT_KID=dash-local-1');
console.log('DASHBOARD_EXCHANGE_SECRET='+require('crypto').randomBytes(32).toString('base64url'));
console.log('# dashboard trusted key:', JSON.stringify({'dash-local-1':publicKey.export({format:'jwk'})}));
" > /tmp/dashboard-local.env   # keep outside the repo; do not commit
```

Paste those `DASHBOARD_*` lines into your local, git-ignored `.env` (do not `source` the file: the JSON
value is not shell-safe). Use the printed public key as the dashboard's trusted key for `dash-local-1`.

Add to `librechat.yaml` (local copy):

```yaml
dashboardAuth:
  enabled: true
  issuer: 'http://localhost:3080'
```

Start chat bound to localhost, sign in as a local test user, then:

```bash
# 2. As the signed-in user (bearer from the browser session): request a code
curl -s -X POST http://localhost:3080/api/auth/dashboard/code -H "Authorization: Bearer $CHAT_ACCESS_TOKEN"

# 3. As the dashboard backend: redeem within 60 s
curl -s -X POST http://localhost:3080/api/auth/dashboard/token \
  -H "Authorization: Bearer $DASHBOARD_EXCHANGE_SECRET" -H 'Content-Type: application/json' \
  -d "{\"grant\":\"code\",\"code\":\"$CODE\"}"

# 4. Replay the same call: expect 400 DASHBOARD_CODE_INVALID
# 5. Revoke
curl -s -X POST http://localhost:3080/api/auth/dashboard/revoke \
  -H "Authorization: Bearer $DASHBOARD_EXCHANGE_SECRET" -H 'Content-Type: application/json' \
  -d "{\"session_handle\":\"$HANDLE\"}"
```

Automated equivalent: `cd packages/api && npx jest --testPathPatterns="auth/dashboard"`.

## Chat UI entry point

With `dashboardAuth.enabled: true` and `dashboardAuth.dashboardUrl` set (https, or http on localhost; no
credentials, query or fragment; never defaulted), `GET /api/config` returns `dashboard.callbackUrl`
(`<dashboardUrl>/auth/callback`) to a signed-in user the issuer would serve. It is omitted when the
issuer is disabled or has no URL, for OpenID-reuse sessions, and when `expectedTenantId` does not match
the user. The account menu then shows **Open dashboard**.

Choosing it calls `requestDashboardCode()` and navigates to `<callbackUrl>?code=<code>`. The code exists
only in a local variable: not in React state, a query cache, storage, logs or analytics. A second click
while a request is pending is ignored. Failures stay on the page with a localized message by status:
401 sign in again, 403 no access, 404/503 unavailable, 429 wait and retry, no response network error,
anything else a generic retry message.
