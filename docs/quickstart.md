# Quickstart

## Goal

Get from an empty machine to a paired HappyTG host that can run a first Codex-backed task.

## Steps

1. Install Git, Node.js 22+, `pnpm`, and Codex CLI.
2. Copy `.env.example` to `.env` and fill required values.
3. Run `pnpm install`.
4. Run `pnpm bootstrap:doctor`.
5. Start local dependencies from `infra/docker-compose.example.yml`.
6. Start `apps/api`, `apps/worker`, `apps/bot`, and `apps/miniapp`.
7. Start `apps/host-daemon` on the machine that will execute tasks.
8. Pair the host from Telegram.
9. Run the first quick task, then the first proof-loop task.

## What to Expect

- Telegram handles commands, approvals, and short summaries.
- Mini App shows richer task and artifact views.
- Repo-local proof artifacts are written to `.agent/tasks/<TASK_ID>/`.

## Next Reads

- [installation.md](./installation.md)
- [runtime-codex.md](./runtime-codex.md)
- [proof-loop.md](./proof-loop.md)
