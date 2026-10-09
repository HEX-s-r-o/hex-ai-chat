# DEV-CONTEXT.md — agent & maintainer working notes (HEX company fork of LibreChat)

> Purpose: my (agent) self-contained context for ongoing development/maintenance on this repo.
> It is safe to commit/omit as the user prefers. **It must NEVER contain real secrets**
> (no live `MONGO_URI`, provider API keys, JWT secrets, or YAML config contents).

## 1. What this is

A company-maintained fork of LibreChat (a self-hosted LLM chat platform). We both develop and
maintain it for HEX s.r.o. It has **real company data** in MongoDB from v0.8.7 that we must NOT
interfere with.

## 2. Remotes & repo state (verified)

- `origin`   → `https://github.com/HEX-s-r-o/hex-ai-chat.git`   (our fork)
- `upstream` → `https://github.com/LibreChat-AI/LibreChat.git`   (public upstream)
- Local branch: `main` (tracks upstream LibreChat exactly — no HEX changes here)
- Local branch: `hex/customisation` (**HEX-only changes** — push only to `origin`, never `upstream`)
- `gh` CLI logged in as **lui-do** but token is currently **invalid (HTTP 401)** → re-auth
  (`gh auth login`) or confirm repo visibility in browser before any push.

### Branch rules

| Branch | Purpose | Push target |
|---|---|---|
| `main` | Mirrors upstream LibreChat exactly | `origin/main` only |
| `hex/customisation` | HEX brand/company code changes | `origin/hex/customisation` only |

**NEVER** push `hex/customisation` (or any HEX-specific code) to `upstream`.
**NEVER** commit HEX changes onto `main`.

Files currently on `hex/customisation`:
- `client/index.html` — title, meta description, theme-color
- `client/src/utils/documentTitle.ts` — DEFAULT_APP_TITLE fallback

To keep `hex/customisation` current after an upstream release:
```
git fetch upstream
git checkout main && git merge upstream/main
git checkout hex/customisation && git rebase main
git push origin hex/customisation --force-with-lease
```

To lock the upstream push-URL (run once on each new clone — .git/config is read-only in sandbox):
```
git config remote.upstream.pushurl DISABLED-never-push-to-upstream-LibreChat
```

### Privacy model (branch Q) — RESOLVED 2025
- **`HEX-s-r-o/hex-ai-chat` is a FORK and is therefore PUBLIC.** GitHub forbids changing a fork's
  visibility. User verified in Settings: `You cannot change the visibility of a fork.`
- ⇒ **Never push company config/secrets to `origin`** (any branch there is public).
- Company-specific config (`librechat.yaml`, `.env` overrides, deploy compose, internal notes) must
  live in a SEPARATE **new private** repo under HEX-s-r-o that is **NOT a fork** (so it can be private).
- Suggested private repo: `HEX-s-r-o/hex-ai-chat-private-config` (not a fork). → OPEN with user.
- `.gitignore` on the fork keeps config out of the public tree; `.env` stays local-only.

## 3. Toolchain (per LibreChat docs + our machine check)

| Tool    | Docs-expected | Actual on machine | Status |
|---------|---------------|-------------------|--------|
| Node.js | v24.16.0      | v24.21.0 (mise)   | ✅ Node 24 family — OK |
| npm     | v11.16.0      | v11.19.0          | ✅ OK |
| MongoDB | Atlas / Community | inside Docker clone | ⚠️ verify connectivity |

- `.nvmrc` pins `24.16.0`.
- The parent-overview "broken node 26" gotcha does **NOT** apply here (Node 24 mise is active & npm works).

## 4. Monorepo workspaces

| Path                 | Ownership                                        |
|----------------------|--------------------------------------------------|
| `packages/api`       | New backend TypeScript services/controllers      |
| `api`                | Legacy Express wiring — keep THIN (no behavior)  |
| `packages/data-schemas` | DB models/schemas/db-specific logic           |
| `packages/data-provider` | Shared API types, endpoints, query keys       |
| `client`             | React app                                        |
| `packages/client`    | Shared frontend utilities/primitives             |

## 5. Daily commands

- `npm run smart-reinstall` — install deps + build compiled workspaces
- `npm run reinstall` — clean install after Node/npm change or suspect deps
- `npm run backend` / `npm run backend:dev` — backend (dev = file watch) @ `:3080`
- `npm run frontend:dev` — frontend dev server @ `:3090` (backed by running backend)
- `npm run build` — build all compiled workspaces (Turborepo)
- `npm run build:data-provider` — rebuild data-provider after API/type changes
- Tests per workspace; `cp .env.example ./api/.env` + `NODE_ENV=CI` for the `/api` test copy.

## 6. AGENTS.md key rules (what I must follow)

