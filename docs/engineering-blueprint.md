# HappyTG Engineering Blueprint

This document is the GitHub-ready engineering blueprint for `HappyTG`: a Telegram-first, Codex-first, self-hosted system for remotely controlling AI coding agents on a home machine or server.

It is written as a production-oriented repo bootstrap document, not as an abstract concept note. It assumes the repository should be immediately usable for:

1. creating the GitHub repository,
2. opening it in Codex or Cursor,
3. laying out the monorepo,
4. filling documentation and templates,
5. starting implementation by module.

## Current Implementation Baseline

The current repository is a TypeScript-first monorepo. Do not treat this document as permission to create a parallel Go implementation or a second CLI. The canonical repo-local proof path is `.agent/tasks/<TASK_ID>/`, with `task.json` kept for compatibility and `state.json` used as the newer phase cursor.

Canonical Wave 1 states are:

- Session: `created`, `preparing`, `ready`, `running`, `blocked`, `needs_approval`, `verifying`, `paused`, `resuming`, `completed`, `failed`, `cancelled`.
- Task phase: `quick`, `freeze`, `build`, `evidence`, `verify`, `fix`, `complete`.
- Approval: `not_required`, `pending`, `waiting_human`, `auto_allowed`, `auto_denied`, `approved_once`, `approved_session`, `approved_phase`, `denied`, `expired`, `superseded`.
- Verification: `not_started`, `queued`, `running`, `passed`, `failed`, `inconclusive`, `stale`.

Older blueprint terms such as `prefetching`, `awaiting_approval`, `pending_dispatch`, `reconnecting`, and `spec_frozen` map to `preparing`, `needs_approval`, `ready`, `resuming`, and `freeze`.

## Team View

HappyTG is designed as if the following roles reviewed every major decision:

1. Product Manager for AI developer tools
2. Solution Architect / Tech Lead
3. Backend Architect
4. Telegram Platform Engineer
5. Local Agent / CLI Engineer
6. Security Engineer
7. DevOps / Infrastructure Engineer
8. UX Conversation Designer
9. AI Agent / Runtime / MCP Engineer
10. QA / Reliability Engineer

Every major section below explicitly considers:

- product intent,
- technical architecture,
- operational concerns,
- security implications,
- reliability and testability,
- UX implications.

---

## 1. Project Overview

### What HappyTG Is

HappyTG is a Telegram-first remote control plane for AI coding workflows that execute on a user-controlled host. The primary runtime is Codex CLI. Telegram provides a low-friction command and approval surface. A Telegram Mini App provides rich inspection. A local daemon performs execution. The control plane stores durable session, approval, and event state.

### Problem It Solves

Current coding-agent setups tend to be:

- CLI-only and hard to operate from mobile,
- web-first and detached from the developer’s actual local environment,
- chat-centric and weak on durable proof,
- fragile under disconnects,
- unclear on approvals and policy boundaries.

HappyTG addresses that by separating remote control from local execution and separating render surfaces from execution truth.

### Why Telegram-First + Codex-First Works

- Telegram is always available, low-latency, and effective for command intake, approvals, and short summaries.
- Codex CLI is effective at local repository work and integrates naturally with repo-local guidance and proof artifacts.
- The combination lets the developer control work from anywhere without giving up local repo state, shell tools, or deterministic verification.

### Why Render-Layer Architecture Beats Bot-as-Backend

Bot-as-backend creates state fragmentation, hidden business logic, and fragile recovery. HappyTG avoids that:

- Telegram Bot, Mini App, CLI, and future admin UI are thin render layers.
- The source of truth is the control plane event store, materialized state, and repo-local task bundles.
- This supports resumability, auditing, multi-surface consistency, and future surface expansion.

### Who It Is For

- solo developers who want remote control over home workstation coding sessions,
- self-hosters who want their own agent control plane,
- small engineering teams that need controlled multi-host workflows later,
- open-source contributors who want repo-local proof and reproducible verification.

### Why It Differs From Mobile/Web-First and CLI-Only Systems

| Model | Limitation | HappyTG Position |
| --- | --- | --- |
| Mobile/web-first | often centralizes execution away from the real dev host | remote control, local execution |
| CLI-only | weak remote approvals and mobile visibility | Telegram-first command and approval loop |
| Chat-only | proof and history remain trapped in chat | proof lives in repo and control plane |
| Bot-centric | business logic drifts into handlers | explicit event-driven core and state machine |

### Team Lens

- Product: reduce friction between “I want this done now” and “I trust the result”.
- Architecture: make execution core reusable across Telegram, Mini App, CLI, and future web admin.
- Operations: support home workstation and server deployment equally well.
- Security: assume Telegram, host, repo, and control plane can fail independently.
- Reliability: every important unit of work must be resumable and auditable.
- UX: keep Telegram concise and action-oriented; move depth into Mini App and repo artifacts.

---

## 2. Product Principles

1. **Codex-first runtime**. Primary runtime is Codex CLI; all core workflows optimize for it first.
2. **Telegram-first, not Telegram-only**. Telegram is the primary command and approval interface, but not the execution backbone or sole source of truth.
3. **Local execution, remote control**. Execution stays on the user-controlled host; coordination stays in the control plane.
4. **Proof in repo, not only in chat**. Non-trivial work produces repo-local task bundles with spec, evidence, and verdict.
5. **Event-driven core**. Significant state changes flow through typed events and explicit projections.
6. **Resumability first**. Sessions, tasks, approvals, verification, and host connectivity must survive interruptions.
7. **Security by default**. Layered policies, short-lived tokens, approval gates, strict queues, and auditable logs are first-class.
8. **Verify independently from build**. Builder and verifier are separate roles and phases.
9. **Bounded subagents**. Orchestration is shallow, role-scoped, and non-recursive.
10. **Hooks as a platform primitive**. Lifecycle hooks are part of the core execution model, not added later.
11. **Split prompt and context management**. Static prefix, dynamic turn context, session memory, task memory, and repo memory are separate subsystems.
12. **GitHub-ready documentation**. Repository structure, config, docs, and task conventions are first-class project outputs.

---

## 3. Functional Scope

Delivery is not split into MVP/V2/Later. Capabilities are grouped by domain and ordered by recommended delivery sequence.

### User Interaction

| Capability | Description | User Value | Complexity | Dependencies | Risks | Delivery Order |
| --- | --- | --- | --- | --- | --- | --- |
| Telegram command intake | `/start`, `/pair`, `/hosts`, `/session`, `/task`, `/approve`, `/status`, `/resume` | immediate mobile control | Medium | bot, API, auth | handler bloat if logic leaks into bot | 1 |
| Inline action callbacks | buttons for approve/reject/open Mini App/reconnect/retry | low-friction task control | Medium | bot, approval engine | stale callback state | 2 |
| Mini App inspection | diff, logs, bundles, verification, hosts | deep visibility without chat spam | High | miniapp, API, artifact store | data volume and auth coupling | 7 |
| Notification routing | concise summaries, heartbeat updates, final reports | awareness without active polling | Medium | worker, bot, projections | noisy UX | 5 |

### Session Management

| Capability | Description | User Value | Complexity | Dependencies | Risks | Delivery Order |
| --- | --- | --- | --- | --- | --- | --- |
| Session creation | choose host, workspace, runtime, mode | controlled starts | Medium | API, daemon, runtime adapter | wrong defaults | 3 |
| Session resume | recover after disconnect/restart | trust under instability | High | event log, daemon state, API | duplicate execution | 4 |
| Session projection | current state, phase, summary, last error | clear observability | Medium | event store, worker | stale projections | 3 |
| Fast-path status | health/pairing/check/version without heavy init | snappy UX | Medium | daemon, caches | hidden slow paths | 2 |

### Proof-loop Tasks

| Capability | Description | User Value | Complexity | Dependencies | Risks | Delivery Order |
| --- | --- | --- | --- | --- | --- | --- |
| Task init | create bundle, freeze metadata, select mode | clear start point | Medium | repo-proof, daemon | partial bundles | 4 |
| Spec freeze | acceptance criteria and verification plan before build | scope control | Medium | repo-proof, agent templates | premature coding | 5 |
| Evidence capture | map criteria to raw artifacts and summaries | auditability | High | runtime, repo-proof | incomplete proof | 6 |
| Independent verify/fix cycle | fresh verifier, minimal fixer, fresh verify | reliable completion | High | runtime, approval engine | role contamination | 6 |

### Host Management

| Capability | Description | User Value | Complexity | Dependencies | Risks | Delivery Order |
| --- | --- | --- | --- | --- | --- | --- |
| Host registration | bootstrap and register a machine | easy onboarding | Medium | daemon, API, auth | orphaned hosts | 1 |
| Pairing with Telegram identity | bind host to user | controlled access | High | bot, API, short-lived tokens | pairing interception | 2 |
| Multi-host inventory | see status and capabilities across hosts | choose execution target | Medium | projections, bot, miniapp | stale liveness | 5 |
| Workspace registry | attach repos/workspaces to host | repeatable targeting | Medium | daemon, API | repo trust mismatch | 4 |

### Approvals & Policies

| Capability | Description | User Value | Complexity | Dependencies | Risks | Delivery Order |
| --- | --- | --- | --- | --- | --- | --- |
| Layered policy evaluation | global to command override | safe defaults | High | policy engine | accidental weakening | 4 |
| Approval requests | risky actions require explicit decision | human control | High | approval engine, bot | deadlocked pending actions | 5 |
| Serialized mutation queue | all risky writes funnel through one queue per execution scope | prevent race conditions | High | daemon, worker | throughput bottlenecks if misdesigned | 4 |
| Approval resume | pending approvals survive disconnect | continuity | Medium | event store, projections | expiry confusion | 6 |

### Runtime Adapters

| Capability | Description | User Value | Complexity | Dependencies | Risks | Delivery Order |
| --- | --- | --- | --- | --- | --- | --- |
| Codex CLI adapter | primary builder/verifier runtime | best workflow fit | High | daemon, runtime-adapters | CLI lifecycle edge cases | 3 |
| Secondary runtime compatibility layer | optional adapters without changing core model | future expansion | Medium | protocol, runtime-adapters | generic-abstraction trap | 8 |
| Runtime prefetch and memoization | lazy heavy init, parallel read prep | lower latency | High | daemon, context engine | stale cache | 5 |

