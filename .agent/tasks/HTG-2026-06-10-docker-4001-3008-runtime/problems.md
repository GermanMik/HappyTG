# Problems

- The previous fix started HappyTG API and Mini App as background PowerShell/pnpm processes.
- Those processes are not durable and would not survive reboot.
- The local `.env` ports still pointed Docker at `4000/3007`, while external BaseDeploy Caddy expects `4001/3008`.
- `.env` also had an active `HAPPYTG_MINIAPP_UPSTREAM=127.0.0.1:3007`, which is wrong for Docker Compose Caddy.
