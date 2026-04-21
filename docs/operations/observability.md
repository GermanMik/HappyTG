# HappyTG Observability

## Signals

- Logs: JSON structured logs from API, bot, worker, Mini App, and host daemon.
- Metrics: API exposes `/metrics` in Prometheus text format.
- Health: `/health` is fast and does not require heavy dependencies.
- Readiness: `/ready` reports service readiness and dependency-facing details.
- Version: `/version` reports service name and package version.
- Audit: control-plane audit records are stored with actor, action, target, metadata, and timestamp.

## Prometheus

The self-hosted compose example starts Prometheus with `infra/prometheus/prometheus.yml`. It scrapes:

- `api:4000/metrics`

Keep `/metrics` internal or protected by the reverse proxy. The starter Caddyfile does not publish metrics publicly.

## Grafana

Grafana is provisioned with a Prometheus datasource from `infra/grafana/provisioning/datasources/prometheus.yml`.

Minimum MVP panels:

- API up
- API uptime
- API RSS memory
- bot `/ready` status from synthetic probe
- worker `/ready` status from synthetic probe
- Mini App `/ready` status from synthetic probe

## Correlation

Use session id, task id, approval id, dispatch id, and host id as correlation fields. Do not put raw prompts, tokens, or secrets in labels.

## Alert Suggestions

- API `/ready` fails for 2 minutes.
- bot delivery is degraded for 5 minutes.
- host has active sessions but no heartbeat for 2 minutes.
- pending approvals expire.
- verification is `failed`, `inconclusive`, or `stale`.
