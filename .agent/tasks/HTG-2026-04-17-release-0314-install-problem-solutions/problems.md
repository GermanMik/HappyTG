# Problems

## Reproduced And Resolved

1. Release content started from a local `main` still pinned to `v0.3.12`, while `origin/main` had already advanced to `v0.3.13`.
   - Resolution: moved the work onto `codex/release-0.3.14-install-problem-solutions` based on `origin/main`, then replayed the validated installer changes there before preparing the release.

## Truthful Constraints

- Repo-level lint remains mostly placeholder-driven in several packages.
- The release bundle truthfully treats the two validated source task bundles as canonical evidence for the code changes included in this release.
