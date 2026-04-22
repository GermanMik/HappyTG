# Evidence Summary

## Acceptance Criteria Mapping

| Criterion | Evidence |
| --- | --- |
| Current resolver and launch diagnostics inspected before the fix. | `raw/init-analysis.txt` captures the pre-fix references in `apps/bot/src/handlers.ts`, `apps/bot/src/index.ts`, `packages/shared/src/index.ts`, `packages/bootstrap/src/telegram-menu.ts`, `packages/bootstrap/src/index.ts`, tests, and docs. |
| Local `HAPPYTG_PUBLIC_URL=http://localhost:4000` no longer masks `HAPPYTG_APP_URL=http://localhost:3007`. | `packages/shared/src/index.ts` now prefers explicit Mini App URLs for non-public diagnostics when no public HTTPS candidate exists; covered by `packages/shared/src/index.test.ts`, `apps/bot/src/handlers.test.ts`, and `packages/bootstrap/src/telegram-menu.test.ts`. |
| Unsafe HTTP/local URLs are not sent to Telegram `web_app`. | `telegramWebAppButton()` still validates each generated URL with `validatePublicHttpsUrl`; `raw/test-bot.txt` includes local HTTP omission coverage and public HTTPS button coverage. |
| Public HTTPS Mini App URL still enables Telegram launch buttons. | `raw/test-bot.txt` includes `start command preserves the inline Mini App web_app button for public HTTPS URLs`; `/ready` public HTTPS readiness remains covered in `apps/bot/src/index.test.ts`. |
| `telegram menu set` remains strict for production/menu setup. | `raw/test-bootstrap.txt` includes rejection of invalid, local, private, and plain HTTP Mini App URLs before Telegram network calls. |
| Doctor/verify diagnostics separate local polling from public HTTPS launch requirements. | `packages/bootstrap/src/telegram-menu.ts` and `packages/bootstrap/src/index.ts` now state local polling can still work while WebApp/menu setup requires public HTTPS; covered by `raw/test-bootstrap.txt`. |
| Docs and env examples are synchronized. | `.env.example`, `docs/configuration.md`, `docs/installation.md`, and `docs/self-hosting.md` now describe the `3007` local Mini App URL and separate public HTTPS Telegram requirement. |

## Build And Verification

- `pnpm --filter @happytg/bot test`: passed (`raw/test-bot.txt`).
- `pnpm --filter @happytg/bootstrap test`: passed (`raw/test-bootstrap.txt`).
- `pnpm typecheck`: passed (`raw/typecheck.txt`).
- `pnpm lint`: passed (`raw/lint.txt`).
- `pnpm test`: passed (`raw/test.txt`).
- `pnpm build`: passed (`raw/build.txt`).
- `pnpm happytg task validate --repo . --task HTG-2026-04-22-miniapp-local-url-diagnostics`: passed (`raw/test-integration.txt`, mirrored as `raw/task-validate.txt`).

## Fresh Verifier Notes

- The post-fix verifier pass re-ran both targeted package suites, repo-wide typecheck/lint/test/build, and task bundle validation after implementation.
- The bot startup log in `raw/test-bot.txt` now shows local polling active with `miniAppLaunchUrl: "http://localhost:3007/"` for the `3007` local Mini App scenario.
- Some existing tests without `HAPPYTG_APP_URL` still show `http://localhost:4000/miniapp` as the only available local fallback; that is expected and does not send a Telegram `web_app` button.

## Residual Risk

- Local HTTP Mini App URLs remain launch-disabled in Telegram by design.
- The fix does not configure BotFather/Main Mini App profile metadata; it preserves the existing explicit `pnpm happytg telegram menu set` path.
