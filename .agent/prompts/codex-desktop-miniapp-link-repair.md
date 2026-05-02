# Codex Desktop Mini App Link Repair Prompt

Use this prompt when HappyTG Mini App opens, but the Codex screen has no real connection to local Codex Desktop: Desktop projects/sessions are empty, Desktop cards fail to load, or Desktop Resume/Stop/New Task buttons return network/auth/404 errors instead of a clear supported/unsupported result.

## Prompt

You are working in the HappyTG repository at `C:\Develop\Projects\HappyTG`.

Create or switch to a dedicated repair branch before changing production code:

```powershell
git switch -c codex/codex-desktop-miniapp-link-repair
```

If the branch already exists, switch to it without discarding local user changes. Do not use `git reset --hard`, `git checkout --`, or destructive cleanup unless the user explicitly asks.

## Current Failure

The user-visible symptom is:

```text
Mini App has no connection to Codex Desktop.
```

Treat this as an end-to-end link failure, not as a request to fake unsupported Desktop controls. Prove where the link breaks:

- Mini App page/rendering path.
- Mini App server to API path.
- Public Caddy route/API boundary.
- API user/session auth path.
- API to Codex Desktop adapter path.
- Adapter visibility of the real local Codex Desktop state under the user's `.codex` home.
- Browser-side Desktop action path.

## Mandatory Startup Discipline

Follow repository instructions exactly:

1. Retrieve EchoVault context first:
   - `memory context --project`
   - `memory search "Codex Desktop Mini App connection codex-desktop projects sessions Caddy"`
   - fetch details for relevant memories, especially the Codex Desktop control implementation and Mini App public routing memories.
2. Create a canonical proof bundle under `.agent/tasks/<TASK_ID>/` before production edits:
   - `spec.md`
   - `evidence.md`
   - `evidence.json`
   - `verdict.json`
   - `problems.md`
   - `task.json`
   - `raw/build.txt`
   - `raw/test-unit.txt`
   - `raw/test-integration.txt`
   - `raw/lint.txt`
3. Freeze scope in `spec.md` before build.
4. Keep builder and verifier roles separate. The verifier must not edit production code.
5. Use minimal fixes only. Do not rewrite the control plane, installer, or Mini App architecture without evidence.

Recommended task id: `HTG-2026-05-01-codex-desktop-miniapp-link`.

## Known Context

Codex Desktop support was added as a source-aware projection:

- `packages/runtime-adapters/src/codex-desktop.ts` reads sanitized local Desktop state from:
  - `.codex-global-state.json`
  - `session_index.jsonl`
  - `sessions/**/*.jsonl`
  - `archived_sessions/**/*.jsonl`
- `apps/api/src/index.ts` exposes:
  - `GET /api/v1/codex-desktop/projects`
  - `GET /api/v1/codex-desktop/sessions`
  - `POST /api/v1/codex-desktop/sessions/:id/resume`
  - `POST /api/v1/codex-desktop/sessions/:id/stop`
  - `POST /api/v1/codex-desktop/tasks`
- `apps/miniapp/src/index.ts` renders the Codex panel by fetching Desktop projects/sessions server-side, but browser-side Desktop action buttons currently call `/api/v1/codex-desktop/...` directly.
- `infra/caddy/Caddyfile` intentionally exposes only a narrow public API allowlist for Mini App auth/dashboard/approval resolve, then returns `404` for generic `/api/*`.
- Production Desktop Resume, Stop, and New Desktop Task were previously left unsupported unless a proven adapter control contract exists. Do not bypass this with process killing, raw `codex resume` assumptions, or unaudited shell commands.

Important likely failure modes to prove or rule out:

1. Public Mini App browser actions call `/api/v1/codex-desktop/...` and are blocked by the Caddy `handle /api/* { respond 404 }` boundary.
2. Docker/API runs in a container or different user context and cannot see the real host Codex Desktop home, so the adapter returns empty Desktop projects/sessions.
3. Mini App server-side fetches lose the Mini App session token or `userId`, so API returns `401`.
4. The API can read `.codex`, but the adapter cannot parse the current Codex Desktop state shape.
5. UI collapses API errors into "no sessions/projects" instead of showing a truthful connection diagnostic.

