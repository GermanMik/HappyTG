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
  json,
  readJsonFile,
  readTextFileOrEmpty,
  resolveHome,
  route,
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
  const originalHome = process.env.HOME;
  try {
    process.env.HOME = tempDir;

    const jsonPath = path.join(tempDir, "nested", "data.json");
    const textPath = path.join(tempDir, "nested", "notes.txt");

    assert.equal(resolveHome("~/workspace"), path.join(tempDir, "workspace"));

    await writeJsonFileAtomic(jsonPath, { ok: true, count: 2 });
    await writeTextFileAtomic(textPath, "hello");

    assert.deepEqual(await readJsonFile(jsonPath, { ok: false }), { ok: true, count: 2 });
    assert.equal(await readTextFileOrEmpty(textPath), "hello");
    assert.equal(await readTextFileOrEmpty(path.join(tempDir, "missing.txt")), "");
    assert.equal((await readFile(jsonPath, "utf8")).endsWith("\n"), true);
  } finally {
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
    await rm(tempDir, { recursive: true, force: true });
  }
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
