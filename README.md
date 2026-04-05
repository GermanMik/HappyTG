# HappyTG

HappyTG is a Telegram-first, Codex-first, self-hosted control plane for remotely operating AI coding sessions on a home machine or server.

It is designed around one hard constraint: Telegram is a render surface for commands, approvals, summaries, and notifications, but it is not the execution core and it is not the source of truth. The source of truth lives in the control plane state, durable event log, materialized views, and repo-local proof artifacts.

## Why HappyTG

- Remote control for local execution: operate coding work from Telegram while code runs on your own host.
- Codex-first workflow: optimize for Codex CLI, reproducible verification, repo-local task bundles, and project guidance.
- Proof in repo: non-trivial tasks use a durable proof loop with independent verification and evidence artifacts.
- Resume-first architecture: sessions, approvals, verification, and host connectivity survive disconnects and restarts.
- Self-hosted by default: designed for one developer on one machine first, without blocking future small-team deployment.

## Core Architecture

- `apps/api`: control plane API and websocket endpoints.
- `apps/worker`: event consumers, long-running orchestration, policy/approval processing.
- `apps/bot`: Telegram Bot render layer.
- `apps/miniapp`: Telegram Mini App render layer for diffs, bundles, logs, and reports.
- `apps/host-daemon`: local execution agent running on the developer host.
- `packages/protocol`: typed events, API contracts, daemon protocol, idempotency models.
- `packages/runtime-adapters`: Codex-first runtime orchestration and secondary runtime compatibility.
- `packages/repo-proof`: repo-local proof loop orchestration and task bundle helpers.
- `packages/bootstrap`: deterministic `doctor/setup/repair/verify` engine and manifests.
- `packages/policy-engine`: layered permissions and policy evaluation.
- `packages/approval-engine`: approval lifecycle and serialized mutation gates.
- `packages/hooks`: platform lifecycle hooks.
- `packages/shared`: shared types, logging, config, and utility helpers.

## Repo Entry Points

- [ARCHITECTURE.md](./ARCHITECTURE.md): high-level architectural overview.
- [AGENTS.md](./AGENTS.md): Codex/Cursor guidance for contributors and agents.
- [docs/engineering-blueprint.md](./docs/engineering-blueprint.md): comprehensive production-oriented blueprint.
- [docs/quickstart.md](./docs/quickstart.md): first-run path.
- [docs/runtime-codex.md](./docs/runtime-codex.md): Codex-first runtime model.
- [docs/proof-loop.md](./docs/proof-loop.md): repo-local proof loop.
- [docs/bootstrap-doctor.md](./docs/bootstrap-doctor.md): deterministic bootstrap and doctor subsystem.
- [infra/docker-compose.example.yml](./infra/docker-compose.example.yml): local self-hosted composition example.

## Fast Start

1. Install Node.js 22+, `pnpm`, Git, and Codex CLI.
2. Copy `.env.example` to `.env` and fill Telegram/OpenAI/backend secrets.
3. Read [docs/installation.md](./docs/installation.md).
4. Run `pnpm install`.
5. Run `pnpm bootstrap:doctor`.
6. Start the control plane with `pnpm dev`.
7. Pair a host through the Telegram bot and run the first smoke task.

## Monorepo Commands

```bash
pnpm install
pnpm lint
pnpm typecheck
pnpm test
pnpm dev
pnpm bootstrap:doctor
pnpm bootstrap:verify
```

## Recommended Stack

HappyTG recommends a TypeScript-first monorepo:

- Node.js 22 LTS
- `pnpm` for the repository
- `npm` for global Codex CLI installation
- PostgreSQL for control-plane state
- Redis or NATS JetStream for queue/event fan-out
- S3-compatible object storage for larger artifacts
- Next.js for Mini App
- Fastify or Nest-like thin API layer backed by explicit domain services

## License

Apache-2.0.
