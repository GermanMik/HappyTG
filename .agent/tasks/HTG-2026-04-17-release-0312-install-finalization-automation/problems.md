# Verification Findings

## Final Status

- No open verifier findings remain.

## Resolved During Verification

- Initial verifier pass found bundle-coherence issues, not product-code regressions:
  - stale `0.3.11` captures remained in the `*-after.txt` artifacts
  - `task.json`, `verdict.json`, and `problems.md` still reflected an unverified task
- Those issues were fixed by refreshing the verification captures on the `0.3.12` tree, updating the task-state files, and rerunning fresh verification.
- The first GitHub release workflow run then exposed one Linux-only test assumption in `packages/bootstrap/src/index.test.ts`; it was fixed by comparing the suggested MinIO API port against its own occupied port instead of assuming an ordering relative to the MinIO console listener.

## Residual Risks

- Remaining risks are environment-dependent and intentionally still visible in the evidence:
  - Telegram pairing remains blocked on this maintainer machine because the configured bot token fails with `401`
  - Codex still shows the websocket `403` fallback warning before switching to HTTP
  - Mini App port `3001` is occupied by `contacts-frontend`