### Bootstrap/Doctor

| Capability | Description | User Value | Complexity | Dependencies | Risks | Delivery Order |
| --- | --- | --- | --- | --- | --- | --- |
| Doctor detection pass | inspect machine readiness | safe onboarding | High | bootstrap package, manifests | false negatives | 1 |
| Setup planner | show plan before install | confidence before change | High | rule engine, manifests | incomplete plans | 2 |
| Repair from previous reports | deterministic repair path | fast recovery | High | state store, reports | repeated loops | 6 |
| Codex smoke verify | prove Codex-ready path | trust in runtime | Medium | codex cli, config | brittle smoke prompt | 3 |
| Uninstall cleanup | remove installer-owned local launcher/state artifacts without deleting the repo checkout by default | safe rollback and host retirement | Medium | bootstrap package, local state layout | over-deleting user data if scope is unclear | 6 |

### Observability & Audit

| Capability | Description | User Value | Complexity | Dependencies | Risks | Delivery Order |
| --- | --- | --- | --- | --- | --- | --- |
| Typed audit log | immutable record of actions and decisions | forensic value | Medium | protocol, API, DB | missing correlation IDs | 4 |
| Metrics and tracing | latency, queue depth, reconnect, approval aging | operability | High | API, worker, daemon | blind spots | 7 |
| Event replay and projection rebuild | restore state after projection drift | resilience | High | event store | replay cost | 7 |

### Security

| Capability | Description | User Value | Complexity | Dependencies | Risks | Delivery Order |
| --- | --- | --- | --- | --- | --- | --- |
| Host authentication | short-lived tokens and signed reconnect | secure control | High | auth, API, daemon | token misuse | 2 |
| Secret references | avoid direct secret propagation | reduced blast radius | Medium | storage, runtime | accidental leaks | 5 |
| Compromise-aware degraded modes | clear behavior under partial compromise | safer operation | High | policy, projections, bot | false confidence | 8 |

### Deployment

| Capability | Description | User Value | Complexity | Dependencies | Risks | Delivery Order |
| --- | --- | --- | --- | --- | --- | --- |
| Single-user self-hosted mode | one person, one stack, one or more hosts | easiest adoption | Medium | infra, docs | packaging gaps | 1 |
| Small-team mode | shared backend, multiple users | later scale path without redesign | High | policies, auth, projections | overbuilding too early | 8 |
| Docker Compose packaging | repeatable deployment | easier evaluation | Medium | infra | false production parity | 6 |

### Recommended First Vertical Slice

Implement the first slice from `happytg doctor` to host pairing to first Codex quick task to first proof-loop task with artifact creation and independent fresh verify. That slice proves the architecture instead of merely describing it.

### Recommended Demo Scope

- Doctor detects missing Codex CLI and config readiness.
- Setup plan is shown without making changes.
- Host is paired from Telegram.
- User starts a Codex quick task from Telegram.
- User starts a proof-loop task that writes `.agent/tasks/HTG-0001/`.
- Builder produces summary and diff.
- Risky command requests Telegram approval.
- Fresh verifier reports pass/fail independently.

---

## 4. Target Architecture

### Component Breakdown

- **Telegram Bot layer**: commands, approvals, concise state and summary rendering.
- **Mini App frontend**: richer inspection surface for diffs, logs, bundles, hosts, and reports.
- **Control Plane API**: auth, pairing, session orchestration endpoints, Mini App API, daemon ingress.
- **Event Bus / Queue**: durable typed event handling and serialized mutation scheduling.
- **Session Engine**: explicit session state machine and orchestration.
- **Approval Engine**: approval creation, expiry, resolution, resume, and evidence.
- **Policy Engine**: multi-layer policy evaluation with monotonic restriction.
- **Context / Memory Engine**: prompt partitioning, memory extraction, compression.
- **Repo Proof Engine**: task bundle creation, validation, artifact mapping, verification verdicts.
- **Host Daemon**: transport, queueing, runtime management, local state, reconnect.
- **Runtime Adapter Layer**: Codex-first adapter and secondary compatibility layer.
- **Storage**: event store, relational projections, artifact/object store, repo-local files.
- **Audit / Observability**: metrics, traces, structured logs, audit records, replay tools.
- **Bootstrap subsystem**: doctor/setup/repair/verify/status/config/snapshot.
- **Optional Admin UI**: operator-only diagnostics and deployment controls.

### Textual Architecture Diagram

```text
Telegram User
   | commands / approvals / notifications
   v
Telegram Bot ---------------------> Mini App
   |                                  |
   | render-only calls                | read-focused rich views
   v                                  v
                  Control Plane API
        +----------------+----------------+
        | Session Engine | Approval Engine|
        | Policy Engine  | Context Engine |
        +----------------+----------------+
                 | typed events / commands
                 v
             Event Bus / Queue
                 |
          +------+------+
          |             |
          v             v
       Worker      Materialized Views
          |
          | daemon protocol
          v
      Host Daemon
    +------+------+------------------+
    | runtime adapter | repo proof   |
    | hooks           | local state  |
    +------+------+------------------+
           |
           v
        Codex CLI
           |
           v
   Repo / Workspace / .agent/tasks
```

### Trust Boundaries

1. **Telegram boundary**: untrusted transport/render layer; trusted only after bot signature and user auth validation.
2. **Control plane boundary**: trusted service boundary for identity, policy, approval, and durable state.
3. **Host boundary**: semi-trusted execution boundary; compromise impacts local repos and host secrets.
4. **Repo boundary**: repository content may be malicious or stale; runtime must treat repo inputs as untrusted data.
5. **Artifact boundary**: large outputs may live in object storage or local repo; integrity and identity must be tracked.

### Control Plane vs Execution Plane

| Plane | Responsibilities | Must Not Do |
| --- | --- | --- |
| Control plane | session truth, approval truth, policy truth, event log, projections, pairing, summaries | perform local repo execution |
| Execution plane | runtime execution, repo-local proof, local verification, local workspace inspection | become the sole source of session truth |

### Render Layers vs Source of Truth

| Surface | Role | Source of Truth? |
| --- | --- | --- |
| Telegram Bot | command and approval rendering | no |
| Mini App | inspection and navigation | no |
| CLI views | local operator diagnostics | no |
| Event store | historical truth | yes |
| Materialized state | current truth for reads | yes |
| Repo-local task bundle | proof truth for task completion | yes |

### End-to-End Flows

#### Flow A: Quick Task

1. User sends `/task quick fix lint on host-1`.
2. Bot creates a session request in control plane.
3. Control plane prefetches session context, host status, workspace state, policies, approvals context, runtime adapter state, tools, and resume metadata in parallel.
4. Session engine validates and transitions session to `ready`.
5. Host daemon receives command, performs fast-path checks, and starts Codex CLI.
6. Read-only inspections execute in parallel; mutating actions queue behind serialized approval-aware lane.
7. Short summaries return to Telegram; details go to Mini App.

#### Flow B: Proof-Loop Task

1. User sends `/task proof implement X in repo Y`.
2. Session engine creates task bundle metadata and `task.init` event.
3. Spec freezer session writes `spec.md`.
4. Build phase starts only after the `freeze` phase has a frozen spec.
5. Evidence is collected into bundle artifacts.
6. Fresh verifier session runs independently and writes `verdict.json` and `problems.md`.
7. If needed, fixer performs minimal patch.
8. Fresh verifier re-runs.
9. Completion is emitted only after acceptance criteria are evidenced.

### Team Lens

- Product: ensure the first slice is useful before secondary features.
- Architecture: keep business logic in engines, not UI surfaces.
- Operations: support reconnect, replay, and partial outages.
- Security: isolate boundaries and treat Telegram and repo inputs as untrusted.
- Reliability: event log plus projections plus repo proof allows recovery without chat history.
- UX: Telegram stays terse; Mini App absorbs complexity.

---

## 5. Core Execution Model

### State Machine

HappyTG is an explicit state machine, not a chat loop.

#### Session States

| State | Meaning | Exit Conditions |
| --- | --- | --- |
| `created` | request accepted, not yet validated | validation starts |
| `preparing` | context and runtime data loaded in parallel | prefetch complete or fail |
| `ready` | ready to send to host | daemon ack |
| `running` | command actively executing | pause, error, await approval, completed |
| `blocked` | blocked by policy, host, or missing prerequisite | resolve blocker |
| `needs_approval` | blocked on human approval | approve, deny, expire |
| `paused` | intentionally paused | resume |
| `resuming` | host/control plane resume in progress | recovered or failed |
| `verifying` | independent verification executing | pass/fail |
| `completed` | terminal success | none |
| `failed` | terminal failure | manual retry/new session |
| `cancelled` | terminal cancellation | none |

#### Task Phases

| Phase | Meaning |
| --- | --- |
| `quick` | quick non-proof task path |
| `freeze` | task metadata exists and acceptance criteria / verification plan are locked before build |
| `build` | implementation in progress |
| `evidence` | artifacts gathered and mapped |
| `verify` | fresh verifier run |
| `fix` | minimal repair after findings |
| `complete` | verified and closed |

#### Approval States

| State | Meaning |
| --- | --- |
| `draft` | created but not yet surfaced |
| `pending` | user action required |
| `approved` | allowed to proceed |
| `rejected` | denied |
| `expired` | timed out |
| `superseded` | replaced by a newer request |
| `cancelled` | no longer needed |

#### Verification States

| State | Meaning |
| --- | --- |
| `not_started` | no verifier run yet |
| `running` | verifier active |
| `passed` | all checks satisfied |
| `failed` | one or more findings |
| `blocked` | prerequisites missing |

### Event Stream Model

All meaningful transitions emit typed events. Write path is append-only. Read path comes from materialized projections. Render layers subscribe to projections or filtered event views.

### Resume Model

Resume uses:

- event store for historical intent,
- materialized session state for quick reads,
- host daemon local journal for in-flight command correlation,
- task bundle markers for proof phase recovery,
- idempotency keys for mutating action replay suppression.

### Fast Path vs Heavy Path

Fast-path commands:

- `health`
- `status`
- `pairing check`
- `version`
- `resume check`

These use cached host/runtime metadata and avoid heavy Codex initialization.

Heavy-path commands:

