# HappyTG Mini App Speed Optimization Prompt

Use this prompt when the Telegram Mini App feels slow, stalls on Codex Desktop data, renders too much before the operator can act, or needs a focused performance pass. The goal is to make the Mini App noticeably faster for day-to-day project work without weakening HappyTG architecture, auth, policy, approval, or serialized mutation guarantees.

## Prompt

You are working in the HappyTG repository.

Primary objective: measure, diagnose, and optimize Telegram Mini App speed across initial load, navigation, data fetching, Codex Desktop projections, and action feedback. Do not make performance claims without timings. Do not stop at an audit if a small, well-proven fix is available.

## Mandatory Start

Follow `AGENTS.md` first:

```bash
memory context --project
memory search "HappyTG Mini App speed performance Codex Desktop loading fallback"
memory details <relevant-memory-id>
```

Inspect repo and branch state before edits:

```bash
git status --short --branch
git fetch --all --prune --tags
git log --oneline -5
```

Work on a separate `codex/...` branch or isolated worktree. If the current worktree is dirty, do not overwrite, stash, reset, or clean it silently.

## Proof Bundle

Create and maintain:

```text
.agent/tasks/<TASK_ID>/
  spec.md
  evidence.md
  evidence.json
  verdict.json
  problems.md
  raw/
    baseline-route-timings.txt
    baseline-api-timings.txt
    baseline-payload-sizes.txt
    test-miniapp.txt
    test-runtime-adapters.txt
    lint.txt
    typecheck.txt
    build.txt
    browser-smoke.txt
```

Suggested task id:

```text
HTG-YYYY-MM-DD-miniapp-speed-optimization
```

Freeze `spec.md` before production-code edits. Include target routes, non-goals, baseline numbers, chosen budgets, acceptance criteria, and residual risks.

## Non-Negotiable Invariants

- Telegram is not the internal transport for agent events.
- Mini App is a render and inspection layer, not the source of truth.
- Mutating host operations must remain serialized.
- Policy evaluation must happen before approval evaluation.
- Higher-level policy cannot be weakened by lower-level overrides.
- Heavy runtime initialization must stay lazy and cache-aware.
- Codex Desktop / CLI source discrimination must stay explicit.
- Unsupported or timed-out actions must never look successful.
- Auth, Mini App session, public reverse-proxy, and Telegram `initData` behavior must remain intact.
- Do not expose secrets, tokens, raw private paths beyond existing safe projections, or unbounded logs.
- LM Studio is the local OpenAI-compatible runtime if local LLM behavior becomes relevant. Do not add Ollama configuration or use Ollama fallback.

## Required Context

Read only the relevant parts first, then narrow to source:

```bash
Get-Content docs/architecture/miniapp-rich-ux.md
Get-Content docs/telegram-ux.md
Get-Content docs/configuration.md
Get-Content apps/miniapp/src/index.ts
Get-Content apps/miniapp/src/index.test.ts
Get-Content packages/runtime-adapters/src/codex-desktop.ts
Get-Content packages/runtime-adapters/src/index.test.ts
```

Use Graphify only when route/API/adapter relationships are unclear:

```bash
graphify query "HappyTG Mini App route data fetching Codex Desktop performance dependencies" --budget 1200
```

Do not run heavy semantic Graphify extraction automatically.

## 10 Independent Performance Roles

Before choosing an optimization, produce one concise assessment from each role. Keep the opinions independent: each role must state blockers, risks, evidence required, and go/no-go. Do not merge them into generic agreement.

1. Mini App Operator
   - Optimizes for fast daily triage, first actionable screen, and low wait time before the operator can decide.
2. Mobile WebView Performance Engineer
   - Optimizes for Telegram WebView startup, payload weight, CSS/JS cost, mobile viewport rendering, and interaction latency.
3. Backend/API Latency Engineer
   - Optimizes Mini App projection endpoints, API fan-out, timeout budgets, payload shape, and bounded partial responses.
4. Codex Desktop Adapter Engineer
   - Optimizes Desktop control capability checks, project/session reads, fallback behavior, deduplication, and source discrimination.
5. Control-Plane Safety Reviewer
   - Protects policy-before-approval, serialized mutations, unsupported-action honesty, auditability, and source-of-truth boundaries.
6. Security/Privacy Reviewer
   - Checks auth/session behavior, Telegram `initData`, public proxy safety, secret redaction, private path exposure, and log bounds.
7. Data/Cache Correctness Reviewer
   - Checks freshness windows, cache invalidation, stale/partial labels, mutation boundaries, and user-visible consistency.
8. QA/Test Engineer
   - Requires slow-upstream tests, failure-state tests, route/API timing evidence, browser smoke, and task proof validation.
9. Release/Operations Engineer
   - Checks versioning, changelog, release notes, CI, rollback clarity, local Docker/self-hosted impact, and branch hygiene.
10. Graphify/Architecture Navigator
    - Uses Graphify only for unclear route/API/adapter relationships, checks graph freshness, and keeps source reads authoritative.

After the role assessments, synthesize them into:

```text
Finding | Supporting roles | Severity | Decision | Evidence
```

Only implement changes that have measured user impact, bounded scope, and test coverage. If roles disagree, prefer the safer path that preserves architecture invariants and records residual risk.

## Performance Questions To Answer

Before implementation, answer with evidence:

- Which Mini App route is slowest for a normal operator workflow?
- Is the delay in Mini App server render, API projection, Codex Desktop adapter, network/reverse proxy, or client-side action JS?
- Are independent API reads serialized where they could safely run in parallel?
- Does any route wait for Codex Desktop control when a stale, partial, or file-backed projection could render first?
- Do failure and timeout states return bounded UI, or does the operator wait on a blank/loading page?
- Are large session histories, project lists, task bundles, diffs, or reports read eagerly when summaries would be enough?
- Are repeated capability checks, Desktop project scans, or session detail reads deduplicated or cached with explicit freshness limits?
- Are response payloads and inline CSS/JS growing enough to affect Telegram WebView startup?
- Does public `/miniapp` through the reverse proxy behave differently from direct local development?

