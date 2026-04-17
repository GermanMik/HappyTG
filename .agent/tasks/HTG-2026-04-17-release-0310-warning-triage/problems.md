# Verification Findings

## Findings

- No findings.

## Summary

Fresh verifier reruns after the minimal follow-up fix in `packages/bootstrap/src/index.ts` found the shared onboarding contradiction resolved across `pnpm happytg setup --json`, `pnpm happytg doctor --json`, and `pnpm happytg verify --json`: none of those surfaces now emit both `Start repo services: \`pnpm dev\`.` and `Some HappyTG services are already running. Reuse the current stack or stop it before starting another copy.` in the same output.

The remaining warnings are truthful environment signals, not product regressions. Current local reruns still show Node `UND_ERR_CONNECT_TIMEOUT` plus a PowerShell `401 Unauthorized` follow-up for Telegram, and the installer now classifies that state as `invalid_token` while preserving the earlier warning-only transport split in the proof artifacts and regression coverage. Codex websocket `403 Forbidden` remains a warn-only condition with HTTP fallback, and Mini App port `3001` remains a real external conflict with Docker container `contacts-frontend`.
