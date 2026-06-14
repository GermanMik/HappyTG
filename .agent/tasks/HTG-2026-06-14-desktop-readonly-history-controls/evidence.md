# Evidence

## Live Finding

- User-visible failure came from `POST /api/v1/codex-desktop/sessions/<id>/continue`.
- API audit for `019ec1b8-e7d9-73b1-81e8-03e7c11212aa` recorded `thread not found`.
- Host proxy can read the JSONL history for that session, but the app-server cannot control it.

## Implementation

- Added `CODEX_DESKTOP_SESSION_READ_ONLY_REASON_CODE` for JSONL-only sessions not confirmed by a control contract.
- File/session-index projections now require control-contract confirmation before exposing `resume`, `continue`, or `stop`.
- Sessions returned by app-server or host-proxy keep their own session-level control flags instead of being re-decorated from global capabilities.
- `continueSession` now auto-runs `thread/resume` before `turn/start` for non-active app-server threads.
- Restarted live `desktop-proxy` and rebuilt live `api` with `docker-compose.codex-desktop-host-proxy.yml`.
- Documented the required Docker override combination in `AGENTS.md` and `docs/memory/troubleshooting.md`.

## Validation

- `pnpm --filter @happytg/runtime-adapters test` passed.
- `pnpm --filter @happytg/runtime-adapters typecheck` passed.
- `pnpm --filter @happytg/runtime-adapters build` passed.
- `pnpm --filter @happytg/api test` passed.
- `git diff --check` passed.
- Live smoke: host proxy and API ready, API control reports `canContinue=true`, old session detail renders in Mini App without `Mini App fetch failed`.

## Not Run

- Full repo `pnpm test`: not run because targeted runtime/API coverage exercises the changed contract and affected API path.
- Real non-empty live `continue` POST: not run to avoid adding an unsolicited prompt to the user's old Codex Desktop thread.
