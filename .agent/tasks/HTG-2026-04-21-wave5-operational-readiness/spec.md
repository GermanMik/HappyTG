# Task Spec

- Task ID: HTG-2026-04-21-wave5-operational-readiness
- Title: Wave 5 operational readiness
- Owner: HappyTG
- Mode: proof
- Status: initialized

## Problem

Waves 1-4 created the product foundation, bot UX, core session/policy/proof logic, and a usable Mini App. The remaining MVP gap is operational readiness: security hardening, observability endpoints, self-hosted deployment wiring, docs/runbooks, and final verification evidence.

Wave 5 must stay additive and release-aware. It should harden the existing TypeScript services and deployment scaffold rather than introducing a new runtime, datastore migration, or orchestration layer.

## Acceptance Criteria

1. Shared logging redacts secrets and API exposes fast version and Prometheus metrics endpoints
2. Mini App sessions and launch grants support explicit revoke paths with audit records
3. Self-hosted compose includes Caddy plus Prometheus/Grafana observability scaffold
4. Security, observability, backup, upgrade, rollback, and release readiness docs are updated
5. CI and verification gates cover lint, typecheck, test, build, and task validation

## Constraints

- Runtime: Codex CLI
- Verification: fresh verifier required
- Preserve existing app/package names and CLI flow.
- Keep deploy/publish side effects out of tests; only generate deploy artifacts.
- Do not expose secrets in logs, docs, tests, or proof artifacts.
- Keep `/health`, `/ready`, `/version`, and `/metrics` fast-path endpoints.
- Out of scope: full PostgreSQL schema migration, real OTel exporter implementation, and production Kubernetes manifests.

## Verification Plan

- Unit: redaction, revoke, metrics/version, CORS/revoke route behavior.
- Integration: full `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`.
- Task validation: `pnpm happytg task validate --repo . --task HTG-2026-04-21-wave5-operational-readiness --json`.
- Evidence: raw command logs plus evidence/verdict/problems/state/task updates.
