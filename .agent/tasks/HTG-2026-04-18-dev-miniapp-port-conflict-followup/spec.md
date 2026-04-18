# HTG-2026-04-18-dev-miniapp-port-conflict-followup

## Status

- Phase: freeze/spec
- Frozen at: 2026-04-18
- Coordinator: Codex main agent
- Builder role: `task-builder`
- Verifier role: `task-verifier`
- Fixer role: `task-fixer`
- Process rule: read-only exploration may be parallelized; all writes remain serialized; no production edits are allowed before this frozen spec exists

## Scope

- Reproduce and classify the occupied-port path for `apps/miniapp` on port `3001` using real local evidence from Windows listeners and `C:\Develop\Projects\BaseDeploy`.
- Determine whether port `3001` is currently a legitimate HappyTG reuse case, a BaseDeploy/Caddy or Docker-backed infrastructure listener, or a foreign conflict, and make the product behavior truthful for that classification.
- Compare mini app behavior with the already-demonstrated API occupied-port behavior on `4000`; preserve the API behavior and use historical commit `d4ef27a` only as reference, not as a blind patch source.
- Extend or wire installer/bootstrap preflight before launch so planned-port diagnostics use the existing `packages/bootstrap/src/index.ts` model (`occupied_expected`, `occupied_supported`, `occupied_external`, including Docker attribution where available).
- Ensure installer/bootstrap reports, for each relevant occupied port, the port number, best-effort listener attribution, whether the state is supported reuse or conflict, explicit override guidance for `HAPPYTG_API_PORT`, `HAPPYTG_MINIAPP_PORT`, and `PORT`, and manual suggestions for alternative ports.
- Keep startup/install handling cheap, deterministic, and separated from core service logic; do not mask legitimate environment issues.
- Add regression coverage for every touched occupied-port classification path and update only the documentation needed for truthful UX.

## Non-Goals

- Auto-reassigning ports, changing default ports, or silently picking new ports.
- Weakening or changing the semantics of `HAPPYTG_API_PORT`, `HAPPYTG_MINIAPP_PORT`, or `PORT`.
- Reworking unrelated startup/runtime behavior outside the minimum scope needed for truthful port diagnostics.
- Hiding or downgrading real environment warnings just to make install/dev appear successful.
- Refactoring large portions of bootstrap or service startup code when a targeted fix is sufficient.

## Acceptance Criteria

1. The `apps/miniapp` occupied-port path on `3001` is either proven correct with evidence or minimally fixed so it truthfully distinguishes legitimate HappyTG reuse from foreign conflict.
2. If port `3001` is occupied by BaseDeploy/Caddy or Docker-published infrastructure, the diagnostics say so explicitly rather than emitting a generic `port in use` message.
3. Installer/bootstrap performs product-level preflight port checks before launch for the relevant planned ports and reports occupied ports without raw stack traces.
4. Occupied-port diagnostics identify, when determinable, which listener/process owns the port, whether the state is `reuse` or `conflict`, and what explicit env overrides are available.
5. Diagnostics suggest manual alternative ports as operator guidance only; they do not silently change defaults or auto-heal by rebinding.
6. The already-demonstrated API occupied-port behavior on `4000` remains intact and is not regressed by the mini app or bootstrap work.
7. Regression tests cover the touched mini app and bootstrap/install conflict paths with deterministic assertions for reuse/conflict attribution and override guidance.
8. Documentation is updated only where required so install/dev troubleshooting matches the real behavior and the actual supported override workflow.
9. The proof bundle for this task is populated with real evidence artifacts, not placeholders, through build/evidence/verify/fix/verify completion.

## Evidence Plan

- Capture baseline reproductions and listener attribution in:
  `raw/repro-pnpm-dev.txt`,
  `raw/port-3001.txt`,
  `raw/port-4000.txt`,
  `raw/base-deploy-port-attribution.txt`,
  `raw/installer-port-check-before.txt`.
- Record build and verification outputs in:
  `raw/build.txt`,
  `raw/lint.txt`,
  `raw/typecheck.txt`,
  `raw/test-unit.txt`,
  `raw/test-integration.txt`,
  `raw/task-validate.txt`,
  `raw/installer-port-check-after.txt`.
- Summarize findings and final disposition in:
  `evidence.md`,
  `evidence.json`,
  `verdict.json`,
  `problems.md`.
- Ground all conclusions in repository code, tests, docs, Windows listener/process evidence, and BaseDeploy configuration/runtime evidence.

## Verification Plan

1. Freeze this spec before any production edits.
2. Perform read-only investigation of `apps/miniapp`, `apps/api`, `packages/bootstrap`, relevant docs, Windows listeners, Docker listeners, and BaseDeploy/Caddy attribution.
3. Implement the minimum scoped fix only after the root cause and desired product behavior are evidenced.
4. Run targeted tests for touched packages and startup/install conflict paths.
5. Run repository verification:
   `pnpm lint`
   `pnpm typecheck`
   `pnpm test`
   `pnpm happytg task validate --repo . --task HTG-2026-04-18-dev-miniapp-port-conflict-followup`
6. Require a fresh verifier pass that does not edit production code.
7. If the verifier finds scoped issues, apply only the minimum necessary fix, then rerun fresh verification before marking complete.

## Risks / Assumptions

- Windows may not always expose a single neat owner for Docker-published or reverse-proxied ports; when exact attribution is unavailable, the product must say that explicitly and present the best supported evidence instead of guessing.
- BaseDeploy facts currently indicate `contacts-frontend` publishes `0.0.0.0:3001->4173/tcp`, `infra-api-1` publishes `0.0.0.0:4000->4000/tcp`, and `C:\Develop\Projects\BaseDeploy\caddy\Caddyfile` proxies `contacts.gerta.crazedns.ru` to `localhost:3001`; the implementation must treat these as real environment facts until disproved by fresh evidence.
- Existing bootstrap port classification should be reused where it is already truthful; avoid duplicating incompatible port-diagnosis logic in multiple startup layers.
- The task is complete only after the proof bundle, fresh verification, and acceptance evidence all align; partial fixes without evidence do not satisfy this spec.
