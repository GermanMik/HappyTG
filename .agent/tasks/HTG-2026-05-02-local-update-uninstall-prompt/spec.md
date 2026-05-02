# HTG-2026-05-02-local-update-uninstall-prompt

- Task ID: HTG-2026-05-02-local-update-uninstall-prompt
- Title: Local update and uninstall prompt package
- Owner: HappyTG
- Mode: proof
- Status: frozen

## Problem

HappyTG has several legitimate installation shapes: one-command installer, existing local checkout, Docker Compose control plane, reused system services, self-hosted control plane, and execution-host daemon installs. Users need a simple, safe, repeatable prompt and documentation path for day-2 local updates and local uninstall that does not confuse repo updates, runtime restarts, Docker state, `.env`, daemon state, or release artifacts.

The user also requested release/APK output. The current HappyTG repository is a TypeScript monorepo with Telegram Mini App surfaces and no Android/Gradle/Capacitor project. This task must treat APK creation as a gated requirement: prove whether an APK build surface exists, and do not fabricate a phone-installable APK when the repository cannot build one.

## Acceptance Criteria

1. Add a reusable prompt artifact under `.agent/prompts/` for a future agent to implement or audit easy local update and uninstall UX.
2. The prompt explicitly covers installer shim, repo-local current checkout, existing checkout update mode, Docker isolated stack, Docker reused services, self-hosted control plane, and execution-host daemon cleanup.
3. The prompt includes critical review from 10 independent roles and turns their concerns into concrete requirements.
4. User-facing documentation is updated consistently across the primary places where users look for update/uninstall guidance.
5. Release metadata is aligned for a `0.4.9` documentation/prompt release if the branch is needed.
6. Evidence records the branch isolation, docs touched, verification commands, and APK support check.
7. The final verdict truthfully states whether a phone APK was produced or blocked by missing Android packaging support.

## Constraints

- Work in an isolated branch/worktree and do not touch the dirty primary checkout.
- Do not change installer/runtime behavior unless documentation reveals a concrete code bug.
- Preserve existing uninstall safety: keep repo checkout, `.env`, Docker services/volumes, and remote data unless the operator separately stops/removes them.
- Do not include secrets, real bot tokens, or credentials in docs, prompt, evidence, or memory.
- Do not publish a fake APK or repurpose unrelated artifacts as an APK.

## Verification Plan

- `rg --files -g '*.gradle' -g 'gradlew*' -g 'AndroidManifest.xml' -g 'capacitor.config.*' -g '*.apk'`
- `pnpm release:check --version 0.4.9`
- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- `pnpm build`
- `pnpm happytg task validate --repo . --task HTG-2026-05-02-local-update-uninstall-prompt`

