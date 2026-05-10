# Evidence

Task: `HTG-2026-05-11-full-verify-release-0.4.14`

## Spec Freeze

Scope frozen before release metadata edits and validation.

## 10-Role Review

| Role | Initial verdict | Critical findings | Resolution |
| --- | --- | --- | --- |
| Release Manager | NO-GO | 0.4.14 metadata and proof were dirty/untracked; raw bundle pending. | Added release metadata, release notes, prompt, proof bundle, and validation outputs. |
| QA/Test Engineer | NO-GO | Clean branch and raw outputs were missing. | Ran lint, typecheck, test, build, doctor, verify, Docker checks, release check, and task validation. |
| Security/Secrets Reviewer | NO-GO | Raw compose/diagnostic logs, `.pyc`, `.pid`, Graphify cache/intermediates, and backup file were release-unsafe. | Removed raw legacy logs, `.pyc`, `.pid`, backup file, Graphify cache/intermediates, machine-specific manifest files, and stale semantic summary. Added `.dockerignore` env exclusions. |
| Architecture Invariants Reviewer | GO with cleanup risk | No runtime invariant violation; noise from generated artifacts. | Production runtime semantics remain unchanged except Docker build reliability and build-context hardening. |
| Docker/Self-hosting Reviewer | NO-GO | Docker proof was stale after MinIO pin; corepack retry proof needed a clean build. | Ran compose config checks, image list, no-cache Docker build proving `corepack prepare pnpm@10.0.0`, and a follow-up build after `.dockerignore` hardening. |
| Graphify/Knowledge Reviewer | NO-GO | Graph was stale and included local cache/path residue. | Ran `graphify update .`; kept only publish-facing graph artifacts and ignored local Graphify residue. |
| Docs/Prompt Reviewer | NO-GO | Prompt/release docs were untracked and evidence was pending. | Added `docs/prompts/happytg-full-verification-10-role-release.md`, changelog entry, release notes, and proof outputs. |
| Monorepo Metadata Reviewer | NO-GO | Version bumps were dirty and release check only covered dirty state. | Updated all 16 workspace package versions to `0.4.14` and ran `pnpm release:check --version 0.4.14`. |
| Git/Branch Hygiene Reviewer | NO-GO | Branch was not pushed; dirty tree prevented PR readiness. | Current branch is isolated for release; final push/PR/merge/cleanup remains after fresh verifier PASS. |
| Operator/User Impact Reviewer | NO-GO | Operator value was clear but proof was not clean. | Docker retry, MinIO pin, Graphify navigation, Docker context hardening, and full-verification prompt are now covered by release evidence. |

## Synthesis

| Finding | Supporting roles | Severity | Decision | Evidence |
| --- | --- | --- | --- | --- |
| Release candidate needed clean metadata and proof. | Release, QA, Docs, Metadata, Git | Blocker | Fixed before PR/release. | `raw/*`, `CHANGELOG.md`, `docs/releases/0.4.14.md` |
| Publish surface included unsafe generated residue. | Security, Graphify, Architecture | Blocker | Removed unsafe raw/cache/intermediate files and ignored future residue. | `.gitignore`, `git diff --check`, `raw/secret-scan.txt` |
| Docker proof was stale after MinIO pin. | Docker, Operator, QA | Blocker | Refreshed compose config/images and Docker builds. | `raw/docker-compose-config.txt`, `raw/docker-compose-images.txt`, `raw/docker-build-nocache.txt`, `raw/docker-build-after-dockerignore.txt` |
| `.env` was not excluded from Docker build context. | Security, Docker | Blocker | Added `.env` and `.env.*` to `.dockerignore`. | `.dockerignore`, `raw/docker-build-after-dockerignore.txt` |
| Full verification prompt needed to be reusable and bounded. | Docs, Release, Git, QA | Required | Added prompt with 10 roles, evidence, branch cleanup, memory, PR/merge, and release rules. | `docs/prompts/happytg-full-verification-10-role-release.md` |

## Implementation Evidence

- Added release metadata for `0.4.14` across 16 workspace package manifests.
- Added `CHANGELOG.md` section and `docs/releases/0.4.14.md`.
- Added `docs/prompts/happytg-full-verification-10-role-release.md`.
- Kept Docker pnpm activation retry and MinIO image pin from the branch.
- Added `.dockerignore` exclusions for `.env` and `.env.*`.
- Refreshed Graphify deterministic graph via `graphify update .`.
- Removed release-unsafe generated residue: old raw compose/diagnostic logs, `.pyc`, `.pid`, backup file, Graphify caches/intermediates, machine-specific manifests, and stale semantic summary JSON.

## Verification

| Command | Raw output | Status |
| --- | --- | --- |
| `pnpm lint` | `raw/lint.txt` | PASS |
| `pnpm typecheck` | `raw/typecheck.txt` | PASS |
| `pnpm test` | `raw/test-unit.txt` | PASS |
| `pnpm build` | `raw/build.txt` | PASS |
| `pnpm happytg doctor` | `raw/doctor.txt` | WARN, exit 0 |
| `pnpm happytg verify` | `raw/test-integration.txt` | WARN, exit 0 |
| `docker compose -f infra/docker-compose.example.yml config --quiet` | `raw/docker-compose-config.txt` | PASS |
| `docker compose -f infra/docker-compose.example.yml config --images` | `raw/docker-compose-images.txt` | PASS |
| `docker build --progress=plain --no-cache --build-arg APP_PACKAGE='@happytg/bot' -f infra/Dockerfile.app -t happytg:0.4.14-verify .` | `raw/docker-build-nocache.txt` | PASS |
| `docker build --progress=plain --build-arg APP_PACKAGE='@happytg/bot' -f infra/Dockerfile.app -t happytg:0.4.14-verify .` | `raw/docker-build-after-dockerignore.txt` | PASS |
| `graphify update .` | `raw/graphify-update.txt` | PASS |
| `node -e <graph parse>` | `raw/graph-parse.txt` | PASS |
| `pnpm release:check --version 0.4.14` | `raw/release-check.txt` | PASS |
| `git diff --check` | `raw/diff-check.txt` | PASS |
| secret-pattern scan | `raw/secret-scan.txt` | PASS |
| `pnpm happytg task validate --repo . --task HTG-2026-05-11-full-verify-release-0.4.14` | `raw/task-validate.txt` | PASS |

## Residual Risk

- A full `docker compose up` was not rerun because it would mutate local Docker services and ports; release proof uses compose config/images plus targeted Docker builds.
- Graphify semantic extraction was not rerun; `graphify update .` refreshed deterministic AST/navigation artifacts without cloud or Ollama fallback.
- `pnpm happytg doctor` and `pnpm happytg verify` exited 0 but reported environment warnings: Codex smoke stderr contained a slow SQLite statement warning, and the configured public Caddy Mini App URL returned HTML without the expected HappyTG Mini App identity marker.
