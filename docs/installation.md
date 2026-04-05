# Installation

## Prerequisites

- Git
- Node.js 22+
- `pnpm`
- `npm` for global Codex CLI installation
- Codex CLI installed globally: `npm install -g @openai/codex`
- Telegram bot token
- PostgreSQL, Redis, and S3-compatible object storage for local or self-hosted runs

## Developer Install

1. Clone the repository.
2. Copy `.env.example` to `.env`.
3. Run `pnpm install`.
4. Run `pnpm bootstrap:doctor`.
5. Start infrastructure.
6. Start the apps with `pnpm dev`.

## Single-User Self-Hosted Install

1. Provision a host for the control plane.
2. Provision one or more execution hosts with Codex CLI installed.
3. Configure reverse proxy and TLS.
4. Run database migrations before first boot.
5. Pair execution hosts through Telegram.
6. Run `happytg verify` and a Codex smoke task.

## Required Config

- Telegram token and webhook secret
- database and Redis URLs
- artifact storage settings
- JWT signing key
- Codex binary path and config path
