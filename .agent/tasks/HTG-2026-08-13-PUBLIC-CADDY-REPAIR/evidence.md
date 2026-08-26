# Evidence Summary

## Acceptance Criteria Mapping

1. Mini App runtime rebuilt from current source; container is running with RestartCount=0 and emits same-origin browser API base behind the proxy.
2. Shared Caddy gained only HappyTG hostname routes and narrow /miniapp, /static, /health, webhook, and selected Mini App API paths targeting 3008/4001/4100; generic API remains 404 and HealthOS remains fallback.
3. Direct, forced-local, public 443, and public 5083 checks pass; Contacts, VideoCall, NPortal, and HealthOS public 443 checks remain green.

## Artifacts

- C:\Develop\Projects\HappyTG\.agent\tasks\HTG-2026-08-13-PUBLIC-CADDY-REPAIR\raw\build.txt
- C:\Develop\Projects\HappyTG\.agent\tasks\HTG-2026-08-13-PUBLIC-CADDY-REPAIR\raw\test-unit.txt
- C:\Develop\Projects\HappyTG\.agent\tasks\HTG-2026-08-13-PUBLIC-CADDY-REPAIR\raw\test-integration.txt
- C:\Develop\Projects\HappyTG\.agent\tasks\HTG-2026-08-13-PUBLIC-CADDY-REPAIR\raw\lint.txt