- Green build ≠ typecheck: `tsdown` doesn't check types → run `npx tsc --noEmit` in changed workspace.
- `/api` (CJS) = wiring only; logic goes in `packages/api` (`MCPRequestContext.js` is the thin re-export shape).
- Keep Mongoose types out of exported signatures; new levers go on `configSchema`; pass deps in, don't import singletons.
- Failure contracts: plain value on success; `null` only for documented absence; typed
  `{ok:true}|{ok:false:error:{code}}` for expected failures; throw for unexpected ops.
- Errors are a security boundary: never forward raw exceptions/stacks/provider payloads/`error.message`
  to clients; prefer `getSafeErrorMetadata`.
- Frontend: compose `@librechat/client` primitives + semantic theme tokens; `useLocalize()` (en keys only);
  React Query + keys in `packages/data-provider/src/keys.ts`; chat menu = `DropdownPopup`+`Ariakit.MenuButton`
  (never Radix `DropdownMenu`). New state is **Jotai**, not Recoil.
- Testing: focused Jest from owning workspace; real logic/spies; `mongodb-memory-server`; mock only external HTTP.

## 7. UPGRADING.md operational gotchas (relevant to us)

1. **Native-only web search (≥ v0.8.8)**: `interface.webSearch: false` persists as a denial; removing the
   field does NOT restore grants. For native search set `interface.webSearch: true` + keep
   `webSearch:false` (external tool) / `preset.web_search:true` (native) per model spec.
2. **Redis stream delta coalescing** now 25 ms by default (`STREAM_DELTA_COALESCE_MS`); `0` = per-delta.
3. **Tenant index migration (v0.8.7-and-older DBs)**: startup may log `Index build failed` for User/Role/
   Preset/AccessRole/MCPServer/AgentCategory/Message/Conversation due to legacy unique-index conflicts.
   Fix is an EXPLICIT maintenance command, NOT auto-run:
   - backup + stop writers
   - `npm run migrate:tenant-indexes:dry-run` then `npm run migrate:tenant-indexes`
   - Docker one-off: `docker compose run --rm --no-deps -w /app api npm run migrate:tenant-indexes:dry-run`

## 8. Setup facts & decisions (log)

