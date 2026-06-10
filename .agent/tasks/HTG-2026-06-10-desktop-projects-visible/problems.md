# Problems

- Blocking problems: none found in targeted, root, and smoke validation.
- Non-blocking warning: `pnpm happytg doctor` and `pnpm happytg verify` exit 0 but report a Codex CLI smoke warning from Codex memory-retention startup. HappyTG Caddy `/miniapp` checks passed.
- Non-blocking warning: Caddy config validation exits 0 with `Valid configuration`, but reports that `Caddyfile` is not formatted.
- Non-blocking warning: Playwright in-app browser backend timed out on forwarded `:5083`, while `curl.exe` against the same `:5083` routes returned HTTP 200 and browser verification passed through standard `443`.
- Operational note: current live fix routes public Mini App/API through host-side background processes on `4001/3008`; make this durable before relying on it across reboot.
- Resolved performance issue: `GET /new-task?source=codex-desktop` no longer blocks on full Desktop sessions; post-fix public `:5083` New Task check returned HTTP 200 in 0.222s.
- Resolved error-reporting issue: Desktop New Task validation failures now preserve upstream status; empty prompt returned HTTP 400 in 30 ms instead of generic Mini App 500.
- Resolved visibility issue: newly-created Desktop app-server threads are projected into Mini App Desktop sessions immediately after `createTask`; final live smoke found the created thread in sessions and opened detail locally/publicly.
- Resolved history issue: Desktop detail no longer reports `CODEX_DESKTOP_HISTORY_UNAVAILABLE` for app-server sessions with turn history; newly-created detail opens from the fast createTask history projection, and old app-server detail uses `thread/read` history when JSONL files are absent.
- Remaining design limit: Desktop Codex list screens now show a bounded recent session projection (`limit=50`). Add pagination/search before exposing the full historical Desktop session set in Mini App.
