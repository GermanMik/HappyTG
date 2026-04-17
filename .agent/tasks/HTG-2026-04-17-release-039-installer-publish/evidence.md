# HTG-2026-04-17-release-039-installer-publish Evidence

## Status

- Phase: complete
- Task ID: `HTG-2026-04-17-release-039-installer-publish`
- Coordinator: Codex main agent
- Verifier role: `task-verifier` (spawned separately)

## Commands Run

- Baseline before fixes:
  - `pnpm happytg doctor --json`
  - `pnpm happytg verify --json`
  - `pnpm happytg setup --json`
  - `pnpm happytg install --json`
  - `pnpm lint`
  - `pnpm typecheck`
  - `pnpm test`
- Telegram-specific safe probes:
  - DNS / proxy / WinHTTP / curl / PowerShell / Node probe bundle in `raw/telegram-probe.txt`
  - IPv4 / IPv6 / PowerShell `getMe` follow-up in `raw/telegram-probe-followup.txt`
- Fresh validation after fixes:
  - `pnpm exec tsx --test packages/bootstrap/src/install.test.ts packages/bootstrap/src/install.runtime.test.ts packages/runtime-adapters/src/index.test.ts`
  - `pnpm lint`
  - `pnpm typecheck`
  - `pnpm test`
  - `pnpm release:check --version 0.3.9`
  - `pnpm happytg task validate --repo . --task HTG-2026-04-17-release-039-installer-publish`
  - `pnpm happytg doctor --json`
  - `pnpm happytg verify --json`
  - `pnpm happytg setup --json`
  - Programmatic `executeHappyTG(["install", ...])` run that injects Telegram values from `.env` without logging the token

## Reproduced Baseline

### Telegram `getMe`

- Baseline installer output in `raw/install-json.txt` initially reduced the issue to:
  - `Telegram API getMe network request failed: Connection to api.telegram.org timed out.`
- Safe probe results in `raw/telegram-probe.txt` and `raw/telegram-probe-followup.txt` showed:
  - proxy env vars unset;
  - WinHTTP direct access;
  - `Resolve-DnsName` returned both A and AAAA records for `api.telegram.org`;
  - Node `fetch` and `curl -4` timed out on `api.telegram.org`;
  - Node `dns.lookup` only produced IPv4 on this host during the probe;
  - Windows PowerShell `Invoke-WebRequest` to the same Bot API `getMe` endpoint with the same token returned `200 OK` and validated `@gerta_workbot`.

### Codex websocket `403`

- Baseline `doctor`, `verify`, `setup`, and installer post-checks all reported the same warning root:
  - `Codex could not open the Responses websocket (403 Forbidden).`
- Raw stderr in `doctor-json.txt` also showed:
  - repeated websocket `403 Forbidden` lines;
  - `codex_core::client: falling back to HTTP`;
  - successful smoke output containing `OK`.

### Final Summary / Next steps duplication

- Baseline installer output duplicated:
  - `pnpm dev` versus `Start repo services: pnpm dev`;
  - `pnpm daemon:pair` versus `Request a pairing code on the execution host`;
  - `/pair` guidance in multiple near-identical forms;
  - three identical post-check step details for setup/doctor/verify.

### Mini App port `3001`

- Baseline and fresh `doctor`/`setup`/`verify` all showed a real external listener:
  - HTTP `Contacts` listener via Docker container `contacts-frontend`.
- This remained a truthful conflict on the maintainer machine and was not suppressed.

## Root Cause Classification

### Telegram warning

- Classification: product diagnostic bug plus legitimate environment warning.
- Product bug:
  - installer previously stopped at the Node-side timeout string and could not tell whether the token was invalid, whether Bot API HTTPS was generally down, or whether the failure was specific to Node/curl transport on this machine.
- Environment fact on the maintainer machine:
  - Node HTTPS to `api.telegram.org` times out, while PowerShell reaches the same Bot API endpoint successfully with the same token.
