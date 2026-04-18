# Evidence Summary

## Acceptance Criteria Mapping

| `pnpm dev` no longer fails with a raw unhandled Node `EADDRINUSE` stack trace from `apps/api/src/index.ts` when the API port is occupied. | `raw/api-conflict-before.txt` captures the pre-fix raw stack trace; `raw/repro-pnpm-dev-after.txt` shows the post-fix `@happytg/api:dev` path no longer emits that stack and instead logs a product message from `apps/api/src/index.ts`. |
| API occupied-port behavior becomes productized and actionable for both legitimate reuse and foreign conflict. | `apps/api/src/index.ts` now routes startup through `startApiServer()` and formats explicit conflict/reuse messages; `raw/api-conflict-after.txt` shows direct startup proof for both foreign conflict and HappyTG API reuse on a configured occupied port. |
| The chosen API UX is documented and justified relative to the existing Mini App behavior. | `docs/troubleshooting.md`, `docs/quickstart.md`, and `docs/installation.md` now describe `4000` using the same reuse-vs-conflict framing already used for `3001`, while leaving the Mini App guidance intact. |
| Bot polling warnings remain truthful and separate unless evidence proves direct causality. | `raw/bot-polling-before.txt` and `raw/bot-polling-after.txt` both show standalone `Telegram polling cycle failed` with `detail:\"fetch failed\"`; `raw/repro-pnpm-dev.txt` and `raw/repro-pnpm-dev-after.txt` show the same warning alongside the API port scenario, which supports treating it as an independent transport symptom. |
| Regression coverage exists for the API startup conflict path. | `apps/api/src/index.test.ts` adds coverage for HappyTG API reuse, foreign conflict, different-HappyTG-service conflict, and transient handoff retry; `raw/test-unit.txt` and `raw/test-integration.txt` are green. |

## Artifacts

- raw/port-3001.txt
- raw/port-4000.txt
- raw/repro-pnpm-dev.txt
- raw/repro-pnpm-dev-after.txt
- raw/api-conflict-before.txt
- raw/api-conflict-after.txt
- raw/bot-polling-before.txt
- raw/bot-polling-after.txt
- raw/test-unit.txt
- raw/lint.txt
- raw/typecheck.txt
- raw/test-integration.txt
- raw/build.txt
- raw/task-validate.txt
- apps/api/src/index.ts
- apps/api/src/index.test.ts
- docs/troubleshooting.md
- docs/quickstart.md
- docs/installation.md
