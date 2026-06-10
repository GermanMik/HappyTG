# Evidence

## Checks

- PASS `pnpm --filter @happytg/miniapp typecheck`
- PASS `pnpm --filter @happytg/miniapp test`
- PASS `pnpm --filter @happytg/miniapp build`
- PASS `pnpm typecheck`
- PASS `pnpm lint`
- PASS `pnpm test`
- PASS `pnpm build`
- PASS `pnpm release:check --version 0.4.17`
- PASS `pnpm happytg task validate --repo . --task HTG-2026-06-10-miniapp-session-ui`
- PASS browser smoke against fixture API on `127.0.0.1:3310` with mobile viewport `390x844`
- PASS `graphify update apps/miniapp/src`
- PASS `graphify query "Mini App result-first session UI task question intent rendering Desktop continuation sorting" --budget 1200`
- ENV-BLOCKED `pnpm happytg doctor` returned process exit 0 but HappyTG report `FAIL` because this clean worktree has no `.env` / `TELEGRAM_BOT_TOKEN` and ports `3001`, `443`, `3000` are occupied.
- ENV-BLOCKED `pnpm happytg verify` returned process exit 0 with the same local environment blockers.

## Evidence Files

- `raw/typecheck.txt`
- `raw/test.txt`
- `raw/build.txt`
- `raw/root-typecheck.txt`
- `raw/lint.txt`
- `raw/root-test.txt`
- `raw/root-build.txt`
- `raw/release-check.txt`
- `raw/doctor.txt`
- `raw/verify.txt`
- `raw/task-validate.txt`
- `raw/browser-smoke.json`
- `raw/browser-smoke-home.html`
- `raw/browser-smoke-new-task.html`
- `raw/browser-smoke-home.png`
- `raw/browser-smoke-new-task.png`
- `raw/graphify-update.txt`
- `raw/graphify-query.txt`

## 10-Role Critical Review Result

1. Telegram Bot Operator: PASS. Bot contracts were not changed; Mini App now carries the detailed inspection and task/question entry load.
2. Mini App Mobile User: PASS. First mobile screen shows `Работа по проектам`, recent result, and direct `Новая задача` / `Задать вопрос` actions; browser smoke confirms this at `390x844`.
3. First-Time User: PASS. New task form exposes intent choices and hides runtime/project/mode details behind `Настройки`, reducing first-run choices.
4. Daily Power User: PASS. Codex panel keeps search and direct task/question actions first; sort/state/source filters stay available but secondary.
5. Accessibility Reviewer: PASS. Labels, native radio/select/details controls, and button semantics are preserved; no icon-only hidden commands were introduced.
6. Telegram Platform Specialist: PASS. No Telegram callback payload, HTTPS launch, or chat transport contract was changed; detail stays in Mini App.
7. Control-Plane Safety Engineer: PASS. Policy, approval, queueing, and runtime adapter semantics were not changed; unsupported Desktop actions remain disabled/truthful.
8. Information Architect: PASS. Session result, next action, technical details, counters, projects, and history now have clearer progressive disclosure boundaries.
9. Visual Product Designer: PASS. UI is denser and calmer; long paths and technical metadata no longer dominate the primary scan path.
10. QA / Release Verifier: PASS with noted environment blockers. Code gates, task validation, browser smoke, Graphify evidence, and release metadata passed; `doctor/verify` are blocked only by local `.env`/ports.

## Release Evidence

- Version metadata bumped from published `0.4.16` to `0.4.17` across 16 workspace `package.json` files.
- Added `CHANGELOG.md` section `v0.4.17`.
- Added `docs/releases/0.4.17.md`.
- `pnpm release:check --version 0.4.17` passed.
