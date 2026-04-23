# Evidence Log

## Phase Status

- `init`: completed
- `freeze/spec`: completed before production edits
- `build`: completed
- `evidence`: completed
- `fresh verify`: completed as a separate read-only pass
- `complete`: completed

## Commands Run

### Context and spec freeze

- `memory context --project`
- `memory search "miniapp dead buttons auth session browser api same-origin ux cjm"`
- `memory details fbe31c73-e2e`
- `memory details c3dbbae2-651`
- `memory details d82654a3-d61`
- proof bundle initialized under `.agent/tasks/HTG-2026-04-23-miniapp-dead-buttons-ux-redesign/`
- frozen scope recorded in `spec.md` before production edits

### Root-cause reproduction before fix

- public page-source probe on `https://happytg.gerta.crazedns.ru/miniapp` -> `raw/browser-api-base-before.txt`
- Playwright live-browser repro before fix -> `raw/network-before.txt`, `raw/console-before.txt`, `raw/before-screenshots.txt`
- repository code-path analysis -> `raw/init-analysis.txt`
- UX 10-lens audit and CJM review -> `raw/ux-audit-notes.txt`, `raw/cjm-review.txt`

### Builder verification

- `pnpm --filter @happytg/miniapp test` -> `raw/test-unit.txt`
- `pnpm --filter @happytg/miniapp typecheck` -> `raw/typecheck.txt`
- `pnpm --filter @happytg/miniapp build` -> `raw/build.txt`
- `pnpm --filter @happytg/miniapp lint` -> `raw/lint.txt`
- `pnpm --filter @happytg/api test` -> `raw/test-integration.txt`
- `pnpm typecheck` -> `raw/repo-typecheck.txt`
- `pnpm lint` -> `raw/repo-lint.txt`
- `pnpm test` -> `raw/repo-test.txt`
- `pnpm build` -> `raw/repo-build.txt`
- `pnpm happytg doctor` in clean worktree without `.env` -> `raw/doctor.txt`
- `pnpm happytg verify` in clean worktree without `.env` -> `raw/verify.txt`
- copied ignored local `.env` into the clean worktree only for env-backed diagnostics, then reran:
  - `pnpm happytg doctor` -> `raw/doctor-env.txt`
  - `pnpm happytg verify` -> `raw/verify-env.txt`
- `pnpm release:check --version 0.4.4` -> `raw/release-check.txt`

### Post-fix routing proof

- local reverse-proxy harness proving same-origin request semantics -> `raw/browser-api-base-after.txt`, `raw/network-after.txt`, `raw/console-after.txt`, `raw/after-proxied-auth-feedback.png`, `raw/miniapp-after-harness.stdout.txt`, `raw/miniapp-after-harness.ts`
- restarted the Mini App on local port `3007` from the fixed branch and re-probed the real public HTTPS route -> `raw/browser-api-base-after-live.txt`, `raw/network-after-live.txt`, `raw/console-after-live.txt`, `raw/live-public-after.png`, `raw/live-public-probe.cjs`

### Fresh verify pass

- separate read-only verifier review -> `raw/fresh-verifier.txt`
- `pnpm happytg task validate --repo . --task HTG-2026-04-23-miniapp-dead-buttons-ux-redesign` -> `raw/task-validate.txt`

## Runtime Findings That Changed the Implementation

- `raw/browser-api-base-before.txt` proves the public HTTPS page injected `window.HAPPYTgApiBase = "http://localhost:4000"` even though the actual user-facing launch surface was `https://happytg.gerta.crazedns.ru/miniapp`.
- `raw/network-before.txt` and `raw/console-before.txt` prove the browser then attempted `POST http://localhost:4000/api/v1/miniapp/auth/session`, which failed with `TypeError: Failed to fetch` and a CORS/preflight rejection. The dead-button symptom was therefore not broken HTML navigation alone; it was a dead-end auth bootstrap to the wrong origin.
- `apps/miniapp/src/index.ts` also swallowed auth bootstrap and primary-action errors. That made the auth-pending screen look inert instead of actionable.
- `raw/browser-api-base-after-live.txt` and `raw/network-after-live.txt` prove the live public page now injects an empty browser API base and posts to `https://happytg.gerta.crazedns.ru/api/v1/miniapp/auth/session`. Outside Telegram the endpoint correctly returns `401` for empty `initData`, which confirms that routing is now correct and the remaining rejection is an auth precondition rather than a browser-origin bug.

