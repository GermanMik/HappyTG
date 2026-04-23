import assert from "node:assert/strict";
import { createServer as createHttpServer } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import type { BotDependencies } from "./handlers.js";
import {
  botConfigurationMessage,
  createBotRuntime,
  createBotServer,
  createDefaultSendTelegramMessage,
  formatBotPortConflictMessageDetailed,
  formatBotPortReuseMessage,
  initializeBotEnvironment,
  inspectTelegramWebhookDelivery,
  resolveTelegramDeliveryMode,
  startBotServer,
  startTelegramPolling
} from "./index.js";

const VALID_BOT_TOKEN = "123456:abcdefghijklmnopqrstuvwx";

function telegramOk(result: unknown): Response {
  return new Response(JSON.stringify({
    ok: true,
    result
  }), {
    status: 200,
    headers: {
      "content-type": "application/json"
    }
  });
}

async function waitForCondition(predicate: () => boolean, timeoutMs = 1_000): Promise<void> {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error("Timed out waiting for condition");
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function closeServer(server: ReturnType<typeof createHttpServer>): Promise<void> {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

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

test("startBotServer reuses an already-running HappyTG bot on the same port", async () => {
  const occupied = createHttpServer((req, res) => {
    res.writeHead(req.url === "/ready" ? 503 : 200, {
      "content-type": "application/json"
    });
    res.end(JSON.stringify({ ok: req.url !== "/ready", service: "bot" }));
  });
  await new Promise<void>((resolve) => occupied.listen(0, resolve));
  const address = occupied.address();
  if (!address || typeof address === "string") {
    throw new Error("Occupied bot test server did not bind to a TCP port");
  }

  const server = createBotServer();
  const infoLogs: Array<{ message: string; metadata?: unknown }> = [];

  try {
    const result = await startBotServer(server, {
      port: address.port,
      logger: {
        info(message, metadata) {
          infoLogs.push({ message, metadata });
        }
      },
      reuseProbeWindowMs: 25,
      reuseProbeIntervalMs: 10
    });

    assert.deepEqual(result, { status: "reused", port: address.port });
    assert.equal(infoLogs[0]?.message, formatBotPortReuseMessage(address.port));
  } finally {
    if (server.listening) {
      await closeServer(server);
    }
    await closeServer(occupied);
  }
});

test("startBotServer rejects when a different HappyTG service occupies the bot port", async () => {
  const occupied = createHttpServer((_req, res) => {
    res.writeHead(200, {
      "content-type": "application/json"
    });
    res.end(JSON.stringify({ ok: true, service: "worker" }));
  });
  await new Promise<void>((resolve) => occupied.listen(0, resolve));
  const address = occupied.address();
  if (!address || typeof address === "string") {
    throw new Error("HappyTG service test server did not bind to a TCP port");
  }

  const server = createBotServer();

  try {
    await assert.rejects(
      () => startBotServer(server, {
        port: address.port,
        logger: { info() {} },
        reuseProbeWindowMs: 25,
        reuseProbeIntervalMs: 10
      }),
      new RegExp(formatBotPortConflictMessageDetailed(address.port, { service: "worker" }).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    );
  } finally {
    if (server.listening) {
      await closeServer(server);
    }
    await closeServer(occupied);
  }
});

test("startBotServer names a foreign HTTP listener when the port is occupied", async () => {
  const occupied = createHttpServer((_req, res) => {
    res.writeHead(200, {
      "content-type": "text/html"
    });
    res.end("<!doctype html><title>Contacts</title>");
  });
  await new Promise<void>((resolve) => occupied.listen(0, resolve));
  const address = occupied.address();
  if (!address || typeof address === "string") {
    throw new Error("Foreign HTTP listener test server did not bind to a TCP port");
  }

  const server = createBotServer();

  try {
    await assert.rejects(
      () => startBotServer(server, {
        port: address.port,
        logger: { info() {} },
        reuseProbeWindowMs: 25,
        reuseProbeIntervalMs: 10
      }),
      new RegExp(formatBotPortConflictMessageDetailed(address.port, { description: "HTTP listener (Contacts)" }).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    );
  } finally {
    if (server.listening) {
      await closeServer(server);
    }
    await closeServer(occupied);
  }
});

test("createBotRuntime reuses an existing HappyTG bot without starting a second Telegram delivery loop", async () => {
  const occupied = createHttpServer((req, res) => {
    res.writeHead(req.url === "/ready" ? 503 : 200, {
      "content-type": "application/json"
    });
    res.end(JSON.stringify({ ok: req.url !== "/ready", service: "bot" }));
  });
  await new Promise<void>((resolve) => occupied.listen(0, resolve));
  const address = occupied.address();
  if (!address || typeof address === "string") {
    throw new Error("Occupied bot runtime test server did not bind to a TCP port");
  }

  const telegramCalls: string[] = [];
  const infoLogs: string[] = [];
  const runtime = createBotRuntime({}, {
    env: {
      TELEGRAM_BOT_TOKEN: VALID_BOT_TOKEN,
      HAPPYTG_PUBLIC_URL: "http://localhost:4000"
    },
    port: address.port,
    reuseProbeWindowMs: 25,
    reuseProbeIntervalMs: 10,
    fetchImpl: async (input) => {
      telegramCalls.push(String(input));
      return telegramOk(true);
    },
    logger: {
      info(message) {
        infoLogs.push(message);
      },
      warn() {},
      error() {}
    }
  });

  try {
    const snapshot = await runtime.start();

    assert.equal(snapshot.activeMode, "polling");
    assert.deepEqual(telegramCalls, []);
    assert.equal(infoLogs[0], formatBotPortReuseMessage(address.port));
  } finally {
    await runtime.stop();
    await closeServer(occupied);
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

test("createDefaultSendTelegramMessage falls back to Windows PowerShell after a Node transport timeout", async () => {
  const timeoutFailure = new TypeError("fetch failed");
  Object.assign(timeoutFailure, {
    cause: {
      code: "UND_ERR_CONNECT_TIMEOUT",
      message: "Connect Timeout Error (attempted address: api.telegram.org:443, timeout: 10000ms)"
    }
  });

  const infoLogs: Array<{ message: string; metadata?: unknown }> = [];
  const errorLogs: Array<{ message: string; metadata?: unknown }> = [];
  const fallbackCalls: Array<{
    token: string;
    payload: {
      chat_id: number;
      text: string;
      reply_markup?: Record<string, unknown>;
    };
  }> = [];
  const sendTelegramMessage = createDefaultSendTelegramMessage({
    botToken: "123456:abcdefghijklmnopqrstuvwx",
    platform: "win32",
    fetchImpl: async () => {
      throw timeoutFailure;
    },
    sendViaWindowsPowerShell: async (token, payload) => {
      fallbackCalls.push({ token, payload });
      return { ok: true };
    },
    logger: {
      info(message, metadata) {
        infoLogs.push({ message, metadata });
      },
      warn() {},
      error(message, metadata) {
        errorLogs.push({ message, metadata });
      }
    }
  });

  await sendTelegramMessage(42, "hello", {
    inline_keyboard: [[{ text: "Open", callback_data: "open" }]]
  });

  assert.equal(fallbackCalls.length, 1);
  assert.equal(fallbackCalls[0]?.token, "123456:abcdefghijklmnopqrstuvwx");
  assert.deepEqual(fallbackCalls[0]?.payload, {
    chat_id: 42,
    text: "hello",
    reply_markup: {
      inline_keyboard: [[{ text: "Open", callback_data: "open" }]]
    }
  });
  assert.equal(errorLogs.length, 0);
  assert.match(infoLogs[0]?.message ?? "", /Windows PowerShell fallback/i);
});

test("createDefaultSendTelegramMessage logs parsed Telegram 400 descriptions from the Windows fallback", async () => {
  const errorLogs: Array<{ message: string; metadata?: unknown }> = [];
  const timeoutFailure = Object.assign(new Error("Node HTTPS sendMessage exceeded 1500ms before Windows fallback."), {
    code: "HAPPYTG_TELEGRAM_NODE_TIMEOUT"
  });
  const telegramDescription = "Bad Request: inline keyboard button Web App URL 'http://localhost:4000/miniapp?screen=home' is invalid: Only HTTPS links are allowed";
  const sendTelegramMessage = createDefaultSendTelegramMessage({
    botToken: VALID_BOT_TOKEN,
    platform: "win32",
    fetchImpl: async () => {
      throw timeoutFailure;
    },
    sendViaWindowsPowerShell: async () => ({
      ok: false,
      statusCode: 400,
      message: telegramDescription
    }),
    logger: {
      info() {},
      warn() {},
      error(message, metadata) {
        errorLogs.push({ message, metadata });
      }
    }
  });

  await sendTelegramMessage(42, "hello", {
    inline_keyboard: [[{ text: "Mini App", web_app: { url: "http://localhost:4000/miniapp?screen=home" } }]]
  });

  assert.equal(errorLogs.length, 1);
  assert.match(errorLogs[0]?.message ?? "", /sendMessage failed/i);
  assert.match(JSON.stringify(errorLogs[0]?.metadata ?? {}), /fallbackStatus\":400/);
  assert.match(JSON.stringify(errorLogs[0]?.metadata ?? {}), /Only HTTPS links are allowed/);
});

test("createDefaultSendTelegramMessage bounds the Windows Node attempt before fallback", async () => {
  const infoLogs: Array<{ message: string; metadata?: unknown }> = [];
  const errorLogs: Array<{ message: string; metadata?: unknown }> = [];
  let fetchCalls = 0;
  let fallbackCalls = 0;
  const sendTelegramMessage = createDefaultSendTelegramMessage({
    botToken: VALID_BOT_TOKEN,
    platform: "win32",
    nodeTransportTimeoutMs: 25,
    fetchImpl: async () => {
      fetchCalls += 1;
      return await new Promise<Response>(() => {});
    },
    sendViaWindowsPowerShell: async () => {
      fallbackCalls += 1;
      return { ok: true };
    },
    logger: {
      info(message, metadata) {
        infoLogs.push({ message, metadata });
      },
      warn() {},
      error(message, metadata) {
        errorLogs.push({ message, metadata });
      }
    }
  });

  const startedAt = Date.now();
  await sendTelegramMessage(42, "hello");
  const elapsedMs = Date.now() - startedAt;

  assert.equal(fetchCalls, 1);
  assert.equal(fallbackCalls, 1);
  assert.equal(errorLogs.length, 0);
  assert.match(infoLogs[0]?.message ?? "", /Windows PowerShell fallback/i);
  assert.ok(elapsedMs < 500, `Expected Windows fallback before the full Node timeout, got ${elapsedMs}ms.`);
});

test("createDefaultSendTelegramMessage keeps Telegram HTTP failures truthful without using fallback", async () => {
  const errorLogs: Array<{ message: string; metadata?: unknown }> = [];
  let fallbackCalls = 0;
  const sendTelegramMessage = createDefaultSendTelegramMessage({
    botToken: "123456:abcdefghijklmnopqrstuvwx",
    platform: "win32",
    fetchImpl: async () => new Response(JSON.stringify({
      ok: false,
      description: "Unauthorized"
    }), {
      status: 401,
      headers: {
        "content-type": "application/json"
      }
    }),
    sendViaWindowsPowerShell: async () => {
      fallbackCalls += 1;
      return { ok: true };
    },
    logger: {
      info() {},
      warn() {},
      error(message, metadata) {
        errorLogs.push({ message, metadata });
      }
    }
  });

  await sendTelegramMessage(42, "hello");

  assert.equal(fallbackCalls, 0);
  assert.equal(errorLogs.length, 1);
  assert.match(errorLogs[0]?.message ?? "", /sendMessage failed/i);
  assert.match(JSON.stringify(errorLogs[0]?.metadata ?? {}), /401/);
  assert.match(JSON.stringify(errorLogs[0]?.metadata ?? {}), /Unauthorized/);
});

test("resolveTelegramDeliveryMode selects polling for local auto mode", () => {
  const resolved = resolveTelegramDeliveryMode({
    env: {
      TELEGRAM_BOT_TOKEN: VALID_BOT_TOKEN,
      HAPPYTG_PUBLIC_URL: "http://localhost:4000"
    }
  });

  assert.equal(resolved.configuredMode, "auto");
  assert.equal(resolved.activeMode, "polling");
  assert.equal(resolved.status, "ready");
  assert.match(resolved.detail, /selected polling/i);
});

test("resolveTelegramDeliveryMode selects webhook for public https auto mode", () => {
  const resolved = resolveTelegramDeliveryMode({
    env: {
      TELEGRAM_BOT_TOKEN: VALID_BOT_TOKEN,
      HAPPYTG_PUBLIC_URL: "https://happy.example.com"
    }
  });

  assert.equal(resolved.configuredMode, "auto");
  assert.equal(resolved.activeMode, "webhook");
  assert.equal(resolved.status, "ready");
  assert.equal(resolved.expectedWebhookUrl, "https://happy.example.com/telegram/webhook");
});

test("resolveTelegramDeliveryMode keeps explicit webhook mode degraded when the public URL is not webhook-capable", () => {
  const resolved = resolveTelegramDeliveryMode({
    env: {
      TELEGRAM_BOT_TOKEN: VALID_BOT_TOKEN,
      TELEGRAM_UPDATES_MODE: "webhook",
      HAPPYTG_PUBLIC_URL: "http://localhost:4000"
    }
  });

  assert.equal(resolved.configuredMode, "webhook");
  assert.equal(resolved.activeMode, "webhook");
  assert.equal(resolved.status, "degraded");
  assert.match(resolved.detail, /requested/i);
  assert.match(resolved.detail, /HAPPYTG_PUBLIC_URL/i);
});

test("caddy and docs use the public /telegram/webhook contract", async () => {
  const caddy = await readFile(new URL("../../../infra/caddy/Caddyfile", import.meta.url), "utf8");
  const selfHosting = await readFile(new URL("../../../docs/self-hosting.md", import.meta.url), "utf8");

  assert.match(caddy, /handle \/telegram\/webhook/);
  assert.doesNotMatch(caddy, /\/bot\/webhook/);
  assert.match(selfHosting, /\/telegram\/webhook/);
  assert.doesNotMatch(selfHosting, /\/bot\/webhook/);
});

test("ready endpoint reports disabled Mini App launch buttons with the local Mini App port", async () => {
  const runtime = createBotRuntime({
    async apiFetch(pathname) {
      assert.equal(pathname, "/health");
      return { ok: true } as never;
    }
  }, {
    env: {
      TELEGRAM_BOT_TOKEN: VALID_BOT_TOKEN,
      HAPPYTG_MINIAPP_PORT: "3007",
      HAPPYTG_PUBLIC_URL: "http://localhost:4000",
      HAPPYTG_APP_URL: "http://localhost:3007"
    },
    port: 0,
    fetchImpl: async (input) => {
      const method = String(input).match(/\/bot[^/]+\/([^/?]+)/u)?.[1] ?? "unknown";
      if (method === "deleteWebhook") {
        return telegramOk(true);
      }
      if (method === "getUpdates") {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return telegramOk([]);
      }
      throw new Error(`Unexpected Telegram method ${method}`);
    }
  });

  try {
    await runtime.start();
    const address = runtime.server.address();
    if (!address || typeof address === "string") {
      throw new Error("Bot runtime did not bind to a TCP port");
    }

    const response = await fetch(`http://127.0.0.1:${address.port}/ready`);
    const payload = await response.json() as {
      ok: boolean;
      miniAppLaunch?: {
        status: string;
        url?: string;
        detail: string;
      };
    };

    assert.equal(response.status, 200);
    assert.equal(payload.ok, true);
    assert.equal(payload.miniAppLaunch?.status, "disabled");
    assert.equal(payload.miniAppLaunch?.url, "http://localhost:3007/");
    assert.match(payload.miniAppLaunch?.detail ?? "", /Local polling can still handle Telegram bot commands/i);
    assert.match(payload.miniAppLaunch?.detail ?? "", /public HTTPS/i);
  } finally {
    await runtime.stop();
  }
});

test("webhook endpoint dispatches updates through the shared bot handlers", async () => {
  const messages: Array<{ chatId: number; text: string }> = [];
  const server = createBotServer({
    async sendTelegramMessage(chatId, text) {
      messages.push({ chatId, text });
    }
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Bot server did not bind to a TCP port");
  }

  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/telegram/webhook`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        update_id: 1,
        message: {
          message_id: 1,
          text: "/start",
          chat: { id: 42 },
          from: { id: 42, username: "dev" }
        }
      })
    });

    assert.equal(response.status, 200);
    assert.equal(messages.length, 1);
    assert.match(messages[0]?.text ?? "", /Сначала подключите host/i);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("local polling mode receives /start without a public webhook", async () => {
  const messages: Array<{ chatId: number; text: string }> = [];
  const telegramCalls: string[] = [];
  let getUpdatesCalls = 0;
  const runtime = createBotRuntime({
    async sendTelegramMessage(chatId, text) {
      messages.push({ chatId, text });
    }
  }, {
    env: {
      TELEGRAM_BOT_TOKEN: VALID_BOT_TOKEN,
      HAPPYTG_PUBLIC_URL: "http://localhost:4000"
    },
    port: 0,
    fetchImpl: async (input) => {
      const match = String(input).match(/\/bot[^/]+\/([^/?]+)/u);
      const method = match?.[1] ?? "unknown";
      telegramCalls.push(method);
      if (method === "deleteWebhook") {
        return telegramOk(true);
      }
      if (method === "getUpdates") {
        getUpdatesCalls += 1;
        if (getUpdatesCalls === 1) {
          return telegramOk([
            {
              update_id: 101,
              message: {
                message_id: 1,
                text: "/start",
                chat: { id: 7 },
                from: { id: 7, username: "localdev" }
              }
            }
          ]);
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
        return telegramOk([]);
      }
      throw new Error(`Unexpected Telegram method ${method}`);
    }
  });

  try {
    const snapshot = await runtime.start();
    await waitForCondition(() => messages.length === 1);

    assert.equal(snapshot.activeMode, "polling");
    assert.equal(runtime.deliveryState.read().status, "ready");
    assert.deepEqual(telegramCalls.slice(0, 2), ["deleteWebhook", "getUpdates"]);
    assert.match(messages[0]?.text ?? "", /\/pair CODE/);
  } finally {
    await runtime.stop();
  }
});

test("local polling mode receives /pair and preserves the pairing claim API boundary", async () => {
  const messages: Array<{ chatId: number; text: string }> = [];
  const apiCalls: Array<{ pathname: string; init?: RequestInit }> = [];
  let getUpdatesCalls = 0;
  const runtime = createBotRuntime({
    async apiFetch(pathname, init) {
      apiCalls.push({ pathname, init });
      if (pathname === "/api/v1/pairing/claim") {
        return {
          user: { id: "usr_1", displayName: "Local Dev" },
          host: { id: "host_1", label: "devbox" }
        } as never;
      }
      throw new Error(`Unexpected path ${pathname}`);
    },
    async sendTelegramMessage(chatId, text) {
      messages.push({ chatId, text });
    }
  }, {
    env: {
      TELEGRAM_BOT_TOKEN: VALID_BOT_TOKEN,
      HAPPYTG_PUBLIC_URL: "http://localhost:4000"
    },
    port: 0,
    fetchImpl: async (input) => {
      const method = String(input).match(/\/bot[^/]+\/([^/?]+)/u)?.[1] ?? "unknown";
      if (method === "deleteWebhook") {
        return telegramOk(true);
      }
      if (method === "getUpdates") {
        getUpdatesCalls += 1;
        if (getUpdatesCalls === 1) {
          return telegramOk([
            {
              update_id: 202,
              message: {
                message_id: 2,
                text: "/pair CODE-123",
                chat: { id: 9 },
                from: {
                  id: 99,
                  username: "pairer",
                  first_name: "Local",
                  last_name: "Dev"
                }
              }
            }
          ]);
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
        return telegramOk([]);
      }
      throw new Error(`Unexpected Telegram method ${method}`);
    }
  });

  try {
    await runtime.start();
    await waitForCondition(() => messages.length === 1);

    assert.equal(apiCalls[0]?.pathname, "/api/v1/pairing/claim");
    assert.equal(apiCalls[0]?.init?.method, "POST");
    assert.deepEqual(JSON.parse(String(apiCalls[0]?.init?.body ?? "{}")), {
      pairingCode: "CODE-123",
      telegramUserId: "99",
      chatId: "9",
      username: "pairer",
      displayName: "Local Dev"
    });
    assert.match(messages[0]?.text ?? "", /Host подключен: devbox/);
  } finally {
    await runtime.stop();
  }
});

test("local polling mode skips a failing update and continues with later updates", async () => {
  const messages: Array<{ chatId: number; text: string }> = [];
  const apiCalls: Array<{ pathname: string; init?: RequestInit }> = [];
  const offsets: number[] = [];
  const errorLogs: Array<{ message: string; metadata?: unknown }> = [];
  const warnLogs: Array<{ message: string; metadata?: unknown }> = [];
  const runtime = createBotRuntime({
    async apiFetch(pathname, init) {
      apiCalls.push({ pathname, init });
      if (pathname === "/api/v1/pairing/claim") {
        throw new Error("API /api/v1/pairing/claim failed with 500: {\n  \"error\": \"Internal server error\",\n  \"detail\": \"Pairing code expired\"\n}\n");
      }
      throw new Error(`Unexpected path ${pathname}`);
    },
    async sendTelegramMessage(chatId, text) {
      messages.push({ chatId, text });
    }
  }, {
    env: {
      TELEGRAM_BOT_TOKEN: VALID_BOT_TOKEN,
      HAPPYTG_PUBLIC_URL: "http://localhost:4000"
    },
    port: 0,
    fetchImpl: async (input, init) => {
      const method = String(input).match(/\/bot[^/]+\/([^/?]+)/u)?.[1] ?? "unknown";
      if (method === "deleteWebhook") {
        return telegramOk(true);
      }
      if (method === "getUpdates") {
        const payload = JSON.parse(String(init?.body ?? "{}")) as { offset?: number };
        offsets.push(payload.offset ?? 0);
        if ((payload.offset ?? 0) === 0) {
          return telegramOk([
            {
              update_id: 401,
              message: {
                message_id: 4,
                text: "/pair EXPIRED-CODE",
                chat: { id: 21 },
                from: {
                  id: 211,
                  username: "pairer",
                  first_name: "Expired",
                  last_name: "Pair"
                }
              }
            },
            {
              update_id: 402,
              message: {
                message_id: 5,
                text: "/start",
                chat: { id: 21 },
                from: { id: 211, username: "pairer" }
              }
            }
          ]);
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
        return telegramOk([]);
      }
      throw new Error(`Unexpected Telegram method ${method}`);
    },
    logger: {
      info() {},
      warn(message, metadata) {
        warnLogs.push({ message, metadata });
      },
      error(message, metadata) {
        errorLogs.push({ message, metadata });
      }
    }
  });

  try {
    const snapshot = await runtime.start();
    await waitForCondition(() => messages.length >= 2 && offsets.length >= 2);

    assert.equal(snapshot.activeMode, "polling");
    assert.equal(runtime.deliveryState.read().status, "ready");
    assert.deepEqual(offsets.slice(0, 2), [0, 403]);
    assert.equal(apiCalls.filter((call) => call.pathname === "/api/v1/pairing/claim").length, 1);
    assert.equal(warnLogs.length, 0);
    assert.equal(errorLogs.length, 0);
    assert.match(messages[0]?.text ?? "", /Pairing code истек/i);
    assert.match(messages[1]?.text ?? "", /Сначала подключите host/i);
  } finally {
    await runtime.stop();
  }
});

test("local polling mode falls back to Windows PowerShell Bot API calls after a Node transport timeout", async () => {
  const timeoutFailure = new TypeError("fetch failed");
  Object.assign(timeoutFailure, {
    cause: {
      code: "UND_ERR_CONNECT_TIMEOUT",
      message: "Connect Timeout Error (attempted address: api.telegram.org:443, timeout: 10000ms)"
    }
  });

  const infoLogs: string[] = [];
  const warnLogs: Array<{ message: string; metadata?: unknown }> = [];
  const messages: Array<{ chatId: number; text: string }> = [];
  const fallbackCalls: string[] = [];
  let getUpdatesCalls = 0;
  const runtime = createBotRuntime({
    async sendTelegramMessage(chatId, text) {
      messages.push({ chatId, text });
    }
  }, {
    env: {
      TELEGRAM_BOT_TOKEN: VALID_BOT_TOKEN,
      HAPPYTG_PUBLIC_URL: "http://localhost:4000"
    },
    port: 0,
    platform: "win32",
    fetchImpl: async () => {
      throw timeoutFailure;
    },
    invokeTelegramApiViaWindowsPowerShell: async (method) => {
      fallbackCalls.push(method);
      if (method === "deleteWebhook") {
        return { ok: true, result: true };
      }
      if (method === "getUpdates") {
        getUpdatesCalls += 1;
        if (getUpdatesCalls === 1) {
          return {
            ok: true,
            result: [
              {
                update_id: 303,
                message: {
                  message_id: 3,
                  text: "/start",
                  chat: { id: 17 },
                  from: { id: 17, username: "fallback" }
                }
              }
            ]
          };
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
        return { ok: true, result: [] };
      }
      throw new Error(`Unexpected Telegram method ${method}`);
    },
    logger: {
      info(message) {
        infoLogs.push(message);
      },
      warn(message, metadata) {
        warnLogs.push({ message, metadata });
      },
      error() {}
    }
  });

  try {
    const snapshot = await runtime.start();
    await waitForCondition(() => messages.length === 1);

    assert.equal(snapshot.activeMode, "polling");
    assert.equal(snapshot.status, "ready");
    assert.deepEqual(fallbackCalls.slice(0, 2), ["deleteWebhook", "getUpdates"]);
    assert.match(infoLogs.join("\n"), /deleteWebhook delivered via Windows PowerShell fallback/i);
    assert.match(infoLogs.join("\n"), /getUpdates delivered via Windows PowerShell fallback/i);
    assert.equal(warnLogs.length, 0);
    assert.match(messages[0]?.text ?? "", /Сначала подключите host/i);
  } finally {
    await runtime.stop();
  }
});

test("polling control-plane bounds a hanging Node attempt and prefers PowerShell on the next polls", async () => {
  const fetchCalls: string[] = [];
  const fallbackCalls: Array<{ method: string; timeoutSec?: number }> = [];
  const infoLogs: Array<{ message: string; metadata?: unknown }> = [];
  const methodFromInput = (input: unknown) => String(input).match(/\/bot[^/]+\/([^/?]+)/u)?.[1] ?? "unknown";
  const startedAt = Date.now();
  const controller = startTelegramPolling({
    botToken: VALID_BOT_TOKEN,
    platform: "win32",
    pollTimeoutSeconds: 30,
    nodeTransportTimeoutMs: 25,
    retryDelayMs: 25,
    fetchImpl: async (input) => {
      fetchCalls.push(methodFromInput(input));
      return await new Promise<Response>(() => {});
    },
    invokeViaWindowsPowerShell: async (method, _token, _payload, options) => {
      fallbackCalls.push({ method, timeoutSec: options?.timeoutSec });
      await new Promise((resolve) => setTimeout(resolve, 5));
      return { ok: true, result: method === "deleteWebhook" ? true : [] };
    },
    async dispatchUpdate() {},
    logger: {
      info(message, metadata) {
        infoLogs.push({ message, metadata });
      },
      warn() {},
      error() {}
    }
  });

  try {
    const snapshot = await controller.ready;
    await waitForCondition(() => fallbackCalls.filter((call) => call.method === "getUpdates").length >= 2);
    const elapsedMs = Date.now() - startedAt;

    assert.equal(snapshot.status, "ready");
    assert.deepEqual(fetchCalls, ["deleteWebhook"]);
    assert.deepEqual(fallbackCalls.slice(0, 3), [
      { method: "deleteWebhook", timeoutSec: 10 },
      { method: "getUpdates", timeoutSec: 40 },
      { method: "getUpdates", timeoutSec: 40 }
    ]);
    assert.ok(elapsedMs < 500, `Expected bounded control-plane fallback before the full Node timeout, got ${elapsedMs}ms.`);
    assert.match(infoLogs.map((log) => log.message).join("\n"), /getUpdates delivered via Windows PowerShell fallback/i);
    assert.match(JSON.stringify(infoLogs), /transportPreference/);
  } finally {
    await controller.stop();
  }
});

test("polling preserves healthy Node long polling instead of applying the control-plane timeout to getUpdates", async () => {
  const fetchCalls: string[] = [];
  let fallbackCalls = 0;
  let getUpdatesCalls = 0;
  const methodFromInput = (input: unknown) => String(input).match(/\/bot[^/]+\/([^/?]+)/u)?.[1] ?? "unknown";
  const controller = startTelegramPolling({
    botToken: VALID_BOT_TOKEN,
    platform: "win32",
    pollTimeoutSeconds: 30,
    nodeTransportTimeoutMs: 25,
    retryDelayMs: 25,
    fetchImpl: async (input) => {
      const method = methodFromInput(input);
      fetchCalls.push(method);
      if (method === "deleteWebhook") {
        return telegramOk(true);
      }
      if (method === "getUpdates") {
        getUpdatesCalls += 1;
        await new Promise((resolve) => setTimeout(resolve, getUpdatesCalls === 1 ? 50 : 5));
        return telegramOk([]);
      }
      throw new Error(`Unexpected Telegram method ${method}`);
    },
    invokeViaWindowsPowerShell: async () => {
      fallbackCalls += 1;
      return { ok: true, result: [] };
    },
    async dispatchUpdate() {},
    logger: {
      info() {},
      warn() {},
      error() {}
    }
  });

  try {
    const snapshot = await controller.ready;
    await waitForCondition(() => getUpdatesCalls >= 1);

    assert.equal(snapshot.status, "ready");
    assert.deepEqual(fetchCalls.slice(0, 2), ["deleteWebhook", "getUpdates"]);
    assert.equal(fallbackCalls, 0);
  } finally {
    await controller.stop();
  }
});

test("polling control-plane keeps Telegram HTTP failures truthful without PowerShell fallback", async () => {
  let fallbackCalls = 0;
  const warnLogs: Array<{ message: string; metadata?: unknown }> = [];
  const controller = startTelegramPolling({
    botToken: VALID_BOT_TOKEN,
    platform: "win32",
    retryDelayMs: 25,
    fetchImpl: async () => new Response(JSON.stringify({
      ok: false,
      description: "Unauthorized"
    }), {
      status: 401,
      headers: {
        "content-type": "application/json"
      }
    }),
    invokeViaWindowsPowerShell: async () => {
      fallbackCalls += 1;
      return { ok: true, result: true };
    },
    async dispatchUpdate() {},
    logger: {
      info() {},
      warn(message, metadata) {
        warnLogs.push({ message, metadata });
      },
      error() {}
    }
  });

  try {
    const snapshot = await controller.ready;

    assert.equal(snapshot.status, "degraded");
    assert.equal(fallbackCalls, 0);
    assert.match(snapshot.detail ?? "", /Telegram deleteWebhook failed with 401/i);
    assert.match(snapshot.detail ?? "", /Unauthorized/i);
    assert.equal(warnLogs.length, 1);
  } finally {
    await controller.stop();
  }
});

test("polling mode stays degraded with actionable detail when both Telegram transports fail on Windows", async () => {
  const runtime = createBotRuntime({}, {
    env: {
      TELEGRAM_BOT_TOKEN: VALID_BOT_TOKEN,
      HAPPYTG_PUBLIC_URL: "http://localhost:4000"
    },
    port: 0,
    platform: "win32",
    telegramApiNodeTransportTimeoutMs: 25,
    fetchImpl: async () => await new Promise<Response>(() => {}),
    invokeTelegramApiViaWindowsPowerShell: async () => ({
      ok: false,
      message: "Proxy authentication required."
    })
  });

  try {
    const snapshot = await runtime.start();

    assert.equal(snapshot.activeMode, "polling");
    assert.equal(snapshot.status, "degraded");
    assert.match(snapshot.detail, /Node HTTPS/i);
    assert.match(snapshot.detail, /pre-fallback timeout/i);
    assert.match(snapshot.detail, /Windows PowerShell Bot API fallback also failed/i);
    assert.match(snapshot.detail, /Proxy authentication required/i);
  } finally {
    await runtime.stop();
  }
});

test("webhook mode stays separate from polling and reports degraded readiness when Telegram webhook is not configured", async () => {
  const telegramCalls: string[] = [];
  const runtime = createBotRuntime({
    async apiFetch(pathname) {
      assert.equal(pathname, "/health");
      return { ok: true } as never;
    }
  }, {
    env: {
      TELEGRAM_BOT_TOKEN: VALID_BOT_TOKEN,
      TELEGRAM_UPDATES_MODE: "webhook",
      HAPPYTG_PUBLIC_URL: "https://happy.example.com"
    },
    port: 0,
    fetchImpl: async (input) => {
      const method = String(input).match(/\/bot[^/]+\/([^/?]+)/u)?.[1] ?? "unknown";
      telegramCalls.push(method);
      if (method === "getWebhookInfo") {
        return telegramOk({
          url: "",
          pending_update_count: 3
        });
      }
      throw new Error(`Unexpected Telegram method ${method}`);
    }
  });

  try {
    const snapshot = await runtime.start();
    const address = runtime.server.address();
    if (!address || typeof address === "string") {
      throw new Error("Bot runtime did not bind to a TCP port");
    }

    const response = await fetch(`http://127.0.0.1:${address.port}/ready`);
    const payload = await response.json() as {
      ok: boolean;
      detail: string;
      telegram: {
        activeMode: string;
        pendingUpdateCount?: number;
      };
    };

    assert.equal(snapshot.activeMode, "webhook");
    assert.equal(snapshot.status, "degraded");
    assert.deepEqual(telegramCalls, ["getWebhookInfo"]);
    assert.equal(response.status, 503);
    assert.equal(payload.ok, false);
    assert.equal(payload.telegram.activeMode, "webhook");
    assert.equal(payload.telegram.pendingUpdateCount, 3);
    assert.match(payload.detail, /expects https:\/\/happy\.example\.com\/telegram\/webhook/i);
  } finally {
    await runtime.stop();
  }
});

test("bot runtime reports Mini App launch readiness without auto-configuring Telegram menu button", async () => {
  const telegramCalls: Array<{ method: string; payload?: unknown }> = [];
  const runtime = createBotRuntime({
    async apiFetch(pathname) {
      assert.equal(pathname, "/health");
      return { ok: true } as never;
    }
  }, {
    env: {
      TELEGRAM_BOT_TOKEN: VALID_BOT_TOKEN,
      TELEGRAM_UPDATES_MODE: "webhook",
      HAPPYTG_PUBLIC_URL: "https://happy.example.com"
    },
    port: 0,
    fetchImpl: async (input, init) => {
      const method = String(input).match(/\/bot[^/]+\/([^/?]+)/u)?.[1] ?? "unknown";
      telegramCalls.push({
        method,
        payload: init?.body ? JSON.parse(String(init.body)) : undefined
      });
      if (method === "getWebhookInfo") {
        return telegramOk({
          url: "https://happy.example.com/telegram/webhook",
          pending_update_count: 0
        });
      }
      throw new Error(`Unexpected Telegram method ${method}`);
    }
  });

  try {
    await runtime.start();
    const address = runtime.server.address();
    if (!address || typeof address === "string") {
      throw new Error("Bot runtime did not bind to a TCP port");
    }

    const response = await fetch(`http://127.0.0.1:${address.port}/ready`);
    const payload = await response.json() as { ok: boolean; miniAppLaunch: { status: string; url?: string } };

    assert.equal(response.status, 200);
    assert.equal(payload.ok, true);
    assert.equal(payload.miniAppLaunch.status, "ready");
    assert.equal(payload.miniAppLaunch.url, "https://happy.example.com/miniapp");
    assert.deepEqual(telegramCalls.map((call) => call.method), ["getWebhookInfo"]);
  } finally {
    await runtime.stop();
  }
});

test("bot ready keeps Telegram delivery healthy when Mini App public URL is invalid", async () => {
  let getUpdatesCalls = 0;
  const runtime = createBotRuntime({
    async apiFetch(pathname) {
      assert.equal(pathname, "/health");
      return { ok: true } as never;
    }
  }, {
    env: {
      TELEGRAM_BOT_TOKEN: VALID_BOT_TOKEN,
      TELEGRAM_UPDATES_MODE: "polling",
      HAPPYTG_MINIAPP_URL: "http://localhost:3001"
    },
    port: 0,
    fetchImpl: async (input) => {
      const method = String(input).match(/\/bot[^/]+\/([^/?]+)/u)?.[1] ?? "unknown";
      if (method === "deleteWebhook") {
        return telegramOk(true);
      }
      if (method === "getUpdates") {
        getUpdatesCalls += 1;
        await new Promise((resolve) => setTimeout(resolve, getUpdatesCalls === 1 ? 1 : 25));
        return telegramOk([]);
      }
      throw new Error(`Unexpected Telegram method ${method}`);
    }
  });

  try {
    await runtime.start();
    const address = runtime.server.address();
    if (!address || typeof address === "string") {
      throw new Error("Bot runtime did not bind to a TCP port");
    }

    const response = await fetch(`http://127.0.0.1:${address.port}/ready`);
    const payload = await response.json() as { ok: boolean; miniAppLaunch: { status: string; detail: string } };

    assert.equal(response.status, 200);
    assert.equal(payload.ok, true);
    assert.equal(payload.miniAppLaunch.status, "disabled");
    assert.match(payload.miniAppLaunch.detail, /HTTPS|localhost/i);
  } finally {
    await runtime.stop();
  }
});

test("webhook inspection falls back to Windows PowerShell Bot API calls after a Node transport timeout", async () => {
  const timeoutFailure = new TypeError("fetch failed");
  Object.assign(timeoutFailure, {
    cause: {
      code: "UND_ERR_CONNECT_TIMEOUT",
      message: "Connect Timeout Error (attempted address: api.telegram.org:443, timeout: 10000ms)"
    }
  });

  const fallbackCalls: string[] = [];
  const runtime = createBotRuntime({
    async apiFetch(pathname) {
      assert.equal(pathname, "/health");
      return { ok: true } as never;
    }
  }, {
    env: {
      TELEGRAM_BOT_TOKEN: VALID_BOT_TOKEN,
      TELEGRAM_UPDATES_MODE: "webhook",
      HAPPYTG_PUBLIC_URL: "https://happy.example.com"
    },
    port: 0,
    platform: "win32",
    fetchImpl: async () => {
      throw timeoutFailure;
    },
    invokeTelegramApiViaWindowsPowerShell: async (method) => {
      fallbackCalls.push(method);
      if (method === "getWebhookInfo") {
        return {
          ok: true,
          result: {
            url: "https://happy.example.com/telegram/webhook",
            pending_update_count: 0
          }
        };
      }
      throw new Error(`Unexpected Telegram method ${method}`);
    }
  });

  try {
    const snapshot = await runtime.start();
    const address = runtime.server.address();
    if (!address || typeof address === "string") {
      throw new Error("Bot runtime did not bind to a TCP port");
    }

    const response = await fetch(`http://127.0.0.1:${address.port}/ready`);
    const payload = await response.json() as { ok: boolean; telegram: { status: string }; miniAppLaunch: { status: string } };

    assert.equal(snapshot.activeMode, "webhook");
    assert.equal(snapshot.status, "ready");
    assert.deepEqual(fallbackCalls, ["getWebhookInfo"]);
    assert.equal(response.status, 200);
    assert.equal(payload.ok, true);
    assert.equal(payload.telegram.status, "ready");
    assert.equal(payload.miniAppLaunch.status, "ready");
  } finally {
    await runtime.stop();
  }
});

test("webhook inspection bounds a hanging Node attempt before PowerShell fallback", async () => {
  const fallbackCalls: Array<{ method: string; timeoutSec?: number }> = [];
  const infoLogs: Array<{ message: string; metadata?: unknown }> = [];
  const startedAt = Date.now();

  const snapshot = await inspectTelegramWebhookDelivery({
    botToken: VALID_BOT_TOKEN,
    expectedWebhookUrl: "https://happy.example.com/telegram/webhook",
    platform: "win32",
    nodeTransportTimeoutMs: 25,
    fetchImpl: async () => await new Promise<Response>(() => {}),
    invokeViaWindowsPowerShell: async (method, _token, _payload, options) => {
      fallbackCalls.push({ method, timeoutSec: options?.timeoutSec });
      return {
        ok: true,
        result: {
          url: "https://happy.example.com/telegram/webhook",
          pending_update_count: 0
        }
      };
    },
    logger: {
      info(message, metadata) {
        infoLogs.push({ message, metadata });
      },
      warn() {},
      error() {}
    }
  });

  const elapsedMs = Date.now() - startedAt;
  assert.equal(snapshot.status, "ready");
  assert.deepEqual(fallbackCalls, [{ method: "getWebhookInfo", timeoutSec: 10 }]);
  assert.ok(elapsedMs < 500, `Expected webhook inspection fallback before the full Node timeout, got ${elapsedMs}ms.`);
  assert.match(infoLogs[0]?.message ?? "", /getWebhookInfo delivered via Windows PowerShell fallback/i);
});
