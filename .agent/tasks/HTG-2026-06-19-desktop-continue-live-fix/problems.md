# Problems

## Initial Build Finding

- Mini App success handling was not addressable: `/codex/desktop-continue` returned only the control result, and the browser did a blind `location.reload()`.
- Old Desktop sessions could remain disabled because the runtime control timeout default (`2500ms`) was shorter than practical host-proxy/app-server warmup.
- A sandboxed host-proxy cannot perform live Desktop control because spawning Codex app-server fails with `spawn EPERM`; live smoke must run the proxy outside sandbox.

## Status

- Fixed in build stage.
- Focused tests, full `corepack pnpm lint`, full `corepack pnpm build`, task validation, and live app-route smoke passed.