- [x] Read AGENTS.md, CONTEXT.md, UPGRADING.md; user-supplied setup docs (overview, get_started, tools, testing).
- [x] Privacy resolved: fork is PUBLIC; company config goes to a separate PRIVATE (non-fork) repo.
- [ ] Create private non-fork repo `HEX-s-r-o/hex-ai-chat-private-config` (needs `gh` auth + GitHub UI).
- [x] Local branch `company/dev-config` created but DEPRECATED (config won't push to the fork).
- [x] INSTALL + BUILD SUCCEEDED here (Node 24.21, npm ci style, turbo 5/5). Working tree reverted to clean;
      `xlsx 0.20.3` installed from local tarball. See §11 workaround.
- [x] Mongo diagnosed: runs only with `--nounixsocket`; sandbox kills daemons across commands, so the
      real dev runtime lives on the user's machine. See §12 + private RUNBOOK.md.
- [ ] Create `.env` from `.env.example` (fill real `MONGO_URI` locally only; never commit).
- [ ] User machine: RUNBOOK.md steps (restore copy, .env, backend/frontend, tenant-index if needed).
- [ ] Apply company `librechat.yaml` (contents confidential — supplied by user, NEVER in DEV-CONTEXT).
- [ ] Decide MongoDB wiring (dev → copied/container DB, see §9).
- [ ] Run `npm run smart-reinstall`.
- [ ] Run `npm run build`.
- [ ] Create `.env` from `.env.example` (fill real `MONGO_URI` locally, don't commit).
- [ ] Handle tenant-index migration AGAINST A COPY if needed (not production).

## 9. Data-safety rule (HARD constraint)

- The company has **real production data (v0.8.7) inside the Docker-deployed whole-app container**
  (MongoDB runs inside that container).
- We must NOT touch/interfere with it.
- Dev should point at a **copy/dump** of the data, never the live DB.
- Plan: export/dump from the container → load into the dev Mongo → run migrations/index fixes on the copy.

### Production layout (from user)
- VPS runs the whole app in Docker; mongo container is `chat-mongodb` (mongo:8.0.20), up normally.

### Dump status
- `/tmp/librechat-dev.gz` — VALID mongodump archive (gz OK, self-reports `server_version: 8.0.20`), ~3.1 MB gz / ~14.5 MB raw.
- No local mongo tools on this machine yet (no mongorestore/mongodump/mongosh on PATH).

## 9b. Sandbox capability matrix (this machine)

| Capability | Status |
|---|---|
| Node 24 + npm | ✅ |
| npm registry | ✅ reachable |
| github (git/gh) | ✅ reachable |
| run LibreChat backend/frontend/tests | ✅ (JS side) |
| MongoDB binary download (fastdl CDN) | ❌ 403 blocked-by-allowlist |
| System Mongo install | ❌ read-only system, no sudo, no docker/podman/apt |

⇒ Node side fully workable here; **hosting MongoDB for the runtime is the open decision.**
Options: (A) portable mongo from an allowlisted mirror, (B) Mongo Atlas cloud (privacy tradeoff),
(C) run dev on VPS as a SEPARATE compose project/volumes, (D) run on user's laptop/workstation.

## 10. Current pending actions / questions for maintainer

1. Create a **new private (non-fork) repo** for company config, e.g. `hex-ai-chat-private-config`.
   (Creating a GitHub repo requires `gh auth login` working + browser, or manual GitHub web UI.)
2. Re-authenticate `gh` (token expired; also `~/.config` is read-only → use `GH_CONFIG_DIR=/tmp/ghconfig`).
3. Provide company `librechat.yaml` (confidential) to wire in (on the private config repo, not the fork).
4. Settle Mongo hosting for the dev copy (open until resolved; see §12).

## 11. Sandbox-only xlsx workaround (REQUIRED on every reinstall here)

- `xlsx` is a direct dep of `/api` pinned to `https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`.
  The corporate proxy blocks `cdn.sheetjs.com` (403 blocked-by-allowlist), so `npm ci` fails on it.
- Fix (reversible, repo kept clean):
  1. Ensure `/tmp/xlsx-0.20.3.tgz` exists (user fetches it on an internet machine and copies in).
  2. Edit `api/package.json`: `"xlsx": "https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz"`
     → `"xlsx": "file:/tmp/xlsx-0.20.3.tgz"`.
  3. `npm install` (regenerates lockfile; the tgz sha512-base64 must equal
     `oLDq3jw7AcLqKWH2AhCpVTZl8mf6X2YReP+Neh0SJUzV/BdZYjth94tG5toiMB1PPrYtxOCfaoUCkvtuH+3AJA==`).
  4. After install, revert `api/package.json` AND `package-lock.json` (`git checkout -- <f>`)
     so the fork stays byte-clean; node_modules keeps xlsx installed.
- Re-run this any time deps are reinstalled in THIS sandbox. On machines with open internet to
  cdn.sheetjs.com, normal `npm ci` works unchanged.

## 12. Portable MongoDB here — status

- mongo 9.0.2 tarball provided by user: `/tmp/mongodb-linux-x86_64-ubuntu2204-9.0.2.tgz`,
  extracted at `/tmp/mongodb-linux-x86_64-ubuntu2204-9.0.2`. bin/ has only `mongod mongos install_compass`
  (NO mongorestore/mongodump/mongosh → those are in the separate Database Tools tarball; NOT present).
- mongod RUNS here ONLY with `--nounixsocket` (sandbox seccomp blocks `socket(AF_UNIX)` with EPERM;
  without the flag it aborts: `open: Operation not permitted`). Working start:
  `mongod --dbpath /tmp/mongodb-data --port 27017 --bind_ip 127.0.0.1 --nounixsocket --fork --logpath /tmp/mongodb.log`
- LIMIT: `bwrap --die-with-parent` kills all child processes at the end of EACH tool call, so
  mongod AND any LibreChat backend/daemon DO NOT persist across commands in this sandbox. This is a
  hard limit → the sandbox cannot HOST the running dev app; it is for repo/code/config/shots-run ops only.
- Real runtime must live on the user's machine (or a separate dev stack). Restore+run runbook below.
- Dump `/tmp/librechat-dev.gz` validated genuine (mongo 8.0.20, server_version 8.0.20).

### Canonical layout (user's machine; clone on their machine — HEX parent is RO in this sandbox)
```
/home/work/dev/company/projects/HEX/
├── hex-ai-chat/            # PUBLIC fork (code ONLY; no .env / librechat.yaml here)
└── hex-ai-chat-private/    # PRIVATE repo: librechat.yaml, real .env (gitignored), dev.sh
```
dev.sh sources .env, auto-sets CONFIG_PATH=./librechat.yaml, runs npm (path-agnostic).
Real .env stays in the PRIVATE repo (gitignored) — never in the public fork.

### Mongo dev runbook (run on the user's machine where processes persist)
1. `mongod --dbpath <data> --port 27017 --bind_ip 127.0.0.1 --nounixsocket &`
2. restore dump: for an archive+gz dump → `mongorestore --gzip --archive=< librechat-dev.gz`
3. LibreChat `.env`: `MONGO_URI=mongodb://127.0.0.1:27017/LibreChat` + `CONFIG_PATH=.../hex-ai-chat-private/librechat.yaml`
4. `npm run backend:dev` (port 3080) + `npm run frontend:dev` (port 3090)
- If old-index conflict on startup → run `npm run migrate:tenant-indexes` (see UPGRADING.md §7.3) ON THE COPY.
2. Where exactly is the company MongoDB inside the Docker stack (`docker-compose.yml` service name; data dir)?
   → so we can dump a copy safely for dev.
3. Provide company `librechat.yaml` (keep out of public scope) — I'll import/review it on the private branch.