- Interpretation:
  - Telegram Desktop working on the same host does not prove Bot API HTTPS reachability because it uses MTProto, not the Bot API over HTTPS;
  - in this case the product now has enough evidence to say the failure is specific to the Node/curl transport path rather than a bad token or a general Telegram outage.

### Codex websocket `403`

- Classification: legitimate environment warning plus product wording/dedupe bug.
- Environment fact:
  - Codex websocket startup fails with `403 Forbidden`.
- Product bug:
  - the old warning text did not say that the CLI fell back to HTTP and still completed the smoke request;
  - installer post-check output repeated the same warning set across setup/doctor/verify without compression.

### Mini App `3001`

- Classification: legitimate environment warning.
- Environment fact:
  - port `3001` is occupied by a non-HappyTG `Contacts` frontend container.
- Product behavior after the fix:
  - the warning remains, but stays scoped to a concrete conflict with concrete override guidance.

## Code Changes

- `packages/bootstrap/src/install/telegram.ts`
  - added a Windows PowerShell Bot API follow-up probe for Node-side Telegram network failures;
  - reclassified follow-up `401`/`404` responses back to invalid-token failures;
  - enriched warning text for Node transport-specific Bot API timeouts;
  - preserved a validated bot username from the follow-up probe for pairing guidance.
- `packages/bootstrap/src/install/index.ts`
  - compressed repeated post-check warning sets after the first identical setup/doctor/verify result;
  - semantically deduplicated overlapping final next steps for `pnpm dev`, pairing, and daemon start.
- `packages/runtime-adapters/src/index.ts`
  - updated Codex smoke warning summaries to say when websocket `403` fell back to HTTP.
- Release metadata:
  - bumped all workspace package versions to `0.3.9`;
  - added changelog entry and `docs/releases/0.3.9.md`.

## Acceptance Criteria Mapping

1. Telegram diagnostics:
   - satisfied by `raw/telegram-probe.txt`, `raw/telegram-probe-followup.txt`, and the fresh installer output in `raw/install-json.txt`.
   - Fresh installer warning now states that Node HTTPS timed out but a PowerShell Bot API probe validated `@gerta_workbot`, explicitly separating Node transport failure from invalid token and from general Telegram reachability.
2. Codex warnings:
   - satisfied by fresh `raw/doctor-json.txt`, `raw/setup-json.txt`, `raw/verify-json.txt`, and `raw/install-json.txt`.
   - Warning now says the websocket `403` fell back to HTTP.
   - Installer step details for repeated post-checks are compressed after the first warning set.
3. Summary / next steps quality:
   - satisfied by fresh `raw/install-json.txt`.
   - Final `nextSteps` now contain one `pnpm dev`, one `pnpm daemon:pair`, and one `/pair` instruction.
4. Mini App port `3001`:
   - satisfied by fresh `raw/doctor-json.txt`, `raw/setup-json.txt`, and `raw/verify-json.txt`.
   - Real conflict remains visible and actionable.
5. Regression coverage:
   - satisfied by `raw/test-unit.txt` and `raw/test-integration.txt`.
   - Added tests for Telegram PowerShell follow-up success, invalid-token follow-up promotion, Codex fallback wording, and semantic installer dedupe.
6. Fresh verifier pass and publish readiness:
   - metadata bumped to `0.3.9`;
   - `raw/release-check.txt` passes;
   - independent verifier agent `019d9a81-78fa-7880-a628-e77b6ea38783` passed the frozen scope after `task.json` backfill and final bundle validation;
   - publish actions are now unblocked.

## Residual Real Warnings

- Direct `setup` / `doctor` / `verify` still warn about:
  - Codex websocket `403`, now explicitly marked as HTTP-fallback warning;
  - Mini App port `3001` conflict with `contacts-frontend`.
- Installer still warns about Telegram on this machine because the Node transport to Bot API times out, even though PowerShell validates the bot.
- Separate proof artifact `raw/install-draft-invalid-json.txt` captures the distinct invalid-token classification path when a saved draft token is bad.
