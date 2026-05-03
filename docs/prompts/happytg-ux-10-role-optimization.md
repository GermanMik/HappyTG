# HappyTG UX 10-Role Optimization Prompt

Use this prompt to run a comprehensive, proof-backed HappyTG usability and design pass. The goal is to make HappyTG maximally simple and convenient in both the Telegram Mini App and the Telegram Bot without weakening runtime, policy, approval, or release safety.

## Baseline 10-Role Opinion Model

This prompt is grounded in these starting role opinions:

1. Telegram Bot Operator: the bot should stay quiet, short, and button-driven; push detail into Mini App.
2. Mini App Mobile User: first screen must show what needs attention and the next action without horizontal scanning.
3. First-Time User: pairing, host, repo, and task mode must be explained through one-step recovery copy.
4. Daily Power User: repeated task launch and active-session triage should avoid redundant choices when safe defaults exist.
5. Accessibility Reviewer: controls need clear labels, readable hierarchy, large touch targets, and low cognitive load.
6. Telegram Platform Specialist: callback payloads, WebApp HTTPS launch, and chat length/noise limits must shape the design.
7. Control-Plane Safety Engineer: UX must never hide policy, approval, audit, source/runtime, or unsupported-action truth.
8. Information Architect: objects must stay consistent: host, repo, session, task, approval, report, evidence.
9. Visual Product Designer: operational density should be calm and scannable, with clear status badges and restrained styling.
10. QA / Release Verifier: every design change needs tests, raw evidence, fresh verifier review, and release-safe metadata.

## Prompt

You are working in the HappyTG repository.

Primary objective: optimize the product design and day-to-day usability so an operator can understand current state, launch work, approve risk, inspect evidence, recover from failures, and continue sessions with the fewest safe steps in both:

- Telegram Mini App
- Telegram Bot

Do not stop at an audit unless implementation would be unsafe or impossible. Audit, synthesize, implement the smallest high-impact changes, verify, document evidence, and release.

## Mandatory Start

Follow `AGENTS.md` first:

```bash
memory context --project
memory search "HappyTG Mini App Bot UX usability design approvals sessions Telegram"
memory details <relevant-memory-id>
```

Create a proof bundle before changing code:

```text
.agent/tasks/<TASK_ID>/
  spec.md
  evidence.md
  evidence.json
  verdict.json
  problems.md
  raw/
```

Freeze `spec.md` before any production-code edits. Work on a separate `codex/...` branch.

## Non-Negotiable Invariants

- Telegram is not the internal transport for agent events.
- Mutating host operations must go through a strict serialized queue.
- Policy evaluation must happen before approval evaluation.
- Higher-level policy cannot be weakened by lower-level overrides.
- Heavy runtime initialization must stay lazy and cache-aware.
- Desktop/CLI runtime source discrimination must stay explicit wherever Codex flows appear.
- Unsupported actions must never look successful.
- Do not expose secrets, raw tokens, long logs, raw transcript dumps, or unbounded artifacts in Telegram chat.
- Keep Mini App public/reverse-proxy auth behavior intact.

## 10 Independent Roles

Before deciding what to change, produce one short, independent assessment from each role. Do not merge the roles into generic agreement. Each role must list:

- top 3 user problems,
- top 3 proposed changes,
- biggest risk of over-design,
- evidence they need before accepting the change.

Roles:

1. Telegram Bot Operator
   - Optimizes for concise chat, fast commands, low notification noise, and clear recovery.
2. Mini App Mobile User
   - Optimizes for thumb reach, scan speed, mobile WebView constraints, and first-screen clarity.
3. First-Time User
   - Optimizes pairing, first task launch, terminology, and onboarding clarity.
4. Daily Power User
   - Optimizes repeated task launch, active-session triage, approvals, and shortcuts.
5. Accessibility Reviewer
   - Optimizes labels, focus order, contrast, target size, reduced cognitive load, and readable microcopy.
6. Telegram Platform Specialist
   - Optimizes callback limits, WebApp launch constraints, public HTTPS requirements, bot message length, and chat anti-spam behavior.
7. Control-Plane Safety Engineer
   - Protects policy ordering, serialized mutations, audit trail, unsupported action honesty, and source/runtime discriminators.
8. Information Architect
   - Optimizes navigation, object names, hierarchy, cross-links, empty states, and progressive disclosure.
9. Visual Product Designer
   - Optimizes density, layout rhythm, status badges, action hierarchy, forms, and calm operational styling.
10. QA / Release Verifier
   - Optimizes testability, proof evidence, regressions, CI stability, and release readiness.

After role assessments, create a synthesis table:

```text
Finding | Roles supporting | User impact | Risk | Implementation scope | Test/evidence
```

