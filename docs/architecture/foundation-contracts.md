# HappyTG Foundation Contracts

This document records the current Wave 1 baseline for the existing HappyTG repository. It is an evolution note, not a replacement architecture.

## Implementation Baseline

- Runtime baseline: TypeScript-first monorepo.
- Control plane: `apps/api` plus `apps/worker`.
- Render layers: `apps/bot` and `apps/miniapp`.
- Execution plane: `apps/host-daemon`.
- Shared contracts: `packages/protocol`.
- Policy and approval: `packages/policy-engine`, `packages/approval-engine`.
- Repo proof layer: `packages/repo-proof`.
- Bootstrap CLI: `packages/bootstrap` through `pnpm happytg`.

Do not add a parallel CLI or rewrite existing apps in another language without an ADR and staged migration plan.

## Public Topology

Recommended single-origin deployment for `happytg.gerta.crazedns.ru`:

| Public path | Target | Notes |
| --- | --- | --- |
| `/` | redirect to `/miniapp` | Human entry point. |
| `/miniapp` | `miniapp:3001` | Telegram Mini App frontend. |
| `/api/*` | `api:4000` | Control-plane API. |
| `/health` | `api:4000` | Fast-path health. |
| `/bot/webhook` | `bot:4100` via `/telegram/webhook` rewrite | Public Telegram webhook path. |
| `/static/*` | `miniapp:3001` | Mini App static assets. |

The Caddy skeleton lives at `infra/caddy/Caddyfile`.

## Domain Model

The canonical TypeScript definitions live in `packages/protocol/src/index.ts`.

| Entity | Key fields | Relationships | Lifecycle | Persistence |
| --- | --- | --- | --- | --- |
| `User` | `id`, `displayName`, `status`, `createdAt` | Owns Telegram identities and sessions. | active -> revoked | Control-plane store, later PostgreSQL. |
| `TelegramIdentity` | `telegramUserId`, `chatId`, `username`, `status` | Binds Telegram account to `User`. | active -> revoked | Control-plane store with unique Telegram user id. |
| `Workspace` | `hostId`, `path`, `repoName`, `status` | Belongs to `Host`; sessions target it. | active -> archived | Store row acts as tombstone when archived. |
| `Host` | `fingerprint`, `status`, `capabilities`, `lastSeenAt` | Owns workspaces and dispatches. | registering -> paired -> active/stale/revoked | Store plus daemon local state. |
| `HostRegistration` | `pairingCode`, `expiresAt`, `status` | Claims a host for a user. | issued -> claimed/expired | Store with short TTL. |
| `Session` | `state`, `mode`, `runtime`, `taskId`, `approvalId` | Ties user, host, workspace, task. | explicit state machine | Event log plus projection. |
| `SessionEvent` | `type`, `payload`, `sequence` | Append-only history for a session. | append-only | Event log; projections are derived. |
| `TaskBundle` | `rootPath`, `phase`, `verificationState` | Repo-local proof for proof sessions. | quick/freeze -> complete | Control-plane record plus `.agent/tasks`. |
| `ApprovalRequest` | `actionKind`, `state`, `scope`, `risk`, `expiresAt`, `nonce` | Blocks a session or dispatch. | waiting_human -> approved/denied/expired | Store plus audit. |
| `ApprovalDecision` | `approvalRequestId`, `actorUserId`, `decision` | Resolves approval once. | append-only | Store plus audit. |
| `Policy` | `layer`, `scopeRef`, `rules`, `version` | Evaluated for actions by scope. | active -> superseded | Store; lower layers cannot weaken deny. |
| `EvidenceArtifact` | `taskId`, `kind`, `path`, `sha256` | Points to proof artifacts. | append-only | Repo-local or object store. |
| `VerificationRun` | `taskId`, `status`, `summary` | Fresh verifier pass for a task. | queued/running -> terminal | Store plus proof bundle verdict. |
| `RuntimeAdapterRecord` | `kind`, `capabilities`, `status` | Declares execution runtime support. | active -> deprecated | Store/config. |
| `MCPBinding` | `serverName`, `allowedTools`, `status` | Binds MCP tools to host/workspace. | active -> disabled/revoked | Store/config; secrets referenced separately. |
| `HookDefinition` | `point`, `enabled`, `handlerRef` | Platform lifecycle hook. | enabled/disabled | Store/config. |
| `HookExecution` | `hookId`, `sessionId`, `status` | Records hook run. | started -> completed/failed | Store/audit. |
| `AuditRecord` | `actorType`, `action`, `targetRef`, `metadata` | Forensic trail. | append-only | Store, later PostgreSQL. |
| `SecretReference` | `scope`, `provider`, `keyRef` | Indirect secret access. | rotate/revoke | Store only references, never secret values. |

Primary indexes for the later database migration should cover `telegramUserId`, `host.fingerprint`, `workspace(hostId,path)`, `session(userId,updatedAt)`, `sessionEvent(sessionId,sequence)`, `approval(sessionId,state)`, and `task(sessionId)`.

## State Models

Session states:

`created -> preparing -> ready -> running -> verifying -> completed`

Allowed branches:

- `running -> needs_approval -> ready`
- `running -> blocked -> paused`
- `running -> paused -> resuming -> ready`
- any non-terminal state -> `failed` or `cancelled`

Task phases:

`quick` for quick tasks, otherwise `freeze -> build -> evidence -> verify -> fix -> verify -> complete`.

Verification states:

`not_started`, `queued`, `running`, `passed`, `failed`, `inconclusive`, `stale`.

Any mutation after `passed` makes verification `stale` until a fresh verifier pass runs.

Approval states:

`not_required`, `pending`, `waiting_human`, `auto_allowed`, `auto_denied`, `approved_once`, `approved_session`, `approved_phase`, `denied`, `expired`, `superseded`.

## Event Model

Canonical event names are exported by `EVENT_NAMES` and detailed by `EVENT_CONTRACTS` in `packages/protocol/src/index.ts`.

Required producers:

- control plane: session creation, assignment, policy evaluation;
- bot/miniapp: user messages, callbacks, approval decisions;
- host daemon: tool calls, summaries, proof updates, verification runs;
- worker: heartbeat reconciliation, disconnect/reconnect projections.

Events are append-only. Projections may be rebuilt from `SessionEvent` records and repo-local proof state.

## Repo Proof Bundle

Canonical path:

```text
.agent/tasks/<TASK_ID>/
  spec.md
  state.json
  evidence.md
  evidence.json
  verdict.json
  problems.md
  raw/
    build.txt
    test-unit.txt
    test-integration.txt
    lint.txt
```

`task.json` remains for existing CLI compatibility. `state.json` is the render/verifier phase cursor and contains `task_id`, `session_id`, `current_phase`, `phase_history`, `verification_state`, `approvals`, `artifact_manifest`, `unresolved_issues`, `last_event_cursor`, and timestamps.

## Duplication Boundaries

Do not create:

- a second `happytg` CLI outside `packages/bootstrap`;
- a second proof bundle location for this repo;
- a second bot state store;
- a second daemon protocol under another package;
- a Go rewrite of existing TypeScript apps without ADR and migration plan.
