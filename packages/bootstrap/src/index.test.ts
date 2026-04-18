import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { runBootstrapCommand } from "./index.js";

async function writeExecutable(filePath: string, source: string): Promise<void> {
  await writeFile(filePath, `${source.trim()}\n`, "utf8");
  await chmod(filePath, 0o755);
}

async function writeFakeGitBinary(filePath: string): Promise<void> {
  await writeExecutable(filePath, "#!/bin/sh\necho git test\n");
}

function batchQuote(value: string): string {
  return value.replace(/"/g, "\"\"");
}

function shellQuote(value: string): string {
  return value.replace(/(["\\$`])/g, "\\$1");
}

async function createWindowsCodexShim(tempDir: string, version: string): Promise<string> {
  const scriptName = "codex-shim.mjs";
  const scriptPath = path.join(tempDir, scriptName);
  await writeExecutable(
    scriptPath,
    `
      #!/usr/bin/env node
      const args = process.argv.slice(2);
      if (args[0] === "--version") {
        console.log(${JSON.stringify(version)});
        process.exit(0);
      }
      if (args[0] === "exec") {
        console.log('{"type":"message","text":"OK"}');
        process.exit(0);
      }
      console.error("unexpected invocation");
      process.exit(1);
    `
  );

  const shimPath = path.join(tempDir, "codex.cmd");
  if (process.platform === "win32") {
    await Promise.all([
      writeFile(
        path.join(tempDir, "node.cmd"),
        `@echo off\r\n"${batchQuote(process.execPath)}" %*\r\n`,
        "utf8"
      ),
      writeFile(
        shimPath,
        `@echo off\r\nsetlocal\r\n"${batchQuote(process.execPath)}" "%~dp0${scriptName}" %*\r\n`,
        "utf8"
      )
    ]);
    return shimPath;
  }

  await writeExecutable(
    shimPath,
    `
      #!/bin/sh
      SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
      exec "${shellQuote(process.execPath)}" "$SCRIPT_DIR/${scriptName}" "$@"
    `
  );
  return shimPath;
}

async function createStrictWindowsCodexShim(tempDir: string, version: string, expectedPrompt: string): Promise<string> {
  const scriptName = "codex-strict-shim.mjs";
  const scriptPath = path.join(tempDir, scriptName);
  await writeExecutable(
    scriptPath,
    `
      #!/usr/bin/env node
      const args = process.argv.slice(2);
      if (args[0] === "--version") {
        console.log(${JSON.stringify(version)});
        process.exit(0);
      }
      if (args[0] === "exec") {
        const expected = ["exec", "--skip-git-repo-check", "--json", ${JSON.stringify(expectedPrompt)}];
        const matches = args.length === expected.length && args.every((value, index) => value === expected[index]);
        if (!matches) {
          console.error(\`unexpected exec args: \${JSON.stringify(args)}\`);
          process.exit(1);
        }
        console.log('{"type":"message","text":"OK"}');
        process.exit(0);
      }
      console.error("unexpected invocation");
      process.exit(1);
    `
  );

  const shimPath = path.join(tempDir, "codex.cmd");
  if (process.platform === "win32") {
    await Promise.all([
      writeFile(
        path.join(tempDir, "node.cmd"),
        `@echo off\r\n"${batchQuote(process.execPath)}" %*\r\n`,
        "utf8"
      ),
      writeFile(
        shimPath,
        `@echo off\r\nsetlocal\r\n"${batchQuote(process.execPath)}" "%~dp0${scriptName}" %*\r\n`,
        "utf8"
      )
    ]);
    return shimPath;
  }

  await writeExecutable(
    shimPath,
    `
      #!/bin/sh
      SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
      exec "${shellQuote(process.execPath)}" "$SCRIPT_DIR/${scriptName}" "$@"
    `
  );
  return shimPath;
}

async function createWindowsNpmPrefixShim(tempDir: string, prefix: string): Promise<string> {
  const scriptName = "npm-prefix-shim.mjs";
  const scriptPath = path.join(tempDir, scriptName);
  await writeExecutable(
    scriptPath,
    `
      const args = process.argv.slice(2);
      if (args[0] === "prefix" && args[1] === "-g") {
        console.log(${JSON.stringify(prefix)});
        process.exit(0);
      }
      console.error("unexpected invocation");
      process.exit(1);
    `
  );

  const shimPath = path.join(tempDir, "npm.cmd");
  if (process.platform === "win32") {
    await Promise.all([
      writeFile(
        path.join(tempDir, "node.cmd"),
        `@echo off\r\n"${batchQuote(process.execPath)}" %*\r\n`,
        "utf8"
      ),
      writeFile(
        shimPath,
        `@echo off\r\nsetlocal\r\nnode "%~dp0${scriptName}" %*\r\n`,
        "utf8"
      )
    ]);
    return shimPath;
  }

  await writeExecutable(
    shimPath,
    `
      #!/bin/sh
      SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
      exec "${shellQuote(process.execPath)}" "$SCRIPT_DIR/${scriptName}" "$@"
    `
  );
  return shimPath;
}

async function reserveFreePort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to reserve a free port");
  }
  const { port } = address;
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function createRedisLikeServer(): Promise<{
  server: net.Server;
  port: number;
}> {
  const server = net.createServer((socket) => {
    socket.on("data", () => {
      socket.write("+PONG\r\n");
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Redis test server did not bind to a TCP port");
  }
  return {
    server,
    port: address.port
  };
}

async function createPostgresLikeServer(): Promise<{
  server: net.Server;
  port: number;
}> {
  const server = net.createServer((socket) => {
    socket.once("data", (chunk) => {
      const isSslRequest = chunk.length >= 8
        && chunk[4] === 0x04
        && chunk[5] === 0xd2
        && chunk[6] === 0x16
        && chunk[7] === 0x2f;
      socket.write(Buffer.from([isSslRequest ? 0x53 : 0x4e]));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Postgres test server did not bind to a TCP port");
  }
  return {
    server,
    port: address.port
  };
}

async function createMinioLikeService(title = "MinIO Console"): Promise<{
  server: ReturnType<typeof createHttpServer>;
  port: number;
}> {
  const server = createHttpServer((req, res) => {
    if (req.url === "/minio/health/live") {
      res.writeHead(200, {
        "content-type": "text/plain",
        server: "MinIO"
      });
      res.end("OK");
      return;
    }

    res.writeHead(200, {
      "content-type": "text/html",
      server: "MinIO"
    });
    res.end(`<!doctype html><title>${title}</title>`);
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("MinIO-like test server did not bind to a TCP port");
  }
  return {
    server,
    port: address.port
  };
}

async function createHappyTGService(service: string): Promise<{
  server: ReturnType<typeof createHttpServer>;
  port: number;
}> {
  const server = createHttpServer((req, res) => {
    if (req.url === "/ready" || req.url === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, service }));
      return;
    }

    res.writeHead(404).end();
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("HTTP test server did not bind to a TCP port");
  }
  return {
    server,
    port: address.port
  };
}

async function createGenericHttpService(): Promise<{
  server: ReturnType<typeof createHttpServer>;
  port: number;
}> {
  const server = createHttpServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("busy");
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("HTTP test server did not bind to a TCP port");
  }
  return {
    server,
    port: address.port
  };
}

async function closeServer(server: net.Server | ReturnType<typeof createHttpServer>): Promise<void> {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

test("doctor writes a report, detects Git, and keeps Codex available on a Windows-like codex.cmd shim", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "happytg-bootstrap-win-codex-"));
  try {
    const configPath = path.join(tempDir, "config.toml");
    const stateDir = path.join(tempDir, ".happytg-state");
    const gitBinaryPath = path.join(tempDir, "git.cmd");
    const codexShimPath = await createWindowsCodexShim(tempDir, "codex shim 0.115.0");
    await Promise.all([
      writeFile(path.join(tempDir, ".env"), "TELEGRAM_BOT_TOKEN=123456:abcdefghijklmnopqrstuvwx\n", "utf8"),
      writeFile(configPath, 'model = "gpt-5"\n', "utf8"),
      writeFile(gitBinaryPath, "@echo off\r\n", "utf8")
    ]);

    const report = await runBootstrapCommand("doctor", {
      cwd: tempDir,
      platform: "win32",
      env: {
        TELEGRAM_BOT_TOKEN: "123456:abcdefghijklmnopqrstuvwx",
        CODEX_CONFIG_PATH: configPath,
        HAPPYTG_STATE_DIR: stateDir,
        HAPPYTG_MINIAPP_PORT: String(await reserveFreePort()),
        HAPPYTG_API_PORT: String(await reserveFreePort()),
        HAPPYTG_BOT_PORT: String(await reserveFreePort()),
        HAPPYTG_WORKER_PORT: String(await reserveFreePort()),
        HAPPYTG_REDIS_HOST_PORT: String(await reserveFreePort()),
        REDIS_URL: `redis://127.0.0.1:${await reserveFreePort()}`,
        PATH: tempDir,
        Path: "",
        PATHEXT: "",
        pathext: ".cmd;.exe"
      }
    });
    const stored = JSON.parse(await readFile(path.join(stateDir, "state", "doctor-last.json"), "utf8")) as typeof report;

    assert.equal(report.command, "doctor");
    assert.equal(stored.id, report.id);
    assert.ok(!report.findings.some((item) => item.code === "CODEX_MISSING"));
    assert.match((report.reportJson.preflight as string[]).join("\n"), /Codex: codex shim 0\.115\.0/);
    assert.deepEqual((report.reportJson.git as { available: boolean; binaryPath: string | null }), {
      available: true,
      binaryPath: gitBinaryPath
    });
    assert.equal((report.reportJson.telegram as { configured: boolean }).configured, true);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("verify surfaces Codex smoke warnings as warn when config exists", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "happytg-bootstrap-verify-"));
  try {
    const binaryPath = path.join(tempDir, "codex-verify.mjs");
    const configPath = path.join(tempDir, "config.toml");
    const gitBinaryPath = path.join(tempDir, "git");
    await Promise.all([
      writeFile(path.join(tempDir, ".env"), "TELEGRAM_BOT_TOKEN=123456:abcdefghijklmnopqrstuvwx\n", "utf8"),
      writeFile(configPath, 'model = "gpt-5"\n', "utf8"),
      writeExecutable(
        binaryPath,
        `
          #!/usr/bin/env node
          const args = process.argv.slice(2);
          if (args[0] === "--version") {
            console.log("codex test 1.0");
            process.exit(0);
          }
          if (args[0] === "exec") {
            console.log('{"type":"message","text":"OK"}');
            console.error("sqlite warning");
            process.exit(0);
          }
          console.error("unexpected invocation");
          process.exit(1);
        `
      ),
      writeFakeGitBinary(gitBinaryPath)
    ]);

    const report = await runBootstrapCommand("verify", {
      cwd: tempDir,
      env: {
        TELEGRAM_BOT_TOKEN: "123456:abcdefghijklmnopqrstuvwx",
        CODEX_CLI_BIN: binaryPath,
        CODEX_CONFIG_PATH: configPath,
        HAPPYTG_STATE_DIR: path.join(tempDir, ".happytg-state"),
        HAPPYTG_MINIAPP_PORT: String(await reserveFreePort()),
        HAPPYTG_API_PORT: String(await reserveFreePort()),
        HAPPYTG_BOT_PORT: String(await reserveFreePort()),
        HAPPYTG_WORKER_PORT: String(await reserveFreePort()),
        HAPPYTG_REDIS_HOST_PORT: String(await reserveFreePort()),
        REDIS_URL: `redis://127.0.0.1:${await reserveFreePort()}`,
        PATH: tempDir
      }
    });

    assert.equal(report.command, "verify");
    assert.equal(report.status, "warn");
    assert.ok(report.findings.some((item) => item.code === "CODEX_SMOKE_WARNINGS"));
    assert.match(String(report.reportJson.platform), /-/);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("doctor distinguishes unavailable Codex from a missing Codex binary", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "happytg-bootstrap-codex-unavailable-"));
  try {
    const configPath = path.join(tempDir, "config.toml");
    const codexPath = path.join(tempDir, "codex-broken.mjs");
    const gitPath = path.join(tempDir, "git");
    await Promise.all([
      writeFile(path.join(tempDir, ".env"), "TELEGRAM_BOT_TOKEN=123456:abcdefghijklmnopqrstuvwx\n", "utf8"),
      writeFile(configPath, 'model = "gpt-5"\n', "utf8"),
      writeExecutable(
        codexPath,
        `
          #!/usr/bin/env node
          process.stderr.write("codex init failed\\n");
          process.exit(1);
        `
      ),
      writeFakeGitBinary(gitPath)
    ]);

    const report = await runBootstrapCommand("doctor", {
      cwd: tempDir,
      env: {
        TELEGRAM_BOT_TOKEN: "123456:abcdefghijklmnopqrstuvwx",
        CODEX_CLI_BIN: codexPath,
        CODEX_CONFIG_PATH: configPath,
        HAPPYTG_STATE_DIR: path.join(tempDir, ".happytg-state"),
        HAPPYTG_MINIAPP_PORT: String(await reserveFreePort()),
        HAPPYTG_API_PORT: String(await reserveFreePort()),
        HAPPYTG_BOT_PORT: String(await reserveFreePort()),
        HAPPYTG_WORKER_PORT: String(await reserveFreePort()),
        HAPPYTG_REDIS_HOST_PORT: String(await reserveFreePort()),
        REDIS_URL: `redis://127.0.0.1:${await reserveFreePort()}`,
        PATH: tempDir
      }
    });

    assert.ok(!report.findings.some((item) => item.code === "CODEX_MISSING"));
    assert.ok(report.findings.some((item) => item.code === "CODEX_UNAVAILABLE"));
    assert.match((report.reportJson.preflight as string[]).join("\n"), /Codex: detected but unavailable/);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("doctor recovers through the npm wrapper when Codex is off PATH and leaves a PATH follow-up warning", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "happytg-bootstrap-codex-path-issue-"));
  try {
    const configPath = path.join(tempDir, "config.toml");
    const gitBinaryPath = path.join(tempDir, "git.cmd");
    const npmPrefix = path.join(tempDir, "global-npm");
    const npmBinDir = npmPrefix;
    await mkdir(npmBinDir, { recursive: true });
    const wrapperPath = await createWindowsCodexShim(npmBinDir, "codex shim 0.118.0");
    await Promise.all([
      writeFile(path.join(tempDir, ".env"), "TELEGRAM_BOT_TOKEN=123456:abcdefghijklmnopqrstuvwx\n", "utf8"),
      writeFile(configPath, 'model = "gpt-5"\n', "utf8"),
      writeFile(gitBinaryPath, "@echo off\r\n", "utf8"),
      createWindowsNpmPrefixShim(tempDir, npmPrefix)
    ]);

    const report = await runBootstrapCommand("doctor", {
      cwd: tempDir,
      platform: "win32",
      env: {
        TELEGRAM_BOT_TOKEN: "123456:abcdefghijklmnopqrstuvwx",
        CODEX_CONFIG_PATH: configPath,
        HAPPYTG_STATE_DIR: path.join(tempDir, ".happytg-state"),
        HAPPYTG_MINIAPP_PORT: String(await reserveFreePort()),
        HAPPYTG_API_PORT: String(await reserveFreePort()),
        HAPPYTG_BOT_PORT: String(await reserveFreePort()),
        HAPPYTG_WORKER_PORT: String(await reserveFreePort()),
        HAPPYTG_REDIS_HOST_PORT: String(await reserveFreePort()),
        REDIS_URL: `redis://127.0.0.1:${await reserveFreePort()}`,
        PATH: tempDir,
        Path: "",
        PATHEXT: "",
        pathext: ".cmd;.exe"
      }
    });

    assert.equal(report.status, "warn");
    assert.ok(!report.findings.some((item) => item.code === "CODEX_MISSING"));
    assert.ok(report.findings.some((item) => item.code === "CODEX_PATH_PENDING"));
    assert.match(report.findings.find((item) => item.code === "CODEX_PATH_PENDING")?.message ?? "", /not on the current shell PATH yet/i);
    assert.match(report.planPreview.join("\n"), new RegExp(npmBinDir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match((report.reportJson.preflight as string[]).join("\n"), /via npm wrapper; PATH follow-up still needed/);
    assert.equal((report.reportJson.codex as { binaryPath: string }).binaryPath, wrapperPath);
    assert.equal((report.reportJson.codexPathResolution as { pathPending: boolean }).pathPending, true);
    assert.deepEqual((report.reportJson.codexInstallCheck as { wrapperPaths: string[] }).wrapperPaths, [wrapperPath]);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("doctor recovers through a standard Windows APPDATA npm wrapper path when npm prefix probing is unavailable", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "happytg-bootstrap-codex-appdata-"));
  try {
    const configPath = path.join(tempDir, "config.toml");
    const gitBinaryPath = path.join(tempDir, "git.cmd");
    const appDataDir = path.join(tempDir, "AppData", "Roaming");
    const npmBinDir = path.join(appDataDir, "npm");
    await mkdir(npmBinDir, { recursive: true });
    const wrapperPath = await createWindowsCodexShim(npmBinDir, "codex shim 0.119.0");
    await Promise.all([
      writeFile(path.join(tempDir, ".env"), "TELEGRAM_BOT_TOKEN=123456:abcdefghijklmnopqrstuvwx\n", "utf8"),
      writeFile(configPath, 'model = "gpt-5"\n', "utf8"),
      writeFile(gitBinaryPath, "@echo off\r\n", "utf8")
    ]);

    const report = await runBootstrapCommand("doctor", {
      cwd: tempDir,
      platform: "win32",
      env: {
        TELEGRAM_BOT_TOKEN: "123456:abcdefghijklmnopqrstuvwx",
        CODEX_CONFIG_PATH: configPath,
        HAPPYTG_STATE_DIR: path.join(tempDir, ".happytg-state"),
        HAPPYTG_MINIAPP_PORT: String(await reserveFreePort()),
        HAPPYTG_API_PORT: String(await reserveFreePort()),
        HAPPYTG_BOT_PORT: String(await reserveFreePort()),
        HAPPYTG_WORKER_PORT: String(await reserveFreePort()),
        HAPPYTG_REDIS_HOST_PORT: String(await reserveFreePort()),
        REDIS_URL: `redis://127.0.0.1:${await reserveFreePort()}`,
        PATH: tempDir,
        Path: "",
        PATHEXT: "",
        pathext: ".cmd;.exe",
        APPDATA: appDataDir,
        USERPROFILE: tempDir
      }
    });

    assert.equal(report.status, "warn");
    assert.ok(!report.findings.some((item) => item.code === "CODEX_MISSING"));
    assert.ok(report.findings.some((item) => item.code === "CODEX_PATH_PENDING"));
    assert.match(report.findings.find((item) => item.code === "CODEX_PATH_PENDING")?.message ?? "", new RegExp(npmBinDir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(report.planPreview.join("\n"), new RegExp(npmBinDir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.equal((report.reportJson.codex as { binaryPath: string }).binaryPath, wrapperPath);
    assert.equal((report.reportJson.codexPathResolution as { pathPending: boolean }).pathPending, true);
    assert.deepEqual((report.reportJson.codexInstallCheck as { wrapperPaths: string[] }).wrapperPaths, [wrapperPath]);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("doctor keeps Codex smoke green through a Windows wrapper when the prompt contains spaces", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "happytg-bootstrap-codex-smoke-"));
  try {
    const configPath = path.join(tempDir, "config.toml");
    const gitBinaryPath = path.join(tempDir, "git.cmd");
    const npmPrefix = path.join(tempDir, "global-npm");
    const npmBinDir = npmPrefix;
    await mkdir(npmBinDir, { recursive: true });
    const wrapperPath = await createStrictWindowsCodexShim(npmBinDir, "codex shim 0.120.0", "Print exactly OK and exit.");
    await Promise.all([
      writeFile(path.join(tempDir, ".env"), "TELEGRAM_BOT_TOKEN=123456:abcdefghijklmnopqrstuvwx\n", "utf8"),
      writeFile(configPath, 'model = "gpt-5"\n', "utf8"),
      writeFile(gitBinaryPath, "@echo off\r\n", "utf8"),
      createWindowsNpmPrefixShim(tempDir, npmPrefix)
    ]);

    const report = await runBootstrapCommand("doctor", {
      cwd: tempDir,
      platform: "win32",
      env: {
        TELEGRAM_BOT_TOKEN: "123456:abcdefghijklmnopqrstuvwx",
        CODEX_CONFIG_PATH: configPath,
        HAPPYTG_STATE_DIR: path.join(tempDir, ".happytg-state"),
        HAPPYTG_MINIAPP_PORT: String(await reserveFreePort()),
        HAPPYTG_API_PORT: String(await reserveFreePort()),
        HAPPYTG_BOT_PORT: String(await reserveFreePort()),
        HAPPYTG_WORKER_PORT: String(await reserveFreePort()),
        HAPPYTG_REDIS_HOST_PORT: String(await reserveFreePort()),
        REDIS_URL: `redis://127.0.0.1:${await reserveFreePort()}`,
        PATH: tempDir,
        Path: "",
        PATHEXT: "",
        pathext: ".cmd;.exe"
      }
    });

    assert.equal(report.status, "warn");
    assert.ok(report.findings.some((item) => item.code === "CODEX_PATH_PENDING"));
    assert.ok(!report.findings.some((item) => item.code === "CODEX_SMOKE_FAILED"));
    assert.ok(!report.findings.some((item) => item.code === "CODEX_SMOKE_WARNINGS"));
    assert.equal((report.reportJson.codex as { binaryPath: string }).binaryPath, wrapperPath);
    assert.equal((report.reportJson.codex as { smokeOk: boolean }).smokeOk, true);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("doctor recommends reinstall with PATH update when Codex wrapper files are missing from the global npm prefix", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "happytg-bootstrap-codex-partial-install-"));
  try {
    const configPath = path.join(tempDir, "config.toml");
    const gitBinaryPath = path.join(tempDir, "git.cmd");
    const npmPrefix = path.join(tempDir, "global-npm");
    await Promise.all([
      writeFile(path.join(tempDir, ".env"), "TELEGRAM_BOT_TOKEN=123456:abcdefghijklmnopqrstuvwx\n", "utf8"),
      writeFile(configPath, 'model = "gpt-5"\n', "utf8"),
      writeFile(gitBinaryPath, "@echo off\r\n", "utf8"),
      createWindowsNpmPrefixShim(tempDir, npmPrefix)
    ]);

    const report = await runBootstrapCommand("doctor", {
      cwd: tempDir,
      platform: "win32",
      env: {
        TELEGRAM_BOT_TOKEN: "123456:abcdefghijklmnopqrstuvwx",
        CODEX_CONFIG_PATH: configPath,
        HAPPYTG_STATE_DIR: path.join(tempDir, ".happytg-state"),
        HAPPYTG_MINIAPP_PORT: String(await reserveFreePort()),
        HAPPYTG_API_PORT: String(await reserveFreePort()),
        HAPPYTG_BOT_PORT: String(await reserveFreePort()),
        HAPPYTG_WORKER_PORT: String(await reserveFreePort()),
        HAPPYTG_REDIS_HOST_PORT: String(await reserveFreePort()),
        REDIS_URL: `redis://127.0.0.1:${await reserveFreePort()}`,
        PATH: tempDir,
        Path: "",
        PATHEXT: "",
        pathext: ".cmd;.exe"
      }
    });

    assert.ok(report.findings.some((item) => item.code === "CODEX_MISSING"));
    assert.match(report.findings.find((item) => item.code === "CODEX_MISSING")?.message ?? "", /missing or partial install/i);
    assert.match(report.planPreview.join("\n"), /Reinstall Codex CLI/);
    assert.match(report.planPreview.join("\n"), /Verify `codex --version`/);
    assert.deepEqual((report.reportJson.codexInstallCheck as { wrapperPaths: string[] }).wrapperPaths, []);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("setup turns missing Telegram token into a short actionable first-run checklist and reuses running Redis", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "happytg-bootstrap-setup-"));
  const redis = await createRedisLikeServer();
  try {
    const configPath = path.join(tempDir, "config.toml");
    const codexPath = path.join(tempDir, "codex.mjs");
    const gitPath = path.join(tempDir, "git");
    await Promise.all([
      writeFile(path.join(tempDir, ".env.example"), "TELEGRAM_BOT_TOKEN=\n", "utf8"),
      writeFile(configPath, 'model = "gpt-5"\n', "utf8"),
      writeExecutable(
        codexPath,
        `
          #!/usr/bin/env node
          const args = process.argv.slice(2);
          if (args[0] === "--version") {
            console.log("codex 0.115.0");
            process.exit(0);
          }
          if (args[0] === "exec") {
            console.log('{"type":"message","text":"OK"}');
            process.exit(0);
          }
          process.exit(1);
        `
      ),
      writeFakeGitBinary(gitPath)
    ]);

    const report = await runBootstrapCommand("setup", {
      cwd: tempDir,
      env: {
        CODEX_CLI_BIN: codexPath,
        CODEX_CONFIG_PATH: configPath,
        HAPPYTG_STATE_DIR: path.join(tempDir, ".happytg-state"),
        HAPPYTG_MINIAPP_PORT: String(await reserveFreePort()),
        HAPPYTG_API_PORT: String(await reserveFreePort()),
        HAPPYTG_BOT_PORT: String(await reserveFreePort()),
        HAPPYTG_WORKER_PORT: String(await reserveFreePort()),
        HAPPYTG_REDIS_HOST_PORT: String(redis.port),
        REDIS_URL: `redis://127.0.0.1:${redis.port}`,
        PATH: tempDir
      }
    });

    assert.equal(report.status, "fail");
    assert.ok(report.findings.some((item) => item.code === "TELEGRAM_TOKEN_MISSING"));
    assert.equal((report.reportJson.telegram as { configured: boolean }).configured, false);
    assert.match((report.reportJson.preflight as string[]).join("\n"), /Redis: running on 127\.0\.0\.1:/);
    assert.match(report.planPreview.join("\n"), /Pairing is blocked because Telegram bot configuration is incomplete/);
    assert.match(report.planPreview.join("\n"), /Fix the Telegram bot configuration first/);
    assert.match(report.planPreview.join("\n"), /skip Docker shared infra entirely|postgres minio/);
    assert.match(report.planPreview.join("\n"), /skip Docker shared infra entirely|skip Docker entirely|DATABASE_URL/);
    assert.match(report.planPreview.join("\n"), /Set `TELEGRAM_BOT_TOKEN`/);
    assert.equal(
      ((report.reportJson.onboarding as { items: Array<{ id: string; kind: string }> }).items)
        .find((item) => item.id === "request-pair-code")?.kind,
      "blocked"
    );
  } finally {
    await closeServer(redis.server);
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("setup names existing PostgreSQL, Redis, and S3 endpoints when Redis is absent locally", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "happytg-bootstrap-redis-absent-"));
  try {
    const configPath = path.join(tempDir, "config.toml");
    const codexPath = path.join(tempDir, "codex.mjs");
    const gitPath = path.join(tempDir, "git");
    await Promise.all([
      writeFile(path.join(tempDir, ".env"), "TELEGRAM_BOT_TOKEN=123456:abcdefghijklmnopqrstuvwx\n", "utf8"),
      writeFile(configPath, 'model = "gpt-5"\n', "utf8"),
      writeExecutable(
        codexPath,
        `
          #!/usr/bin/env node
          const args = process.argv.slice(2);
          if (args[0] === "--version") {
            console.log("codex 0.115.0");
            process.exit(0);
          }
          if (args[0] === "exec") {
            console.log('{"type":"message","text":"OK"}');
            process.exit(0);
          }
          process.exit(1);
        `
      ),
      writeFakeGitBinary(gitPath)
    ]);

    const report = await runBootstrapCommand("setup", {
      cwd: tempDir,
      env: {
        TELEGRAM_BOT_TOKEN: "123456:abcdefghijklmnopqrstuvwx",
        CODEX_CLI_BIN: codexPath,
        CODEX_CONFIG_PATH: configPath,
        HAPPYTG_STATE_DIR: path.join(tempDir, ".happytg-state"),
        HAPPYTG_MINIAPP_PORT: String(await reserveFreePort()),
        HAPPYTG_API_PORT: String(await reserveFreePort()),
        HAPPYTG_BOT_PORT: String(await reserveFreePort()),
        HAPPYTG_WORKER_PORT: String(await reserveFreePort()),
        HAPPYTG_REDIS_HOST_PORT: String(await reserveFreePort()),
        REDIS_URL: `redis://127.0.0.1:${await reserveFreePort()}`,
        PATH: tempDir
      }
    });

    assert.ok(report.findings.some((item) => item.code === "REDIS_MISSING"));
    assert.match(report.findings.find((item) => item.code === "REDIS_MISSING")?.message ?? "", /REDIS_URL/);
    assert.match(report.planPreview.join("\n"), /DATABASE_URL/);
    assert.match(report.planPreview.join("\n"), /REDIS_URL/);
    assert.match(report.planPreview.join("\n"), /S3_ENDPOINT/);
    assert.match(report.planPreview.join("\n"), /postgres redis minio/);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("doctor reports Redis installed but stopped", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "happytg-bootstrap-redis-stopped-"));
  try {
    const configPath = path.join(tempDir, "config.toml");
    const codexPath = path.join(tempDir, "codex.mjs");
    const gitPath = path.join(tempDir, "git");
    const redisCliPath = path.join(tempDir, "redis-cli");
    const redisPort = await reserveFreePort();
    await Promise.all([
      writeFile(path.join(tempDir, ".env"), "TELEGRAM_BOT_TOKEN=123456:abcdefghijklmnopqrstuvwx\n", "utf8"),
      writeFile(configPath, 'model = "gpt-5"\n', "utf8"),
      writeExecutable(
        codexPath,
        `
          #!/usr/bin/env node
          const args = process.argv.slice(2);
          if (args[0] === "--version") {
            console.log("codex 0.115.0");
            process.exit(0);
          }
          if (args[0] === "exec") {
            console.log('{"type":"message","text":"OK"}');
            process.exit(0);
          }
          process.exit(1);
        `
      ),
      writeFakeGitBinary(gitPath),
      writeExecutable(redisCliPath, "#!/bin/sh\necho redis-cli\n")
    ]);

    const report = await runBootstrapCommand("doctor", {
      cwd: tempDir,
      env: {
        TELEGRAM_BOT_TOKEN: "123456:abcdefghijklmnopqrstuvwx",
        CODEX_CLI_BIN: codexPath,
        CODEX_CONFIG_PATH: configPath,
        HAPPYTG_STATE_DIR: path.join(tempDir, ".happytg-state"),
        HAPPYTG_MINIAPP_PORT: String(await reserveFreePort()),
        HAPPYTG_API_PORT: String(await reserveFreePort()),
        HAPPYTG_BOT_PORT: String(await reserveFreePort()),
        HAPPYTG_WORKER_PORT: String(await reserveFreePort()),
        HAPPYTG_REDIS_HOST_PORT: String(redisPort),
        REDIS_URL: `redis://127.0.0.1:${redisPort}`,
        PATH: tempDir
      }
    });

    assert.ok(report.findings.some((item) => item.code === "REDIS_STOPPED"));
    assert.match(report.findings.find((item) => item.code === "REDIS_STOPPED")?.message ?? "", /REDIS_URL/);
    assert.equal((report.reportJson.redis as { state: string }).state, "installed_stopped");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("doctor reports an actionable mini app port conflict and distinguishes an already-running HappyTG service", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "happytg-bootstrap-ports-"));
  const busyPort = await createGenericHttpService();
  const happyMiniApp = await createHappyTGService("miniapp");
  try {
    const configPath = path.join(tempDir, "config.toml");
    const codexPath = path.join(tempDir, "codex.mjs");
    const gitPath = path.join(tempDir, "git");
    await Promise.all([
      writeFile(path.join(tempDir, ".env"), "TELEGRAM_BOT_TOKEN=123456:abcdefghijklmnopqrstuvwx\n", "utf8"),
      writeFile(configPath, 'model = "gpt-5"\n', "utf8"),
      writeExecutable(
        codexPath,
        `
          #!/usr/bin/env node
          const args = process.argv.slice(2);
          if (args[0] === "--version") {
            console.log("codex 0.115.0");
            process.exit(0);
          }
          if (args[0] === "exec") {
            console.log('{"type":"message","text":"OK"}');
            process.exit(0);
          }
          process.exit(1);
        `
      ),
      writeFakeGitBinary(gitPath)
    ]);

    const report = await runBootstrapCommand("doctor", {
      cwd: tempDir,
      env: {
        TELEGRAM_BOT_TOKEN: "123456:abcdefghijklmnopqrstuvwx",
        CODEX_CLI_BIN: codexPath,
        CODEX_CONFIG_PATH: configPath,
        HAPPYTG_STATE_DIR: path.join(tempDir, ".happytg-state"),
        HAPPYTG_MINIAPP_PORT: String(busyPort.port),
        HAPPYTG_API_PORT: String(await reserveFreePort()),
        HAPPYTG_BOT_PORT: String(await reserveFreePort()),
        HAPPYTG_WORKER_PORT: String(await reserveFreePort()),
        HAPPYTG_REDIS_HOST_PORT: String(await reserveFreePort()),
        REDIS_URL: `redis://127.0.0.1:${await reserveFreePort()}`,
        PATH: tempDir
      }
    });
    const setupReport = await runBootstrapCommand("setup", {
      cwd: tempDir,
      env: {
        TELEGRAM_BOT_TOKEN: "123456:abcdefghijklmnopqrstuvwx",
        CODEX_CLI_BIN: codexPath,
        CODEX_CONFIG_PATH: configPath,
        HAPPYTG_STATE_DIR: path.join(tempDir, ".happytg-state"),
        HAPPYTG_MINIAPP_PORT: String(happyMiniApp.port),
        HAPPYTG_API_PORT: String(await reserveFreePort()),
        HAPPYTG_BOT_PORT: String(await reserveFreePort()),
        HAPPYTG_WORKER_PORT: String(await reserveFreePort()),
        HAPPYTG_REDIS_HOST_PORT: String(await reserveFreePort()),
        REDIS_URL: `redis://127.0.0.1:${await reserveFreePort()}`,
        PATH: tempDir
      }
    });

    assert.ok(report.findings.some((item) => item.code === "MINIAPP_PORT_BUSY"));
    assert.match(report.findings.find((item) => item.code === "MINIAPP_PORT_BUSY")?.message ?? "", /HAPPYTG_MINIAPP_PORT/);
    assert.equal(
      (setupReport.reportJson.ports as Array<{ id: string; state: string }>).find((item) => item.id === "miniapp")?.state,
      "occupied_expected"
    );
    assert.ok(setupReport.findings.some((item) => item.code === "SERVICES_ALREADY_RUNNING"));
    assert.match(setupReport.planPreview.join("\n"), /Reuse the current stack/);
    assert.equal(setupReport.planPreview.some((item) => item === "Start repo services: `pnpm dev`."), false);
    assert.equal(((setupReport.reportJson.onboarding as { steps: string[] }).steps).some((item) => item === "Start repo services: `pnpm dev`."), false);
    const miniAppConflict = ((report.reportJson.onboarding as {
      items: Array<{ id: string; message: string; solutions?: string[] }>;
    }).items).find((item) => item.id === "miniapp-port-conflict");
    assert.equal(miniAppConflict?.message.includes("already there"), true);
    assert.equal(miniAppConflict?.solutions?.[0], "This is a conflict, not a supported HappyTG reuse path.");
    assert.match(miniAppConflict?.solutions?.[1] ?? "", /Nearest free ports:/);
    assert.match(miniAppConflict?.solutions?.[2] ?? "", /HAPPYTG_MINIAPP_PORT/);
    assert.match(miniAppConflict?.solutions?.[2] ?? "", /PORT/);
    assert.match(miniAppConflict?.solutions?.[2] ?? "", /pnpm dev:miniapp/);
  } finally {
    await Promise.all([
      closeServer(busyPort.server),
      closeServer(happyMiniApp.server)
    ]);
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("setup treats compatible Redis, PostgreSQL, and MinIO listeners as supported reuse while flagging unrelated conflicts", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "happytg-bootstrap-port-reuse-"));
  const busyMiniApp = await createGenericHttpService();
  const redis = await createRedisLikeServer();
  const postgres = await createPostgresLikeServer();
  const minioApi = await createMinioLikeService("MinIO API");
  const minioConsole = await createMinioLikeService("MinIO Console");
  try {
    const configPath = path.join(tempDir, "config.toml");
    const codexPath = path.join(tempDir, "codex.mjs");
    const gitPath = path.join(tempDir, "git");
    await Promise.all([
      writeFile(path.join(tempDir, ".env"), "TELEGRAM_BOT_TOKEN=123456:abcdefghijklmnopqrstuvwx\n", "utf8"),
      writeFile(configPath, 'model = "gpt-5"\n', "utf8"),
      writeExecutable(
        codexPath,
        `
          #!/usr/bin/env node
          const args = process.argv.slice(2);
          if (args[0] === "--version") {
            console.log("codex 0.115.0");
            process.exit(0);
          }
          if (args[0] === "exec") {
            console.log('{"type":"message","text":"OK"}');
            process.exit(0);
          }
          process.exit(1);
        `
      ),
      writeFakeGitBinary(gitPath)
    ]);

    const report = await runBootstrapCommand("setup", {
      cwd: tempDir,
      env: {
        TELEGRAM_BOT_TOKEN: "123456:abcdefghijklmnopqrstuvwx",
        CODEX_CLI_BIN: codexPath,
        CODEX_CONFIG_PATH: configPath,
        HAPPYTG_STATE_DIR: path.join(tempDir, ".happytg-state"),
        HAPPYTG_MINIAPP_PORT: String(busyMiniApp.port),
        HAPPYTG_API_PORT: String(await reserveFreePort()),
        HAPPYTG_BOT_PORT: String(await reserveFreePort()),
        HAPPYTG_WORKER_PORT: String(await reserveFreePort()),
        HAPPYTG_REDIS_HOST_PORT: String(redis.port),
        HAPPYTG_POSTGRES_HOST_PORT: String(postgres.port),
        HAPPYTG_MINIO_PORT: String(minioApi.port),
        HAPPYTG_MINIO_CONSOLE_PORT: String(minioConsole.port),
        REDIS_URL: `redis://127.0.0.1:${redis.port}`,
        DATABASE_URL: `postgres://postgres:postgres@127.0.0.1:${postgres.port}/happytg`,
        S3_ENDPOINT: `http://127.0.0.1:${minioApi.port}`,
        PATH: tempDir
      }
    });

    const ports = report.reportJson.ports as Array<{
      id: string;
      port: number;
      state: string;
      detail: string;
      suggestedPort?: number;
      suggestedPorts?: number[];
      listener?: { description: string };
    }>;
    const overrideExamples = (report.reportJson.onboarding as {
      overrideExamples: Array<{ service: string; shellExample: string }>;
    }).overrideExamples;
    const minioApiPort = ports.find((item) => item.id === "minio-api");
    const minioConsolePort = ports.find((item) => item.id === "minio-console");
    assert.ok(report.findings.some((item) => item.code === "MINIAPP_PORT_BUSY"));
    assert.ok(!report.findings.some((item) => item.code === "POSTGRES_PORT_BUSY"));
    assert.ok(!report.findings.some((item) => item.code === "MINIO-API_PORT_BUSY"));
    assert.ok(!report.findings.some((item) => item.code === "MINIO-CONSOLE_PORT_BUSY"));
    assert.equal(ports.find((item) => item.id === "redis")?.state, "occupied_supported");
    assert.equal(ports.find((item) => item.id === "postgres")?.state, "occupied_supported");
    assert.equal(minioApiPort?.state, "occupied_supported");
    assert.equal(minioConsolePort?.state, "occupied_supported");
    assert.equal(ports.find((item) => item.id === "miniapp")?.suggestedPorts?.length, 3);
    assert.deepEqual(
      ports.find((item) => item.id === "miniapp")?.suggestedPorts?.[0],
      ports.find((item) => item.id === "miniapp")?.suggestedPort
    );
    assert.match(ports.find((item) => item.id === "miniapp")?.detail ?? "", /another process|HTTP listener/i);
    assert.match((report.reportJson.preflight as string[]).join("\n"), /reuse:/i);
    assert.ok(minioApiPort?.suggestedPort && minioApiPort.suggestedPort > minioApi.port);
    assert.ok(minioConsolePort?.suggestedPort && minioConsolePort.suggestedPort > minioConsole.port);
    assert.equal(minioApiPort?.suggestedPorts?.length, 3);
    assert.equal(minioConsolePort?.suggestedPorts?.length, 3);
    assert.notEqual(minioApiPort?.suggestedPort, minioApiPort?.port);
    assert.notEqual(minioApiPort?.suggestedPort, minioConsolePort?.port);
    assert.notEqual(minioConsolePort?.suggestedPort, minioApiPort?.port);
    assert.notEqual(minioConsolePort?.suggestedPort, minioConsolePort?.port);
    assert.notEqual(minioApiPort?.suggestedPort, minioConsolePort?.suggestedPort);
    assert.match(overrideExamples.find((item) => item.service === "MinIO API host port")?.shellExample ?? "", new RegExp(`HAPPYTG_MINIO_PORT=\"?${minioApiPort?.suggestedPort}\"?`));
    assert.match(overrideExamples.find((item) => item.service === "MinIO console host port")?.shellExample ?? "", new RegExp(`HAPPYTG_MINIO_CONSOLE_PORT=\"?${minioConsolePort?.suggestedPort}\"?`));
  } finally {
    await Promise.all([
      closeServer(busyMiniApp.server),
      closeServer(redis.server),
      closeServer(postgres.server),
      closeServer(minioApi.server),
      closeServer(minioConsole.server)
    ]);
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("setup respects PORT fallback when app-specific port overrides are absent", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "happytg-bootstrap-port-env-fallback-"));
  const busyMiniApp = await createGenericHttpService();
  try {
    const configPath = path.join(tempDir, "config.toml");
    const codexPath = path.join(tempDir, "codex.mjs");
    const gitPath = path.join(tempDir, "git");
    await Promise.all([
      writeFile(path.join(tempDir, ".env"), "TELEGRAM_BOT_TOKEN=123456:abcdefghijklmnopqrstuvwx\n", "utf8"),
      writeFile(configPath, 'model = "gpt-5"\n', "utf8"),
      writeExecutable(
        codexPath,
        `
          #!/usr/bin/env node
          const args = process.argv.slice(2);
          if (args[0] === "--version") {
            console.log("codex 0.115.0");
            process.exit(0);
          }
          if (args[0] === "exec") {
            console.log('{"type":"message","text":"OK"}');
            process.exit(0);
          }
          process.exit(1);
        `
      ),
      writeFakeGitBinary(gitPath)
    ]);

    const report = await runBootstrapCommand("setup", {
      cwd: tempDir,
      env: {
        TELEGRAM_BOT_TOKEN: "123456:abcdefghijklmnopqrstuvwx",
        CODEX_CLI_BIN: codexPath,
        CODEX_CONFIG_PATH: configPath,
        HAPPYTG_STATE_DIR: path.join(tempDir, ".happytg-state"),
        PORT: String(busyMiniApp.port),
        HAPPYTG_API_PORT: String(await reserveFreePort()),
        HAPPYTG_BOT_PORT: String(await reserveFreePort()),
        HAPPYTG_WORKER_PORT: String(await reserveFreePort()),
        HAPPYTG_REDIS_HOST_PORT: String(await reserveFreePort()),
        REDIS_URL: `redis://127.0.0.1:${await reserveFreePort()}`,
        PATH: tempDir
      }
    });

    const miniAppPort = (report.reportJson.ports as Array<{
      id: string;
      port: number;
      detail: string;
    }>).find((item) => item.id === "miniapp");
    const miniAppConflict = ((report.reportJson.onboarding as {
      items: Array<{ id: string; solutions?: string[] }>;
    }).items).find((item) => item.id === "miniapp-port-conflict");

    assert.equal(miniAppPort?.port, busyMiniApp.port);
    assert.match(miniAppPort?.detail ?? "", new RegExp(`port ${busyMiniApp.port}`));
    assert.ok(report.findings.some((item) => item.code === "MINIAPP_PORT_BUSY"));
    assert.match(miniAppConflict?.solutions?.[1] ?? "", /Nearest free ports:/);
    assert.match(miniAppConflict?.solutions?.[2] ?? "", /HAPPYTG_MINIAPP_PORT\/PORT/);
  } finally {
    await closeServer(busyMiniApp.server);
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("config-init and env-snapshot remain deterministic plan-only commands", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "happytg-bootstrap-config-"));
  try {
    const configReport = await runBootstrapCommand("config-init", {
      env: {
        HAPPYTG_STATE_DIR: path.join(tempDir, ".happytg-state")
      }
    });
    const envReport = await runBootstrapCommand("env-snapshot");

    assert.equal(configReport.status, "warn");
    assert.ok(configReport.findings.some((item) => item.code === "CONFIG_INIT_PLAN_ONLY"));
    assert.equal(envReport.status, "pass");
    assert.equal(typeof envReport.reportJson.node, "string");
    assert.equal(envReport.reportJson.cwd, process.cwd());
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
