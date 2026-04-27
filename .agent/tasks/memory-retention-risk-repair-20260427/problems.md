# memory-retention-risk-repair-20260427 Problems

## Open At Spec Freeze

- H1: child-process timeout can retain a hung Codex process forever.
- M1: child-process stdout/stderr buffered without caps.
- M2: expired/terminal control-plane records retained indefinitely.
- M3: `FileStateStore` serialized queue can retain pending callers behind async filesystem work.
- L1: Telegram wizard drafts expire only on same-user access.
- L2: Mini App auth retry can create overlapping bounded timeout chains.

## Residual Risks

## Fixed / Reduced

- H1 fixed for `runCodexExec`: timeout now resolves deterministically after normal termination plus a grace period, with Windows process-tree force kill when needed.
- M1 reduced for `runCodexExec`: stdout/stderr retained in memory are capped and exposed with byte/truncation metadata. Runtime proof artifacts now receive bounded output instead of unlimited strings.
- M2 fixed for worker-maintained control-plane records: expired Mini App launch grants, expired/revoked Mini App sessions, stale host registrations, terminal approvals, and terminal dispatches are compacted with active-record guards.
- M3 fixed for API proof-bundle filesystem paths found in the audit: task init, task approval recording, and task phase persistence no longer execute inside the serialized store update critical section.
- L1 fixed: Telegram wizard drafts are swept on existing message/callback lifecycle paths.
- L2 fixed: Mini App initData retry polling is guarded by a single pending timer id.

## Residual Risks

- M1 is not fully eliminated across every bootstrap and Telegram helper in the repository. `packages/bootstrap/src/index.ts`, `packages/bootstrap/src/install/commands.ts`, and Telegram PowerShell fallback helpers still use local stdout/stderr strings. They are outside the primary `runCodexExec` daemon path fixed here; widening them should use the new bounded runner pattern in a follow-up to avoid mixing installer behavior changes into this repair.
- The dynamic memory smoke is lightweight and process-local. It verifies the repaired child/output and compaction scenarios but is not a full long-running service soak.
- `pnpm happytg verify` remains WARN due to environment/service issues: Codex websocket 403 fallback to HTTP, public Caddy Mini App route identity mismatch, and pairing/daemon flow not completed even though local services are already running.
