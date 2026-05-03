# HTG-2026-05-03 Codex Vision History Complete Spec

Status: frozen before production-code changes.
Branch: `codex/happytg-codex-vision-history-complete`

## Goal

Complete the remaining HappyTG Codex "vision" gap after `0.4.10`: safe, source-aware browsing of Codex Desktop and Codex CLI details, history, and transcript-like timelines without weakening the established Desktop control safety decision.

## Non-Goals

- Do not enable Codex Desktop Resume, Stop, or New Task unless a stable non-experimental mutating contract is proven.
- Do not implement Desktop Stop via process kill, window control, lock-file deletion, or direct mutation of Codex Desktop internal files.
- Do not expose raw secrets, auth tokens, or unbounded local transcript payloads.
- Do not use Telegram as an internal transport for agent events.
- Do not weaken policy ordering or higher-level policy precedence.

## Scope

### Sources

- `codex-cli`
- `codex-desktop`

### Surfaces

- Backend API
- Telegram Bot
- Mini App
- Tests and proof bundle

### Capabilities

| Source | Capability | Expected |
| --- | --- | --- |
| codex-cli | list sessions/tasks/status/details/history | supported through existing HappyTG store projections |
| codex-cli | transcript/timeline detail | supported through existing session timeline/task artifacts where available |
| codex-desktop | list projects/sessions/status/details | supported through sanitized read-only projection |
| codex-desktop | history/transcript preview | supported as bounded, sanitized read-only timeline extracted from local Desktop JSONL records |
| codex-desktop | full raw transcript export | unsupported/degraded unless explicitly sanitized and bounded |
| codex-desktop | resume/stop/new task | unsupported by default with `CODEX_DESKTOP_CONTROL_UNSUPPORTED` |

## Acceptance Criteria

- Backend API exposes a source-aware Desktop session detail/history endpoint or extends the existing endpoint without ambiguous CLI/Desktop mixing.
- Desktop history entries are bounded, sanitized, and read-only.
- Mini App Desktop session detail shows a useful bounded history/timeline when available and keeps unsupported controls disabled.
- Telegram Desktop detail can mention history availability and point to Mini App for deeper inspection without dumping raw transcripts into chat.
- Existing CLI session detail/timeline behavior remains source-aware and unchanged or improved.
- Tests cover Desktop history extraction, sanitization, API payload, and Mini App rendering.
- Required checks are captured in `raw/`: lint, typecheck, test-unit, test-integration, doctor, verify, and task validate.
- Final `verdict.json` records pass/fail, evidence, and residual risks.

## Evidence Required

- Code map and gap analysis in `evidence.md`.
- Raw verification outputs in `raw/`.
- Fresh verifier review before completion.