- new build session,
- proof-loop verification,
- repo scans,
- artifact diff generation.

Heavy initialization is lazy and memoized per host/runtime/workspace tuple.

### Parallel Prefetching

On session start the system prefetches in parallel:

- user/session context,
- host status,
- policies,
- runtime adapter state,
- repo/workspace state,
- approvals context,
- available tools,
- reconnect/resume metadata.

Prefetch must be read-only and safe to repeat.

### Concurrency Rules

- Read-only repo inspection may execute as bounded parallel batches.
- Mutating tool calls flow through a strict serialized queue per workspace/session scope.
- Approval evaluation happens before queue admission for risky actions.
- Queue key should include host, workspace, and mutating scope.
- Verification runs do not share builder mutation queue.

### Canonical Execution Pipeline

`validation -> hooks -> policy -> approval -> execution -> evidence -> summarization`

This pipeline applies to any risky or stateful execution unit.

### Context Management

Split prompt architecture:

- static cacheable prefix,
- dynamic turn context,
- session memory,
- task memory,
- repo memory.

Compression strategies in order:

1. micro-compact
2. context collapse
3. session/task memory extraction
4. full compact summary
5. hard truncation as last resort

### Typed Events

```ts
type HappyTGEvent =
  | { type: "SessionCreated"; sessionId: string; mode: "quick" | "proof"; }
  | { type: "PromptBuilt"; sessionId: string; sources: string[]; }
  | { type: "PolicyEvaluated"; sessionId: string; outcome: string; effectiveLayer: string; }
  | { type: "ApprovalRequested"; approvalId: string; sessionId: string; risk: string; scope: string; }
  | { type: "ApprovalResolved"; approvalId: string; decision: "approved_once" | "approved_phase" | "approved_session" | "denied" | "expired"; }
  | { type: "HostReconnected"; hostId: string; capabilities?: string[]; }
  | { type: "HostDisconnected"; hostId: string; reason: string; }
  | { type: "TaskBundleUpdated"; taskId: string; phase: string; verificationState?: string; }
  | { type: "ToolCallStarted"; sessionId: string; runtime: "codex-cli" | "secondary"; }
  | { type: "SummaryGenerated"; sessionId: string; summary: string; }
  | { type: "ArtifactSynced"; taskId: string; artifactPath: string; }
  | { type: "VerificationPassed" | "VerificationFailed" | "VerificationInconclusive"; taskId: string; runId: string; }
  | { type: "SessionCompleted" | "SessionFailed" | "SessionCancelled"; sessionId: string; };
```

### Hooks

Mandatory hook points:

- session start/end
- task init/freeze/build/evidence/verify/fix/complete
- pre/post tool
- approval requested/resolved
- summary emitted
- host connected/disconnected
- reconnect/resume

---

## 6. Repo Proof-Loop Design

### Quick Mode vs Proof-Loop Mode

| Mode | Use Case | Requirements |
| --- | --- | --- |
| Quick | low-risk, short-lived, obvious verification | session summary and minimal evidence |
| Proof-loop | non-trivial, risky, multi-file, security-sensitive, or architectural changes | full task bundle and independent verifier |

### Canonical Task Bundle Path

Canonical source of truth:

```text
.agent/tasks/<TASK_ID>/
```

Required files:

```text
.agent/tasks/<TASK_ID>/spec.md
.agent/tasks/<TASK_ID>/evidence.md
.agent/tasks/<TASK_ID>/evidence.json
.agent/tasks/<TASK_ID>/verdict.json
.agent/tasks/<TASK_ID>/problems.md
.agent/tasks/<TASK_ID>/raw/build.txt
.agent/tasks/<TASK_ID>/raw/test-unit.txt
.agent/tasks/<TASK_ID>/raw/test-integration.txt
.agent/tasks/<TASK_ID>/raw/lint.txt
```

Optional human-friendly mirror:

```text
.agent/tasks/<TASK_ID>/
```

But `.agent/tasks/<TASK_ID>/` is the canonical proof bundle.

### Task Command Behavior

| Command | Behavior |
| --- | --- |
| `happytg task init` | allocate task ID, create bundle, write metadata, emit `task.init` |
| `happytg task status` | read task bundle + control plane status and render phase |
| `happytg task validate` | ensure required files exist, phase progression is valid, artifacts are parseable |
| `happytg task run` | execute proof-loop orchestration for current phase |

### Acceptance-Criteria-Driven Evidence

- `spec.md` freezes acceptance criteria.
- `evidence.md` maps each criterion to raw artifacts or outputs.
- `evidence.json` provides machine-readable linkage.
- `verdict.json` stores verifier outcome and check details.
- `problems.md` stores human-readable findings and next actions.

### Independent Verifier

- Verifier must use a fresh session.
- Verifier must not edit production code.
- Verifier reads spec, code delta, artifacts, and raw outputs.
- If findings exist, fixer receives only the finding set and frozen spec.

### Fixer Cycle

1. Verifier fails.
2. `problems.md` and `verdict.json` are updated.
3. Fixer performs the minimum required patch.
4. Evidence is refreshed.
5. Fresh verifier session reruns.

### Telegram Representation Without Chat Spam

- Telegram shows phase transitions, blocker notices, approvals, and final verdict.
- Long raw outputs are uploaded as files or linked into Mini App.
- Telegram never becomes the only place where proof lives.

### Mini App Rendering

Mini App should render:

- bundle index,
- current phase,
- acceptance criteria to evidence map,
- verifier findings,
- raw artifacts,
- diff view,
- final verdict,
- session and approval timeline.

### Codex Project Guidance Alignment

Proof-loop integrates with:

- `AGENTS.md`
- `.codex/agents/task-spec-freezer.toml`
- `.codex/agents/task-builder.toml`
- `.codex/agents/task-verifier.toml`
- `.codex/agents/task-fixer.toml`

This keeps Codex sessions aligned with repo-local proof semantics.

---

## 7. Codex-First Runtime Design

### Why Codex CLI Is Primary

- best alignment with developer-local repos,
- strong fit for iterative coding and verification loops,
- natural integration with repo guidance and task bundles,
- avoids centralizing code execution in remote opaque infrastructure.

### Integration Model

Host daemon manages Codex CLI as a long-lived runtime primitive:

- preflight check Codex availability,
- resolve workspace and `.codex` guidance,
- start session with frozen mode and context,
- collect structured outputs and summaries,
- checkpoint session metadata,
- hand off to verifier or fixer role sessions as required.

### How Host Daemon Manages Codex Sessions

- one active builder session per mutation scope,
- separate verifier session IDs,
- local journal tracks runtime pid/session mapping,
- output is summarized incrementally,
- raw command outputs are captured into task bundle artifacts,
- reconnect logic reattaches using local journal and control plane session IDs.

### Repo Guidance

HappyTG treats the following as first-class runtime inputs:

- `AGENTS.md`
- `.codex/agents/*`
- reproducible repository commands,
- `.agent/tasks/<TASK_ID>/` bundle state,
- workspace policy files if present.

### Scenarios to Support First

1. quick read-only inspection with summary,
2. quick low-risk code patch with approval gate,
3. proof-loop build with independent verifier,
4. reconnect into an interrupted Codex session,
5. resume verification after control plane restart,
6. multiple workspaces on one host.

### Approvals, Summaries, Diff, and Verification Around Codex

- read-only inspections can execute before approval,
- risky mutations require policy and approval before queue dispatch,
- summaries are emitted incrementally but compactly,
- diffs are rendered in Mini App and optionally as patch files,
- verification results are separate from builder summaries.

### Bounded Subagent Orchestration

HappyTG allows bounded role sessions:

- `task-spec-freezer`
- `task-builder`
- `task-verifier`
- `task-fixer`

Rules:

- tree stays shallow,
- only one integration builder owns production code at a time,
- verifier is always fresh and independent,
- fixer is separate and minimal,
- no uncontrolled recursive spawning,
- allow cache sharing only where it does not taint independence.

### Fresh Verifier Session

Fresh verifier is required:

- after initial build,
- after every fix,
- after suspicious reconnect on verify phase,
- before marking a proof-loop task complete.

### Compatibility Layer for Secondary Runtimes

Secondary runtimes may be added behind a compatibility contract:

- same session state machine,
- same approval API,
- same task phases,
- same evidence and verdict contracts,
- same reconnect semantics.

The system must not regress into a generic runtime abstraction that weakens Codex-first design.

### Team Lens

- Product: optimize the workflow users actually want, not a theoretical adapter marketplace.
- Architecture: keep runtime adapter contracts explicit and narrow.
- Operations: persist just enough runtime state to resume safely.
- Security: treat runtime output as untrusted until policy and proof layers evaluate it.
- Reliability: verifier independence is non-negotiable.
- UX: users interact with runtime state through concise summaries and rich inspection, not raw streams by default.

---

## 8. Bootstrap + Doctor Specification

### Command Surface

- `happytg doctor`
- `happytg setup`
- `happytg repair`
- `happytg verify`
- `happytg status`
- `happytg config init`
- `happytg env snapshot`
- optional: `happytg task init`
- optional: `happytg task validate`
- optional: `happytg task status`

### Design Principles

- detect first, install second,
- ask only when needed,
- rule-based selection,
- idempotent execution,
- verify after installation,
- safe by default,
- human confirmation before impactful changes,
- install only from manifest whitelist,
- backup before edit,
- persist reports and state for repair,
- dry-run plan before apply.

### What Doctor Checks

- OS, version, architecture,
- shell and PATH sanity,
- privilege level,
- package manager availability,
- Git presence,
- Node.js / npm / pnpm presence,
- Codex CLI presence,
- IDE presence as optional recommendation,
- Docker presence as optional recommendation,
- `~/.codex/config.toml` existence and sanity,
- project directory readiness,
- host daemon prerequisites,
- pairing prerequisites,
- minimal Codex smoke check.

### Installation Profiles

| Profile | Includes |
| --- | --- |
| `minimal` | Git, Node.js + npm, Codex CLI, base `.codex/config.toml`, Codex readiness verify |
| `recommended` | minimal + pnpm, IDE recommendations, helper scripts, diagnostics, host daemon prerequisites |
| `full` | recommended + Docker/Compose optional path, advanced self-hosted prerequisites, extended verify pass |
| `custom` | rule-driven capability selection from explicit questionnaire |

