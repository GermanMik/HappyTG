# Evidence

## Init

- EchoVault context and details were retrieved before repository work.
- Initial dirty state in `C:\Develop\Projects\HappyTG` was detected and preserved in `raw/original-worktree-dirty-status.txt`.
- Work continued in a separate clean worktree to avoid overwriting user changes.

## Findings

- Root cause for the wrong `/miniapp` identity was external Caddy/BaseDeploy drift, not product HTML. The active host Caddy had no HappyTG host route and the public domain fell through to a HealthOS/static fallback. Evidence: `raw/caddy-active-config-before.json`, `raw/public-miniapp-before-headers.txt`, `raw/public-miniapp-before-body.txt`.
- The deployed BaseDeploy Caddyfile was repaired outside this repository to route `happytg.gerta.crazedns.ru` and the generic `:8443` fallback HappyTG paths to the running HappyTG listeners: Mini App `127.0.0.1:3007`, API `127.0.0.1:4000`, Bot webhook `127.0.0.1:4100`. Evidence: `raw/caddy-fix-notes-final.txt`, `raw/caddy-active-config-after-reapply.json`.
- The repository Caddy starter contract had a redirect bug: `redir /miniapp 302` was parsed as redirecting to literal `302`. It now uses `redir * /miniapp 302`.
- Public `/miniapp` now returns HappyTG Mini App identity. Evidence: `raw/public-root-api-boundary-after-parser-fix-final.txt`, `raw/node-fetch-public-miniapp-after-reapply.txt`.
- The public API boundary remains narrow: `/health` reaches HappyTG API, Mini App API exceptions reach HappyTG API, and generic `/api/v1/projects` returns Caddy `404 Not found`. Evidence: `raw/public-root-api-boundary-after-parser-fix-final.txt`.
- `pnpm happytg telegram menu set --dry-run` passes Caddy identity preflight and does not call Telegram. Evidence: `raw/telegram-menu-dry-run-after-parser-fix-final.txt`.
- Codex websocket 403 is not benign in this environment. The CLI reaches an HTTP/model error, but stdout reports `The 'gpt-5.5' model requires a newer version of Codex`; no expected smoke reply is returned. The readiness message now classifies this as an actionable Codex upgrade/model mismatch warning instead of a stale websocket-only warning. Evidence: `raw/doctor-after-parser-fix-env-final.json`, `raw/verify-after-parser-fix-final.json`.
- Residual external risk: public `/` still serves HealthOS from the BaseDeploy default fallback. This no longer affects `/miniapp` identity or the narrow HappyTG API boundary, but the edge default route should be owned separately if root-brand purity is required.

## Verification

- PASS: `pnpm --filter @happytg/runtime-adapters test` (`raw/test-runtime-adapters-after-parser.txt`).
- PASS: `pnpm --filter @happytg/bootstrap test` (`raw/test-bootstrap-after-parser.txt`).
- PASS: `pnpm typecheck` (`raw/typecheck.txt`).
- PASS: `pnpm lint` (`raw/lint.txt`).
- PASS: `pnpm test` (`raw/test-unit.txt`).
- PASS: `pnpm build` (`raw/build.txt`).
- WARN, truthful: `pnpm happytg doctor --json` with sanitized env sees HappyTG Caddy identity, but warns on missing `.env`, Mini App port 3001 conflict, and Codex CLI too old for configured `gpt-5.5` (`raw/doctor-after-parser-fix-env-final.json`).
- WARN, truthful: `pnpm happytg verify --json` with sanitized env sees HappyTG Caddy identity, but warns on missing `.env`, Mini App port 3001 conflict, and Codex CLI too old for configured `gpt-5.5` (`raw/verify-after-parser-fix-final.json`).
- PASS: `pnpm happytg telegram menu set --dry-run` with sanitized env (`raw/telegram-menu-dry-run-after-parser-fix-final.txt`).