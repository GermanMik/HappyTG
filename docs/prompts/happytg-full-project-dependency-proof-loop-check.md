# HappyTG Full Project Dependency Proof-Loop Check Prompt

Use this prompt when HappyTG needs a full-project verification pass that accounts for source dependencies, workspace package relationships, runtime services, external integrations, and dependency health. The goal is not only to find issues, but to keep the project test-green after every individual fix and to close the task only when proof-loop evidence agrees with the actual command results.

## Prompt

You are working in the HappyTG repository.

Primary objective: perform a complete dependency-aware project check, implement only the smallest necessary fixes, and prove after each fix that the project still passes the relevant tests. Treat the project as unverified until the frozen spec, dependency inventory, raw command outputs, fresh verifier verdict, and task bundle metadata all agree.

Do not publish a release, create a PR, or change version metadata unless the user explicitly asks for that.

## Mandatory Start

Follow `AGENTS.md` before doing any work:

```bash
memory context --project
memory search "HappyTG full project dependency proof-loop tests verify audit"
memory details <relevant-memory-id>
```

Inspect the repository and branch state before edits:

```bash
git status --short --branch
git log --oneline -5
git diff --stat
Get-Content package.json
Get-Content pnpm-workspace.yaml
Get-Content turbo.json
```

If the worktree is dirty, do not overwrite, stash, reset, clean, or reformat unrelated changes. Work with the current state, or create an isolated `codex/...` branch/worktree only when it is safe.

Read project memory before broad exploration:

```bash
Get-Content docs/memory/README.md
Get-Content docs/proof-loop.md
```

For architecture, import, package, or module relationship questions, start narrow with Graphify when available:

```bash
graphify query "HappyTG workspace package dependencies runtime services verification surfaces" --budget 1200
```

Use Graphify as navigation evidence only. Read actual source files before editing. Do not run heavy semantic extraction unless the dependency question requires it and the local LM Studio path is verified.

## Proof Bundle

Create and maintain:

```text
.agent/tasks/<TASK_ID>/
  spec.md
  state.json
  evidence.md
  evidence.json
  verdict.json
  problems.md
  raw/
    dependency-inventory.txt
    package-manager.txt
    audit.txt
    outdated.txt
    build.txt
    test-unit.txt
    test-integration.txt
    lint.txt
    typecheck.txt
    doctor.txt
    verify.txt
    task-validate.txt
    fix-<N>-targeted.txt
```

Suggested task id:

```text
HTG-YYYY-MM-DD-full-project-dependency-check
```

Freeze `spec.md` before implementation. The frozen spec must include:

- exact scope and non-goals,
- dependency surfaces to inspect,
- acceptance criteria,
- required validation matrix,
- what counts as a blocker,
- what may be deferred with documented risk.

Do not start production-code edits before the spec is frozen.

## Dependency-Aware Scope

Cover these surfaces explicitly:

- Workspace layout: root `package.json`, `pnpm-workspace.yaml`, `turbo.json`, all changed workspace package manifests, and `pnpm-lock.yaml`.
- Source dependencies: imports, package boundaries, shared contracts, TypeScript types, generated or fixture data, and tests that depend on the changed code.
- Runtime dependencies: `apps/api`, `apps/bot`, `apps/miniapp`, `apps/worker`, `apps/host-daemon`, protocol packages, runtime adapters, session engine, approval, policy, hooks, and bootstrap CLI.
- Infrastructure dependencies: Docker Compose files, Caddy/reverse proxy config, Postgres expectations, local filesystem state, and Windows/WSL path boundaries when relevant.
- External services: Telegram Bot/Mini App surfaces, GitHub/CI only when touched, and LM Studio as the local OpenAI-compatible runtime when LLM behavior is relevant.
- Security dependencies: dependency advisories, secret boundaries, token redaction, public artifact safety, and logs/evidence that must not include credentials.

Do not add Ollama configuration and do not use Ollama as fallback unless the user explicitly requests it.

## Non-Negotiable Invariants

- Telegram is not the internal transport for agent events.
- Mutating host operations must remain serialized.
- Policy evaluation must precede approval evaluation.
- Higher-level policy cannot be weakened by lower-level overrides.
- Heavy runtime initialization must remain lazy and cache-aware.
- Hooks are platform primitives, not app-specific glue.
- The control plane and durable state remain the source of truth.
- Unsupported, timed-out, or partially available dependencies must not look successful.
- Do not store or publish secrets, bot tokens, API keys, private endpoints, raw credentials, or unbounded private logs.

## Iteration Rule After Every Fix

Every production-code, package, lockfile, infra, config, or test change starts a new verification iteration.

For each fix:

