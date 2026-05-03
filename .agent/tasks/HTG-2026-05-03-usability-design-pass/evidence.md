# HTG-2026-05-03 Usability Design Pass Evidence

## 10 Independent Role Assessments

### Telegram Bot Operator

- Top problems: `/menu` reports counts but not the next safe press; session lists do not surface why an item needs attention; chat can become a decision surface when details should move to Mini App.
- Proposed changes: add one `Следующее:` line; show short session attention hints; keep detail buttons pointed at Mini App.
- Over-design risk: turning chat into a dashboard.
- Acceptance evidence: bot handler tests for concise menu/session text and keyboard payloads.

### Mini App Mobile User

- Top problems: dashboard hero actions appear before the urgent item; session cards expose internal-ish labels such as `open`; mobile scanning depends on reading secondary sections.
- Proposed changes: put the top attention item in the first viewport; localize action labels; preserve large touch targets.
- Over-design risk: adding another dense dashboard layer.
- Acceptance evidence: Mini App HTML tests for priority action and localized card labels.

### First-Time User

- Top problems: pairing and no-host states require remembering host/repo concepts; auth pending can be opened outside Telegram; no-project flow needs one recovery step.
- Proposed changes: keep one-step recovery copy; link no-project/no-host states to hosts; avoid new terminology.
- Over-design risk: onboarding prose that pushes work below the fold.
- Acceptance evidence: existing first-use/auth tests remain green.

### Daily Power User

- Top problems: repeated launch still presents choices, but safe defaults exist; active sessions list lacks triage hints; Desktop/CLI source switching must stay explicit.
- Proposed changes: emphasize next action and attention flags; keep current smart defaults; keep source labels visible.
- Over-design risk: adding shortcuts that bypass approval/policy truth.
- Acceptance evidence: bot and Mini App tests for next action and source labels.

### Accessibility Reviewer

- Top problems: controls need clearer labels; disabled/unsupported controls must have reason text; card hierarchy needs concise headings.
- Proposed changes: user-facing button labels; clear notices for unsupported Desktop actions; maintain 46px+ targets.
- Over-design risk: too many badges competing with the primary action.
- Acceptance evidence: rendered HTML assertions for button text and visible reason codes where present.

### Telegram Platform Specialist

- Top problems: callback payloads must stay short; WebApp buttons require public HTTPS; chat length/noise must remain bounded.
- Proposed changes: no callback contract changes; keep Mini App buttons gated; move diff/verify detail to Mini App.
- Over-design risk: adding payload data into callbacks.
- Acceptance evidence: existing callback/web_app tests remain green.

### Control-Plane Safety Engineer

- Top problems: UX can imply success for unsupported Desktop actions; broad approvals must remain explicit; policy-before-approval ordering must not move.
- Proposed changes: add session-scope approval only as an explicit user button; preserve nonce; keep unsupported reason visible.
- Over-design risk: convenience buttons that hide risk scope.
- Acceptance evidence: Mini App approval test checks scope/nonce; no backend policy path edits.

### Information Architect

- Top problems: objects are mixed across `Codex`, `sessions`, `reports`; action tokens are inconsistent; evidence/report navigation is not always obvious.
- Proposed changes: consistent user labels for session next action; keep host/repo/session/task/approval/report naming; top attention cross-links.
- Over-design risk: navigation sprawl.
- Acceptance evidence: HTML tests for links and labels.

### Visual Product Designer

- Top problems: first screen should feel operational, not decorative; status badges must serve scanning; styling should remain calm and restrained.
- Proposed changes: decision-first hero; concise cards; preserve current restrained palette while avoiding extra decoration.
- Over-design risk: a marketing-like hero or nested cards.
- Acceptance evidence: code inspection and Mini App render tests.

### QA / Release Verifier

- Top problems: design changes can regress string-dependent tests; raw evidence must be captured; verifier must be separate and read-only.
- Proposed changes: focused unit tests; full standard command capture; fresh verifier pass after implementation.
- Over-design risk: wide refactor with insufficient evidence.
- Acceptance evidence: raw outputs, verdict, and task validation.

## Synthesis Table

