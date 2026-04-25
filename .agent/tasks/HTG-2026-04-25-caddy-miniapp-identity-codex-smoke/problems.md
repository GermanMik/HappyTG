# Problems

## Resolved

- Public `https://happytg.gerta.crazedns.ru/miniapp` served HealthOS HTML because the host Caddy/BaseDeploy config did not bind HappyTG routes for this domain/fallback path.
- The repository starter Caddyfile used an ambiguous `redir /miniapp 302` directive; this has been corrected to `redir * /miniapp 302`.
- HappyTG doctor previously summarized Codex smoke using stderr only, so a stdout model-version failure after websocket retries could be hidden behind a generic websocket 403 warning.

## Remaining Operator Items

- Upgrade Codex CLI or configure a model supported by `codex-cli 0.118.0`; current smoke does not return the expected reply because configured `gpt-5.5` requires a newer Codex.
- Restore real local `.env`/Telegram token in the operator worktree before a non-dry-run Telegram menu update.
- Resolve the local Mini App default port conflict if starting a new stack from this worktree: port `3001` is occupied by Contacts, while the running HappyTG Mini App is on `3007`.
- Consider a separate BaseDeploy cleanup for public `/`, which still serves HealthOS as the default fallback. `/miniapp` and generic `/api/*` behavior are fixed for this task.