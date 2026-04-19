# HTG-2026-04-19-release-0323-startup-port-fix

## Status

- Phase: frozen
- Frozen at: 2026-04-19
- Coordinator: Codex main agent

## Goal

Publish the already-landed worker/bot startup port-classification fix as release `0.3.23` from branch `codex/release-0.3.23-startup-port-fix`, then merge it to `main` and dispatch the guarded release workflow from the latest default-branch HEAD.

## In Scope

- Bump all workspace package versions from `0.3.22` to `0.3.23`.
- Update `CHANGELOG.md` and add `docs/releases/0.3.23.md`.
- Reference the validated source proof bundle `HTG-2026-04-19-startup-port-proof-loop`.
- Create and finalize a dedicated release proof bundle for `0.3.23`.
- Run release metadata and verification checks locally against the release branch content.
- Commit and push the release-ready branch state.
- Merge the release PR to `main`.
- Dispatch the guarded GitHub Actions `Release` workflow for `0.3.23`.

## Out Of Scope

- New worker, bot, API, miniapp, bootstrap, or daemon product changes beyond the already-landed startup-port fix.
- Reopening or modifying the source proof bundle scope except to reference it as canonical product evidence.
- Bypassing the repo's main-only guarded release workflow by tagging directly from a feature branch.

## Acceptance Criteria

1. All workspace package versions, `CHANGELOG.md`, and `docs/releases/0.3.23.md` are aligned at `0.3.23`.
2. The startup-port fix from `HTG-2026-04-19-startup-port-proof-loop` remains the canonical product evidence for this release.
3. Fresh release validation passes after the metadata bump.
4. The release-ready commit is pushed on `codex/release-0.3.23-startup-port-fix` and merged to `main`.
5. The guarded GitHub `Release` workflow creates `v0.3.23` from the latest `main` HEAD and the release proof bundle is finalized truthfully.

## Completion Notes

- This release packages the worker/bot startup fix that brings occupied-port behavior in line with the product reuse-vs-conflict model already used by bootstrap, API, and Mini App startup.
