# HTG-2026-04-22-release-041-telegram-miniapp

## Frozen Scope

Prepare and publish HappyTG `0.4.1` from the current Telegram Mini App repair work:

- preserve the production Mini App routing/auth fix already on `origin/main`;
- include the Telegram `sendMessage` invalid `web_app.url` repair;
- include the Telegram persistent menu button CLI and Caddy `/miniapp` preflight repair;
- align workspace release metadata to `0.4.1`;
- add release notes and changelog entries for `0.4.1`;
- validate the existing feature proof bundles plus this release proof bundle;
- commit, push, merge to `main`, and publish the `v0.4.1` release artifact when repository tooling allows.

## Out Of Scope

- No new delivery modes.
- No weakening of pairing, auth, approval, policy, or delivery-mode semantics.
- No hidden production URL fallback for local development.
- No automatic Telegram menu-button mutation from bot startup; menu setup remains an explicit preflighted operator command.

## Acceptance Criteria

- `pnpm release:check --version 0.4.1` passes.
- Required bot, bootstrap, repo-level typecheck/lint/test/build verification passes.
- Prior task bundles for Telegram `sendMessage` repair and menu/Caddy repair validate.
- This release task bundle validates.
- `main` contains the release commit and `v0.4.1` points at that commit.
