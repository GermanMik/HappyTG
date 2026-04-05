# Codex Runtime

## Primary Runtime

Codex CLI is the primary runtime for HappyTG.

## Why

- best fit for repo-local coding workflows,
- natural support for AGENTS guidance,
- compatible with proof-first task bundles,
- works well on self-hosted developer machines.

## Runtime Responsibilities

- start and resume coding sessions,
- maintain session checkpoints and summaries,
- support diff and verification handoff,
- integrate with approval and policy engines,
- record outputs needed for proof-loop artifacts.

## Role Split

- `task-spec-freezer`
- `task-builder`
- `task-verifier`
- `task-fixer`

Verifier sessions must always be fresh and must not edit production code.
