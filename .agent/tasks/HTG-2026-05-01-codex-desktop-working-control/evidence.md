# Evidence

## Implementation

- Added a Codex app-server JSON-RPC control contract in `packages/runtime-adapters/src/codex-desktop.ts`.
- Resume uses `thread/resume`.
- New Desktop Task uses `thread/start` then `turn/start`.
- Stop uses `thread/turns/list` and interrupts only an `inProgress` turn through `turn/interrupt`.
- API keeps existing policy/audit gates and now maps app-server control failures to guarded control errors instead of unhandled 500s.
- Mini App Desktop action buttons now post to a same-origin Mini App route, which forwards to the API with Mini App auth; no broad public `/api/*` Caddy exposure is required.
- Mini App New Task now preserves Desktop project id/path instead of accidentally submitting CLI workspace fields for Desktop tasks.

## Verification

- Main-tree refresh on 2026-05-02 fast-forwarded this checkout to `origin/main` / `v0.4.9` without stashing or resetting the existing dirty Desktop-control files.
- `pnpm install --frozen-lockfile` passed in the main checkout.
- `pnpm release:check --version 0.4.9` passed in the main checkout.
- `pnpm lint` passed in the main checkout.
- `pnpm typecheck` passed in the main checkout.
- `pnpm test` passed in the main checkout.
- `pnpm build` passed in the main checkout.
- `pnpm happytg doctor` exited 0 with existing WARN findings.
- `pnpm happytg verify` exited 0 with existing WARN findings.
- `pnpm happytg task validate --repo . --task HTG-2026-05-01-codex-desktop-working-control` passed in the main checkout.
- `pnpm --filter @happytg/runtime-adapters run test` passed.
- `pnpm --filter @happytg/api run test` passed.
- `pnpm --filter @happytg/miniapp run test` passed.
- `pnpm --filter @happytg/runtime-adapters run typecheck` passed.
- `pnpm --filter @happytg/api run typecheck` passed.
- `pnpm --filter @happytg/miniapp run typecheck` passed.
- `pnpm --filter @happytg/runtime-adapters run build` passed.
- `pnpm --filter @happytg/api run build` passed.
- `pnpm --filter @happytg/miniapp run build` passed.
- `pnpm --filter @happytg/runtime-adapters run lint` passed.
- `pnpm --filter @happytg/api run lint` passed.
- `pnpm --filter @happytg/miniapp run lint` passed.
- Live app-server probe listed local Desktop sessions and successfully resumed one thread without starting a new model turn.
- `pnpm happytg task validate --repo . --task HTG-2026-05-01-codex-desktop-working-control` passed.
- `pnpm happytg doctor` exited 0 with existing WARN findings.
- `pnpm happytg verify --json` and direct `pnpm exec tsx packages/bootstrap/src/cli.ts verify` exited 0 with existing WARN findings.

Raw outputs are under `raw/`.

Fresh main-tree outputs use the `*-main-tree.txt` suffix.