### Rule-Based Profile Selection

Selection must come from explicit manifests and a deterministic rule engine, not from an LLM choosing packages. Inputs:

- requested profile,
- platform,
- privilege level,
- user mode (`local-dev`, `self-hosted-server`, `repair`),
- available installers,
- policy restrictions,
- degraded mode flags.

### Internal Structure

- `env-detector`
- `questionnaire`
- `profile-selector`
- `rule-engine`
- `planner`
- `installer backends`
- `configurator`
- `verifier`
- `state-store`
- `report-renderer`

### Install Flow

1. Detect environment.
2. Produce structured report.
3. Select profile via rules.
4. Build plan from whitelisted manifests.
5. Show dry-run plan.
6. Confirm impactful changes.
7. Backup target configs.
8. Execute installers deterministically.
9. Verify results.
10. Persist report and state.

### Verify Flow

1. Re-read environment.
2. Compare expected profile state to actual state.
3. Run package/tool version checks.
4. Validate config files.
5. Run Codex smoke check.
6. Render pass/fail findings and suggested repairs.

### State Files

```text
~/.happytg/state/doctor-last.json
~/.happytg/state/setup-last.json
~/.happytg/state/repair-last.json
~/.happytg/state/verify-last.json
~/.happytg/logs/*.log
~/.happytg/backups/*
```

### Manifests

- `profiles/*.yaml`
- `installers/*.yaml`
- `rules/*.yaml`

Manifests define:

- allowed installers,
- package names per OS family,
- verify commands,
- backup targets,
- remediation actions,
- elevation requirements.

### OS-Specific Installers

Backends should be explicit:

- macOS via Homebrew where supported,
- Debian/Ubuntu via `apt`,
- Fedora via `dnf`,
- manual/degraded instructions when automation is unavailable.

### Degraded Mode

Degraded mode activates when:

- auto-install is blocked by policy,
- required package manager is missing,
- elevation unavailable,
- network blocked,
- environment unknown.

Behavior:

- generate report only,
- show exact missing prerequisites,
- produce a manual plan,
- do not attempt arbitrary shell generation.

### Safety Constraints

- never execute arbitrary model-generated shell,
- install only from whitelist manifest,
- show plan before change,
- mark elevation explicitly,
- log all changes,
- backup configs before edits,
- support idempotent reruns.

### Repair Semantics

Repair must reuse prior reports and state:

- load last failed report,
- identify unmet expectations,
- generate deterministic remediation plan,
- avoid reinstalling already healthy components,
- verify again after repair.

### Codex-First Smoke Strategy

Smoke check should confirm:

- `codex` resolves on PATH,
- `~/.codex/config.toml` exists and parses,
- a minimal non-destructive prompt runs,
- output matches expected sentinel,
- return code and timing are recorded.

### Team Lens

- Product: setup should build trust, not surprise users.
- Architecture: bootstrap is deterministic infrastructure logic, not agent improvisation.
- Operations: reports and backups enable supportability.
- Security: installer source and privilege elevation are explicit.
- Reliability: repair is stateful and repeatable.
- UX: ask only when necessary and always show the plan before changes.

---

## 9. Domain Model

| Entity | Fields | Relations | Lifecycle | Persistence | Indexes |
| --- | --- | --- | --- | --- | --- |
| `User` | `id`, `displayName`, `status`, `createdAt` | has many identities, sessions, approvals | created on first authenticated use | relational | `id`, `status` |
| `TelegramIdentity` | `id`, `userId`, `telegramUserId`, `chatId`, `username`, `linkedAt` | belongs to user | linked, active, revoked | relational | unique `telegramUserId`, `userId` |
| `Host` | `id`, `label`, `fingerprint`, `status`, `capabilities`, `lastSeenAt` | belongs to registrations, workspaces, sessions | registered, paired, active, stale, revoked | relational + projection | `status`, `lastSeenAt`, `fingerprint` |
| `HostRegistration` | `id`, `hostId`, `pairingCode`, `expiresAt`, `claimedByUserId` | belongs to host, user | issued, claimed, expired | relational | `pairingCode`, `expiresAt` |
| `Workspace` | `id`, `hostId`, `path`, `repoName`, `defaultBranch`, `policyId` | belongs to host | discovered, active, archived | relational | `hostId`, `repoName` |
| `Session` | `id`, `userId`, `hostId`, `workspaceId`, `mode`, `runtime`, `state`, `currentTaskId` | has many events, approvals | created to terminal | relational + projection | `hostId`, `workspaceId`, `state`, `createdAt` |
| `SessionEvent` | `id`, `sessionId`, `type`, `payload`, `occurredAt`, `sequence` | belongs to session | append-only | event store | unique `(sessionId, sequence)`, `type`, `occurredAt` |
| `TaskBundle` | `id`, `sessionId`, `workspaceId`, `rootPath`, `phase`, `mode` | belongs to session | init to complete | relational + repo-local | `sessionId`, `phase` |
| `ApprovalRequest` | `id`, `sessionId`, `actionType`, `risk`, `state`, `expiresAt` | has decisions | draft to terminal | relational | `sessionId`, `state`, `expiresAt` |
| `ApprovalDecision` | `id`, `approvalRequestId`, `actorUserId`, `decision`, `reason`, `decidedAt` | belongs to request | append-only per decision event | relational | `approvalRequestId`, `decidedAt` |
| `Policy` | `id`, `layer`, `scopeRef`, `rules`, `status`, `version` | attached to deployment/workspace/session | active, superseded, archived | relational + versioned blob | `(layer, scopeRef, version)` |
| `EvidenceArtifact` | `id`, `taskId`, `kind`, `path`, `sha256`, `storageKind`, `createdAt` | belongs to task | created, superseded | relational + object or repo-local | `taskId`, `kind` |
| `VerificationRun` | `id`, `taskId`, `sessionId`, `status`, `startedAt`, `finishedAt` | belongs to task and session | started, passed, failed, blocked | relational | `taskId`, `status`, `startedAt` |
| `RuntimeAdapter` | `id`, `kind`, `version`, `capabilities`, `status` | used by sessions | registered, active, deprecated | config + relational | `kind`, `status` |
| `HookDefinition` | `id`, `point`, `handlerRef`, `enabled`, `policyRef` | referenced by executions | active, disabled | relational/config | `point`, `enabled` |
| `HookExecution` | `id`, `hookId`, `sessionId`, `status`, `startedAt`, `finishedAt`, `outputRef` | belongs to hook and session | append-only outcomes | relational | `hookId`, `sessionId`, `status` |
| `AuditRecord` | `id`, `actorType`, `actorRef`, `action`, `targetRef`, `metadata`, `createdAt` | cross-cuts most entities | append-only | audit store | `action`, `actorRef`, `createdAt` |
| `SecretReference` | `id`, `scope`, `provider`, `keyRef`, `rotatedAt` | linked to runtime or deployment | active, rotated, revoked | secret manager metadata | `scope`, `provider` |
| `BootstrapReport` | `id`, `hostFingerprint`, `command`, `status`, `reportJson`, `createdAt` | belongs to environment snapshots | append-only by run | local state + optional upload | `hostFingerprint`, `command`, `createdAt` |
| `InstallPlan` | `id`, `reportId`, `profile`, `steps`, `requiresElevation`, `status` | derived from bootstrap report | planned, approved, applied, failed | local state + optional upload | `reportId`, `status` |

### Persistence Strategy Notes

- Event history is append-only and durable in the control plane database.
- Materialized projections provide current state for low-latency reads.
- Repo-local task artifacts remain in the repo workspace, not only in central storage.
- Larger logs or binary artifacts may be mirrored to object storage with hashes.

### Lifecycle Notes

- `SessionEvent` and `AuditRecord` never mutate; they are append-only.
- `Policy` is versioned and immutable per version.
- `ApprovalRequest` reaches terminal state and remains queryable indefinitely for audit.
- `TaskBundle` phase progression must be monotonic except explicit reopen semantics.

---

## 10. API & Protocol Design

### Public Backend API

| Endpoint | Purpose |
| --- | --- |
| `POST /api/v1/pairing/start` | create host pairing challenge |
| `POST /api/v1/pairing/claim` | claim pairing from Telegram user |
| `GET /api/v1/hosts` | list accessible hosts |
| `POST /api/v1/sessions` | create session |
| `GET /api/v1/sessions/:id` | get session projection |
| `POST /api/v1/sessions/:id/resume` | request resume |
| `GET /api/v1/tasks/:id` | get task bundle metadata |
| `GET /api/v1/tasks/:id/artifacts` | list artifacts |
| `POST /api/v1/approvals/:id/resolve` | approve/reject |
| `GET /api/v1/miniapp/bootstrap` | bootstrap Mini App auth/session |

### Bot Callback Contracts

Callback payload must be compact, signed, and versioned:

```json
{
  "v": 1,
  "type": "approval.resolve",
  "approvalId": "apr_123",
  "decision": "approved",
  "nonce": "cb_456",
  "issuedAt": "2026-04-05T12:00:00Z"
}
```

Rules:

- callback data must not contain secrets,
- callback actions must be revalidated server-side,
- expired callbacks should render a refresh action.

### Mini App API

| Endpoint | Purpose |
| --- | --- |
| `GET /api/v1/miniapp/session/:id/timeline` | event and phase timeline |
| `GET /api/v1/miniapp/session/:id/summary` | compact state overview |
| `GET /api/v1/miniapp/task/:id/bundle` | task bundle structure |
| `GET /api/v1/miniapp/task/:id/raw/:artifact` | artifact streaming |
| `GET /api/v1/miniapp/hosts` | host inventory and liveness |

### Host-Daemon Protocol

Recommended transport:

- outbound websocket or long-lived HTTP/2 stream initiated by host daemon,
- short-lived access token + refresh token for reconnect,
- bidirectional messages with ack and idempotency keys.

Message types:

- `host.hello`
- `host.resume`
- `host.heartbeat`
- `session.dispatch`
- `session.control`
- `session.event`
- `artifact.sync`
- `approval.blocked`

### Event Contract Example

```json
{
  "messageId": "msg_001",
  "type": "session.dispatch",
  "sessionId": "ses_001",
  "idempotencyKey": "dispatch_ses_001_1",
  "payload": {
    "workspaceId": "ws_001",
    "runtime": "codex-cli",
    "mode": "proof",
    "taskId": "HTG-0001"
  }
}
```

