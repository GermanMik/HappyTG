import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildSystemCaddyPlan, generateSystemCaddySnippet } from "./install/docker-services.js";

test("compose declares a stable HappyTG project name", async () => {
  const compose = await readFile(new URL("../../../infra/docker-compose.example.yml", import.meta.url), "utf8");

  assert.match(compose, /^name:\s*happytg/m);
});

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

test("system Caddy snippet targets host-published Docker ports", () => {
  const snippet = generateSystemCaddySnippet({
    HAPPYTG_DOMAIN: "happytg.example.test",
    HAPPYTG_API_PORT: "4400",
    HAPPYTG_BOT_PORT: "4410",
    HAPPYTG_MINIAPP_PORT: "3301"
  });

  assert.match(snippet, /happytg\.example\.test \{/);
  assert.match(snippet, /reverse_proxy 127\.0\.0\.1:4400/);
  assert.match(snippet, /reverse_proxy 127\.0\.0\.1:4410/);
  assert.match(snippet, /reverse_proxy 127\.0\.0\.1:3301/);
  assert.match(snippet, /# BEGIN HappyTG managed block/);
  assert.match(snippet, /# END HappyTG managed block/);
});

test("system Caddy plan reuses existing validated HappyTG routes", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "happytg-caddy-reuse-"));
  const caddyfilePath = path.join(tempDir, "Caddyfile");
  const commands: string[] = [];

  try {
    await writeFile(caddyfilePath, generateSystemCaddySnippet({ HAPPYTG_DOMAIN: "happytg.example.test" }), "utf8");
    const plan = await buildSystemCaddyPlan({
      repoPath: tempDir,
      env: {
        HOME: tempDir,
        HAPPYTG_DOMAIN: "happytg.example.test",
        HAPPYTG_STATE_DIR: path.join(tempDir, "state")
      },
      platform: "linux",
      caddyfilePath,
      resolveExecutableImpl: async (command) => command === "caddy" ? "/usr/bin/caddy" : undefined,
      runCommandImpl: async ({ command, args }) => {
        commands.push([command, ...(args ?? [])].join(" "));
        return {
          stdout: "valid",
          stderr: "",
          exitCode: 0,
          binaryPath: command,
          shell: false,
          fallbackUsed: false
        };
      }
    });

    assert.equal(plan.status, "reuse");
    assert.equal(plan.caddyfilePath, caddyfilePath);
    assert.ok(commands.some((command) => command.includes("validate --config")));
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("system Caddy plan does not treat the repo starter Caddyfile as active system Caddy", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "happytg-caddy-repo-starter-"));
  const repoCaddyfilePath = path.join(tempDir, "infra", "caddy", "Caddyfile");

  try {
    await mkdir(path.dirname(repoCaddyfilePath), { recursive: true });
    await writeFile(repoCaddyfilePath, generateSystemCaddySnippet({ HAPPYTG_DOMAIN: "happytg.example.test" }), "utf8");
    const plan = await buildSystemCaddyPlan({
      repoPath: tempDir,
      env: {
        HOME: tempDir,
        HAPPYTG_DOMAIN: "happytg.example.test",
        HAPPYTG_STATE_DIR: path.join(tempDir, "state")
      },
      platform: "linux",
      action: "print-snippet",
      resolveExecutableImpl: async (command) => command === "caddy" ? "/usr/bin/caddy" : undefined,
      runCommandImpl: async () => {
        throw new Error("repo starter Caddyfile must not be validated as system Caddy");
      }
    });

    assert.equal(plan.status, "snippet");
    assert.notEqual(plan.caddyfilePath, repoCaddyfilePath);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("system Caddy reuse requires the full HappyTG route surface", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "happytg-caddy-incomplete-"));
  const caddyfilePath = path.join(tempDir, "Caddyfile");

  try {
    await writeFile(
      caddyfilePath,
      [
        "happytg.example.test {",
        "\thandle_path /miniapp* {",
        "\t\treverse_proxy 127.0.0.1:3001",
        "\t}",
        "\thandle /telegram/webhook {",
        "\t\treverse_proxy 127.0.0.1:4100",
        "\t}",
        "\thandle /api/v1/miniapp/auth/session {",
        "\t\treverse_proxy 127.0.0.1:4000",
        "\t}",
        "}",
        ""
      ].join("\n"),
      "utf8"
    );
    const plan = await buildSystemCaddyPlan({
      repoPath: tempDir,
      env: {
        HOME: tempDir,
        HAPPYTG_DOMAIN: "happytg.example.test",
        HAPPYTG_STATE_DIR: path.join(tempDir, "state")
      },
      platform: "linux",
      action: "reuse-system",
      caddyfilePath,
      resolveExecutableImpl: async (command) => command === "caddy" ? "/usr/bin/caddy" : undefined,
      runCommandImpl: async () => {
        throw new Error("incomplete routes must not be validated as reusable");
      }
    });

    assert.equal(plan.status, "blocked");
    assert.match(plan.detail, /blocked/i);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("system Caddy print-snippet action writes snippet without editing the Caddyfile", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "happytg-caddy-snippet-"));
  const caddyfilePath = path.join(tempDir, "Caddyfile");

  try {
    await writeFile(caddyfilePath, "example.test {\n\trespond \"owned\"\n}\n", "utf8");
    const plan = await buildSystemCaddyPlan({
      repoPath: tempDir,
      env: {
        HOME: tempDir,
        HAPPYTG_DOMAIN: "happytg.example.test",
        HAPPYTG_STATE_DIR: path.join(tempDir, "state")
      },
      platform: "linux",
      action: "print-snippet",
      caddyfilePath,
      resolveExecutableImpl: async () => undefined,
      runCommandImpl: async () => {
        throw new Error("print-snippet must not run caddy commands");
      }
    });

    assert.equal(plan.status, "snippet");
    assert.equal(await readFile(caddyfilePath, "utf8"), "example.test {\n\trespond \"owned\"\n}\n");
    assert.ok(plan.snippetPath);
    assert.match(await readFile(plan.snippetPath!, "utf8"), /happytg\.example\.test/);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("system Caddy patch action requires confirmation and then backs up, validates, and reloads", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "happytg-caddy-patch-"));
  const caddyfilePath = path.join(tempDir, "Caddyfile");
  const commands: string[] = [];

  try {
    await mkdir(tempDir, { recursive: true });
    await writeFile(caddyfilePath, "example.test {\n\trespond \"owned\"\n}\n", "utf8");
    const blocked = await buildSystemCaddyPlan({
      repoPath: tempDir,
      env: {
        HOME: tempDir,
        HAPPYTG_DOMAIN: "happytg.example.test",
        HAPPYTG_STATE_DIR: path.join(tempDir, "state")
      },
      platform: "linux",
      action: "patch-system",
      caddyfilePath,
      patchConfirmed: false,
      resolveExecutableImpl: async (command) => command === "caddy" ? "/usr/bin/caddy" : undefined,
      runCommandImpl: async () => {
        throw new Error("unconfirmed patch must not run caddy");
      }
    });
    assert.equal(blocked.status, "blocked");
    assert.doesNotMatch(await readFile(caddyfilePath, "utf8"), /HappyTG managed block/);

    const patched = await buildSystemCaddyPlan({
      repoPath: tempDir,
      env: {
        HOME: tempDir,
        HAPPYTG_DOMAIN: "happytg.example.test",
        HAPPYTG_STATE_DIR: path.join(tempDir, "state")
      },
      platform: "linux",
      action: "patch-system",
      caddyfilePath,
      patchConfirmed: true,
      resolveExecutableImpl: async (command) => command === "caddy" ? "/usr/bin/caddy" : undefined,
      runCommandImpl: async ({ command, args }) => {
        commands.push([command, ...(args ?? [])].join(" "));
        return {
          stdout: "",
          stderr: "",
          exitCode: 0,
          binaryPath: command,
          shell: false,
          fallbackUsed: false
        };
      }
    });

    assert.equal(patched.status, "patched");
    assert.ok(patched.backupPath);
    assert.match(await readFile(caddyfilePath, "utf8"), /# BEGIN HappyTG managed block/);
    assert.ok(commands.some((command) => command.includes("validate --config")));
    assert.ok(commands.some((command) => command.includes("reload --config")));
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