## Goal

Repair the Mini App to Codex Desktop link so users can reliably see the truthful Codex Desktop connection state and use only supported Desktop actions.

The finished repair must:

1. show Desktop projects/sessions in Mini App when the local adapter can see valid Codex Desktop state;
2. show a clear "Desktop state unavailable" diagnostic when the API/adapter cannot access Desktop state, instead of silently looking empty;
3. make browser-initiated Desktop actions work through a HappyTG-authenticated path that respects the existing public API boundary;
4. preserve the explicit unsupported state for Resume/Stop/New Task when no stable Desktop control contract is available;
5. keep raw prompts, logs, auth/config files, and `.env` secrets out of API/Mini App projections;
6. keep Telegram as a render/control surface, not an internal event transport.

## Required Investigation Scope

Inspect and test these areas:

- Mini App Codex panel and Desktop actions:
  - `apps/miniapp/src/index.ts`
  - `apps/miniapp/src/index.test.ts`
- API Desktop routes and auth:
  - `apps/api/src/index.ts`
  - `apps/api/src/service.ts`
  - `apps/api/src/index.test.ts`
  - `apps/api/src/service.test.ts`
- Codex Desktop adapter:
  - `packages/runtime-adapters/src/codex-desktop.ts`
  - `packages/runtime-adapters/src/index.test.ts`
- Public routing and packaged deployment:
  - `infra/caddy/Caddyfile`
  - `infra/docker-compose.example.yml`
  - installer/bootstrap env guidance if Docker cannot see host `.codex`
- Host daemon boundary if evidence shows Desktop projection must run on the execution host:
  - `apps/host-daemon/src/index.ts`
  - existing daemon hello/heartbeat/poll contracts in `apps/api/src/service.ts`
  - protocol types in `packages/protocol/src/index.ts`

## Explicit Questions To Answer

Your evidence must answer:

1. From the user's failing environment, does `GET /api/v1/codex-desktop/projects?userId=<known-user>` return projects, an empty list, `401`, `404`, or an exception?
2. Does the Mini App server fetch `/api/v1/codex-desktop/projects` and `/api/v1/codex-desktop/sessions` with the same Mini App session/user context that the dashboard uses?
3. Does the browser directly call a public `/api/v1/codex-desktop/...` route that Caddy intentionally blocks?
4. Which process is expected to read Codex Desktop state in the current deployment: API container, host-run API, or host daemon?
5. Does that process have access to the actual Codex Desktop home used by Codex Desktop on this machine?
6. If Desktop projects/sessions are empty, is that a true empty Desktop state, a missing/corrupt `.codex` state, a wrong `CODEX_HOME`, a Docker mount/env problem, or an auth/routing error?
7. What exact UX should Mini App show for each case: connected, unsupported controls, auth missing, state inaccessible, API route blocked?

## Expected Fix Shape

Prefer a small, auditable repair:

- Add a typed Desktop connection/status projection if needed, so Mini App can distinguish:
  - adapter connected with projects/sessions;
  - adapter connected but no Desktop state found;
  - adapter cannot access the configured Codex home;
  - Mini App/API auth missing;
  - Desktop controls unsupported by contract.
- If browser-side Desktop action buttons are blocked by Caddy, route them through Mini App server endpoints under the Mini App surface, then have the Mini App server call the API with the Mini App bearer token. Do not broadly expose `/api/v1/codex-desktop/*` publicly just to make buttons work.
- If Docker/API cannot see host Codex Desktop state, do not silently accept an empty adapter result as success. Add an explicit configuration/diagnostic path. Prefer the architecture-safe option:
  - host daemon reads local Desktop state and reports sanitized projections to API, or
  - installer/deployment explicitly mounts/configures a read-only Codex Desktop home for the API with clear warnings.
- Keep direct Telegram bot and browser reads of `%USERPROFILE%\.codex` forbidden.
- Keep production Desktop Resume/Stop/New Task disabled unless a real adapter control contract is proven and covered by policy/audit gates.
- Improve Mini App error copy so it says what is unavailable and where to check next, without exposing local secrets or raw paths beyond existing sanitized project paths.

## Do Not Do

