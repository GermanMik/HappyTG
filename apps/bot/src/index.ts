import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  createJsonServer,
  createLogger,
  json,
  loadHappyTGEnv,
  parseDotEnv,
  readJsonBody,
  readPort,
  route,
  telegramTokenStatus
} from "../../../packages/shared/src/index.js";

import type { BotDependencies, TelegramUpdate } from "./handlers.js";
import { createBotHandlers } from "./handlers.js";

const logger = createLogger("bot");

export function botConfigurationMessage(env = process.env, envFilePath?: string): string | undefined {
  const tokenState = telegramTokenStatus(env);
  switch (tokenState.status) {
    case "missing":
    case "placeholder":
      return envFilePath
        ? "Telegram bot token is missing. Set `TELEGRAM_BOT_TOKEN` in `.env`, then restart the bot."
        : "Telegram bot token is missing. Copy `.env.example` to `.env`, set `TELEGRAM_BOT_TOKEN`, then restart the bot.";
    case "invalid":
      return "Telegram bot token format looks invalid. Update `TELEGRAM_BOT_TOKEN`, then restart the bot.";
    case "configured":
    default:
      return undefined;
  }
}

function hydrateTelegramTokenFromEnvFile(env: NodeJS.ProcessEnv, envFilePath?: string): void {
  if (!envFilePath || telegramTokenStatus(env).configured) {
    return;
  }

  const parsed = parseDotEnv(readFileSync(envFilePath, "utf8"));
  const fileToken = parsed.TELEGRAM_BOT_TOKEN?.trim();
  if (!fileToken) {
    return;
  }

  if (telegramTokenStatus({ TELEGRAM_BOT_TOKEN: fileToken }).configured) {
    env.TELEGRAM_BOT_TOKEN = fileToken;
  }
}

export function initializeBotEnvironment(options?: {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  envFilePath?: string;
}): {
  envFilePath?: string;
  telegramConfigured: boolean;
  configurationMessage?: string;
} {
  const env = options?.env ?? process.env;
  const loaded = loadHappyTGEnv(options);
  hydrateTelegramTokenFromEnvFile(env, loaded.envFilePath);

  return {
    envFilePath: loaded.envFilePath,
    telegramConfigured: telegramTokenStatus(env).configured,
    configurationMessage: botConfigurationMessage(env, loaded.envFilePath)
  };
}

const botEnvironment = initializeBotEnvironment();
const botToken = process.env.TELEGRAM_BOT_TOKEN?.trim();
const apiBaseUrl = process.env.HAPPYTG_API_URL ?? "http://localhost:4000";
const port = readPort(process.env, ["HAPPYTG_BOT_PORT", "PORT"], 4100);

function createDefaultApiFetch() {
  return async function apiFetch<T>(pathname: string, init?: RequestInit): Promise<T> {
    const response = await fetch(new URL(pathname, apiBaseUrl), {
      ...init,
      headers: {
        "content-type": "application/json",
        ...(init?.headers ?? {})
      }
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`API ${pathname} failed with ${response.status}: ${text}`);
    }

    return (await response.json()) as T;
  };
}

function createDefaultSendTelegramMessage() {
  return async function sendTelegramMessage(chatId: number, text: string, replyMarkup?: Record<string, unknown>): Promise<void> {
    if (!botToken) {
      logger.info("Telegram token missing, logging reply instead", { chatId, text, replyMarkup });
      return;
    }

    const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        ...(replyMarkup ? { reply_markup: replyMarkup } : {})
      })
    });

    if (!response.ok) {
      logger.error("Telegram sendMessage failed", {
        status: response.status,
        body: await response.text()
      });
    }
  };
}

export function createBotServer(dependencies: Partial<BotDependencies> = {}) {
  const apiFetch = dependencies.apiFetch ?? createDefaultApiFetch();
  const sendTelegramMessage = dependencies.sendTelegramMessage ?? createDefaultSendTelegramMessage();
  const handlers = createBotHandlers({
    apiFetch,
    sendTelegramMessage,
    resolveInternalUserId: dependencies.resolveInternalUserId
  });

  return createJsonServer(
    [
      route("GET", "/health", async ({ res }) => {
        json(res, 200, { ok: true, service: "bot" });
      }),
      route("GET", "/ready", async ({ res }) => {
        try {
          await apiFetch<{ ok: boolean }>("/health");
          json(res, 200, { ok: true, service: "bot", apiBaseUrl });
        } catch (error) {
          json(res, 503, {
            ok: false,
            service: "bot",
            apiBaseUrl,
            detail: error instanceof Error ? error.message : "Unknown error"
          });
        }
      }),
      route("POST", "/telegram/webhook", async ({ req, res }) => {
        const update = await readJsonBody<TelegramUpdate>(req);
        if (update.message) {
          await handlers.handleMessage(update.message);
        }
        if (update.callback_query) {
          await handlers.handleCallbackQuery(update.callback_query);
        }

        json(res, 200, { ok: true });
      })
    ],
    logger
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const server = createBotServer();
  server.listen(port, () => {
    const configurationMessage = botEnvironment.configurationMessage;
    if (configurationMessage) {
      logger.warn(configurationMessage, { port, apiBaseUrl, telegramConfigured: false });
    } else {
      logger.info("Bot listening", { port, apiBaseUrl, telegramConfigured: true });
    }
  });
}
