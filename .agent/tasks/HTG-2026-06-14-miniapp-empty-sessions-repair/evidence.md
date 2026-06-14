# Evidence

## Diagnosis

- The reported Mini App screen had Codex Desktop projects/sessions in the shell status, but the selected project queue rendered `0 visible` and `Нет активных сессий`.
- The selected-project filter in `apps/miniapp/src/index.ts` compared `repoName` and `projectPath` exactly.
- A safe Windows-equivalent path mismatch such as `c:\develop\projects\happytg` versus `C:/Develop/Projects/HappyTG/` could hide valid selected-project Desktop sessions.
- Recent project memory requires preserving the strict `0.4.27` selected-project behavior: do not show unrelated or unscoped Desktop sessions, and render at most five cards.

## Change

- Added `normalizeCodexProjectPath` for Mini App project matching.
- `matchesCodexProject` still accepts exact `repoName` matches, but now compares normalized project paths for slash direction, trailing slashes, and Windows case differences.
- Added regression coverage for a selected Codex Desktop project path written as lowercase backslashes while the Desktop session path uses forward slashes and a trailing slash.
- Regression coverage also verifies unrelated and unscoped Desktop sessions remain hidden.

## Validation

- `pnpm --filter @happytg/miniapp test` passed on rerun; raw output is in `raw/test-unit.txt`.
- `pnpm --filter @happytg/miniapp exec tsx --test --test-reporter=spec src/index.test.ts` passed; raw output is in `raw/test-unit-debug.txt`.
- `pnpm --filter @happytg/miniapp typecheck` passed; raw output is in `raw/typecheck.txt`.
- `pnpm --filter @happytg/miniapp lint` passed; raw output is in `raw/lint.txt`.
- `pnpm --filter @happytg/miniapp build` passed; raw output is in `raw/build.txt`.
- `pnpm typecheck` passed across 15 packages; raw output is in `raw/repo-typecheck.txt`.
- `pnpm test` passed across 15 packages; raw output is in `raw/repo-test.txt`.
- `pnpm lint` passed across 15 packages; raw output is in `raw/repo-lint.txt`.
- `pnpm build` passed across 15 packages; raw output is in `raw/repo-build.txt`.
- `git diff --check` passed; raw output is in `raw/diff-check.txt`.
- `pnpm happytg task validate --repo . --task HTG-2026-06-14-miniapp-empty-sessions-repair --json` passed with `ok: true` and `canonicalOk: true`; raw output is in `raw/task-validate.txt`.
- Dependency surface check: `package.json` and `pnpm-lock.yaml` were not changed.

## Residual Risk

- No live Docker/browser smoke was run in this pass; the changed behavior is covered by Mini App server tests using the same route and HTML rendering path, plus full monorepo test/typecheck/lint/build.
