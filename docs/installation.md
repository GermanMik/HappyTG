# Installation

## Prerequisites

- Git
- Node.js 22+
- `pnpm`
- `npm` for global Codex CLI installation
- Codex CLI installed globally: `npm install -g @openai/codex`
- Telegram bot token
- PostgreSQL, Redis, and S3-compatible object storage for local or self-hosted runs
- Docker and Docker Compose for the packaged control-plane path

## Before You Start

1. Clone the repository.
2. Copy `.env.example` to `.env`.
3. Fill at least the Telegram token, webhook secret, API signing key, database URL, Redis URL, artifact storage settings, and Codex paths.
4. Run `pnpm install`.
5. Run `pnpm happytg doctor` on the execution host that will run Codex.

## Developer Install

1. Start local infrastructure:

   ```bash
   docker compose -f infra/docker-compose.example.yml up --build
   ```

2. In a separate terminal, run the monorepo in watch mode:

   ```bash
   pnpm dev
   ```

3. Run the host daemon on the machine that owns the workspace and Codex install:

   ```bash
   pnpm --filter @happytg/host-daemon pair
   pnpm --filter @happytg/host-daemon run
   ```

4. Open Telegram, complete pairing, then run a quick session followed by a proof-loop session.
5. Use the repo-local CLI when you need deterministic bootstrap or task-bundle actions:

   ```bash
   pnpm happytg status
   pnpm happytg task init --repo . --task HTG-0001 --session ses_manual --workspace ws_manual --title "Manual proof task" --criterion "criterion one"
   pnpm happytg task validate --repo . --task HTG-0001
   ```

6. Validate the local baseline before any change lands:

   ```bash
   pnpm typecheck
   pnpm test
   pnpm build
   ```

## Single-User Self-Hosted Install

1. Provision one control-plane host and one or more execution hosts.
2. On the control-plane host, copy `.env.example` to `.env` and set production secrets and storage endpoints.
3. Build and start the packaged services:

   ```bash
   docker compose -f infra/docker-compose.example.yml up --build -d
   ```

4. Put a reverse proxy with TLS in front of the API and Mini App.
5. On each execution host, install Codex CLI and run `pnpm happytg doctor`.
6. Start the host daemon outside the Compose stack on the execution host.
7. Pair execution hosts through Telegram.
8. Run `pnpm happytg verify` and then execute a Codex smoke session.

## Required Config

- Telegram token and webhook secret
- database and Redis URLs
- artifact storage settings
- JWT signing key
- Codex binary path and config path
- public API and Mini App URLs for Telegram callbacks

## Notes

- `infra/Dockerfile.app` is the shared runtime image for `apps/api`, `apps/worker`, `apps/bot`, and `apps/miniapp`.
- The host daemon is intentionally excluded from Docker Compose because it must run where the target repositories and local Codex configuration live.
- The CI baseline in `.github/workflows/ci.yml` matches the expected local verification gates.
- `pnpm happytg ...` is the repo-local wrapper around the same CLI surface exposed as `happytg ...` when installed as a binary.
