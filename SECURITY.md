# Security Policy

## Supported Deployment Model

HappyTG is built for self-hosted deployments where the operator controls:

- the control plane backend,
- the host daemon runtime,
- the Telegram bot token,
- the repositories and workspaces attached to hosts.

## Security Principles

- Short-lived access tokens for hosts and pairing flows.
- Layered policies: global, deployment, workspace, session, command.
- Serialized queue for mutating execution.
- Approval gate before risky actions.
- Repo-local evidence for auditable completion.
- Secrets referenced indirectly where possible.
- Explicit trust boundaries between Telegram, control plane, host, and repo.

## Reporting

Report vulnerabilities privately before opening an issue. Include:

- affected component,
- reproduction steps,
- impact assessment,
- whether host compromise, Telegram compromise, or repo compromise is required.

## Hard Security Requirements

- Verifier role must not edit production code.
- Telegram must not carry internal execution events.
- Host reconnect must not replay mutating actions without idempotency keys.
- Bootstrap installers must come from manifests and whitelisted backends only.