- Do not implement Stop by killing Codex, Electron, Node, or matching processes.
- Do not treat `codex resume` as a proven Desktop control contract unless you prove it resumes the same Desktop-owned session safely.
- Do not expose generic `/api/*` through public Caddy.
- Do not put raw Codex prompts, transcript payloads, auth files, config files, or logs into API responses.
- Do not commit `.env`, tokens, Telegram init data, bearer tokens, or personal Desktop transcript content.
- Do not mark empty Desktop lists as healthy unless the proof shows the adapter read the right Codex home and the state is genuinely empty.

## Suggested Tests

Add focused tests before broad repo checks:

- Mini App renders Codex Desktop projects/sessions when API returns valid Desktop projections.
- Mini App renders a specific diagnostic when Desktop API returns `401`, `404`, or adapter-unavailable metadata.
- Browser Desktop actions use a Mini App-owned route or otherwise pass Caddy's public route contract without opening generic `/api/*`.
- Public Caddy still blocks generic `/api/*` and does not expose broad Codex Desktop API routes.
- API Desktop endpoints keep accepting Mini App bearer auth and query `userId` where intended.
- Runtime adapter reports or enables a distinguishable inaccessible/wrong-home state without reading private payloads.
- Docker/config diagnostics cover the case where the API process cannot see host Codex Desktop `.codex`.
- Existing unsupported-control tests still prove Resume/Stop/New Task are disabled without a proven control contract.

## Recommended Evidence To Capture

Store outputs in `.agent/tasks/<TASK_ID>/raw/`:

- `init-memory.txt`
- `git-status-before.txt`
- `desktop-link-spec-freeze.txt`
- `env-summary-sanitized.txt`
- `codex-home-overview-sanitized.txt`
- `api-codex-projects-direct.txt`
- `api-codex-sessions-direct.txt`
- `miniapp-codex-page-before.txt`
- `browser-network-before.txt`
- `caddy-api-boundary-before.txt`
- `adapter-analysis.txt`
- `routing-analysis.txt`
- `docker-host-access-analysis.txt`
- `test-runtime-adapters.txt`
- `test-api.txt`
- `test-miniapp.txt`
- `test-bootstrap-or-caddy.txt`
- `typecheck.txt`
- `build.txt`
- `lint.txt`
- `doctor.txt`
- `verify.txt`
- `fresh-verifier.txt`
- `task-validate.txt`

Sanitize tokens, bearer/session values, Telegram init data, private prompt text, and raw transcript/log bodies.

## Verification Requirements

At minimum run and record:

```powershell
pnpm --filter @happytg/runtime-adapters run test
pnpm --filter @happytg/api run test
pnpm --filter @happytg/miniapp run test
pnpm --filter @happytg/runtime-adapters run typecheck
pnpm --filter @happytg/api run typecheck
pnpm --filter @happytg/miniapp run typecheck
pnpm --filter @happytg/runtime-adapters run build
pnpm --filter @happytg/api run build
pnpm --filter @happytg/miniapp run build
pnpm happytg task validate --repo . --task HTG-2026-05-01-codex-desktop-miniapp-link
```

If the fix changes Caddy, Docker, installer guidance, host daemon protocol, shared protocol types, or bot behavior, also run the relevant expanded checks:

```powershell
pnpm lint
pnpm typecheck
pnpm test
pnpm happytg doctor
pnpm happytg verify
```

For browser/runtime proof, use the real Mini App route when possible:

- local direct Mini App URL;
- public `/miniapp` route through Caddy if configured;
- Codex panel `screen=codex` or `/codex?source=codex-desktop`;
- browser network evidence for Desktop action buttons.

## Completion Criteria

Do not mark complete until the proof bundle demonstrates:

1. The break point between Mini App and Codex Desktop is proven with sanitized evidence.
2. The repair restores a real connected state when the adapter can access Codex Desktop state.
3. The Mini App shows truthful diagnostics when Desktop state is inaccessible or controls are unsupported.
4. Browser Desktop actions no longer fail because of the public Caddy API boundary.
5. Public API exposure remains narrow and intentional.
6. No private Codex transcript content, auth files, or secrets leak into projections or evidence.
7. Required verification is green.
8. A fresh verifier pass confirms the repair without editing production code.