| Finding | Roles supporting | User impact | Risk | Implementation scope | Test/evidence |
| --- | --- | --- | --- | --- | --- |
| Dashboard hides the urgent next action below generic launch buttons. | Bot Operator, Mini App Mobile User, IA, Visual Designer | Faster first-screen triage. | Medium if it duplicates detail. | Render top attention strip in dashboard hero. | Mini App HTML test. |
| Session cards expose raw/internal action tokens. | Mini App Mobile User, Accessibility, Daily Power User, IA | Less cognitive load on mobile. | Low. | Add label mapping and localized attention copy. | Mini App HTML test. |
| Mini App approval lacks session-scope action that Bot already exposes. | Control-Plane Safety, Daily Power User, Accessibility | Fewer round trips for trusted session work. | Medium due broader scope; mitigated by explicit button, nonce, backend policy. | Add session-scope button only. | Mini App approval test. |
| Bot menu gives counts but not the next safe press. | Bot Operator, First-Time User, Daily Power User | Faster button choice, less chat. | Low. | Add one concise next-action line. | Bot handler test. |
| Bot active sessions list omits attention hint. | Bot Operator, Daily Power User, QA | Better triage without opening every card. | Low. | Add one short per-session attention phrase. | Bot handler test. |

## Implementation Notes

- Mini App dashboard now renders a first-viewport `Следующее действие` notice before generic actions. It uses existing dashboard attention projections and falls back to a calm no-attention state.
- Mini App session cards map `nextAction` and `attention` tokens into user-facing labels while keeping `Codex CLI` / `Codex Desktop` source labels explicit.
- Mini App approval detail now exposes `Разрешить на сессию` with `data-scope="session"` through the existing authenticated, nonce-aware Mini App approval resolve path.
- Mini App visual style was restrained by removing decorative radial backgrounds and normalizing cards/buttons/forms to 8px radius.
- Mini App now returns 204 for `/favicon.ico` so browser visual checks do not report a false 404 console error.
- Telegram Bot `/menu` adds one concise `Следующее:` line, and `/sessions` adds a short Russian attention hint for sessions that need approval, verify, or unblock work.
- No API callback contract, backend policy path, approval-engine path, serialized queue path, or Codex Desktop adapter semantics were changed.

## Verification

- `pnpm build`: PASS, raw output in `raw/build.txt`.
- `pnpm lint`: PASS, raw output in `raw/lint.txt`.
- `pnpm typecheck`: PASS, raw output in `raw/typecheck.txt`.
- `pnpm test`: PASS, raw output in `raw/test-unit.txt`.
- `pnpm --filter @happytg/miniapp test`: PASS after favicon/visual-cleanup fix, raw output in `raw/test-miniapp-focused.txt`.
- `pnpm --filter @happytg/bot test`: PASS after Russian attention-copy fix, raw output in `raw/test-bot-focused.txt`.
- `pnpm happytg doctor`: exit 0 with WARN, raw output in `raw/doctor.txt`. Residual warning is Codex Responses websocket 403 fallback to HTTP plus already-running services.
- `pnpm happytg verify`: exit 0 with WARN, raw output in `raw/happytg-verify.txt`. Same residual warning as doctor.
- `pnpm happytg task validate --repo . --task HTG-2026-05-03-usability-design-pass`: PASS, raw output in `raw/task-validate.txt`.
- Browser render check: local Mini App on port 3107 rendered the updated dashboard with `Следующее действие`; console had 0 errors and 0 warnings after adding the favicon route. Snapshot, console output, and screenshot are under `raw/browser-snapshot-current.txt`, `raw/browser-console.txt`, and `raw/screenshots/miniapp-home.png`.
- `raw/test-integration.txt` records that there is no separate integration command; repo-level `pnpm test` includes API, bot, Mini App, bootstrap, runtime-adapter, and control-plane integration-style tests.

## Fresh Verifier

- First fresh verifier pass: FAIL on proof metadata only. It found no implementation or invariant blockers, but `evidence.md`, `evidence.json`, and `verdict.json` still said pending.
- Minimal fix after first verifier: completed proof metadata and changed bot session attention hints from internal-ish English labels to Russian operator copy.
- Final fresh verifier pass: PASS. Blocking findings: none.
- Final verifier notes: proof metadata blocker fixed; `task-validate.txt` reports `Validation: ok` while phase/verification are unknown because this proof bundle is manually maintained; doctor/verify WARNs are the existing Codex websocket fallback and running-service reuse guidance.
