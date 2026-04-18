import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
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
import { createBotHandlers, dispatchTelegramUpdate } from "./handlers.js";

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
const publicUrl = process.env.HAPPYTG_PUBLIC_URL ?? apiBaseUrl;

export type TelegramUpdateMode = "polling" | "webhook" | "disabled";

interface TelegramBotApiError extends Error {
  statusCode?: number;
  telegramErrorCode?: number;
}

interface TelegramBotApiEnvelope<T> {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
}

interface CreateTelegramPollingRuntimeOptions {
  botToken?: string;
  updateMode?: TelegramUpdateMode;
  fetchImpl?: typeof fetch;
  logger?: Logger;
  pollTimeoutSeconds?: number;
  idleDelayMs?: number;
  errorDelayMs?: number;
  dispatchUpdate(update: TelegramUpdate): Promise<void>;
}

function isPrivateIpv4(hostname: string): boolean {
  const octets = hostname.split(".").map((part) => Number(part));
  if (octets.length !== 4 || octets.some((part) => Number.isNaN(part) || part < 0 || part > 255)) {
    return false;
  }

  if (octets[0] === 10 || octets[0] === 127) {
    return true;
  }
  if (octets[0] === 192 && octets[1] === 168) {
    return true;
  }
  if (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) {
    return true;
  }

  return false;
}

function isProbablyLocalHostname(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase();
  if (!normalized) {
    return true;
  }

  if (["localhost", "127.0.0.1", "::1", "[::1]"].includes(normalized)) {
    return true;
  }

  if (isPrivateIpv4(normalized)) {
    return true;
  }

  if (normalized.endsWith(".local") || normalized.endsWith(".lan")) {
    return true;
  }

  return !normalized.includes(".");
}

export function resolveTelegramUpdateMode(env = process.env): TelegramUpdateMode {
  if (!telegramTokenStatus(env).configured) {
    return "disabled";
  }

  const override = (env.TELEGRAM_UPDATES_MODE ?? "").trim().toLowerCase();
  if (["disabled", "off", "none"].includes(override)) {
    return "disabled";
  }
  if (override === "polling") {
    return "polling";
  }
  if (override === "webhook") {
    return "webhook";
  }

  const configuredPublicUrl = (env.HAPPYTG_PUBLIC_URL ?? env.HAPPYTG_API_URL ?? "").trim();
  if (!configuredPublicUrl) {
    return "polling";
  }

  try {
    const parsed = new URL(configuredPublicUrl);
    return isProbablyLocalHostname(parsed.hostname) ? "polling" : "webhook";
  } catch {
    return "polling";
  }
}

async function telegramBotApiRequest<T>(
  token: string,
  method: string,
  pathname: string,
  fetchImpl: typeof fetch,
  init?: RequestInit
): Promise<T> {
  const response = await fetchImpl(`https://api.telegram.org/bot${token}/${pathname}`, {
    method,
    ...init
  });

  let payload: TelegramBotApiEnvelope<T> | undefined;
  try {
    payload = await response.json() as TelegramBotApiEnvelope<T>;
  } catch {
    payload = undefined;
  }

  if (!response.ok || !payload?.ok) {
    const description = payload?.description ?? response.statusText ?? "Telegram Bot API request failed.";
    const error = new Error(description) as TelegramBotApiError;
    error.statusCode = response.status;
    error.telegramErrorCode = payload?.error_code;
    throw error;
  }

  return payload.result as T;
}

function shouldStopPolling(error: unknown): boolean {
  const statusCode = error && typeof error === "object" && "statusCode" in error && typeof error.statusCode === "number"
    ? error.statusCode
    : undefined;
  const telegramErrorCode = error && typeof error === "object" && "telegramErrorCode" in error && typeof error.telegramErrorCode === "number"
    ? error.telegramErrorCode
    : undefined;

  return statusCode === 401 || telegramErrorCode === 401;
}

