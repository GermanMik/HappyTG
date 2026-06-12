# Evidence

Task: `HTG-2026-06-12-miniapp-past-sessions-visibility`

## Finding

The Mini App general Codex Desktop list rendered `50` sessions, but project-filtered views could show zero visible sessions because filtering happened after the first bounded Desktop session fetch.

Live evidence showed the API had Desktop sessions for the paired user. The first `50` Desktop sessions included many sessions without `projectPath`; strict project filtering hid those sessions. Raising the project view directly to `200` exceeded the Mini App `6000ms` fallback timeout, so the initial project view must stay below that latency.

## Change

- Project-filtered Codex Desktop views now request `limit=100`.
- Explicit `limit` query values are clamped from `50` to `200`.
- `limit > 100` Desktop fetches receive a `10000ms` timeout budget for explicit "show more" requests.
- Project-filtered views include unscoped Desktop sessions when Codex Desktop omitted `projectPath`, with a visible explanatory note.
- Added a regression test that verifies `limit=100`, unscoped session visibility, and the `Показать до 200 Desktop sessions` action.

## Validation

| Command | Raw output | Status |
| --- | --- | --- |
| `pnpm --filter @happytg/miniapp test` | `raw/test-miniapp.txt` | PASS |
| `pnpm --filter @happytg/miniapp typecheck` | `raw/typecheck-miniapp.txt` | PASS |
| `pnpm --filter @happytg/miniapp lint` | `raw/lint-miniapp.txt` | PASS |
| `pnpm --filter @happytg/miniapp build` | `raw/build-miniapp.txt` | PASS |
| `git diff --check` | `raw/diff-check.txt` | PASS |
| Live Desktop session latency probe | `raw/live-desktop-session-limits.json` | PASS |
| Live local/public project-route smoke | `raw/live-project-route-smoke.json` | PASS |
| `graphify query "Mini App past sessions not showing Codex Desktop sessions list filters" --budget 1200` | `raw/graphify-query-past-sessions.txt` | PASS |

## Fresh Verifier

- Verdict: PASS.
- Blocking findings: none.

## Residual Risk

Desktop sessions older than the bounded `200` window still need explicit server-side pagination/search. This release restores visibility for the current project screen without reintroducing an 8s initial load.
