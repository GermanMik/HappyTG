import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import type { BotDependencies } from "./handlers.js";
import { botConfigurationMessage, createBotServer, initializeBotEnvironment } from "./index.js";

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

test("botConfigurationMessage stays actionable without exposing secrets", () => {
  assert.match(botConfigurationMessage({}, undefined) ?? "", /Copy `.env.example` to `.env`/);
  assert.match(botConfigurationMessage({}, "/tmp/.env") ?? "", /TELEGRAM_BOT_TOKEN/);
  assert.match(botConfigurationMessage({ TELEGRAM_BOT_TOKEN: "abc" }) ?? "", /format looks invalid/);
  assert.equal(botConfigurationMessage({ TELEGRAM_BOT_TOKEN: "123456:abcdefghijklmnopqrstuvwx" }), undefined);
});

test("initializeBotEnvironment prefers a valid .env token over placeholder shell state", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "happytg-bot-env-"));
  try {
    const env: NodeJS.ProcessEnv = {
      TELEGRAM_BOT_TOKEN: "replace-me"
    };
    await writeFile(path.join(tempDir, ".env"), "TELEGRAM_BOT_TOKEN=123456:abcdefghijklmnopqrstuvwx\n", "utf8");

    const initialized = initializeBotEnvironment({
      cwd: tempDir,
      env
    });

    assert.equal(initialized.telegramConfigured, true);
    assert.equal(initialized.configurationMessage, undefined);
    assert.equal(env.TELEGRAM_BOT_TOKEN, "123456:abcdefghijklmnopqrstuvwx");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