### Bootstrap/Doctor Protocol

Doctor output should be structured JSON plus human-readable rendering.

```json
{
  "command": "doctor",
  "status": "warn",
  "profileRecommendation": "recommended",
  "findings": [
    {
      "code": "CODEX_MISSING",
      "severity": "error",
      "message": "Codex CLI not found on PATH"
    }
  ],
  "planPreview": [
    "Install Node.js 22",
    "Install @openai/codex globally",
    "Initialize ~/.codex/config.toml"
  ]
}
```

### Artifact Sync Contract

Artifacts may stay repo-local or be mirrored centrally.

```json
{
  "type": "artifact.sync",
  "taskId": "HTG-0001",
  "artifacts": [
    {
      "path": ".agent/tasks/HTG-0001/raw/build.txt",
      "sha256": "abc123",
      "sizeBytes": 1201,
      "storageKind": "repo-local"
    }
  ]
}
```

### Reconnect/Resume Contract

```json
{
  "type": "host.resume",
  "hostId": "host_001",
  "resumeToken": "rt_123",
  "inflightSessions": [
    {
      "sessionId": "ses_001",
      "lastAckedSequence": 42,
      "localJournalState": "running"
    }
  ]
}
```

### Idempotency Rules

- every dispatch and mutating action requires an idempotency key,
- daemon must ack processed keys,
- replayed keys must return previous outcome without re-executing mutation,
- read-only operations may omit idempotency but should carry correlation IDs.

### Example Session Create Request

```http
POST /api/v1/sessions
Content-Type: application/json
```

```json
{
  "hostId": "host_001",
  "workspaceId": "ws_001",
  "runtime": "codex-cli",
  "mode": "proof",
  "task": {
    "title": "Implement pairing expiry cleanup",
    "acceptanceCriteria": [
      "Expired pairing codes are rejected",
      "Doctor reports stale pairing state cleanly"
    ]
  }
}
```

### Example Session Create Response

```json
{
  "sessionId": "ses_001",
  "state": "preparing",
  "taskId": "HTG-0001",
  "links": {
    "telegramSummary": "/session/ses_001",
    "miniApp": "/miniapp/session/ses_001"
  }
}
```

---

## 11. Telegram UX

### Bot Commands

- `/start`
- `/help`
- `/pair`
- `/hosts`
- `/workspaces`
- `/session`
- `/task`
- `/approve`
- `/resume`
- `/status`
- `/doctor`
- `/verify`

### Inline Actions

- `Approve`
- `Reject`
- `Open Mini App`
- `Resume Session`
- `Retry Verify`
- `Show Diff`
- `Download Artifact`
- `Reconnect Host`

### Callback Flows

1. User receives approval card.
2. User taps `Approve`.
3. Bot callback hits API.
4. API revalidates token, user, policy, session state, and expiry.
5. Approval event emitted.
6. Serialized queue unblocks or remains blocked.
7. Bot sends compact confirmation.

### Long-Running Progress UX

- send phase changes,
- send heartbeat every meaningful state transition or bounded interval,
- collapse repetitive tool outputs into summary,
- use Mini App or file upload for long logs,
- surface blockers immediately.

### Approval Dialog Rules

- include action, workspace, host, risk level, and expiry,
- show why approval is needed,
- show policy layer that triggered it,
- show impact summary,
- keep decision buttons explicit.

### Diff/Test/Result Delivery Rules

| Content Type | Surface |
| --- | --- |
| one-line status | Telegram text |
| short summary | Telegram text |
| approval | Telegram inline buttons |
| long logs | Mini App or file attachment |
| diff | Mini App first, patch file optional |
| verification report | Mini App summary + Telegram verdict |
| raw artifacts | file or Mini App |

### Log Verbosity Rules

- Telegram: terse, decision-oriented.
- Mini App: structured and drill-down friendly.
- Repo-local: full proof artifacts.
- Control plane logs: structured machine logs with correlation IDs.

### Conversation Map

```text
/start
  -> pair host?
      -> show pairing code flow
      -> pair success
  -> choose action
      -> quick task
      -> proof task
      -> status
      -> resume
quick task
  -> choose host/workspace/runtime
  -> session created
  -> progress updates
  -> approval if needed
  -> summary + diff link
proof task
  -> choose host/workspace/runtime
  -> task init
  -> spec freeze
  -> build
  -> evidence
  -> verify
  -> fix if needed
  -> fresh verify
  -> complete
```

### Mini App Screens

1. Host list
2. Host detail
3. Workspace list
4. Session list
5. Session detail timeline
6. Approval inbox
7. Task bundle viewer
8. Artifact viewer
9. Diff viewer
10. Verification report
11. Doctor report viewer
12. Audit trail

### 20 Example Bot Messages

1. `Host paired: home-macbook is now linked to @user.`
2. `Doctor found 2 required fixes before Codex sessions can start.`
3. `Session HTG-S-001 created on host home-macbook in proof mode.`
4. `Prefetch complete: policy, workspace, runtime, and host status loaded.`
5. `Task HTG-0001 initialized. Spec freeze is required before build.`
6. `Spec frozen. Build phase can start.`
7. `Build is running on host home-macbook.`
8. `Approval required: write access outside workspace root.`
9. `Approval approved. Mutation queue resumed.`
10. `Approval rejected. Session paused safely.`
11. `Evidence updated for 3 acceptance criteria.`
12. `Fresh verification started in an independent session.`
13. `Verification failed with 2 findings. Open Mini App for details.`
14. `Fix cycle started with minimal scope.`
15. `Fresh verification passed.`
16. `Session completed. Summary and diff are ready.`
17. `Host disconnected. Resume is waiting for reconnect.`
18. `Host reconnected. Session resume in progress.`
19. `Doctor verify passed. Codex CLI is ready on this host.`
20. `Mini App link generated for session HTG-S-001.`

### 10 Example Approval Dialogs

1. `Approve file write outside repo root? Risk: high. Expires in 10 min.`
2. `Approve git push to remote origin/main? Risk: critical. Expires in 5 min.`
3. `Approve package install from manifest whitelist? Risk: medium.`
4. `Approve bootstrap config edit to ~/.codex/config.toml? Backup will be created.`
5. `Approve Docker startup for self-hosted services? Risk: medium.`
6. `Approve deletion of generated temp artifacts? Risk: low.`
7. `Approve rerun of failed verification suite? Risk: low.`
8. `Approve workspace registration for /Users/me/project? Risk: medium.`
9. `Approve repair plan with elevated privileges? Risk: high.`
10. `Approve reconnect resume for interrupted mutation session? Risk: medium.`

### 10 Example Error Messages

1. `Pairing failed: code expired. Request a new pairing code.`
2. `Host unavailable: last heartbeat exceeded reconnect threshold.`
3. `Session blocked: policy denied network mutation for this workspace.`
4. `Verification blocked: spec.md is missing from the task bundle.`
5. `Codex smoke check failed: binary not found on PATH.`
6. `Approval expired before action was resumed.`
7. `Diff too large for Telegram. Open Mini App instead.`
8. `Resume failed: local journal and control plane sequence mismatch.`
9. `Artifact upload skipped: repo-local proof remains canonical.`
10. `Repair aborted: required installer is not on the whitelist for this OS.`

### Team Lens

- Product: keep Telegram useful under pressure, not verbose.
- Architecture: render surfaces must be projection-driven.
- Operations: support stale callback refresh, reconnect, and degraded delivery.
- Security: approvals carry enough context to make safe decisions.
- Reliability: message delivery must tolerate retries without double actions.
- UX: Mini App is where inspection depth belongs.

---

## 12. Security Model

### Threat Model

Threat classes:

- compromised Telegram account,
- compromised Telegram bot token,
- compromised host daemon or host OS,
- compromised control plane,
- compromised repo/workspace content,
- replayed protocol messages,
- stolen refresh or pairing tokens,
- malicious runtime output.

### Trust Boundaries

- Telegram channel is untrusted input until verified server-side.
- Host is trusted only for execution within its scope; it is not trusted to define policy truth.
- Repo content is untrusted and may attempt prompt or tool injection.
- Control plane is trusted for identity and state but still must be auditable and least-privilege.

### Replay Protection

- all mutating messages carry idempotency keys,
- approvals carry nonces and expiry,
- host reconnect includes last acked sequence,
- callback payloads are signed and validated server-side,
- stale sequences are rejected or require manual reconcile.

### Host Authentication

- host registration yields short-lived pairing token,
- pairing results in short-lived access token plus long-lived refresh token,
- host fingerprint and device key are bound to registration,
- refresh token rotation on successful resume.

### Short-Lived Tokens

Use short TTLs for:

- pairing codes,
- host access tokens,
- approval action tokens,
- Mini App session bootstrap tokens.

### Secret Handling

- prefer secret references over raw secret values,
- never send long-lived secrets through Telegram,
- daemon reads local secrets from host config or secret store,
- control plane stores encrypted secret metadata only when necessary,
- redact secrets from summaries and artifacts.

### Auditability

- append-only audit records for approvals, policy overrides, session terminal states, and bootstrap actions,
- correlation IDs on bot, API, worker, and daemon logs,
- durable mapping between session events and repo proof artifacts.

### Sandbox Boundaries

- workspace-root restrictions enforced by policy,
- out-of-root mutations require explicit approval,
- bootstrap cannot run arbitrary generated shell,
- verifier cannot modify production code.

### Compromised Host Scenario

Impact:

- attacker may read workspace content, local secrets, and in-flight session context,
- attacker may attempt false execution reports.

Mitigations:

- control plane remains approval and state authority,
- host tokens are revocable,
- repo-local proof and independent verifier reduce false completion,
- suspicious host state forces session freeze and manual review.

### Compromised Telegram Account Scenario

Impact:

- attacker may request sessions or approve actions as the user.

Mitigations:

- allow multi-factor or secondary confirmation for critical scopes,
- short approval expiry,
- policy denies critical actions by default,
- audit trail shows user actions,
- emergency revoke of Telegram identity and host bindings.

### Compromised Control Plane Scenario

Impact:

- attacker may tamper with session truth, approvals, or tokens.

