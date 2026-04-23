# Problems

- No blocking release problems remain after the local release-ready verification set.
- GitHub tag/release creation still depends on merging the release branch to `main` and running the `Release` workflow, which is intentionally outside `pnpm release:check`.
