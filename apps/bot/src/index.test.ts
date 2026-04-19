import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import type { BotDependencies } from "./handlers.js";
import {
  botConfigurationMessage,
  createBotRuntime,
  createBotServer,
  createDefaultSendTelegramMessage,
  initializeBotEnvironment,
  resolveTelegramDeliveryMode
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
    assert.match(messages[0]?.text ?? "", /HappyTG bot is ready/i);
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
    assert.match(messages[0]?.text ?? "", /\/pair <PAIRING_CODE>/);
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
    assert.match(messages[0]?.text ?? "", /Host paired: devbox/);
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
    assert.match(messages[0]?.text ?? "", /HappyTG bot is ready/i);
  } finally {
    await runtime.stop();
  }
});

test("polling mode stays degraded with actionable detail when both Telegram transports fail on Windows", async () => {
  const timeoutFailure = new TypeError("fetch failed");
  Object.assign(timeoutFailure, {
    cause: {
      code: "UND_ERR_CONNECT_TIMEOUT",
      message: "Connect Timeout Error (attempted address: api.telegram.org:443, timeout: 10000ms)"
    }
  });

  const runtime = createBotRuntime({}, {
    env: {
      TELEGRAM_BOT_TOKEN: VALID_BOT_TOKEN,
      HAPPYTG_PUBLIC_URL: "http://localhost:4000"
    },
    port: 0,
    platform: "win32",
    fetchImpl: async () => {
      throw timeoutFailure;
    },
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
    const payload = await response.json() as { ok: boolean; telegram: { status: string } };

    assert.equal(snapshot.activeMode, "webhook");
    assert.equal(snapshot.status, "ready");
    assert.deepEqual(fallbackCalls, ["getWebhookInfo"]);
    assert.equal(response.status, 200);
    assert.equal(payload.ok, true);
    assert.equal(payload.telegram.status, "ready");
  } finally {
    await runtime.stop();
  }
});
