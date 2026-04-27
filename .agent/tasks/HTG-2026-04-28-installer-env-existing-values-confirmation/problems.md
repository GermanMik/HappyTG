# Problems

## P1 - Current workspace includes out-of-scope changes

The frozen spec for `HTG-2026-04-28-installer-env-existing-values-confirmation` explicitly excludes unrelated installer launch, Docker, port-preflight, doctor, or verify behavior. The current workspace diff is not limited to the existing `.env` Telegram confirmation work. It also includes Docker/launch/port-related files and other unrelated surfaces, including `.env.example`, `README.md`, `docs/installation.md`, `docs/self-hosting.md`, `infra/docker-compose.example.yml`, `packages/bootstrap/src/install/launch.ts`, `packages/bootstrap/src/install.scripts.test.ts`, `packages/bootstrap/src/infra-config.test.ts`, `packages/protocol/src/index.ts`, `packages/policy-engine/src/index.ts`, `packages/runtime-adapters/src/index.ts`, and `scripts/install/install.ps1`.

Because this verifier was asked to verify the spec against current workspace changes, the task cannot be passed as an isolated implementation of the frozen scope while those unrelated changes are present.

## Passing checks

- The interactive existing `.env` confirmation behavior is implemented before Telegram setup when an existing token is present.
- The confirmation screen masks `TELEGRAM_BOT_TOKEN` and displays safe non-secret values such as fake allowed IDs, home channel, bot username, local URLs, and port overrides.
- The edit path opens the Telegram form with a blank token and without `.env` or draft allowed IDs/home channel.
- The reuse path carries existing Telegram values into the result and `.env` merge.
- Interactive CLI `--allowed-user` handling remains operator input, while non-interactive fallback still reads CLI, draft, then existing `.env` values.
- Fresh targeted unit/runtime tests, bootstrap build, bootstrap lint, and task validation passed during this verifier pass.
