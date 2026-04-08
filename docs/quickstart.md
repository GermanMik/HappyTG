# Quickstart

## Goal

Get from an empty machine to a paired HappyTG host that can run a first Codex-backed task.

## Steps

1. Install Git, Node.js 22+, `pnpm`, and Codex CLI.
2. Copy `.env.example` to `.env` and fill required values:

   ```bash
   cp .env.example .env
   ```
3. In terminal 1, install dependencies and verify the execution host:

   ```bash
   pnpm install
   pnpm happytg doctor
   ```

4. In terminal 1, start the packaged control-plane services:

   ```bash
   docker compose -f infra/docker-compose.example.yml up --build
   ```

5. In terminal 2, start the development stack:

   ```bash
   pnpm dev
   ```

6. In terminal 3 on the execution host, request pairing and start the daemon:

   ```bash
   pnpm daemon:pair
   # send /pair <CODE> to the Telegram bot
   pnpm dev:daemon
   ```

7. If port `3001` is already taken, restart the Mini App with a different port:

   ```bash
   PORT=3002 pnpm dev:miniapp
   ```

8. Run the first quick task, then the first proof-loop task.
9. Confirm the local verification baseline:

   ```bash
   pnpm typecheck
   pnpm test
   pnpm build
   pnpm happytg verify
   ```

## What to Expect

- Telegram handles commands, approvals, and short summaries.
- Mini App shows richer task and artifact views.
- Repo-local proof artifacts are written to `.agent/tasks/<TASK_ID>/`.
- `pnpm happytg doctor --json` keeps raw Codex stderr and other detailed diagnostics if the plain-text doctor output asks you to inspect them.

## Next Reads

- [installation.md](./installation.md)
- [runtime-codex.md](./runtime-codex.md)
- [proof-loop.md](./proof-loop.md)
