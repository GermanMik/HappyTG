# HTG-2026-06-14-installer-codex-desktop-docker-support

## Frozen Scope

Modify the HappyTG installer Docker launch path so a Docker-hosted API can see Codex Desktop projects/sessions by default when a readable host Codex home is available, and can opt into Desktop mutating controls when an operator explicitly configures the host proxy.

Relevant files are expected to stay limited to:

- `packages/bootstrap/src/install/docker-services.ts`
- `packages/bootstrap/src/install/launch.ts`
- `packages/bootstrap/src/install/types.ts`
- `packages/bootstrap/src/install.runtime.test.ts`
- `.agent/tasks/HTG-2026-06-14-installer-codex-desktop-docker-support/**`

## Proof-Loop Implementation Prompt

You are the HappyTG task-builder for this frozen task.

Context:

- Live Docker API could not see Desktop projects/sessions until started with `infra/docker-compose.codex-desktop.yml` and `HAPPYTG_HOST_CODEX_HOME` pointing at the host `.codex` directory.
- Session continuation controls require the host-side proxy and Docker override `infra/docker-compose.codex-desktop-host-proxy.yml`.
- The installer already builds a `DockerServiceStrategyPlan` and `runDockerLaunch` already propagates `overrideFiles` to `docker compose config`, `up`, and `ps`.

Implement:

1. Add Docker strategy planning that detects a host Codex home in this order:
   - `repoEnv.HAPPYTG_HOST_CODEX_HOME`
   - `installEnv.HAPPYTG_HOST_CODEX_HOME`
   - `~/.codex` resolved from the installer environment
2. When that path exists, include `infra/docker-compose.codex-desktop.yml` in the Docker compose override files and pass `HAPPYTG_HOST_CODEX_HOME` through `DockerServiceStrategyPlan.env`.
3. Add explicit host-proxy opt-in detection. Include `infra/docker-compose.codex-desktop-host-proxy.yml` only when the operator has configured `HAPPYTG_CODEX_DESKTOP_CONTROL=host-proxy` or `HAPPYTG_CODEX_DESKTOP_PROXY_URL`.
4. Do not invent proxy tokens, do not enable mutating controls implicitly, and do not require elevated Windows Scheduled Task setup in this task.
5. Make finalization/report data describe the applied Desktop Docker plan so the operator can see which override files were used.
6. Preserve existing isolated/reuse service behavior and Caddy/service reuse rules.

Acceptance criteria:

- A non-interactive `runHappyTGInstall` Docker launch with a detected host `.codex` directory runs compose commands with `-f infra/docker-compose.codex-desktop.yml` and has `HAPPYTG_HOST_CODEX_HOME` in the Docker command env.
- A Docker launch without a readable host `.codex` directory does not include the Codex Desktop override.
- Explicit host-proxy env includes `infra/docker-compose.codex-desktop-host-proxy.yml`; absent proxy env does not include it.
- Existing Docker isolated and reuse tests continue to pass after expectation updates.
- Compose command strings in launch/finalization include the same override files used by actual docker args.

## Verification Plan

Builder validation:

- `pnpm --filter @happytg/bootstrap test`
- `pnpm --filter @happytg/bootstrap typecheck`
- `git diff --check -- packages/bootstrap/src/install/docker-services.ts packages/bootstrap/src/install/launch.ts packages/bootstrap/src/install/types.ts packages/bootstrap/src/install.runtime.test.ts .agent/tasks/HTG-2026-06-14-installer-codex-desktop-docker-support`

Fresh verifier validation:

- Re-run the scoped bootstrap tests/typecheck.
- Validate the generated proof bundle with `pnpm happytg task validate --repo . --task HTG-2026-06-14-installer-codex-desktop-docker-support --json`.

## Out Of Scope

- Running or installing the Windows Scheduled Task for `pnpm daemon:desktop-proxy`.
- Storing proxy tokens or credentials.
- Changing runtime-adapters Desktop session parsing.
- Reworking Caddy/BaseDeploy topology.
