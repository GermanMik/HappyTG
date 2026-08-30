# Task Spec: HTG-2026-08-30-miniapp-cpu-optimization

## Metadata
- Task ID: HTG-2026-08-30-miniapp-cpu-optimization
- Created: 2026-08-30T09:42:29+00:00
- Repo root: C:\Develop\Projects\HappyTG
- Working directory at init: C:\Develop\Projects\HappyTG

## Guidance sources
- AGENTS.md

## Original task statement
Optimize HappyTG Telegram Mini App CPU usage: remove expensive sticky backdrop blur on Telegram/mobile, reduce the initial broad Codex Desktop session list, add browser rendering containment/lazy rendering for long session cards, preserve existing project-specific five-card cap and explicit load-more behavior, add focused tests, and verify with automated and real browser evidence. Do not commit, push, merge, release, or deploy.

## Acceptance criteria
- AC1: The Telegram/mobile sticky top bar no longer uses `backdrop-filter` blur and keeps a readable opaque background.
- AC2: Broad Codex Desktop session views request 20 sessions by default, while project-filtered views continue to request 100 sessions and render at most five matching project sessions.
- AC3: The broad Desktop session list retains an explicit staged load-more path from 20 to 50, then 100 and 200 sessions; explicit limits remain bounded to 20..200.
- AC4: Session cards use browser-native off-screen rendering containment (`content-visibility` with an intrinsic-size fallback) without hiding their content or controls.
- AC5: Focused Mini App unit tests cover the CSS performance guards, default/staged session limits, and preserved project cap; Mini App typecheck, lint, test, build, `git diff --check`, and a real-browser DOM/style smoke all pass.

## Constraints
- Preserve the existing server-rendered TypeScript Mini App architecture.
- Preserve authentication, approval, policy, control-plane, and serialized mutation contracts.
- Keep project-filtered Desktop session behavior strict and capped at five visible cards.
- Make only scoped, reviewable changes; do not commit, push, merge, release, deploy, or restart production services.
- Treat the existing Docker deployment as a baseline only; runtime proof of the changed checkout must use an isolated local listener.

## Non-goals
- Replacing SSR with React or another frontend framework.
- Adding SSE, WebSocket, or new polling behavior.
- Changing API response contracts or Codex Desktop adapter behavior.
- Claiming an exact Telegram renderer flamegraph without Telegram WebView DevTools.

## Verification plan
- Build: `pnpm --filter @happytg/miniapp build`
- Unit tests: `pnpm --filter @happytg/miniapp test`
- Integration tests: focused HTTP route smoke from the Mini App test suite and isolated local browser smoke against the changed checkout.
- Lint: `pnpm --filter @happytg/miniapp lint` and `pnpm --filter @happytg/miniapp typecheck`
- Manual checks: inspect rendered CSS and `/codex?source=codex-desktop&userId=usr_1` DOM for no sticky blur, 20-session default fetch, staged load-more link, and session-card containment; compare DOM size with the recorded 50-session baseline.

## Assumptions
- The user-approved “ДАВАЙ” refers to implementing the three proposed code optimizations and verifying them, not to Git publication or deployment.
- A default of 20 sessions is the narrow end of the proposed 20–25 range and gives the strongest initial DOM reduction while retaining explicit expansion.