Mitigations:

- protect signing keys,
- backup event store and audit records,
- use database and object storage encryption,
- validate repo-local proof independently during incident review,
- allow host suspension on suspected backend compromise.

### Compromised Repo Scenario

Impact:

- malicious prompts, scripts, or code may try to influence runtime or verification.

Mitigations:

- treat repo as untrusted data,
- require explicit policy/approval for risky commands,
- separate verifier from builder,
- constrain tool and shell surfaces,
- keep bootstrap manifests outside repo influence when possible.

### Bootstrap Safety Model

- deterministic manifests,
- installer whitelist,
- plan-before-apply,
- explicit elevation markers,
- backups before edits,
- repair driven by stored reports, not freeform generation.

---

## 13. Technology Stack

### Option A: TypeScript-First

- Backend/API: Node.js 22 + Fastify
- Worker: Node.js worker process
- Bot: Node.js Telegram framework
- Mini App: Next.js + TypeScript
- Host daemon: Node.js + TypeScript
- Shared contracts: TypeScript packages
- Database: PostgreSQL
- Queue/cache: Redis or NATS JetStream
- Object storage: S3-compatible

Pros:

- one primary language,
- shared types across API, bot, miniapp, daemon, and packages,
- easiest Codex/Cursor onboarding,
- fastest monorepo bootstrap.

Cons:

- daemon and concurrency semantics require discipline,
- high-throughput queueing is less strict than Go by default.

### Option B: Go Backend + TypeScript Surfaces

- Backend/API: Go
- Worker/event consumers: Go
- Bot/Mini App: TypeScript
- Host daemon: Go or TypeScript
- Shared protocol: generated schemas

Pros:

- stronger backend/runtime performance characteristics,
- simpler long-lived service footprint,
- good fit for concurrency-heavy systems.

Cons:

- split language tax,
- slower contributor onboarding,
- more schema/codegen overhead,
- weaker direct type sharing across all surfaces.

### Recommended Stack

Recommend **Option A: TypeScript-first** for HappyTG.

Rationale:

- Codex-first contributor experience matters more than theoretical backend purity at this stage,
- monorepo coherence is critical,
- repo-local proof, agent templates, and docs can move faster with one dominant language,
- the system is primarily orchestration-heavy, not CPU-heavy.

### Package Manager Strategy

- Use `pnpm` for the repository.
- Use `npm` for global Codex CLI installation.

This combination is pragmatic:

- `pnpm` gives fast monorepo installs and workspace management,
- Codex CLI global installation is an environment tool, not a repo dependency.

### Home Machine Requirements for Codex-First Workflow

- Git
- Node.js 22+
- `npm`
- `pnpm`
- Codex CLI installed globally
- `~/.codex/config.toml`
- enough disk for repos and artifacts
- optional Cursor or VS Code
- optional Docker for local self-hosted stack

---

## 14. Monorepo Structure

```text
HappyTG/
  apps/
    api/
    bot/
    miniapp/
    worker/
    host-daemon/
  packages/
    protocol/
    shared/
    runtime-adapters/
    repo-proof/
    policy-engine/
    approval-engine/
    bootstrap/
    hooks/
  docs/
    engineering-blueprint.md
    installation.md
    quickstart.md
    local-development.md
    self-hosting.md
    configuration.md
    bootstrap-doctor.md
    telegram-ux.md
    runtime-codex.md
    proof-loop.md
    troubleshooting.md
  infra/
    docker-compose.example.yml
  .codex/
    agents/
      task-spec-freezer.toml
      task-builder.toml
      task-verifier.toml
      task-fixer.toml
  .agent/
    tasks/
      .gitkeep
      templates/
        proof-loop/
  AGENTS.md
  README.md
  ARCHITECTURE.md
  CONTRIBUTING.md
  SECURITY.md
  ROADMAP.md
  .env.example
  package.json
  pnpm-workspace.yaml
  turbo.json
  tsconfig.base.json
```

### Monorepo Rationale

- apps stay thin and surface-specific,
- packages hold reusable domain logic and contracts,
- docs and templates are first-class,
- Codex guidance lives in-repo,
- proof artifacts are visible and durable.

---

## 15. File-by-File Starter Blueprint

| Path | Purpose | Minimal Content | Implementation Order |
| --- | --- | --- | --- |
| `README.md` | project landing page | positioning, architecture, quickstart | 1 |
| `AGENTS.md` | Codex/Cursor repo guidance | proof loop rules, commands, invariants | 1 |
| `.env.example` | config template | required env vars grouped by subsystem | 1 |
| `ARCHITECTURE.md` | high-level architecture | source of truth, layers, runtime model | 1 |
| `CONTRIBUTING.md` | contributor workflow | task bundle expectations, PR rules | 1 |
| `SECURITY.md` | security guidance | threat model and reporting path | 1 |
| `ROADMAP.md` | engineering epics | delivery structure and done criteria | 1 |
| `package.json` | monorepo root | scripts, package manager, turbo | 1 |
| `pnpm-workspace.yaml` | workspace config | apps/packages globs | 1 |
| `turbo.json` | task graph | dev/build/test/lint/typecheck | 1 |
| `.codex/agents/task-spec-freezer.toml` | role template | frozen spec role | 1 |
| `.codex/agents/task-builder.toml` | role template | builder role | 1 |
| `.codex/agents/task-verifier.toml` | role template | verifier role | 1 |
| `.codex/agents/task-fixer.toml` | role template | fixer role | 1 |
| `.agent/tasks/.gitkeep` | preserve proof dir | empty placeholder | 1 |
| `.agent/tasks/templates/proof-loop/spec.md` | proof template | acceptance criteria and verification plan | 1 |
| `.agent/tasks/templates/proof-loop/evidence.md` | proof template | evidence mapping | 1 |
| `.agent/tasks/templates/proof-loop/evidence.json` | machine-readable proof | criteria to artifacts mapping | 1 |
| `.agent/tasks/templates/proof-loop/verdict.json` | machine-readable verdict | verifier result | 1 |
| `.agent/tasks/templates/proof-loop/problems.md` | verifier findings | issue list and next actions | 1 |
| `apps/api/src/index.ts` | API entrypoint | session/pairing/miniapp service skeleton | 2 |
| `apps/worker/src/index.ts` | worker entrypoint | event consumer skeleton | 2 |
| `apps/bot/src/index.ts` | Telegram bot entrypoint | commands and callback adapter | 2 |
| `apps/miniapp/src/index.ts` | Mini App entrypoint | UI shell placeholder | 2 |
| `apps/host-daemon/src/index.ts` | daemon entrypoint | transport and queue shell | 2 |
| `packages/protocol/src/index.ts` | typed contracts | events, message types | 2 |
| `packages/shared/src/index.ts` | shared types | ids, timestamps, logging helpers | 2 |
| `packages/runtime-adapters/src/index.ts` | runtime contract | Codex adapter interface | 2 |
| `packages/repo-proof/src/index.ts` | proof bundle contract | task phases, bundle refs | 2 |
| `packages/policy-engine/src/index.ts` | policy types | layered decision model | 2 |
| `packages/approval-engine/src/index.ts` | approval types | request/decision states | 2 |
| `packages/bootstrap/src/index.ts` | bootstrap entrypoint | doctor/setup/repair/verify CLI | 2 |
| `packages/hooks/src/index.ts` | hook definitions | hook points and execution types | 2 |
| `packages/bootstrap/manifests/profiles/*.yaml` | profile manifests | minimal/recommended/full/custom | 2 |
| `packages/bootstrap/manifests/installers/installers.yaml` | installer whitelist | OS-specific install commands | 2 |
| `packages/bootstrap/manifests/rules/profile-selection.yaml` | rule engine inputs | deterministic selection rules | 2 |
| `infra/docker-compose.example.yml` | self-hosted example | postgres, redis, minio, apps | 3 |
| `docs/*.md` | docs pack | install, runtime, proof, hosting | 3 |

---

## 16. GitHub Repository Documentation Pack

### Root Files

| File | Purpose | Audience | Recommended Outline | Draft Starter Content |
| --- | --- | --- | --- | --- |
| `README.md` | project landing page | users, contributors | what, why, architecture, quickstart, repo map | “HappyTG is a Telegram-first, Codex-first self-hosted control plane for remote AI coding on your own host.” |
| `.env.example` | config reference | operators, contributors | grouped env vars by subsystem | “Copy to `.env` and fill Telegram, DB, storage, JWT, and Codex settings.” |
| `.gitignore` | keep repo clean | contributors | dependencies, builds, env, logs, state | “Ignore `node_modules`, `.env`, build output, `.happytg/` runtime state.” |
| `LICENSE` | open-source terms | everyone | Apache-2.0 text | “Apache-2.0 is recommended for permissive OSS collaboration.” |
| `CONTRIBUTING.md` | contribution rules | contributors | workflow, proof loop, PR expectations | “Non-trivial changes should reference a repo-local task bundle.” |
| `SECURITY.md` | security posture | security researchers, operators | reporting, hard requirements, scope | “Telegram is not trusted as the source of truth; verifier cannot edit prod code.” |
| `ARCHITECTURE.md` | architecture summary | contributors, reviewers | layers, source of truth, core runtime | “Business logic lives in engines, not in bot handlers.” |
| `ROADMAP.md` | engineering plan | maintainers | epics and done criteria | “Roadmap tracks delivery order without redefining scope.” |
| `AGENTS.md` | Codex guidance | coding agents, contributors | proof loop, commands, invariants | “Freeze spec before build and always use a fresh verifier.” |

### Docs

