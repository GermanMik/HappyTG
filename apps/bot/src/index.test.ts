import assert from "node:assert/strict";
import test from "node:test";

import type { BotDependencies } from "./handlers.js";
import { createBotServer } from "./index.js";

test("bot ready endpoint returns healthy when api is reachable", async () => {
  const dependencies: Partial<BotDependencies> = {
    async apiFetch(pathname) {
      assert.equal(pathname, "/health");
      return { ok: true } as never;
    },
    async sendTelegramMessage() {}
  };

  const server = createBotServer(dependencies);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Bot server did not bind to a TCP port");
  }

  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/ready`);
    const payload = await response.json() as { ok: boolean; service: string };

    assert.equal(response.status, 200);
    assert.equal(payload.ok, true);
    assert.equal(payload.service, "bot");
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("bot ready endpoint returns 503 when api is unreachable", async () => {
  const dependencies: Partial<BotDependencies> = {
    async apiFetch() {
      throw new Error("upstream down");
    },
    async sendTelegramMessage() {}
  };

  const server = createBotServer(dependencies);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Bot server did not bind to a TCP port");
  }

  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/ready`);
    const payload = await response.json() as { ok: boolean; detail: string };

    assert.equal(response.status, 503);
    assert.equal(payload.ok, false);
    assert.match(payload.detail, /upstream down/);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
