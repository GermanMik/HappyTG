# HappyTG Graphify Core Corpus

Generated: 2026-07-11
Source root: `C:\Develop\Projects\HappyTG`

Purpose: code-first architecture graph for application and package source,
tests, and project scripts without proof-bundle or task-history noise.

Excluded intentionally: `.agent`, `.agents`, broad docs/changelog history,
GitHub metadata, build/test output, generated bundles, local caches, and secrets.

Refresh:

1. Run `graphify-runs\sync-core-corpus.ps1` from the repository root.
2. Run `graphify update graphify-runs\core-corpus`.
3. If source files were intentionally deleted and the shrink guard triggers,
   rerun step 2 with `--force`.

