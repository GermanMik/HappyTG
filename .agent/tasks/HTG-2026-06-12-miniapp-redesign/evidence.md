# Evidence

Status: complete

## Commands

- `pnpm --filter @happytg/miniapp run typecheck`
  - Result: PASS
  - Raw: `raw/typecheck.txt`
- `pnpm --filter @happytg/miniapp run test`
  - Result: PASS, 25 tests passed
  - Raw: `raw/test-miniapp.txt`
- `pnpm lint`
  - Result: PASS, 15/15 turbo lint tasks successful
  - Raw: `raw/lint.txt`
- Route smoke with mock Mini App API
  - Result: PASS
  - Covered: `/`, `/codex`, `/sessions`, `/projects`, `/project/ws_1`, `/new-task`, `/approvals`, `/approval/apr_1`, `/codex/desktop-session?id=desktop_1`, `/session/ses_1`, `/diff/ses_1`, `/verify/ses_1`, `/hosts`, `/host/host_1`, `/reports`, `/task/HTG-smoke`
  - Raw: `raw/route-smoke.txt`
- Shell status smoke with mock Mini App API
  - Result: PASS
  - Checked: overview AppShell shows `RTX-PC`, `2 активн.`, `1 реш.`; new-task AppShell shows project and active counters.
  - Raw: `raw/shell-status-smoke.txt`
- Edge mobile screenshot capture at 390x844 with temporary mock server
  - Result: PASS
  - Overview screenshot: `raw/overview-mobile.png`
  - New task screenshot: `raw/new-task-mobile.png`
  - Raw: `raw/edge-screenshot.txt`
- Docker Mini App runtime rebuild/recreate
  - Result: PASS
  - Command output: `raw/docker-miniapp-rebuild.txt`
  - Live smoke: `raw/live-runtime-smoke.txt`
  - `happytg-miniapp-1` is healthy on host port `3008`.

## Notes

- Scope frozen before production edits.
- Temporary visual server script is stored at `raw/visual-server.ts`; the process was stopped after verification.
- AppShell status strip is now data-backed by route projections where route data is available.
- Running Docker Mini App image was rebuilt after the source change so the visible runtime uses the redesign.