export function createTelegramPollingRuntime(options: CreateTelegramPollingRuntimeOptions) {
  const configuredBotToken = options.botToken?.trim();
  const fetchImpl = options.fetchImpl ?? fetch;
  const pollingLogger = options.logger ?? logger;
  const pollTimeoutSeconds = options.pollTimeoutSeconds ?? 30;
  const idleDelayMs = options.idleDelayMs ?? 250;
  const errorDelayMs = options.errorDelayMs ?? 1_000;
  const updateMode = options.updateMode ?? resolveTelegramUpdateMode();
  let nextOffset = 0;
  let stopped = false;
  let prepared = false;
  let running = false;

  async function preparePolling(): Promise<void> {
    if (prepared || !configuredBotToken) {
      return;
    }

    await telegramBotApiRequest<boolean>(
      configuredBotToken,
      "POST",
      "deleteWebhook?drop_pending_updates=false",
      fetchImpl
    );
    prepared = true;
  }

  async function pollOnce(): Promise<number> {
    if (!configuredBotToken || updateMode !== "polling") {
      return 0;
    }

    await preparePolling();

    const updates = await telegramBotApiRequest<TelegramUpdate[]>(
      configuredBotToken,
      "POST",
      "getUpdates",
      fetchImpl,
      {
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          offset: nextOffset,
          timeout: pollTimeoutSeconds,
          allowed_updates: ["message", "callback_query"]
        })
      }
    );

    for (const update of updates) {
      try {
        await options.dispatchUpdate(update);
      } catch (error) {
        pollingLogger.error("Telegram update dispatch failed", {
          updateId: update.update_id,
          detail: error instanceof Error ? error.message : String(error)
        });
      } finally {
        nextOffset = update.update_id + 1;
      }
    }

    return updates.length;
  }

  async function start(): Promise<void> {
    if (!configuredBotToken || updateMode !== "polling" || running) {
      return;
    }

    running = true;
    stopped = false;

    while (!stopped) {
      try {
        const processed = await pollOnce();
        if (!stopped && processed === 0) {
          await delay(idleDelayMs);
        }
      } catch (error) {
        if (shouldStopPolling(error)) {
          pollingLogger.error("Telegram polling stopped", {
            detail: error instanceof Error ? error.message : String(error)
          });
          stopped = true;
          break;
        }

        pollingLogger.warn("Telegram polling cycle failed", {
          detail: error instanceof Error ? error.message : String(error)
        });
        if (!stopped) {
          await delay(errorDelayMs);
        }
      }
    }

    running = false;
  }

  function stop(): void {
    stopped = true;
  }

  return {
    updateMode,
    start,
    stop,
    pollOnce
  };
}

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
        await dispatchTelegramUpdate(handlers, update);
        json(res, 200, { ok: true });
      })
    ],
    logger
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const server = createBotServer();
  server.listen(port, () => {
    const updateMode = resolveTelegramUpdateMode();
    const configurationMessage = botEnvironment.configurationMessage;
    if (configurationMessage) {
      logger.warn(configurationMessage, { port, apiBaseUrl, publicUrl, telegramConfigured: false, updateMode });
    } else {
      logger.info("Bot listening", { port, apiBaseUrl, publicUrl, telegramConfigured: true, updateMode });
      const handlers = createBotHandlers({
        apiFetch: createDefaultApiFetch(),
        sendTelegramMessage: createDefaultSendTelegramMessage()
      });
      const pollingRuntime = createTelegramPollingRuntime({
        botToken,
        updateMode,
        logger,
        dispatchUpdate: async (update) => dispatchTelegramUpdate(handlers, update)
      });
      server.on("close", () => pollingRuntime.stop());
      if (updateMode === "polling") {
        logger.info("Telegram update delivery using polling", { publicUrl });
        void pollingRuntime.start();
      } else if (updateMode === "webhook") {
        logger.info("Telegram update delivery expecting webhook", { publicUrl });
      }
    }
  });
}
