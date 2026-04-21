# Evidence

Status: complete; fresh verifier passed.

## Builder Notes

- Spec frozen before production edits.
- Dependencies were restored with `pnpm install --frozen-lockfile` because `node_modules` was absent.
- Unit tests passed for `@happytg/api`, `@happytg/miniapp`, and `@happytg/bot`; full output is in `raw/test-unit.txt`.
- Targeted Caddy/docs checks passed; output is in `raw/test-integration.txt`.
- Repo gates passed: `pnpm typecheck`, `pnpm lint`, `pnpm build`.
- Task validation passed after verifier metadata closeout: `raw/task-validate.txt` shows phase `complete` and verification `passed`.
- Release metadata check passed for 0.4.0: `raw/release-check.txt`.

## Targeted Evidence

- Caddy public route contract: public webhook is `/telegram/webhook`; generic `/api/*` responds 404; only Mini App auth/session and authenticated approval resolve endpoints are proxied.
- Docs route contract: configuration, self-hosting, foundation contracts, and 0.4.0 release notes distinguish webhook delivery URL, Mini App public URL, and BotFather/Menu Button setup.
- Mini App auth/session fail-closed behavior: API Mini App projections require bearer/session auth; service-level scoped store returns empty projections without a user; approval resolution checks the session owner.
- Mini App base path and approval behavior: Mini App forwards session cookies as bearer auth, prefixes links when `X-Forwarded-Prefix: /miniapp` is present, and renders approval buttons as authenticated POST actions instead of `href="#"`.
- Telegram Mini App discovery: bot URL resolver prefers `HAPPYTG_MINIAPP_URL`, derives public HTTPS `HAPPYTG_PUBLIC_URL + /miniapp`, rejects localhost/http production URLs, and auto-configures `setChatMenuButton` with readiness degradation on failure.
