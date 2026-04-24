import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("compose keeps Mini App host port separate from container port for Caddy", async () => {
  const compose = await readFile(new URL("../../../infra/docker-compose.example.yml", import.meta.url), "utf8");

  assert.match(compose, /HAPPYTG_MINIAPP_PORT:\s*3001/);
  assert.match(compose, /\$\{HAPPYTG_MINIAPP_PORT:-3001\}:3001/);
  assert.match(compose, /fetch\('http:\/\/127\.0\.0\.1:3001\/ready'\)/);
});

test("compose publishes bot readiness on the host without changing worker exposure", async () => {
  const compose = await readFile(new URL("../../../infra/docker-compose.example.yml", import.meta.url), "utf8");

  assert.match(compose, /\$\{HAPPYTG_BOT_PORT:-4100\}:4100/);
  assert.match(compose, /fetch\('http:\/\/127\.0\.0\.1:4100\/ready'\)/);
  assert.doesNotMatch(compose, /HAPPYTG_WORKER_PORT:-4200/);
});

test("Caddy Mini App upstream is configurable and defaults to Docker network", async () => {
  const caddy = await readFile(new URL("../../../infra/caddy/Caddyfile", import.meta.url), "utf8");

  assert.match(caddy, /\{\$HAPPYTG_MINIAPP_UPSTREAM:miniapp:3001\}/);
  assert.doesNotMatch(caddy, /localhost:3001/);
});

test("Caddy exposes only narrow public Mini App API exceptions before generic API deny", async () => {
  const caddy = await readFile(new URL("../../../infra/caddy/Caddyfile", import.meta.url), "utf8");

  const dashboardIndex = caddy.indexOf("handle /api/v1/miniapp/dashboard");
  const authIndex = caddy.indexOf("handle /api/v1/miniapp/auth/session");
  const approvalIndex = caddy.indexOf("@miniappApprovalResolve");
  const denyIndex = caddy.indexOf("handle /api/*");

  assert.ok(authIndex >= 0);
  assert.ok(dashboardIndex >= 0);
  assert.ok(approvalIndex >= 0);
  assert.ok(denyIndex >= 0);
  assert.ok(authIndex < denyIndex);
  assert.ok(dashboardIndex < denyIndex);
  assert.ok(approvalIndex < denyIndex);
  assert.doesNotMatch(caddy, /handle(?:_path)?\s+\/api\/v1\/miniapp\*/);
  assert.match(caddy, /handle \/api\/\* \{\s+respond "Not found" 404\s+\}/);
});
