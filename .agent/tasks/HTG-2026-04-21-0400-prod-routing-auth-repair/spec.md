# Task Spec

- Task ID: HTG-2026-04-21-0400-prod-routing-auth-repair
- Title: HappyTG 0.4.0 production routing/auth repair
- Owner: task-spec-freezer
- Mode: proof-loop
- Status: frozen
- Frozen at: 2026-04-21T00:00:00+03:00

## Problem

HappyTG 0.4.0 has review regressions in production-facing routing, Mini App auth scoping, public API exposure, Mini App routing behind the `/miniapp` mount, approval action wiring, and Telegram Mini App discovery. The repair must make production safer without changing the product architecture or local Telegram polling/webhook development model.

## Acceptance Criteria

1. The public Telegram webhook delivery URL is consistently `/telegram/webhook` in Caddy, bot readiness expectations, and self-hosting/configuration docs.
2. Mini App projection endpoints fail closed in production when no valid bearer/session context resolves to a user; missing `userId` must not mean global data access.
3. The public reverse proxy does not expose mutating control-plane routes without an auth boundary; session creation, approval resolution, daemon endpoints, launch grant create/revoke, and similar state-changing routes are not open through `/api/*`.
4. Mini App navigation and generated links work both locally and when mounted behind Caddy at `/miniapp`.
5. Mini App approval actions either execute approve/reject end-to-end with valid Mini App session auth or the UI does not show nonfunctional action controls.
6. Production Mini App URLs prefer `HAPPYTG_MINIAPP_URL`; otherwise derive from public HTTPS `HAPPYTG_PUBLIC_URL + /miniapp`; `HAPPYTG_APP_URL` is only a development fallback and must not allow production `localhost`/plain HTTP `web_app` links.
7. Telegram Menu/Main Mini App setup is handled by `setChatMenuButton` when a valid public HTTPS Mini App URL is configured, or readiness/docs clearly warn when it is missing or cannot be verified.
8. `/ready` or doctor diagnostics report degraded/warning when the Mini App public URL is non-HTTPS, localhost, or the menu button cannot be configured/verified.
9. `.env.example`, `docs/configuration.md`, `docs/self-hosting.md`, and `docs/releases/0.4.0.md` distinguish Telegram webhook delivery URL, Telegram Mini App public URL, and BotFather/Menu Button/Main Mini App setup.
10. Regression tests cover auth fail-closed behavior, base path links, webhook path consistency, approval action behavior, Mini App URL resolution from copied `.env.example` plus `HAPPYTG_PUBLIC_URL=https://happy.example.com`, inline `web_app` links, invalid Mini App URL readiness degradation, and mocked `setChatMenuButton` auto setup.

## Constraints

- Keep changes narrowly scoped to production routing/auth and Mini App action/discovery wiring.
- Do not rewrite the Mini App into another framework.
- Do not break the local Telegram polling/webhook model.
- Do not weaken auth, pairing, launch grant, approval, or policy semantics.
- Do not perform a broad architecture rewrite.
- Verifier role must not edit production code.
- Completion requires all proof bundle metadata to be non-pending/non-unknown and fresh verifier confirmation after any fix.

## Verification Plan

- Unit: `pnpm --filter @happytg/api test`, `pnpm --filter @happytg/miniapp test`, `pnpm --filter @happytg/bot test`.
- Integration/static: targeted assertions for Caddy route contract and docs route wording when infra/docs change.
- Repo gates: `pnpm typecheck`, `pnpm lint`, `pnpm build`.
- Task gate: `pnpm happytg task validate --repo . --task HTG-2026-04-21-0400-prod-routing-auth-repair`.
- Evidence files to produce: `raw/test-unit.txt`, `raw/test-integration.txt`, `raw/typecheck.txt`, `raw/lint.txt`, `raw/build.txt`, `raw/task-validate.txt`, plus targeted route/docs evidence in `evidence.md` and `evidence.json`.
