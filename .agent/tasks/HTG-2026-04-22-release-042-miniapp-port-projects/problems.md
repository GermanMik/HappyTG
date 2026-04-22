# Problems

- Existing local `.env` files can already contain `HAPPYTG_MINIAPP_PORT=3007` with stale `HAPPYTG_APP_URL=http://localhost:3001`. The installer now prevents future drift, but existing files still need manual correction.
- A generated `apps/host-daemon/.agent/` task folder was present from the live host daemon and is intentionally not part of this release scope.