## Code Changes

- `apps/miniapp/src/index.ts`
  - added request-aware `resolveBrowserApiBaseUrlForRequest()` using forwarded request origin/prefix
  - kept localhost direct-dev fallback through the existing env-based resolver
  - threaded request-aware browser API config through `renderPage()` and `renderForRequest()`
  - added active bottom navigation and translated labels to Russian
  - redesigned auth-pending shell into an explicit mobile-first recovery screen with step states, retry/reload controls, and visible notices
  - added visible loading/success/error feedback for approval actions and the new-task form
- `apps/miniapp/src/index.test.ts`
  - added regression coverage for public reverse-proxy same-origin behavior
  - added regression coverage for localhost direct-dev fallback
  - added deterministic assertions for auth feedback, approval feedback, and task-form feedback
- docs:
  - `docs/configuration.md`
  - `docs/architecture/miniapp-rich-ux.md`
  - `docs/self-hosting.md`
  - `README.md`
- release metadata:
  - `CHANGELOG.md`
  - `docs/releases/0.4.4.md`
  - workspace `package.json` versions bumped to `0.4.4`

## Acceptance Mapping

| Criterion | Evidence |
| --- | --- |
| Root cause proven | `raw/init-analysis.txt`, `raw/browser-api-base-before.txt`, `raw/network-before.txt`, `raw/console-before.txt` |
| Public HTTPS Mini App interactions restored | `apps/miniapp/src/index.ts`, `raw/browser-api-base-after-live.txt`, `raw/network-after-live.txt`, `raw/console-after-live.txt`, `raw/live-public-after.png`, `raw/test-unit.txt` |
| Localhost direct dev preserved | `apps/miniapp/src/index.ts`, `apps/miniapp/src/index.test.ts`, `raw/test-unit.txt`, `docs/configuration.md`, `docs/self-hosting.md` |
| Request-aware browser API derivation covered | `apps/miniapp/src/index.ts`, `apps/miniapp/src/index.test.ts`, `raw/test-unit.txt`, `raw/typecheck.txt` |
| Visible interaction feedback | `apps/miniapp/src/index.ts`, `apps/miniapp/src/index.test.ts`, `raw/after-screenshots.txt`, `raw/live-public-after.png` |
| UX/CJM improved | `raw/ux-audit-notes.txt`, `raw/cjm-review.txt`, `docs/architecture/miniapp-rich-ux.md`, `apps/miniapp/src/index.ts` |
| Fresh verifier and release complete | `raw/release-check.txt`, `raw/doctor-env.txt`, `raw/verify-env.txt`, `raw/fresh-verifier.txt`, `raw/task-validate.txt`, `verdict.json` |

## Verification Summary

- Scoped Mini App checks all passed: tests, typecheck, build, lint.
- `pnpm --filter @happytg/api test` passed.
- Fresh repo-wide `pnpm typecheck`, `pnpm lint`, `pnpm test`, and `pnpm build` all passed after the final Mini App fix and release metadata update.
- `pnpm release:check --version 0.4.4` passed.
- The env-backed verification logs show the task-specific environment is healthy enough for this scope:
  - `raw/doctor-env.txt`: `WARN` only because Codex smoke did not exit before timeout and the existing local Mini App listener on `3007` was already running
  - `raw/verify-env.txt`: `WARN/INFO` only because Codex websocket fell back to HTTP and the local stack was already running
- The earlier `raw/doctor.txt` / `raw/verify.txt` files are preserved as builder-context artifacts from the clean worktree before `.env` was copied in for diagnostics. They are not the final environment-backed verdict for this task.

## Fresh Verify Outcome

- The fresh verifier pass was run as a separate read-only role with no production edits.
- The verifier first flagged two proof gaps: unfinished bundle metadata and missing live public post-fix evidence. Both gaps were closed in the builder follow-up.
- The final bundle now records a complete/passed proof state and includes both harness-based and live public post-fix routing evidence.
