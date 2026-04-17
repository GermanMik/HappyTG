import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
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
import type { Logger } from "../../../packages/shared/src/index.js";

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

interface TelegramSendMessagePayload {
  chat_id: number;
  text: string;
  reply_markup?: Record<string, unknown>;
}

interface WindowsPowerShellTelegramSendResult {
  ok: boolean;
  statusCode?: number;
  message?: string;
}

interface CreateDefaultSendTelegramMessageOptions {
  botToken?: string;
  fetchImpl?: typeof fetch;
  platform?: NodeJS.Platform;
  logger?: Logger;
  sendViaWindowsPowerShell?: (
    token: string,
    payload: TelegramSendMessagePayload
  ) => Promise<WindowsPowerShellTelegramSendResult | undefined>;
}

function windowsPowerShellPath(): string {
  return process.env.SystemRoot
    ? path.join(process.env.SystemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
    : "powershell.exe";
}

async function sendTelegramMessageViaWindowsPowerShell(
  token: string,
  payload: TelegramSendMessagePayload,
  platform: NodeJS.Platform = process.platform
): Promise<WindowsPowerShellTelegramSendResult | undefined> {
  if (platform !== "win32") {
    return undefined;
  }

  const script = [
    "$ErrorActionPreference = 'Stop'",
    "$ProgressPreference = 'SilentlyContinue'",
    "$token = $env:HAPPYTG_TELEGRAM_BOT_TOKEN_PROBE",
    "$payloadJson = $env:HAPPYTG_TELEGRAM_SEND_MESSAGE_PAYLOAD",
    "if (-not $token) {",
    "  @{ ok = $false; message = 'Bot token was not provided to the PowerShell fallback.' } | ConvertTo-Json -Compress",
    "  exit 0",
    "}",
    "if (-not $payloadJson) {",
    "  @{ ok = $false; message = 'Telegram sendMessage payload was not provided to the PowerShell fallback.' } | ConvertTo-Json -Compress",
    "  exit 0",
    "}",
    "$uri = \"https://api.telegram.org/bot$token/sendMessage\"",
    "try {",
    "  $response = Invoke-RestMethod -Uri $uri -Method Post -ContentType 'application/json' -Body $payloadJson -TimeoutSec 20",
    "  if ($response.ok) {",
    "    @{ ok = $true } | ConvertTo-Json -Compress",
    "  } else {",
    "    @{ ok = $false; message = if ($response.description) { [string]$response.description } else { 'Telegram API rejected sendMessage.' } } | ConvertTo-Json -Compress",
    "  }",
    "} catch {",
    "  $response = $_.Exception.Response",
    "  if ($response) {",
    "    $statusCode = [int]$response.StatusCode",
    "    $fallbackMessage = [string]$_.Exception.Message",
    "    try {",
    "      $stream = $response.GetResponseStream()",
    "      $reader = [System.IO.StreamReader]::new($stream)",
    "      $body = $reader.ReadToEnd()",
    "      if ($body) {",
    "        $json = $body | ConvertFrom-Json",
    "        $description = if ($json.description) { [string]$json.description } else { $fallbackMessage }",
    "        @{ ok = $false; statusCode = $statusCode; message = $description } | ConvertTo-Json -Compress",
    "      } else {",
    "        @{ ok = $false; statusCode = $statusCode; message = $fallbackMessage } | ConvertTo-Json -Compress",
    "      }",
    "    } catch {",
    "      @{ ok = $false; statusCode = $statusCode; message = $fallbackMessage } | ConvertTo-Json -Compress",
    "    }",
    "  } else {",
    "    @{ ok = $false; message = [string]$_.Exception.Message } | ConvertTo-Json -Compress",
    "  }",
    "}"
  ].join("\n");

  return new Promise((resolve) => {
    const child = spawn(windowsPowerShellPath(), [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      script
    ], {
      env: {
        ...process.env,
        HAPPYTG_TELEGRAM_BOT_TOKEN_PROBE: token,
        HAPPYTG_TELEGRAM_SEND_MESSAGE_PAYLOAD: JSON.stringify(payload)
      },
      shell: false,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      child.kill("SIGTERM");
      resolve({
        ok: false,
        message: "Windows PowerShell Telegram sendMessage fallback timed out."
      });
    }, 25_000);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      if (settled) {
        return;
      }
      settled = true;
      resolve({
        ok: false,
        message: error instanceof Error ? error.message : "Windows PowerShell Telegram sendMessage fallback failed to start."
      });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (settled) {
        return;
      }
      settled = true;
      const jsonLine = stdout
        .trim()
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .filter(Boolean)
        .pop();

      if (!jsonLine) {
        resolve({
          ok: false,
          message: stderr.trim() || `Windows PowerShell Telegram sendMessage fallback exited with code ${code ?? 1}.`
        });
        return;
      }

      try {
        resolve(JSON.parse(jsonLine) as WindowsPowerShellTelegramSendResult);
      } catch {
        resolve({
          ok: false,
          message: jsonLine
        });
      }
    });
  });
}

function telegramTransportError(error: unknown): {
  message: string;
  code?: string;
  causeCode?: string;
  causeMessage?: string;
} {
  const message = error instanceof Error ? error.message : String(error);
  const code = error && typeof error === "object" && "code" in error && typeof error.code === "string"
    ? error.code
    : undefined;
  const cause = error instanceof Error ? (error as Error & { cause?: unknown }).cause : undefined;
  const causeCode = cause && typeof cause === "object" && "code" in cause && typeof cause.code === "string"
    ? cause.code
    : undefined;
  const causeMessage = cause && typeof cause === "object" && "message" in cause && typeof cause.message === "string"
    ? cause.message
    : undefined;

  return {
    message,
    code,
    causeCode,
    causeMessage
  };
}

export function createDefaultSendTelegramMessage(options: CreateDefaultSendTelegramMessageOptions = {}) {
  const configuredBotToken = options.botToken ?? botToken;
  const fetchImpl = options.fetchImpl ?? fetch;
  const platform = options.platform ?? process.platform;
  const botLogger = options.logger ?? logger;
  const sendViaWindowsPowerShell = options.sendViaWindowsPowerShell ?? sendTelegramMessageViaWindowsPowerShell;

  return async function sendTelegramMessage(chatId: number, text: string, replyMarkup?: Record<string, unknown>): Promise<void> {
    if (!configuredBotToken) {
      botLogger.info("Telegram token missing, logging reply instead", { chatId, text, replyMarkup });
      return;
    }

    const payload: TelegramSendMessagePayload = {
      chat_id: chatId,
      text,
      ...(replyMarkup ? { reply_markup: replyMarkup } : {})
    };

    try {
      const response = await fetchImpl(`https://api.telegram.org/bot${configuredBotToken}/sendMessage`, {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        botLogger.error("Telegram sendMessage failed", {
          status: response.status,
          body: await response.text()
        });
      }
    } catch (error) {
      const fallback = await sendViaWindowsPowerShell(configuredBotToken, payload);
      if (fallback?.ok) {
        botLogger.info("Telegram sendMessage delivered via Windows PowerShell fallback", { chatId });
        return;
      }

      botLogger.error("Telegram sendMessage failed", {
        nodeTransport: telegramTransportError(error),
        ...(fallback
          ? {
            fallbackStatus: fallback.statusCode,
            fallbackMessage: fallback.message
          }
          : {})
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
