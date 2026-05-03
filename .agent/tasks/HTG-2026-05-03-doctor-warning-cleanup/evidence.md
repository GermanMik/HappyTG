# Evidence

## Baseline

- `raw/baseline-summary.txt` records the initial `doctor/verify` warning classification without storing the long Codex/Cloudflare stderr dump.
- The warning path was `CODEX_SMOKE_WARNINGS` after Codex Responses websocket 403 with a successful HTTP fallback and final `OK` smoke reply.
- Running local HappyTG services were already classified as port reuse, but `SERVICES_ALREADY_RUNNING` was still emitted as a finding/documented finding, which made the healthy reuse state look like remaining doctor/verify work.

## Implementation Evidence

- `packages/runtime-adapters/src/index.ts`
  - Added successful-smoke benign stderr classification for Codex websocket 403, retry/fallback, plugin sync/cache, analytics 403, Cloudflare HTML fragments, rmcp remote app discovery failures, and exact global-memory policy-block noise observed during Codex smoke.
  - Added optional `smokeCwd` so callers can run the Codex smoke from a neutral directory.
- `packages/bootstrap/src/index.ts`
  - Passes `HAPPYTG_CODEX_SMOKE_CWD` or `os.tmpdir()` to Codex readiness smoke so repo/project instructions do not shape the readiness probe.
  - Removed `SERVICES_ALREADY_RUNNING` from findings; the same state remains visible under `Ports:` and `Reuse:`.
- `packages/runtime-adapters/src/index.test.ts`
  - Covers neutral smoke cwd.
  - Covers benign Codex fallback/HTML/memory-policy smoke diagnostics while preserving a custom actionable warning.
- `packages/bootstrap/src/index.test.ts`
  - Covers successful Codex HTTP fallback with benign stderr and no `CODEX_SMOKE_WARNINGS`/`CODEX_SMOKE_FAILED`.
  - Covers already-running HappyTG service ports as reuse info without `SERVICES_ALREADY_RUNNING`.
- `docs/bootstrap-doctor.md`
  - Removed `SERVICES_ALREADY_RUNNING` from the documented findings table.

## Command Evidence

| Command | Result | Raw output |
| --- | --- | --- |
| `pnpm --filter @happytg/runtime-adapters test` | PASS | `raw/test-runtime-adapters-fifth.txt` |
| `pnpm --filter @happytg/bootstrap test` | PASS | `raw/test-bootstrap-final.txt` |
| `pnpm build` | PASS | `raw/build.txt` |
| `pnpm lint` | PASS | `raw/lint.txt` |
| `pnpm typecheck` | PASS | `raw/typecheck.txt`, `raw/typecheck-final.txt` |
| `pnpm test` | PASS | `raw/test.txt`, `raw/test-final.txt` |
| `pnpm happytg doctor` | PASS | `raw/doctor-final.txt` |
| `pnpm happytg verify` | PASS | `raw/happytg-verify-final.txt` |
| `pnpm happytg task validate --repo . --task HTG-2026-05-03-doctor-warning-cleanup` | PASS | `raw/task-validate-final.txt` |
| `git diff --check` | PASS | `raw/diff-check.txt` |

## Fresh Verifier

Fresh verifier pass reviewed the frozen spec, implementation diff, focused tests, full command outputs, final doctor/verify output, and proof files. Verdict: PASS, no blocking findings.
