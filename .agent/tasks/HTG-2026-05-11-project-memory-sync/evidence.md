# Evidence Log

## Phase Status

- `init`: completed
- `freeze/spec`: completed before production edits
- `build`: completed
- `evidence`: completed
- `fresh verify`: completed as a separate read-back pass
- `complete`: completed

## Commands Run

### Context and spec freeze

- `memory context --project`
- `memory search "HappyTG project memory git hooks graphify docs memory"`
- `memory details 99a0b0df-59c`
- `memory details f4f7f89e-3ed`
- `memory details 3382aca7-ecd`
- read `README.md`, `AGENTS.md`, `.gitignore`, `package.json`, `docs/proof-loop.md`, `ARCHITECTURE.md`, `CONTRIBUTING.md`, `ROADMAP.md`, `docs/engineering-blueprint.md`, `docs/troubleshooting.md`, and `graphify-out/GRAPH_REPORT.md`
- froze scope in `spec.md` before production edits

### Validation

- `git status --short` -> `raw/git-status-short.txt`
- `.\scripts\install-git-hooks.ps1` -> `raw/install-git-hooks.txt`
- `git config core.hooksPath` -> `raw/core-hooks-path.txt`
- `.\scripts\after-pull-memory-sync.ps1 -Mode manual` -> `raw/after-pull-manual.txt`
- `git check-ignore -v ...` for Graphify residue and DB/log/lock patterns -> `raw/git-check-ignore.txt`
- `C:\Program Files\Git\bin\sh.exe .githooks/post-checkout HEAD HEAD 1` -> exit code 0 with no output

## Implementation Notes

- Added `docs/memory/` with README, decisions, troubleshooting, and architecture notes.
- Added `Project Memory` guidance to `AGENTS.md`.
- Updated `.gitignore` to ignore Graphify temp/cache/intermediate residue and local DB/log/lock files while leaving `graphify-out/GRAPH_REPORT.md` and `graphify-out/graph.json` committable.
- Added PowerShell hook installer and after-pull memory sync script.
- Added Git for Windows sh wrappers for `post-merge` and `post-checkout`; wrappers are best-effort and exit 0.
- The first manual script run exposed a PowerShell single-output indexing issue for `git rev-parse`; fixed before final validation.

## Acceptance Mapping

| Criterion | Evidence |
| --- | --- |
| `docs/memory/` files exist | `docs/memory/README.md`, `decisions.md`, `troubleshooting.md`, `architecture.md` |
| `AGENTS.md` contains `Project Memory` | `AGENTS.md` diff |
| `.gitignore` protects local generated state | `.gitignore`, `raw/git-check-ignore.txt` |
| Hook installer works | `raw/install-git-hooks.txt`, `raw/core-hooks-path.txt` |
| Sync script detects memory changes | `raw/after-pull-manual.txt` |
| Shell wrappers invoke PowerShell script | `.githooks/post-merge`, `.githooks/post-checkout`, Git sh smoke exit 0 |
| Heavy checks skipped appropriately | `raw/build.txt`, `raw/test-integration.txt`, `raw/lint.txt` |
