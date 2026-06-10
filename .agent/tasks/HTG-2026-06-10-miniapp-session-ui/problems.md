# Problems

No open verifier findings.

Notes:
- The local API on `127.0.0.1:4000` was not running, so browser smoke used a task-local fixture API.
- `pnpm release:check` without arguments reports missing `--version`; the passing release check was `pnpm release:check -- --version 0.4.15`.
- `graphify update apps/miniapp/src` produced a scoped generated `apps/miniapp/src/graphify-out`; it was removed from the commit candidate as generated source-tree noise. The command output is preserved in `raw/graphify-update.txt`.
