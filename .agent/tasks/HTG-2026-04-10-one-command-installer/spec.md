# Task Spec

- Task ID: HTG-2026-04-10-one-command-installer
- Title: One-command installer and Telegram-first onboarding
- Owner: Codex
- Mode: proof
- Status: frozen

## Problem

HappyTG onboarding currently requires the user to manually clone the repository, install prerequisites, copy `.env`, run `pnpm install`, and then remember the `setup` / `doctor` / `verify` flow from README and `docs/installation.md`. The bootstrap package already owns environment detection and onboarding guidance, so the install experience should be extended inside `packages/bootstrap` rather than replaced. The new flow needs to support a true one-command entrypoint for new macOS and Windows users, safely handle existing checkouts and dirty worktrees, keep Linux behavior intact, and present a Telegram-first retro terminal installer instead of a sequence of plain prompts.

## Acceptance Criteria

1. `happytg install` is added to the existing bootstrap CLI surface and provides the primary interactive installer entrypoint with retro TUI screens for welcome/preflight, repo mode selection, Telegram setup, background run mode, installation progress, and final summary.
2. The shared installer implementation lives inside `packages/bootstrap` and handles platform detection, repo sync decisions (`clone fresh`, `update existing checkout`, `use current directory`), safe dirty-worktree handling, dependency resolution, `pnpm install`, `.env` merge/backup behavior, guided Telegram-only configuration, Telegram bot token capture/validation during install, and end-of-flow handoff to `setup`, `doctor`, and `verify`.
3. Thin bootstrap wrappers are added at `scripts/install/install.sh` and `scripts/install/install.ps1`; they only prepare the host enough to fetch or update the repo and invoke the shared HappyTG installer implementation, keeping macOS and Windows user journeys aligned while not regressing Linux shell usage.
4. Installer manifests, repository docs, and tests are updated for the new one-command onboarding path, including automated coverage for platform detection, repo sync decision logic, idempotent reruns, and `.env` merge behavior, plus renderer coverage where practical.
5. Re-running the installer is safe: it does not overwrite dirty worktrees or existing `.env` values silently, does not print secrets, preserves compatibility with `pnpm happytg setup`, `doctor`, `repair`, and `verify`, and does not weaken the repo architecture invariants around Telegram, policy/approval ordering, serialized mutations, or lazy heavy initialization.
6. The installer removes the common post-install blocker where `TELEGRAM_BOT_TOKEN` is still missing by explicitly collecting the token, persisting it safely, verifying the bot when possible, and surfacing the bot identity so later `/pair <CODE>` authorization requests target the configured bot without extra manual lookup.

## Constraints

- Extend the existing bootstrap engine; do not introduce a separate standalone installer application or a parallel UX outside `packages/bootstrap`.
- Installer UX is Telegram-first only. Do not surface messaging-platform choices for Discord, Slack, Matrix, Mattermost, WhatsApp, or generic webhooks.
- Preserve current Linux support paths and do not regress existing `setup` / `doctor` / `repair` / `verify` behavior.
- Keep platform differences behind explicit installer/platform modules rather than ad hoc conditionals spread across the CLI.
- Treat secrets as sensitive input: never echo configured Telegram tokens or other secret values to stdout/stderr or persisted reports.
- A fresh verification pass is still required after build; if delegated verifier tooling is unavailable in this session, record a separate manual fresh-verify pass in the proof artifacts without mixing it into production edits.

## Verification Plan

- Unit:
  - `pnpm --filter @happytg/bootstrap test`
- Integration / repo gates:
  - `pnpm lint`
  - `pnpm typecheck`
  - `pnpm test`
  - `pnpm happytg doctor`
  - `pnpm happytg verify`
- Manual / behavioral:
  - exercise `pnpm happytg install --help` and representative JSON/non-interactive paths if implemented
  - inspect TUI rendering/screens and final summary outputs for Telegram-only wording and keyboard hints
- Evidence files to produce:
  - `.agent/tasks/HTG-2026-04-10-one-command-installer/raw/build.txt`
  - `.agent/tasks/HTG-2026-04-10-one-command-installer/raw/test-unit.txt`
  - `.agent/tasks/HTG-2026-04-10-one-command-installer/raw/test-integration.txt`
  - `.agent/tasks/HTG-2026-04-10-one-command-installer/raw/lint.txt`
  - `.agent/tasks/HTG-2026-04-10-one-command-installer/raw/typecheck.txt`
  - `.agent/tasks/HTG-2026-04-10-one-command-installer/raw/doctor.txt`
  - `.agent/tasks/HTG-2026-04-10-one-command-installer/raw/verify.txt`
