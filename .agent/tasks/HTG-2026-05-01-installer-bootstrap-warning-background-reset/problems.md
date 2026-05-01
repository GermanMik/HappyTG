# Problems

Fresh verifier pass 1 found Caddy blockers:

- Repo starter `infra/caddy/Caddyfile` was treated as active system Caddy.
- System Caddy snippets could be generated before final port remaps.
- Caddy reuse detection did not prove the full route surface.

Minimal fixes applied:

- Removed the repo starter Caddyfile from implicit system Caddy candidates.
- Delayed final Caddy plan/snippet/patch generation until after port preflight applies `.env` remaps.
- Tightened HappyTG route detection and added regression tests for incomplete route surfaces.

No builder-blocking problems remain after the minimal fixes. Fresh verifier pass 2 accepted the repair with no blocking findings.

Environment warnings captured during `pnpm happytg doctor --json` and `pnpm happytg verify`:

- Codex Responses websocket returned 403 Forbidden and fell back to HTTP.
- The configured public Mini App route returned HTTP 200 but not the HappyTG Mini App identity.
- Existing HappyTG services were already running on local ports.

These are existing operator-environment findings, not regressions from the installer repair. No automated test mutated real Scheduled Tasks, Startup shortcuts, Docker Desktop state, or system Caddyfiles.

Fresh verifier pass 2 findings: none blocking.
