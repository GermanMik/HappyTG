# Installer Bottom Progress And Substep Indicators Prompt

Use this prompt when the HappyTG interactive installer progress screen needs the aggregate progress surface moved lower in the screen and local progress indicators added for each install item.

## Prompt

You are working in the HappyTG repository at `C:\Develop\Projects\HappyTG`.

Your task is to update the interactive installer progress UX so that:

1. The shared installer-wide progress bar is rendered near the bottom of the installer progress screen, after the step list and before keyboard hints.
2. Every install step renders an ASCII-safe local progress indicator below the step label/detail.
3. Local step indicators are derived from existing step status unless a step explicitly supplies subprogress.
4. The change does not alter installer execution order, step status semantics, persisted non-interactive behavior, or final summary semantics.

## Required Proof Loop

Create a canonical proof bundle under `.agent/tasks/<TASK_ID>/` before production edits:

- `spec.md`
- `evidence.md`
- `evidence.json`
- `verdict.json`
- `problems.md`
- `task.json`
- `raw/build.txt`
- `raw/test-unit.txt`
- `raw/test-integration.txt`
- `raw/lint.txt`

Freeze scope before changing production files. Keep builder and verifier roles separate. The verifier must not edit production code.

## Likely Implementation Scope

- `packages/bootstrap/src/install/tui.ts`
- `packages/bootstrap/src/install/types.ts`
- `packages/bootstrap/src/install.test.ts`
- `packages/bootstrap/src/install.runtime.test.ts` if runtime assertions need updating

## Acceptance Criteria

- Aggregate progress still counts only terminal step statuses: `passed`, `warn`, `failed`, and `skipped`.
- `running` remains incomplete in the aggregate bar.
- The aggregate bar appears below the rendered step list.
- Each step has a local indicator such as complete, running, pending, warning, failed, or skipped.
- Optional explicit step subprogress can render a bounded `completed/total` bar without requiring all steps to supply it.
- Output remains ASCII-safe and suitable for Windows terminals.

## Verification Commands

Record outputs under the task bundle's `raw/` directory.

```bash
pnpm --filter @happytg/bootstrap exec tsx --test src/install.test.ts --test-name-pattern progress
pnpm --filter @happytg/bootstrap exec tsx --test src/install.runtime.test.ts --test-name-pattern progress
pnpm --filter @happytg/bootstrap build
pnpm --filter @happytg/bootstrap lint
pnpm happytg task validate --repo . --task <TASK_ID>
```