## Measurement Baseline

Capture baseline before edits. Prefer repeatable local commands over subjective observation.

Suggested local route timing loop:

```powershell
$routes = @("/", "/sessions", "/codex?source=codex-desktop", "/projects", "/new-task", "/approvals", "/hosts", "/reports")
foreach ($route in $routes) {
  1..5 | ForEach-Object {
    Measure-Command { Invoke-WebRequest -UseBasicParsing "http://127.0.0.1:3001$route" | Out-Null } |
      Select-Object @{Name="route";Expression={$route}}, TotalMilliseconds
  }
}
```

Suggested API timing loop, adjusted to the actual configured API port:

```powershell
$paths = @(
  "/api/v1/miniapp/dashboard?userId=usr_1",
  "/api/v1/miniapp/sessions?userId=usr_1",
  "/api/v1/miniapp/projects?userId=usr_1",
  "/api/v1/miniapp/approvals?userId=usr_1",
  "/api/v1/miniapp/hosts?userId=usr_1"
)
foreach ($path in $paths) {
  1..5 | ForEach-Object {
    Measure-Command { Invoke-WebRequest -UseBasicParsing "http://127.0.0.1:4000$path" | Out-Null } |
      Select-Object @{Name="path";Expression={$path}}, TotalMilliseconds
  }
}
```

If auth/session is required for a route, use the existing test harness or a local fixture instead of weakening auth.

Record:

- cold and warm route timings,
- response byte sizes,
- Mini App server logs for slow routes,
- API timings for matching projections,
- Codex Desktop adapter timings when Desktop data is involved,
- browser smoke observations for Telegram-like mobile viewport.

## Optimization Targets

Choose targets only after baseline. Good candidates usually include:

- render a useful shell or partial result before slow optional Desktop data,
- keep dashboard and navigation routes independent from heavy Desktop session detail reads,
- run independent read-only API calls with `Promise.all` while preserving bounded error handling,
- add or tighten timeout budgets for optional projections,
- cache or deduplicate Desktop capability/project/session reads with explicit TTL and invalidation,
- limit eager history, diff, report, project, and session reads to summary data on list screens,
- move expensive detail reads behind explicit drill-down routes,
- reduce repeated inline payload, duplicate markup, or oversized response fragments,
- add route-level timing logs that do not expose secrets,
- improve tests so slow upstreams prove bounded UI instead of hangs.

Avoid:

- broad framework rewrites,
- replacing the current Mini App architecture without a staged ADR,
- fake loading success for unsupported actions,
- hiding timeout or partial-data warnings,
- unbounded background retries,
- caching mutating permissions without a freshness model,
- changing public Mini App URL, CORS, session cookie, or Telegram auth contracts unless the spec explicitly requires it.

## Required Audit Surfaces

Cover at least the routes touched by the candidate fix:

- home/dashboard,
- sessions list,
- session detail,
- Codex Desktop / CLI panel,
- Codex Desktop session detail,
- projects,
- new task flow,
- approvals,
- hosts,
- reports,
- diff and verify views,
- auth pending, expired session, denied access, empty state, timeout state, and API unavailable state.

## Implementation Rules

1. Keep scope small.
   - Prefer improving existing fetch/render helpers, route handlers, and adapter calls.
   - Do not introduce a new frontend framework or state library for a speed pass.
   - Keep UI copy short and truthful.

2. Preserve source-of-truth boundaries.
   - Backend/control-plane state remains authoritative.
   - Mini App may display partial or cached read-only projections only when freshness and unsupported-action states are explicit.

3. Make speed observable.
   - Add tests or logs that prove the optimized path is bounded.
   - Do not rely on manual stopwatch claims alone.

4. Test slow and failing dependencies.
   - Simulate slow API projection responses.
   - Simulate slow or unavailable Codex Desktop control.
   - Prove available CLI/file-backed data can still render when optional Desktop data is late.

5. Keep release separate unless explicitly requested.
   - A speed fix can be merged without a release if the user did not ask to publish.
   - If releasing, follow `docs/release-process.md`.

## Verification Commands

Run the smallest targeted tests first, then broaden as risk increases:

```bash
pnpm --filter @happytg/miniapp test
pnpm --filter @happytg/runtime-adapters test
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm happytg doctor
pnpm happytg verify
pnpm happytg task validate --repo . --task <TASK_ID>
```

For meaningful UI/layout changes, start the local dev server and use browser automation with a mobile viewport. Capture screenshots or a concise browser-smoke log under `.agent/tasks/<TASK_ID>/raw/`.

If any command cannot run, record the exact reason in `problems.md` and the final response.

## Fresh Verifier

After implementation, run a fresh verifier pass that does not edit production code. The verifier must inspect:

- frozen `spec.md`,
- 10-role findings and synthesis,
- baseline and after timings,
- changed route/API/adapter behavior,
- raw command outputs,
- screenshot or browser-smoke evidence when UI changed,
- tests for slow/failing dependencies,
- architecture invariants,
- `evidence.md`, `evidence.json`, `problems.md`, and `verdict.json`.

The verifier verdict must be `PASS` or `FAIL`, with blocking findings first.

## Completion Report

Keep the final report short:

- branch and task id,
- slowest baseline finding,
- implemented speed changes,
- before/after timing summary,
- tests and checks that passed,
- exact blockers or skipped checks,
- proof bundle path,
- whether EchoVault memory was saved.
