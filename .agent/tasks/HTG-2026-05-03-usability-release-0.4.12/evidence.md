# Evidence

## Start State

- Base branch: `main`
- Base commit: `78b2705` (`Merge pull request #52 from GermanMik/codex/happytg-usability-design-pass-20260503`)
- Previous release checked: `v0.4.11` published on GitHub.
- Target release: `v0.4.12`

## Implementation Notes

- Updated all 16 workspace `package.json` files from `0.4.11` to `0.4.12`.
- Added `CHANGELOG.md` entry for `v0.4.12`.
- Added `docs/releases/0.4.12.md`.
- Added a preview-only Mini App fixture API under this proof bundle to capture an interface screenshot without touching production runtime code.

## Verification

- `pnpm release:check --version 0.4.12`: PASS.
- `pnpm build`: PASS.
- `pnpm lint`: PASS.
- `pnpm typecheck`: PASS.
- `pnpm test`: PASS.
- `pnpm happytg doctor`: exit 0, WARN for Codex websocket 403 fallback and already-running local services.
- `pnpm happytg verify`: exit 0, WARN for Codex websocket 403 fallback and already-running local services.
- `pnpm happytg task validate --repo . --task HTG-2026-05-03-usability-release-0.4.12`: PASS with `Validation: ok`; phase/verification metadata reported as `unknown`.

## Interface Preview

- Started a local Mini App preview against a proof-bundle fixture API.
- Captured screenshot: `raw/screenshots/miniapp-home.png`.
- Browser screenshot command output: `raw/browser-screenshot.txt`.

## Release State

- PR/CI/GitHub Release are pending at proof-bundle commit time and must be completed after this branch is pushed.