| File | Purpose | Audience | Recommended Outline | Draft Starter Content |
| --- | --- | --- | --- | --- |
| `docs/installation.md` | installation guide | developers, self-hosters | prerequisites, developer install, self-hosted install | “Install Git, Node.js, pnpm, Codex CLI, then run `pnpm bootstrap:doctor`.” |
| `docs/quickstart.md` | fastest path to first run | new users | 10-minute path, first commands, next docs | “Get to a paired host and first Codex task fast.” |
| `docs/local-development.md` | daily development flow | contributors | branches, proof loop, verify commands | “Use proof-loop for non-trivial changes and keep verifier fresh.” |
| `docs/self-hosting.md` | deployment guide | operators | topologies, infra, backups, upgrade, rollback | “Single-user mode is the primary deployment target.” |
| `docs/configuration.md` | config surfaces | operators, contributors | env vars, policy layers, local state paths | “HappyTG splits deployment config, local Codex config, and repo-local proof.” |
| `docs/bootstrap-doctor.md` | bootstrap/doctor details | operators, contributors | commands, profiles, state files, safety | “Detect first, install second, and never run arbitrary generated shell.” |
| `docs/telegram-ux.md` | bot and Mini App UX | product, bot engineers | commands, approvals, verbosity, examples | “Telegram is terse; Mini App is inspectable.” |
| `docs/runtime-codex.md` | Codex runtime model | runtime engineers, contributors | why Codex, orchestration, approvals, resume | “Codex CLI is the default adapter and design center.” |
| `docs/proof-loop.md` | repo proof workflow | contributors, QA | bundle path, phase order, rules | “Proof lives in `.agent/tasks/<TASK_ID>/`.” |
| `docs/troubleshooting.md` | operational recovery | users, operators | pairing, resume, Codex, stale state | “Use this guide before opening a bug.” |

---

## 17. Installation Guide

### Prerequisites

- Git
- Node.js 22+
- `pnpm`
- `npm`
- Codex CLI installed globally
- Telegram bot token
- PostgreSQL
- Redis or NATS JetStream
- S3-compatible storage or local development substitute

### What the Home Machine Needs for Codex

- `codex` on PATH
- readable `~/.codex/config.toml`
- enough disk for repos and task artifacts
- network path needed by Codex
- shell and PATH sanity confirmed by doctor

### Install HappyTG Dependencies

```bash
git clone <repo-url> HappyTG
cd HappyTG
cp .env.example .env
pnpm install
pnpm bootstrap:doctor
```

### Prepare `.env`

Fill at least:

- `DATABASE_URL`
- `REDIS_URL`
- `TELEGRAM_BOT_TOKEN`
- `JWT_SIGNING_KEY`
- `CODEX_CLI_BIN`
- `CODEX_CONFIG_PATH`

### Start the Backend

```bash
docker compose --env-file .env -f infra/docker-compose.example.yml up -d postgres redis minio
pnpm dev
```

If splitting processes manually:

```bash
pnpm --filter @happytg/api dev
pnpm --filter @happytg/worker dev
```

### Start the Bot

```bash
pnpm --filter @happytg/bot dev
```

### Start the Mini App

```bash
pnpm --filter @happytg/miniapp dev
```

### Start the Host Daemon

Run on the execution host:

```bash
pnpm --filter @happytg/host-daemon dev
```

### Connect the Telegram Bot

1. Create a bot with BotFather.
2. Put the token into `.env`.
3. Configure webhook or use polling in development.
4. Confirm the bot can reach the API.

### Pair the Host

1. Run `/pair` in Telegram.
2. Host daemon requests pairing start from API.
3. Telegram user claims the pairing code.
4. Control plane issues host tokens and stores binding.

### First Smoke Test

1. Run `happytg doctor`.
2. Run `happytg verify`.
3. Create a quick session from Telegram.
4. Create a proof-loop task that writes `.agent/tasks/HTG-0001/`.
5. Confirm verifier pass or fail is shown independently.

### Developer Instructions

- run everything locally,
- use polling for Telegram if webhooks are inconvenient,
- use one execution host first.

### Single-User Self-Hosted Instructions

- deploy API, worker, bot, miniapp, postgres, redis, object storage,
- run host daemon on the workstation/server that executes Codex,
- use TLS reverse proxy,
- configure backups before persistent use.

---

## 18. Local Development Flow

### Recommended Daily Workflow

1. Sync branch from main.
2. Create `codex/<task-name>` branch.
3. Decide quick mode vs proof-loop.
4. If proof-loop, create bundle under `.agent/tasks/<TASK_ID>/`.
5. Freeze spec.
6. Implement with builder.
7. Gather evidence.
8. Run fresh verifier.
9. Fix minimally if needed.
10. Run fresh verifier again.

### Git Strategy

- use short-lived focused branches,
- prefer separate worktrees for verifier independence,
- avoid mixing unrelated infrastructure and feature changes.

### Proof-Loop Use

Use proof-loop for:

- architecture or protocol changes,
- approval or policy changes,
- bootstrap changes,
- security-sensitive work,
- multi-file behavior changes,
- anything hard to explain without evidence.

