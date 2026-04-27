# memory-leak-audit-20260426 Evidence

## Scope Freeze

`spec.md` was frozen before runtime audit and before verification commands. Production code was not modified.

## Discipline Sources

- Local `AGENTS.md` was read and applied.
- EchoVault context was loaded with `memory context --project`; relevant HappyTG memories were searched and inspected.
- Repo Task Proof Loop references were used for proof-bundle shape and fresh-verifier discipline.
- The external Claude Code source analysis was used only as discipline for resource-aware agent/orchestrator review: bounded read parallelism, serialized writes, lazy/cache-aware startup, output truncation, and lifecycle hooks.

## Static Audit

Raw search outputs:

- `raw/pattern-search.txt`: broad scan for timers, listeners, subscriptions, child processes, streams, watchers, caches, abort handling, and hooks.
- `raw/timers.txt`: `setInterval`, `setTimeout`, and cleanup matches.
- `raw/listeners-subscriptions.txt`: event listener and `.on(...)` matches.
- `raw/maps-caches.txt`: `Map`, `Set`, cache, TTL, cleanup matches.
- `raw/processes-streams-watchers.txt`: child process, stream, watcher matches.
- `raw/queues-approval-policy.txt`: queue, pending, approval, policy, abort matches.
- `raw/miniapp-lifecycle.txt`: Mini App lifecycle and client listener matches.
- `raw/servers-fetch.txt`: HTTP server/fetch/abort/listen/close matches.

Key files inspected:

- `packages/runtime-adapters/src/index.ts`
- `apps/host-daemon/src/index.ts`
- `apps/bot/src/index.ts`
- `apps/bot/src/handlers.ts`
- `apps/api/src/service.ts`
- `apps/worker/src/index.ts`
- `apps/worker/src/reconcile.ts`
- `apps/miniapp/src/index.ts`
- `packages/shared/src/index.ts`
- `packages/bootstrap/src/index.ts`
- `packages/bootstrap/src/install/commands.ts`
- `packages/bootstrap/src/install/manifest.ts`

## Accepted Patterns

- `apps/worker/src/index.ts:160` creates one interval guarded by `if (interval)` and clears it in `stop()` at `apps/worker/src/index.ts:171`.
- `apps/bot/src/index.ts:424` uses abort-aware delay cleanup and removes the abort listener at `apps/bot/src/index.ts:436`.
- `apps/bot/src/index.ts:1204` polling owns an `AbortController`; `stop()` aborts and awaits loop completion at `apps/bot/src/index.ts:1320`.
- `apps/host-daemon/src/index.ts:630` uses an intentional long-running daemon loop with serialized `await processDispatch(...)`; this is not itself a leak.
- `packages/bootstrap/src/install/manifest.ts:9` is an acceptable singleton cache for installer manifests in normal use; it is keyed by repo-local manifest path and does not grow per request in runtime services.
- `apps/miniapp/src/index.ts` is not a React app and has no `useEffect` lifecycle. Page-level DOM listeners are attached once per document load.

## Dynamic Verification

`raw/memory-smoke.txt` sampled already-running services on ports `3007`, `4000`, `4100`, and `4200` with repeated `/ready` and `/metrics` requests. Only API exposed `/metrics`; API RSS moved from `269484032` to `269578240` bytes across 8 light iterations. This smoke is not a pass/fail heap test because the processes were already running, GC was not exposed, and only API returned memory metrics.

Recommended follow-up smoke test, without new heavy dependencies:

- Start API, bot, worker, and miniapp with `node --expose-gc` or equivalent `tsx`/Node flags where practical.
- Drive repeated `/ready`, Mini App auth/session creation, Telegram polling handler stubs, and daemon dispatch stubs.
- Call `global.gc?.()` after warmup and between samples.
- Capture `process.memoryUsage()` from `/metrics` or a temporary test-only endpoint/harness.
- Fail only if `heapUsed`/`rss` grow monotonically after warmup across multiple windows.

## Verification Commands

- `pnpm lint`: pass, output in `raw/lint.txt`.
- `pnpm typecheck`: pass, output in `raw/typecheck.txt`.
- `pnpm test`: pass, output in `raw/test.txt`.
- `pnpm happytg doctor`: pass with warning, output in `raw/happytg-doctor.txt`.
- `pnpm happytg verify`: blocked/crashed with Windows exit code `3221226505` (`-1073740791` from PowerShell), output in `raw/happytg-verify.txt`.
- Repeat on 2026-04-27: `pnpm happytg verify` exited `0` with WARN status, output in `raw/happytg-verify-repeat-20260427.txt`. Warnings: Codex websocket 403 fallback to HTTP, public Caddy Mini App route HTTP 502, repo services not running for pairing/API flow.

## Fresh Verify

A second read-only verifier pass was performed against the frozen spec and evidence. It did not edit production code. It confirmed the audit evidence is sufficient for a fail verdict because medium/high retention risks remain. The original `pnpm happytg verify` crash was cleared by the 2026-04-27 repeat, but the command still reports WARN status due to environment/service issues. Notes are in `raw/fresh-verify.txt`.
