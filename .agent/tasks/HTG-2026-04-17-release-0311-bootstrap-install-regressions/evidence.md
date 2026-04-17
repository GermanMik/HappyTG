# Evidence Summary

## Acceptance Criteria Mapping

| Criterion | Evidence |
| --- | --- |
| Broken preload no longer reports `Node.js 22+ is still not available on PATH` when Node is present. | `raw/repro-poisoned-node.txt`, `raw/repro-poisoned-install-ps1.txt`, `scripts/install/install.ps1`, `packages/bootstrap/src/install.scripts.test.ts` |
| Root cause is explicitly classified as environment contamination vs repo-managed preload requirement. | `raw/env-node-options.txt`, `raw/repro-poisoned-bootstrap-local-install-ps1.txt`, `scripts/install/install.ps1`, `scripts/install/install.sh`, `raw/install-warning-classification.txt` |
| Bootstrap strategy is truthful on both PowerShell and shell bootstrap wrappers. | `scripts/install/install.ps1`, `scripts/install/install.sh`, `packages/bootstrap/src/install.scripts.test.ts`, `raw/test.txt` |
| Warning surfaces remain truthful and deduped. | `raw/doctor-json.txt`, `raw/verify-json.txt`, `raw/install-final-summary.txt`, `raw/install-warning-classification.txt`, `packages/bootstrap/src/install.runtime.test.ts`, `packages/bootstrap/src/cli.test.ts` |
| TUI indicators are readable and stable again. | `packages/bootstrap/src/install/tui.ts`, `packages/bootstrap/src/install.test.ts`, `raw/install-interactive-transcript.txt`, `raw/tui-render-notes.txt` |
| Regression coverage exists and full repo verification passed. | `raw/build.txt`, `raw/lint.txt`, `raw/typecheck.txt`, `raw/test.txt` |

## Root Cause

- The failing bootstrap was not caused by a tracked HappyTG preload artifact. Repo-local search and the working tree both show no tracked `undici-timeout-preload.cjs` and no tracked reference to `undici-timeout-preload`.
- `raw/env-node-options.txt` records that the user-reported example path `C:\Develop\undici-timeout-preload.cjs` exists on this builder machine, so reproductions used a different missing path: `C:\Develop\__missing_happytg_preload__.cjs`.
- `raw/repro-poisoned-node.txt`, `raw/repro-poisoned-corepack.txt`, and `raw/repro-poisoned-pnpm.txt` show the same failure shape before HappyTG does any real work: `Require stack: internal/preload` with `Node.js v24.15.0` still printed. That proves Node exists and the shell is poisoned by stale external `NODE_OPTIONS`, not by missing Node.
- The old wrappers misdiagnosed the failure because `install.ps1` `Node-Major()` and `install.sh` `node_major()` collapsed any `node -p ...` failure to `0`. The final bootstrap guard then translated that `0` into `Node.js 22+ is still not available on PATH`.
- The new wrappers probe Node startup explicitly, detect missing preload paths, classify scope (`external`, `workspace`, `bootstrap`), clear only broken external `NODE_OPTIONS` for bootstrap-owned commands, and fail truthfully when the missing preload lives under `HAPPYTG_BOOTSTRAP_DIR` or the selected workspace.

## Chosen Fix

- `scripts/install/install.ps1`
  - adds explicit Node probing, preload-path parsing, scope classification, and bootstrap-local `NODE_OPTIONS` sanitization for broken external preloads only
  - preserves hard failure for missing preload inside `HAPPYTG_BOOTSTRAP_DIR` or the selected workspace
  - replaces the false PATH diagnosis with a truthful runtime/preload error message when Node is present but cannot start cleanly
- `scripts/install/install.sh`
  - mirrors the same classification and sanitization model so the architecture stays symmetric
- `packages/bootstrap/src/install/tui.ts`
  - changes the running glyph from Unicode ellipsis to ASCII `>`
  - changes pending from `·` to `.`
  - colorizes labels by status so the active/completed/warn/error rows remain readable
