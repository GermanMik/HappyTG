# HappyTG Full Verification 10-Role Release Prompt

Use this prompt when a HappyTG branch needs a critical, proof-backed full verification pass and, when justified, a release. The goal is to avoid shallow "looks fine" review: treat the branch as potentially wrong until repo evidence, independent role critique, validation, PR/merge state, and release metadata agree.

## Prompt

You are working in the HappyTG repository.

Primary objective: perform a full-project verification of the current branch, finish only the minimum necessary work, and release only if the verified branch contains changes that are not already in `main` and are worth shipping.

## Mandatory Start

Follow `AGENTS.md` before doing any work:

```bash
memory context --project
memory search "HappyTG full verification release branch evidence"
memory details <relevant-memory-id>
```

Inspect the repository and branch state before edits:

```bash
git status --short --branch
git fetch --all --prune --tags
git log --oneline origin/main..HEAD
git diff --stat origin/main...HEAD
```

If the worktree is dirty, do not overwrite, stash, reset, or clean it silently. Either work from a separate `git worktree` or create a new isolated branch only when the current state is clean enough to do so safely.

## Proof Bundle

For non-trivial work, create and maintain:

```text
.agent/tasks/<TASK_ID>/
  spec.md
  evidence.md
  evidence.json
  verdict.json
  problems.md
  raw/
```

Freeze `spec.md` before implementation or release metadata edits. Raw command output belongs in `raw/`.

## Non-Negotiable Invariants

- Telegram is not the internal transport for agent events.
- Mutating host operations must remain serialized.
- Policy evaluation must precede approval evaluation.
- Higher-level policy cannot be weakened by lower-level overrides.
- Heavy runtime initialization must remain lazy and cache-aware.
- Hooks are platform primitives, not app-specific glue.
- LM Studio is the local OpenAI-compatible runtime when local LLM behavior is relevant.
- Do not add Ollama configuration or use Ollama as fallback unless explicitly requested.
- Do not store or publish secrets, bot tokens, API keys, private endpoints, or raw credentials.

## 10 Independent Roles

Produce one concise assessment from each role before deciding. Each role must state blockers, risks, evidence required, and go/no-go:

1. Release Manager: verifies versioning, changelog, release notes, tags, GitHub Release, and rollback clarity.
2. QA/Test Engineer: verifies build, lint, typecheck, tests, doctor, verify, and task validation coverage.
3. Security/Secrets Reviewer: checks logs, evidence, generated artifacts, `.env` boundaries, tokens, and public release safety.
4. Architecture Invariants Reviewer: checks transport, policy/approval order, mutation serialization, lazy init, and hooks boundaries.
5. Docker/Self-hosting Reviewer: checks compose, Dockerfiles, image tags, local networking, and reproducible self-hosting behavior.
6. Graphify/Knowledge Reviewer: checks `graphify-out/`, graph freshness notes, local LM Studio assumptions, and navigation value.
7. Docs/Prompt Reviewer: checks whether prompt docs are actionable, bounded, and aligned with project rules.
8. Monorepo Metadata Reviewer: checks all workspace package versions, `pnpm@10.0.0`, lockfile expectations, and release validation.
9. Git/Branch Hygiene Reviewer: checks branch ancestry, PR necessity, dirty-worktree safety, and local/remote cleanup.
10. Operator Impact Reviewer: checks whether the shipped changes materially help a self-hosted operator.

Synthesize the roles into:

```text
Finding | Supporting roles | Severity | Decision | Evidence
```

Do not implement broad refactors just because a role can imagine them. Fix only release-blocking or clearly scoped issues.

## Verification Commands

Run the smallest relevant command first, then broaden for release:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm happytg doctor
pnpm happytg verify
pnpm happytg task validate --repo . --task <TASK_ID>
```

For releases:

```bash
pnpm release:check --version <VERSION>
```

If Docker or Graphify changed, add targeted evidence such as:

```bash
docker compose -f infra/docker-compose.example.yml config --quiet
graphify update .
```

Do not run heavy semantic Graphify extraction unless architecture/dependency work requires it and the local LM Studio path is verified.

## Fresh Verifier

After implementation and validation, run a fresh verifier pass that does not edit production code. The verifier inspects:

- frozen spec,
- 10-role findings and synthesis,
- branch diff,
- raw command outputs,
- release metadata,
- `evidence.md`, `evidence.json`, `problems.md`, and `verdict.json`.

The verifier verdict must be PASS/FAIL, with blocking findings first.

## Branch, PR, Merge, Release

At completion:

1. If the branch is needed, finish it, verify it, push it, open a PR, wait for CI, merge it, and delete obsolete local/remote branches when safe.
2. If the branch is already in `main` or not needed, delete the local/remote branch without touching unrelated dirty worktree changes.
3. If releasing, bump from the latest published version only when necessary, update all workspace `package.json` files, update `CHANGELOG.md`, add `docs/releases/<VERSION>.md`, and run `pnpm release:check --version <VERSION>`.
4. Publish the GitHub Release only after the release commit is on `main`.
5. Save EchoVault memory before the final response.

## Final Response

Keep the final report short:

- branch and PR/merge state,
- release tag/URL,
- checks that passed or exact blockers,
- proof bundle path,
- branch cleanup state,
- memory state.
