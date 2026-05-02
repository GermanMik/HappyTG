# HTG-2026-05-02-local-update-uninstall-prompt

- Task ID: HTG-2026-05-02-local-update-uninstall-prompt
- Title: Local update and uninstall prompt package
- Owner: HappyTG
- Mode: proof
- Status: frozen

## Problem

HappyTG has several legitimate installation shapes: one-command installer, existing local checkout, Docker Compose control plane, reused system services, self-hosted control plane, and execution-host daemon installs. Users need a simple, safe, repeatable command, prompt, and documentation path for day-2 local updates and local uninstall that does not confuse repo updates, runtime restarts, Docker state, `.env`, daemon state, or release artifacts.

## Acceptance Criteria

1. Add `pnpm happytg update` as a real day-2 update command backed by the existing bootstrap installer engine.
2. Add a reusable prompt artifact under `.agent/prompts/` for a future agent to implement or audit easy local update and uninstall UX.
3. The prompt explicitly covers installer shim, repo-local current checkout, existing checkout update mode, Docker isolated stack, Docker reused services, self-hosted control plane, and execution-host daemon cleanup.
4. The prompt includes critical review from 10 independent roles and turns their concerns into concrete requirements.
5. User-facing documentation is updated consistently across the primary places where users look for update/uninstall guidance.
6. Release metadata is aligned for a `0.4.9` update/prompt/docs release if the branch is needed.
7. Evidence records the branch isolation, implementation scope, docs touched, and verification commands.

## Constraints

- Work in an isolated branch/worktree and do not touch the dirty primary checkout.
- Do not change installer/runtime behavior unless documentation reveals a concrete code bug.
- Preserve existing uninstall safety: keep repo checkout, `.env`, Docker services/volumes, and remote data unless the operator separately stops/removes them.
- Do not include secrets, real bot tokens, or credentials in docs, prompt, evidence, or memory.
- APK creation is out of scope after the user's correction.

## Verification Plan

- `pnpm --filter @happytg/bootstrap exec tsx --test src/cli.test.ts --test-name-pattern "update"`
- `pnpm release:check --version 0.4.9`
- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- `pnpm build`
- `pnpm happytg task validate --repo . --task HTG-2026-05-02-local-update-uninstall-prompt`
