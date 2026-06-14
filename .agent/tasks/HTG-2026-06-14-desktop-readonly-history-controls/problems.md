# Problems

- Before the fix, global control availability decorated file-backed sessions as controllable even when the specific thread was not present in app-server state.
- Before the fix, `continueSession` called `turn/start` directly for old `recent` app-server threads; live audit showed `thread not found` for `019ec1b8-e7d9-73b1-81e8-03e7c11212aa`.
- A first live `api` rebuild was started without `docker-compose.codex-desktop-host-proxy.yml`, which temporarily removed `HAPPYTG_CODEX_DESKTOP_CONTROL=host-proxy`; the final rebuild used all required overrides.