1. Record the issue, hypothesis, affected files, and dependency surface in `evidence.md`.
2. Make the minimum patch needed for that single issue.
3. Immediately run the smallest relevant targeted validation and save output as `raw/fix-<N>-targeted.txt`.
4. If TypeScript contracts changed, run the affected package `typecheck` or root `pnpm typecheck` before moving on.
5. If tests changed or behavior changed, run the affected package test before moving on.
6. If `package.json` or `pnpm-lock.yaml` changed, run install/lockfile validation before moving on.
7. If any validation fails, stop stacking changes. Fix the failure or record it as a blocker in `problems.md`.
8. Mark any previous verifier result stale after a mutation. A PASS before the latest mutation is not completion evidence.

The project is not complete because "most checks passed." It is complete only when the latest post-change verification is green or remaining failures are exact, reproducible, and explicitly accepted as blockers/deferred risks.

## Baseline Dependency Inventory

Capture baseline before fixes:

```bash
pnpm --version
pnpm install --frozen-lockfile
pnpm list -r --depth 1
pnpm audit --audit-level moderate
pnpm outdated -r
```

Notes:

- If `pnpm outdated -r` cannot run because network access is unavailable, record the exact reason and continue with local evidence.
- Treat audit failures as real findings. Do not blindly upgrade major versions; inspect affected paths with `pnpm why <package>` and choose the smallest compatible fix.
- If a dependency update is required, explain why the chosen range is safe for HappyTG and prove it with targeted tests plus the full matrix.

## Full Validation Matrix

Run targeted checks after each fix, then run the full matrix before completion:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm happytg doctor
pnpm happytg verify
pnpm happytg task validate --repo . --task <TASK_ID>
```

Add targeted package commands when files changed under a workspace, for example:

```bash
pnpm --filter @happytg/miniapp test
pnpm --filter @happytg/api test
pnpm --filter @happytg/bootstrap test
pnpm --filter @happytg/runtime-adapters test
```

Add surface-specific validation when relevant:

```bash
docker compose -f infra/docker-compose.example.yml config --quiet
pnpm release:check --version <VERSION>
git diff --check
```

Use browser automation for meaningful Mini App UI changes. Use Bot message/render tests for Telegram Bot behavior. Use Docker checks for infra changes. Use release checks only when release metadata changes.

## Dependency Review Roles

Before choosing fixes, produce one concise assessment from each role. Each role must state blockers, risks, evidence required, and go/no-go.

1. Proof-Loop Lead: checks frozen spec, phase order, raw evidence, stale verifier handling, and task bundle closure.
2. Dependency Graph Reviewer: checks workspace package relationships, package manifests, lockfile, transitive risks, and duplicate or incompatible versions.
3. QA/Test Engineer: checks targeted tests after every fix and final full matrix coverage.
4. TypeScript/Build Reviewer: checks type boundaries, build graph, Turbo task behavior, and generated artifacts.
5. Runtime Integration Reviewer: checks API, Bot, Mini App, Worker, Host Daemon, runtime adapters, and session/control-plane contracts.
6. Security/Secrets Reviewer: checks dependency advisories, evidence/log redaction, token boundaries, and public artifact safety.
7. Architecture Invariants Reviewer: checks transport, serialized mutations, policy/approval order, lazy initialization, hooks, and source-of-truth boundaries.
8. Self-Hosting/Infra Reviewer: checks Docker Compose, Postgres, Caddy/reverse proxy, Windows/WSL path behavior, and local operator setup.
9. Local LLM Reviewer: checks LM Studio assumptions only where LLM behavior is relevant and rejects Ollama fallback unless explicitly requested.
10. Git/CI Hygiene Reviewer: checks dirty worktree safety, branch state, CI parity, and that no unrelated changes were included.

Synthesize findings into:

```text
Finding | Dependency surface | Supporting roles | Severity | Decision | Evidence
```

Only fix findings that are blockers or tightly scoped. Record broad refactors as follow-up unless the frozen spec requires them.

## Fresh Verifier

After the final implementation pass, run a fresh verifier role that does not edit production code. The verifier inspects:

- frozen `spec.md`,
- dependency inventory,
- all role findings and synthesis,
- changed files and dependency surfaces,
- raw outputs for every post-fix targeted check,
- raw outputs for the full validation matrix,
- `evidence.md`, `evidence.json`, `problems.md`, `verdict.json`, and `state.json`.

The verifier verdict must be `PASS` or `FAIL`, with blocking findings first. A verifier may not mark `PASS` if:

- any latest required command failed,
- a command was skipped without a concrete reason,
- a fix lacks post-fix targeted validation,
- `evidence.json`, `verdict.json`, or `state.json` contradicts the actual result,
- proof bundle validation reports missing canonical files.

## Completion Report

Keep the final response short:

- task id and proof bundle path,
- dependency surfaces checked,
- fixes made,
- targeted checks run after each fix,
- full matrix result,
- exact blockers or skipped checks,
- whether EchoVault memory was saved.