- `packages/bootstrap/src/install.test.ts`
  - adds a TUI regression test asserting the running indicator is ASCII `>`
- `packages/bootstrap/src/install.scripts.test.ts`
  - adds wrapper-script regressions for PowerShell external poison, PowerShell bootstrap-local poison, and shell-wrapper symmetry

## Verdict On The Preload-Hypothesis

- Evidence does not support “just place `undici`/preload inside HappyTG” as the fix.
- HappyTG does not track or create such a preload today.
- The failure reproduces purely from an external stale `NODE_OPTIONS` entry before any HappyTG-managed artifact exists.
- Therefore the minimal correct fix is bootstrap-specific detection plus conditional sanitization of broken external preload paths, not inventing a new repo-managed preload artifact.
- `HAPPYTG_BOOTSTRAP_DIR` remains sufficient for the one case HappyTG does own: if a missing preload path is inside the bootstrap checkout, bootstrap now fails explicitly and truthfully.

## Warning Classification

See `raw/install-warning-classification.txt` for the detailed matrix. The short version:

- Telegram `getMe` timeout / Node HTTPS-undici split:
  - legitimate environment warning when token state is preserved and alternate transport can still reach Telegram
  - not reproduced on this host during `doctor`/`verify`, so classification is backed by repo-local tests rather than a live machine repro
- Codex websocket `403`:
  - real environment/runtime warning on this machine
  - should remain visible because the CLI falls back to HTTP rather than fully failing
- Mini App port `3001` busy:
  - real environment warning on this machine
  - should remain visible with occupant identity and port-override guidance
- Final Summary / Next steps:
  - diagnostics-quality surface
  - should dedupe repeated warning sets and keep next steps concrete without pretending the install is clean

## TUI Regression

- The prior running icon was Unicode `…`, which is unstable on some Windows terminal/font/codepage combinations and matches the user-reported purple `E` regression better than a status-enum bug.
- `raw/install-interactive-transcript.txt` now shows the active step rendered as purple `>` and the pending step as `.`
- The non-interactive/final-summary path is separate (`packages/bootstrap/src/cli.ts`) and was not changed by the TUI glyph fix.

## Verification

- Repro commands/artifacts:
  - `raw/repro-poisoned-node.txt`
  - `raw/repro-poisoned-corepack.txt`
  - `raw/repro-poisoned-pnpm.txt`
  - `raw/repro-clean-install.txt`
  - `raw/repro-poisoned-install-ps1.txt`
  - `raw/repro-poisoned-bootstrap-local-install-ps1.txt`
- Repo verification:
  - `raw/build.txt`
  - `raw/lint.txt`
  - `raw/typecheck.txt`
  - `raw/test.txt`
  - `raw/test-unit.txt`
  - `raw/test-integration.txt`
  - `raw/task-validate.txt`

## Residual Risk / Coverage Boundary

- A live Telegram timeout on this exact machine was not reproduced during this task. Coverage for that branch comes from repo-local unit/runtime tests plus the warning-classification notes, not from a fresh host-specific timeout artifact.
- The interactive renderer itself is exercised through render snapshots/tests rather than a human-driven terminal session. That boundary is intentional and compensated by `raw/install-interactive-transcript.txt`, `raw/tui-render-notes.txt`, and the new regression test.

## Fresh Verifier

- Independent verifier role: `task-verifier`
- Verifier agent: `019d9b33-7336-7cf0-b47c-002832258dfe` (`Lagrange`)
- Verifier verdict:
  - no blocking product-code findings
  - root-cause classification and minimal fix accepted
  - warning classification accepted
  - TUI indicator fix accepted
  - initial blocker was only proof-bundle completeness (`test-unit`, `test-integration`, `task-validate`, pending metadata)
- Follow-up:
  - canonical split test artifacts were added
  - verifier metadata was synchronized into the bundle
  - `task validate` was rerun after bundle sync
