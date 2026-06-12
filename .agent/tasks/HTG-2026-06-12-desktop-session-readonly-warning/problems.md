# Problems

Task: `HTG-2026-06-12-desktop-session-readonly-warning`

## Resolved

- The first Mini App test run failed because the existing test still expected `contract missing` to appear in the Codex panel page-level output. That expectation matched the old warning behavior and was updated after the UI fix.
- After the first Docker rebuild, `/projects?source=codex-desktop` showed `Desktop projects не найдены` because the stack was running only `infra/docker-compose.example.yml`, so API did not have `CODEX_HOME=/codex-home`. Rebuilding with `infra/docker-compose.codex-desktop.yml` restored the host `.codex` read-only mount and the adapter returned 12 Desktop projects.

## Residual Risks

- This is a presentation-layer fix. It does not enable Codex Desktop Resume/Stop/New Task when the control contract is unsupported.
- Full repository `pnpm test` was not run; scoped Mini App test, typecheck, lint, build, and diff check passed.
- Future Docker restarts must include `infra/docker-compose.codex-desktop.yml` when Desktop project projections are expected.
