# Evidence

Spec frozen before release metadata edits.

## Commands

- `pnpm release:check --version 0.4.7` -> pass. Raw: `raw/release-check.txt`.
- `pnpm lint` -> pass, 15/15 tasks. Raw: `raw/lint.txt`.
- `pnpm typecheck` -> pass, 15/15 tasks. Raw: `raw/typecheck.txt`.
- `pnpm test` -> pass, 15/15 tasks. Raw: `raw/test.txt`.
- `pnpm build` -> pass, 15/15 tasks. Raw: `raw/build.txt`.
- `pnpm happytg verify` -> exit 0 with WARN status. Raw: `raw/verify.txt`.
- `gh pr checks 42 --watch --interval 10` -> pass, two CI `verify` checks passed.
- `gh pr merge 42 --merge --delete-branch` -> merged release metadata to `main` at `22f1e49`.
- `gh workflow run release.yml --ref main -f version=0.4.7 -f draft=false -f prerelease=false` -> started Release workflow run `25112208566`.
- `gh run watch 25112208566 --interval 15 --exit-status` -> pass.
- `gh release view v0.4.7 --json tagName,name,isDraft,isPrerelease,publishedAt,targetCommitish,url` -> published release confirmed.
- `pnpm happytg task validate --repo . --task HTG-2026-04-29-release-047-uninstall-desktop-control` -> pass. Raw: `raw/task-validate.txt`.

## Published Release

- Release: `v0.4.7`
- URL: https://github.com/GermanMik/HappyTG/releases/tag/v0.4.7
- Target commit: `22f1e49c8d9c7c0fef27fb7294747bccb382e1ce`
- Workflow run: https://github.com/GermanMik/HappyTG/actions/runs/25112208566
- Published at: `2026-04-29T13:39:33Z`
- Draft: `false`
- Prerelease: `false`

## Verify Warnings

`pnpm happytg verify` reported environment warnings unrelated to the release metadata:

- Codex CLI websocket fallback warning.
- Public Caddy `/miniapp` route returned HTTP 200 without HappyTG Mini App identity.
- Host ports 80, 443, and 3000 are occupied by non-HappyTG listeners.
