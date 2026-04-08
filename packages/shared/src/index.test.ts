import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import type { Logger } from "./index.js";
import {
  FileStateStore,
  createJsonServer,
  findExecutable,
  loadHappyTGEnv,
  json,
  normalizeSpawnEnv,
  readJsonFile,
  readTextFileOrEmpty,
  resolveHome,
  route,
  telegramTokenStatus,
  writeJsonFileAtomic,
  writeTextFileAtomic
} from "./index.js";

const silentLogger: Logger = {
  info() {},
  warn() {},
  error() {}
};

test("resolveHome and atomic file helpers round-trip data", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "happytg-shared-files-"));
  try {
    const jsonPath = path.join(tempDir, "nested", "data.json");
    const textPath = path.join(tempDir, "nested", "notes.txt");

    assert.equal(resolveHome("~/workspace", {
      env: { HOME: tempDir }
    }), path.join(tempDir, "workspace"));
    assert.equal(resolveHome("~", {
      env: { HOME: tempDir }
    }), tempDir);

    await writeJsonFileAtomic(jsonPath, { ok: true, count: 2 });
    await writeTextFileAtomic(textPath, "hello");

    assert.deepEqual(await readJsonFile(jsonPath, { ok: false }), { ok: true, count: 2 });
    assert.equal(await readTextFileOrEmpty(textPath), "hello");
    assert.equal(await readTextFileOrEmpty(path.join(tempDir, "missing.txt")), "");
    assert.equal((await readFile(jsonPath, "utf8")).endsWith("\n"), true);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("resolveHome honors Windows HOME, USERPROFILE, and HOMEDRIVE/HOMEPATH overrides", () => {
  const windowsHomeOverride = resolveHome("~/workspace", {
    env: {
      HOME: "/tmp/windows-home",
      USERPROFILE: "C:\\Users\\fallback"
    },
    platform: "win32"
  });
  const windowsUserProfile = resolveHome("~/workspace", {
    env: {
      USERPROFILE: "C:\\Users\\profile"
    },
    platform: "win32"
  });
  const windowsHomeDrive = resolveHome("~/workspace", {
    env: {
      HOMEDRIVE: "C:",
      HOMEPATH: "\\Users\\drive-home"
    },
    platform: "win32"
  });

  assert.equal(windowsHomeOverride, path.join("/tmp/windows-home", "workspace"));
  assert.equal(windowsUserProfile, "C:\\Users\\profile\\workspace");
  assert.equal(windowsHomeDrive, "C:\\Users\\drive-home\\workspace");
});

test("findExecutable searches PATH and appends Windows executable extensions", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "happytg-shared-executable-"));
  try {
    const windowsCodex = path.join(tempDir, "codex.cmd");
    const unixGit = path.join(tempDir, "git");
    await Promise.all([
      writeFile(windowsCodex, "@echo off\r\n", "utf8"),
      writeFile(unixGit, "#!/bin/sh\n", "utf8")
    ]);
    await chmod(unixGit, 0o755);

    const windowsResolved = await findExecutable("codex", {
        PATH: tempDir,
        PATHEXT: ".COM;.EXE;.BAT;.CMD"
      }, "win32");
    const unixResolved = await findExecutable("git", {
        PATH: tempDir
      }, "linux");
    const explicitWindowsResolved = await findExecutable(path.join(tempDir, "codex"), {
        PATH: tempDir,
        PATHEXT: ".COM;.EXE;.BAT;.CMD"
      }, "win32");

    assert.equal(windowsResolved, windowsCodex);
    assert.equal(unixResolved, unixGit);
    assert.equal(explicitWindowsResolved, windowsCodex);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("loadHappyTGEnv fills missing values without overriding existing env", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "happytg-shared-env-"));
  try {
    const envFilePath = path.join(tempDir, ".env");
    await writeFile(envFilePath, "TELEGRAM_BOT_TOKEN=123:test_token_value_1234567890\nLOG_LEVEL=debug\n", "utf8");

    const env: NodeJS.ProcessEnv = {
      LOG_LEVEL: "info"
    };
    const loaded = loadHappyTGEnv({
      cwd: tempDir,
      env
    });

    assert.equal(loaded.envFilePath, envFilePath);
    assert.deepEqual(loaded.loadedKeys, ["TELEGRAM_BOT_TOKEN"]);
    assert.equal(env.TELEGRAM_BOT_TOKEN, "123:test_token_value_1234567890");
    assert.equal(env.LOG_LEVEL, "info");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("normalizeSpawnEnv de-duplicates Windows Path keys and preserves PATHEXT", () => {
  const normalized = normalizeSpawnEnv({
    PATH: "C:\\wrong",
    Path: "C:\\Users\\tester\\AppData\\Roaming\\npm",
    PATHEXT: ".COM;.EXE;.BAT;.CMD",
    HOME: "C:\\Users\\tester"
  }, "win32");

  assert.equal(normalized.Path, "C:\\Users\\tester\\AppData\\Roaming\\npm");
  assert.equal(normalized.PATHEXT, ".COM;.EXE;.BAT;.CMD");
  assert.equal(normalized.PATH, undefined);
  assert.equal(normalized.HOME, "C:\\Users\\tester");
});

test("telegramTokenStatus distinguishes missing, placeholder, invalid, and configured values", () => {
  assert.equal(telegramTokenStatus({}).status, "missing");
  assert.equal(telegramTokenStatus({ TELEGRAM_BOT_TOKEN: "replace-me" }).status, "placeholder");
  assert.equal(telegramTokenStatus({ TELEGRAM_BOT_TOKEN: "abc" }).status, "invalid");
  assert.equal(telegramTokenStatus({ TELEGRAM_BOT_TOKEN: "123456:abcdefghijklmnopqrstuvwx" }).status, "configured");
});

test("FileStateStore serializes concurrent updates through its queue", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "happytg-shared-store-"));
  try {
    const store = new FileStateStore(path.join(tempDir, "control-plane.json"));

    await Promise.all([
      store.update(async (state) => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        state.users.push({
          id: "usr_1",
          displayName: "First",
          status: "active",
          createdAt: "2026-04-07T10:00:00.000Z"
        });
      }),
      store.update((state) => {
        state.users.push({
          id: "usr_2",
          displayName: "Second",
          status: "active",
          createdAt: "2026-04-07T10:00:01.000Z"
        });
      })
    ]);

    const finalState = await store.read();
    assert.deepEqual(finalState.users.map((user) => user.id).sort(), ["usr_1", "usr_2"]);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("createJsonServer resolves route params and query data", async () => {
  const server = createJsonServer(
    [
      route("GET", "/items/:itemId", async ({ res, params, url }) => {
        json(res, 200, {
          itemId: params.itemId,
          filter: url.searchParams.get("filter")
        });
      })
    ],
    silentLogger
  );

  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Server did not bind to a TCP port");
  }

  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/items/abc?filter=recent`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(body, {
      itemId: "abc",
      filter: "recent"
    });
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("createJsonServer returns a structured 500 when handler throws", async () => {
  const server = createJsonServer(
    [
      route("GET", "/boom", async () => {
        throw new Error("boom");
      })
    ],
    silentLogger
  );

  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Server did not bind to a TCP port");
  }

  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/boom`);
    const body = await response.json();

    assert.equal(response.status, 500);
    assert.deepEqual(body, {
      error: "Internal server error",
      detail: "boom"
    });
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
