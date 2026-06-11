# Problems

- User reported that the Mini App does not load.
- Initial public probe returned `HTTP/1.1 502 Bad Gateway` for `https://happytg.gerta.crazedns.ru:5083/miniapp/ready`.
- `docker compose --env-file .env -f infra/docker-compose.example.yml ps` showed no HappyTG services.
- Local listeners for the Caddy host-side upstreams `3008` and `4001` were absent.

## Working Hypothesis

The public Mini App route is still configured correctly, but the host-side HappyTG API and Mini App processes that BaseDeploy Caddy proxies to are not running.
