# HappyTG Architecture

HappyTG uses a split execution model:

- render layers: Telegram Bot, Telegram Mini App, CLI, optional admin UI,
- control plane: API, worker, session engine, approval engine, policy engine, context engine, audit pipeline,
- execution plane: host daemon, runtime adapters, local repo proof engine,
- durable state: event log, materialized views, object storage, repo-local task bundles.

## Source of Truth

Canonical sources of truth:

- control plane event store for session and approval history,
- materialized state tables for current projections,
- repo-local `.agent/tasks/<TASK_ID>/` bundles for proof artifacts.

Derived or rendered views:

- Telegram summaries,
- Mini App screens,
- CLI status output,
- optional admin dashboards.

## Primary Runtime

Codex CLI is the primary runtime. Secondary runtimes are supported only behind a compatibility layer that keeps:

- the same session state machine,
- the same approval semantics,
- the same proof-loop phases,
- the same evidence contracts.

## Detailed Spec

The full production blueprint lives in [docs/engineering-blueprint.md](./docs/engineering-blueprint.md).