### Verify Steps

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm bootstrap:verify
```

Add task-specific commands and store outputs under `.agent/tasks/<TASK_ID>/raw/`.

### Test Strategy During Development

- unit tests during inner loop,
- integration tests before handoff,
- verifier pass as outer loop,
- smoke self-hosted checks before merge for deployment-affecting changes.

### Quick Mode vs Proof-Loop Decision Rule

| Use Quick Mode When | Use Proof-Loop When |
| --- | --- |
| isolated read or trivial patch | behavior spans modules or state transitions |
| low-risk and obvious verification | approval, security, bootstrap, or runtime behavior changes |
| no durable evidence needed | durable evidence is needed |

### Keeping Task Bundles Clean

- one bundle per non-trivial task,
- do not overwrite old raw artifacts silently,
- record commands and timestamps,
- keep `spec.md` stable after freeze unless explicitly reopened,
- close bundles cleanly with final verdict.

---

## 19. Implementation Roadmap

### Epic 1. Repo Bootstrap

- Goal: create the monorepo, docs pack, and Codex guidance.
- Deliverables: root files, workspace config, docs, templates, skeleton packages.
- Dependencies: none.
- Risks: over-documentation without executable entrypoints.
- Done criteria: repo opens in Codex/Cursor and explains itself.
- Exact tasks: create root files, create apps/packages skeletons, add `.codex/agents`, add `.agent/tasks/templates`.

### Epic 2. Protocol Contracts

- Goal: define typed events, daemon messages, session/task/approval states.
- Deliverables: `packages/protocol`, event taxonomy doc, JSON schema or Zod layer.
- Dependencies: epic 1.
- Risks: schema churn after implementation starts.
- Done criteria: API, worker, bot, and daemon all depend on shared contracts.
- Exact tasks: define event enums, session states, approval states, reconnect contracts, idempotency headers.

### Epic 3. Control Plane

- Goal: build API, persistence, projections, and orchestration core.
- Deliverables: API app, worker app, DB schema, queue integration.
- Dependencies: epics 1-2.
- Risks: projection drift and implicit business logic spread.
- Done criteria: session create, projection read, approval persistence, event replay.
- Exact tasks: DB schema, event store, session service, projection worker, auth bootstrap.

### Epic 4. Bot

- Goal: Telegram-first control and approval UX.
- Deliverables: bot commands, callbacks, pairing flow, summary delivery.
- Dependencies: epics 2-3.
- Risks: bot handler logic growing into a backend.
- Done criteria: bot works purely as render and action intake layer.
- Exact tasks: `/start`, `/pair`, `/hosts`, `/task`, approval callback flow, error messaging.

### Epic 5. Host Daemon

- Goal: durable execution agent on local host.
- Deliverables: daemon transport, local journal, queue model, reconnect.
- Dependencies: epics 2-3.
- Risks: duplicate execution on reconnect.
- Done criteria: daemon can register, receive dispatch, ack, reconnect, and report events.
- Exact tasks: hello/heartbeat protocol, journal persistence, mutation queue, read batcher.

### Epic 6. Codex Integration

- Goal: Codex CLI adapter as primary runtime.
- Deliverables: runtime adapter, smoke checks, session wrapper, summary capture.
- Dependencies: epics 2, 5, 9.
- Risks: runtime lifecycle edge cases, brittle parsing.
- Done criteria: quick task and proof-loop task run through Codex on a real host.
- Exact tasks: runtime interface, Codex preflight, command wrapper, checkpointing, summary adapter.

### Epic 7. Repo Proof Engine

- Goal: task bundle lifecycle and proof enforcement.
- Deliverables: bundle init/status/validate/run logic.
- Dependencies: epics 2, 5, 6.
- Risks: proof becoming optional in practice.
- Done criteria: proof-loop tasks create and update canonical bundle reliably.
- Exact tasks: bundle scaffolder, phase validator, evidence mapper, verdict writer.

### Epic 8. Approvals/Policies

- Goal: layered policy and approval gating.
- Deliverables: policy engine, approval engine, queue integration.
- Dependencies: epics 2, 3, 4, 5.
- Risks: deadlocks or policy loopholes.
- Done criteria: risky actions require valid approval and effective policy decision.
- Exact tasks: policy evaluator, approval request creation, expiry/resume, queue unblock logic.

### Epic 9. Bootstrap Subsystem

- Goal: deterministic machine setup and validation.
- Deliverables: doctor/setup/repair/verify commands, manifests, reports.
- Dependencies: epic 1.
- Risks: accidental unsafe automation.
- Done criteria: machine readiness can be assessed and repaired deterministically.
- Exact tasks: env detector, planner, installer backends, backup manager, Codex smoke check.

### Epic 10. Mini App

- Goal: rich inspection surface.
- Deliverables: task bundle viewer, diff/log views, host/session pages.
- Dependencies: epics 3, 4, 7, 8.
- Risks: overbuilt UI before projections are stable.
- Done criteria: Mini App shows enough detail to avoid Telegram spam.
- Exact tasks: auth bootstrap, session list, task detail, artifact viewer, diff page.

### Epic 11. Observability

- Goal: metrics, tracing, audit, projection rebuild.
- Deliverables: structured logs, traces, dashboards, replay tools.
- Dependencies: epics 3, 5, 6.
- Risks: missing correlation across surfaces.
- Done criteria: operators can trace a session end-to-end.
- Exact tasks: request IDs, session correlation IDs, queue metrics, reconnect metrics, replay tool.

### Epic 12. Security Hardening

- Goal: reduce blast radius and validate threat model.
- Deliverables: token rotation, secret references, critical approval protections.
- Dependencies: epics 3, 5, 8, 9.
- Risks: late hardening that breaks flows.
- Done criteria: high-risk paths have tests and clear controls.
- Exact tasks: token TTL review, audit coverage, replay tests, compromise runbooks.

### Epic 13. Docs Pack

- Goal: keep repository self-explanatory.
- Deliverables: all root/docs files in sync with implementation.
- Dependencies: ongoing.
- Risks: docs drift.
- Done criteria: quickstart works and links remain valid.
- Exact tasks: update docs per merged feature, add examples, keep install guides current.

### Epic 14. Self-Hosted Packaging

- Goal: make single-user deployment practical.
- Deliverables: compose examples, env guidance, backup and upgrade docs.
- Dependencies: epics 3, 4, 5, 10.
- Risks: packaging lags behind app assumptions.
- Done criteria: clean install on a fresh machine with documented steps.
- Exact tasks: compose validation, reverse proxy example, migration wrapper, backup script plan.

### Epic 15. QA/Release

- Goal: prove the platform is reliable enough to use daily.
- Deliverables: smoke suite, resume/reconnect suite, release checklist.
- Dependencies: all core epics.
- Risks: happy-path bias.
- Done criteria: release pipeline validates core slices end-to-end.
- Exact tasks: golden path test, reconnect test, approval race test, bootstrap smoke, release notes template.

---

## 20. First 30 Tasks

1. Replace placeholder README with project positioning and repo map.
2. Add `pnpm-workspace.yaml`, root `package.json`, `turbo.json`, and `tsconfig.base.json`.
3. Create `apps/api`, `apps/worker`, `apps/bot`, `apps/miniapp`, and `apps/host-daemon`.
4. Create `packages/protocol` with typed event and message contracts.
5. Create `packages/shared` for base types and logging contracts.
6. Create `packages/runtime-adapters` and define `RuntimeAdapter` interface.
7. Create `packages/repo-proof` and define task phases and bundle refs.
8. Create `packages/policy-engine` and define layered policy model.
9. Create `packages/approval-engine` and define approval request/decision model.
10. Create `packages/hooks` with mandatory hook points.
11. Create `packages/bootstrap` and manifest directories.
12. Add `.codex/agents/task-spec-freezer.toml`.
13. Add `.codex/agents/task-builder.toml`.
14. Add `.codex/agents/task-verifier.toml`.
15. Add `.codex/agents/task-fixer.toml`.
16. Add `.agent/tasks/templates/proof-loop/*`.
17. Define session, task, approval, and verification states in protocol package.
18. Define host-daemon handshake, heartbeat, and resume contracts.
19. Design database schema for sessions, events, approvals, policies, hosts, and workspaces.
20. Implement control plane event append and projection update skeleton.
21. Implement Telegram `/pair` flow skeleton.
22. Implement host registration and pairing claim endpoints.
23. Implement daemon hello/heartbeat local journal skeleton.
24. Implement `happytg doctor` detection-only pass.
25. Implement Codex CLI presence and smoke verifier.
26. Implement session create API and basic projection read endpoint.
27. Implement quick-mode Codex dispatch on a single host.
28. Implement proof-loop bundle init and spec freeze flow.
29. Implement approval request/resolution flow for one risky mutation type.
30. Implement first fresh verifier flow that writes `verdict.json`.

---

## 21. Test Strategy

### Unit

- state transition guards,
- policy layer merge logic,
- approval expiry calculations,
- bootstrap rule selection,
- artifact manifest parsing.

### Integration

- API + worker + DB event flow,
- bot callback to approval resolution,
- daemon reconnect with idempotent replay suppression,
- repo-proof bundle creation and validation.

### Bot Flows

- pairing,
- approval accept/reject,
- stale callback refresh,
- quick session start,
- proof-loop phase summaries.

### Daemon Protocol

- hello/heartbeat,
- session dispatch ack,
- reconnect with local journal,
- resume after backend restart,
- artifact sync.

### Codex Integration Checks

- Codex binary discovery,
- config presence,
- smoke prompt,
- builder session lifecycle,
- fresh verifier session isolation.

### Proof-Loop Verification

- no build before spec freeze,
- verifier cannot mark complete without evidence,
- fixer requires new verifier pass,
- task validation catches missing required files.

### Bootstrap Tests

- profile selection by rules,
- manifest whitelist enforcement,
- backup creation before config edit,
- degraded mode report-only behavior.

### Security Tests

- token expiry,
- replayed callback rejection,
- idempotency key reuse on mutations,
- policy override monotonicity,
- secret redaction in summaries.

### Self-Hosted Install Smoke Tests

- compose boot,
- API reachability,
- bot connectivity,
- daemon registration,
- first Codex smoke task.

### Resume/Reconnect Tests

- host restart during build,
- backend restart during approval wait,
- verifier restart during verify phase,
- long-running session heartbeat recovery.

### Approval/Policy Race Tests

- approval arrives after expiry,
- concurrent risky actions on same workspace,
- policy update during pending approval,
- duplicate callback press.

### Degraded-Mode Tests

- no package manager available,
- no elevation available,
- object storage unavailable,
- Telegram delivery degraded while Mini App/API still serve state.

---

## 22. Deployment & Self-Hosting

### Single-User Mode

Recommended first-class deployment:

- one control plane,
- one Telegram bot,
- one operator,
- one or more execution hosts,
- one database, one queue, one object store.

### Small-Team Mode

Future-safe but not primary initial focus:

- multiple users,
- workspace-scoped policies,
- host pools,
- stronger approval routing,
- more explicit audit partitioning.

### Docker Compose

Compose is appropriate for:

- evaluation,
- local development,
- single-user self-hosting.

Do not assume compose alone equals production readiness. Document backup, TLS, and upgrade separately.

### Env Vars

Keep env vars grouped:

- app URLs,
- database,
- queue,
- storage,
- Telegram,
- auth,
- runtime,
- observability.

### Reverse Proxy

Use reverse proxy for:

- TLS termination,
- webhook routing,
- Mini App public access,
- optional admin UI separation.

### Webhook vs Polling

| Mode | Use When |
| --- | --- |
| Webhook | stable self-hosted deployment with public HTTPS endpoint |
| Polling | local development or temporary degraded mode |

### Backups

Back up:

- PostgreSQL,
- object storage metadata and artifacts,
- `.happytg/` daemon/bootstrap state where relevant,
- critical config files,
- signing keys and secret metadata securely.

### Migrations

- version DB schema explicitly,
- run migrations before deploying incompatible app versions,
- support projection rebuild from event log after schema change if needed.

### Upgrade Path

1. backup state,
2. review release notes,
3. apply migrations,
4. restart API and worker,
5. verify projections and bot health,
6. reconnect hosts and confirm resume behavior.

### Rollback

- preserve event store,
- roll back app binaries/images,
- restore previous DB snapshot only with explicit operator action,
- freeze mutation sessions during uncertain state.

### Secret Rotation

- rotate JWT signing keys with overlap strategy,
- rotate host refresh tokens on suspicion or schedule,
- rotate Telegram token with controlled cutover,
- rotate object store credentials without exposing them to Telegram.

### Host Reconnect After Backend Restart

- host daemon keeps local journal,
- backend restart invalidates transient streams but not persistent session truth,
- host reconnects with refresh token and last acked sequence,
- backend resends only pending work not acknowledged as executed.

---

## 23. Recommended First Vertical Slice

The first practical slice should prove the architecture end-to-end:

1. `happytg doctor` runs detection-only and reports Codex readiness.
2. `happytg verify` runs the Codex smoke check.
3. Host daemon registers and pairs with Telegram identity.
4. User selects host and workspace from Telegram.
5. User starts a Codex-backed quick session.
6. Read-only summary returns to Telegram.
7. A risky mutation requests Telegram approval.
8. On approval, daemon executes through serialized mutation queue.
9. User starts a proof-loop task.
10. `.agent/tasks/HTG-0001/` is created locally.
11. Spec freezer writes `spec.md`.
12. Builder updates code and raw artifacts.
13. Fresh verifier writes `verdict.json`.
14. Telegram shows final verdict and Mini App shows diff/artifacts.

Success criteria for this slice:

- Telegram is useful but not stateful truth,
- daemon reconnect can recover session state,
- proof artifact bundle exists in repo,
- fresh verifier is distinct from builder,
- risky mutations never bypass approval and queue controls.

---

## 24. Final Recommendation

### 1. Recommended Architecture

Use an event-driven control plane with explicit session/task/approval state machines, durable event log, relational projections, and repo-local proof bundles. Keep Telegram Bot and Mini App as thin render layers over the same core.

### 2. Recommended Stack

Use a TypeScript-first monorepo with Node.js 22, `pnpm`, PostgreSQL, Redis or NATS JetStream, S3-compatible artifact storage, Next.js Mini App, and a TypeScript host daemon.

### 3. Recommended Package Manager Strategy

Use `pnpm` for repository dependencies and workspace orchestration. Use `npm` only for globally installed environment tools such as Codex CLI.

### 4. Recommended Codex-First Runtime Approach

Treat Codex CLI as the primary runtime adapter and design approvals, summaries, proof bundles, and verification around it. Do not generalize the runtime layer so early that Codex workflow quality degrades.

### 5. Recommended Bootstrap Implementation

Implement bootstrap as a deterministic engine using manifest whitelists, explicit rule-based profile selection, plan-before-apply, backups-before-edit, and stateful repair. Never use freeform LLM-generated install shell.

### 6. Recommended Repo Structure

Adopt the monorepo layout in section 14 with first-class `docs/`, `.codex/agents/`, and `.agent/tasks/`. Make project guidance and proof templates part of the repository from day one.

### 7. Recommended First 30 Tasks

Use the backlog in section 20 directly. It sequences repo bootstrap, protocol contracts, control plane skeleton, pairing, daemon transport, Codex runtime, proof bundle init, approvals, and fresh verifier flow in a coherent order.

### 8. Key Technical Mistakes to Avoid

- treating Telegram as the internal transport for agent events,
- letting Telegram or Mini App become the source of truth,
- combining builder and verifier roles,
- running mutating actions in parallel without a strict queue,
- skipping resumability and idempotency design,
- allowing recursive uncontrolled subagent spawning,
- starting proof-loop build before spec freeze,
- using LLM-driven package install logic instead of manifests and rules,
- centralizing all proof in chat instead of repo-local artifacts,
- building UI-specific business logic instead of event-driven core services.

HappyTG should be built as a control plane with durable execution truth, not as a smart Telegram bot with extra screens. That architectural decision is the difference between a toy and a system that remains usable after the first real disconnect, approval race, or failed verification cycle.
