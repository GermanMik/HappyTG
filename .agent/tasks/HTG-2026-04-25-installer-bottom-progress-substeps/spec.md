# Task Spec

- Task ID: HTG-2026-04-25-installer-bottom-progress-substeps
- Title: Move installer aggregate progress to bottom and add per-step progress indicators
- Owner: HappyTG
- Mode: proof
- Status: frozen

## Problem

The interactive installer currently renders the aggregate progress bar immediately under the progress screen header. The user requested the common progress indicator to move to the bottom of the installer and asked for an additional progress indicator for each implemented/active item so individual steps do not look static while the install flow advances.

## Acceptance Criteria

1. The interactive installer progress screen renders the aggregate step-count progress bar near the bottom of the screen, after the step list and before keyboard hints.
2. Each install step renders an ASCII-safe local progress indicator below the step label/detail.
3. Local indicators do not change installer execution semantics or persisted result shape; they are derived from existing step status unless explicit step progress is provided later.
4. Existing aggregate accounting remains terminal-state based: passed, warn, failed, and skipped count as complete; running remains incomplete.
5. A reusable prompt artifact exists under `.agent/prompts/` for future agents to reproduce or extend the installer progress UX task.
6. Targeted renderer and runtime progress tests pass and raw evidence is recorded in this bundle.

## Constraints

- Preserve installer step ordering and status semantics.
- Keep output ASCII-safe for Windows terminals.
- Do not introduce duration-based or fake runtime estimates.
- Avoid changing non-interactive install output.
- Builder and verifier phases are separated by command evidence; verifier does not edit production code.

## Verification Plan

- Unit renderer: `pnpm --filter @happytg/bootstrap exec tsx --test src/install.test.ts --test-name-pattern progress`
- Runtime progress: `pnpm --filter @happytg/bootstrap exec tsx --test src/install.runtime.test.ts --test-name-pattern progress`
- Package build: `pnpm --filter @happytg/bootstrap build`
- Package lint: `pnpm --filter @happytg/bootstrap lint`
- Task validation if available: `pnpm happytg task validate --repo . --task HTG-2026-04-25-installer-bottom-progress-substeps`
