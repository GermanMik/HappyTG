# Problems

- No known implementation blockers remain.
- Fresh main-tree checks on 2026-05-02 found no code failures after fast-forwarding to `origin/main` / `v0.4.9`.
- `pnpm happytg doctor` and `pnpm happytg verify` still report pre-existing environment warnings for Codex smoke timeout and public Caddy Mini App route identity.
- Live New Desktop Task was not run against the real model to avoid starting an unsolicited agent turn; the app-server `thread/start` + `turn/start` path is covered by the focused fake app-server regression test.
