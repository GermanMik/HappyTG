# Evidence

Spec frozen before release metadata edits.

## Commands

- `pnpm release:check --version 0.4.7` -> pass. Raw: `raw/release-check.txt`.
- `pnpm lint` -> pass, 15/15 tasks. Raw: `raw/lint.txt`.
- `pnpm typecheck` -> pass, 15/15 tasks. Raw: `raw/typecheck.txt`.
- `pnpm test` -> pass, 15/15 tasks. Raw: `raw/test.txt`.
- `pnpm build` -> pass, 15/15 tasks. Raw: `raw/build.txt`.
- `pnpm happytg verify` -> exit 0 with WARN status. Raw: `raw/verify.txt`.

## Verify Warnings

`pnpm happytg verify` reported environment warnings unrelated to the release metadata:

- Codex CLI websocket fallback warning.
- Public Caddy `/miniapp` route returned HTTP 200 without HappyTG Mini App identity.
- Host ports 80, 443, and 3000 are occupied by non-HappyTG listeners.
