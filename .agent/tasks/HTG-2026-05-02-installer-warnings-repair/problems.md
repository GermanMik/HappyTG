# Problems

## Fixed

- Public HappyTG `/miniapp` returned HTTP 200 from the wrong route and failed HappyTG identity validation.

Root cause: BaseDeploy live Caddy config did not contain HappyTG site blocks, and the `https://:8443` catch-all served HealthOS.

Fix: restore HappyTG-specific Caddy routes and path overrides while preserving HealthOS fallback.

## Resolved By Operator

- `HappyTG Host Daemon` Scheduled Task was deleted from an elevated/operator context. A follow-up query returned `ERROR: The system cannot find the file specified.`

## Not Fixed Locally

- Codex websocket 403 remains a Codex/ChatGPT network-auth warning. The CLI fallback completes, so HappyTG verification remains usable.
