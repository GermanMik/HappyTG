# HTG-2026-04-17-release-0314-install-problem-solutions

## Status

- Phase: complete
- Frozen at: 2026-04-17
- Coordinator: Codex main agent

## Goal

Publish the validated installer remediation follow-up as release `0.3.14` on top of `origin/main@v0.3.13`.

## In Scope

- Bump all workspace package versions from `0.3.13` to `0.3.14`.
- Update `CHANGELOG.md` and add `docs/releases/0.3.14.md`.
- Include the validated source proof bundles for:
  - `HTG-2026-04-17-installer-warning-repair`
  - `HTG-2026-04-17-install-problem-solutions`
- Create and finalize a release proof bundle for `0.3.14`.
- Commit, push, and merge the release branch after validation.

## Out Of Scope

- Any new installer feature work beyond the already validated remediation-bullets scope.
- Additional product fixes unrelated to the current bootstrap/install diff.

## Acceptance Criteria

1. Workspace versions, `CHANGELOG.md`, and `docs/releases/0.3.14.md` are aligned at `0.3.14`.
2. Both source proof bundles validate successfully on this branch.
3. Fresh release verification passes after the version bump.
4. The release proof bundle is complete and validates successfully.
5. The branch is committed, pushed, and merged into `main`.

## Completion Notes

- Release content was prepared on branch `codex/release-0.3.14-install-problem-solutions` from `origin/main@v0.3.13`.
- The proof bundle covers the release artifact preparation and validation for `0.3.14`.