Only implement changes that have clear user impact, bounded scope, and test/evidence coverage.

## Required Audit Surfaces

Mini App:

- Home/dashboard
- Sessions list
- Session detail
- Codex Desktop / CLI panel
- New task flow
- Projects
- Approvals
- Hosts
- Reports
- Diff / Verify / Task proof bundle views
- Auth pending, expired launch, denied access, empty states, error states

Telegram Bot:

- `/start`, `/menu`, unknown command handling
- New task wizard
- Host/repo/mode/prompt confirmation flow
- Active sessions list and session cards
- Approval prompts and callbacks
- Codex Desktop / CLI menus
- Mini App deep-link buttons
- Error/recovery messages
- Anti-noise behavior for long-running work

Backend/API contracts to inspect only as needed:

- Mini App projections
- Bot projection endpoints
- Session create/resume/cancel
- Approval resolve
- Codex Desktop/CLI source-aware endpoints
- Audit and policy/approval code paths when UI changes touch action semantics

## Design Targets

Make the product feel like an operational control tool, not a marketing page.

Prioritize:

- decision-first status summaries,
- one obvious next action per screen/card,
- fewer ambiguous buttons,
- consistent source/runtime labeling,
- short Russian microcopy where the UI already uses Russian,
- no raw logs on first view,
- deep inspection in Mini App instead of chat,
- disabled states with reason codes when actions are unsupported,
- recoverable empty/error states,
- mobile-first layout and touch targets,
- bot messages that answer: what happened, what needs attention, what to press next.

Avoid:

- decorative hero sections,
- nested cards,
- one-note palettes,
- raw system internals in user-facing copy,
- long Telegram messages,
- fake success / no-op success,
- changes that require undocumented external contracts.

## Implementation Rules

1. Start with repo evidence.
   - Read `docs/architecture/miniapp-rich-ux.md`.
   - Read `docs/architecture/bot-first-ux.md`.
   - Read `docs/telegram-ux.md`.
   - Read current Mini App and Bot tests before editing.

2. Freeze the scope.
   - Write a clear `spec.md` with target screens, non-goals, acceptance criteria, and evidence requirements.
   - Include the 10-role findings and synthesis in `evidence.md`.

3. Implement minimal high-impact changes.
   - Prefer improving existing components and projections over creating new architecture.
   - Keep Mini App and Bot consistent but not identical: Bot stays concise, Mini App handles detail.
   - Preserve all existing callback/API contracts unless a change is explicitly justified and tested.
   - Add tests for changed UI text, buttons, disabled states, source/runtime labels, and error/recovery states.

4. Verify visually when UI changes are substantial.
   - Start the relevant local dev server if needed.
   - Use browser automation/screenshots for Mini App paths when layout or interaction changes are meaningful.
   - For Bot, verify rendered message text and inline keyboard payloads in tests.

5. Capture proof.
   - Save raw outputs under `.agent/tasks/<TASK_ID>/raw/`.
   - Update `evidence.md`, `evidence.json`, `problems.md`, and `verdict.json`.

## Required Commands

Run and capture when available:

```bash
pnpm build
pnpm lint
pnpm typecheck
pnpm test
pnpm happytg doctor
pnpm happytg verify
pnpm happytg task validate --repo . --task <TASK_ID>
```

If preparing a release:

```bash
pnpm release:check --version <VERSION>
```

If any command cannot run, record the exact reason and residual risk.

## Fresh Verifier

Run a fresh verifier pass after implementation and before merge. The verifier must not edit production code. It must inspect:

- frozen spec,
- 10 role findings,
- synthesis table,
- implementation diff,
- tests,
- raw command outputs,
- `evidence.md`,
- `evidence.json`,
- `problems.md`,
- `verdict.json`,
- release metadata if changed.

Verifier verdict must be PASS/FAIL with blocking findings first.

## Branch, PR, Merge, Release

At completion:

1. Check whether the branch is still needed.
2. If changes are needed, finish them, verify them, push, open PR, wait for CI, merge, and delete local/remote task branch.
3. If the work is already in `main` or the branch is unnecessary, delete local/remote branch without touching unrelated dirty worktree changes.
4. If the user requested a release:
   - bump version only if the previous version is already published,
   - update every workspace `package.json`,
   - update `CHANGELOG.md`,
   - add `docs/releases/<VERSION>.md`,
   - run `pnpm release:check --version <VERSION>`,
   - publish the GitHub Release after merge.
5. Save EchoVault memory before final response.

## Final Response Shape

Keep it short:

- what changed,
- what remains unsupported or deferred,
- checks that passed,
- proof bundle path,
- PR/merge/release state.
