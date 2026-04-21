# Task Spec

- Task ID: HTG-2026-04-21-wave1-foundation-contracts
- Title: Wave 1 foundation contracts alignment
- Owner: HappyTG
- Mode: proof
- Status: frozen

## Problem

The existing HappyTG repository already implements a TypeScript-first monorepo with API, bot, miniapp, host-daemon, worker, protocol, policy, approval, runtime, bootstrap, hooks, and repo-proof packages. The Wave 1 request must therefore align and extend the existing foundation instead of creating a second architecture or migrating services to Go.

The current gaps for this wave are contract drift and missing foundational skeletons:

- protocol state enums use older names such as `prefetching`, `awaiting_approval`, and `spec_frozen`;
- event names cover only a small subset of the requested Wave 1 taxonomy;
- repo-proof bundles use `.agent/tasks/<TASK_ID>/` but do not yet write a `state.json` phase cursor/history file;
- docs still mention `.ai/tasks` in the broad blueprint even though the repo's canonical path is `.agent/tasks`;
- infra has compose and a shared Dockerfile, but no Caddy/public topology skeleton or migrations directory.

## Acceptance Criteria

1. Protocol state and event contracts match the Wave 1 canonical model without adding a parallel architecture
2. Repo-proof bundle supports state.json while preserving existing .agent/tasks compatibility
3. Public topology and infra skeleton are documented for happytg.gerta.crazedns.ru

## Constraints

- Preserve the TypeScript-first implementation baseline.
- Do not create Go app skeletons or a second CLI.
- Do not alter unrelated user changes in `apps/bot/src/index.ts` or `apps/bot/src/index.test.ts`.
- Keep `.agent/tasks/<TASK_ID>/` as the canonical repo-local proof bundle path for this repository.
- Provide compatibility aliases or migration notes for persisted state names where practical.
- Out of scope for Wave 1: full bot wizard UX, Mini App rich UI pages, final auth/session token implementation, full database migrations, and production observability wiring.

## Verification Plan

- Unit: run focused protocol and repo-proof tests.
- Integration: run impacted API/daemon/miniapp tests if contract references change.
- Workspace: run `pnpm typecheck` and a scoped test set before final evidence.
- Proof: validate this task bundle and record evidence under `raw/`.
