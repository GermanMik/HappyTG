import { spawn } from "node:child_process";
import type { Server } from "node:http";
import { readFileSync } from "node:fs";
import { isIP } from "node:net";
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
const apiBaseUrl = process.env.HAPPYTG_API_URL ?? "http://localhost:4000";
const port = readPort(process.env, ["HAPPYTG_BOT_PORT", "PORT"], 4100);

export type TelegramUpdatesMode = "auto" | "polling" | "webhook";

export interface TelegramDeliverySnapshot {
  configuredMode: string;
  activeMode: "disabled" | "polling" | "webhook";
  status: "disabled" | "ready" | "degraded";
  detail: string;
  publicUrl?: string;
  expectedWebhookUrl?: string;
  actualWebhookUrl?: string;
  pendingUpdateCount?: number;
  lastErrorMessage?: string;
}

interface TelegramPublicUrlInspection {
  publicUrl?: string;
  expectedWebhookUrl?: string;
  webhookCapable: boolean;
  reason: string;
}

interface TelegramWebhookInfo {
  url: string;
  pending_update_count: number;
  last_error_message?: string;
}

interface TelegramApiEnvelope<T> {
  ok: boolean;
  description?: string;
  result: T;
}

interface StartTelegramPollingOptions {
  botToken: string;
  dispatchUpdate(update: TelegramUpdate): Promise<void>;
  fetchImpl?: typeof fetch;
  logger?: Logger;
  onStatus?(patch: Partial<TelegramDeliverySnapshot>): void;
  pollTimeoutSeconds?: number;
  retryDelayMs?: number;
}

interface TelegramPollingController {
  ready: Promise<Partial<TelegramDeliverySnapshot>>;
  stop(): Promise<void>;
}

function normalizeTelegramUpdatesMode(value: string | undefined): TelegramUpdatesMode | undefined {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) {
    return "auto";
  }
  if (normalized === "auto" || normalized === "polling" || normalized === "webhook") {
    return normalized;
  }
  return undefined;
}

function inspectTelegramPublicUrl(rawValue: string | undefined): TelegramPublicUrlInspection {
  const trimmed = rawValue?.trim();
  if (!trimmed) {
    return {
      webhookCapable: false,
      reason: "`HAPPYTG_PUBLIC_URL` is not set."
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return {
      publicUrl: trimmed,
      webhookCapable: false,
      reason: "`HAPPYTG_PUBLIC_URL` is not a valid URL."
    };
  }

  const hostname = parsed.hostname.toLowerCase();
  const ipVersion = isIP(hostname);
  const isLoopbackHostname = hostname === "localhost" || hostname === "0.0.0.0" || hostname === "::1";
  const isLocalName = hostname.endsWith(".local") || (!hostname.includes(".") && ipVersion === 0);
  const isPrivateIpv4 = ipVersion === 4 && (() => {
    const octets = hostname.split(".").map((item) => Number.parseInt(item, 10));
    const [a, b] = octets;
    return a === 10
      || a === 127
      || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168);
  })();
  const normalizedIpv6 = hostname.replace(/^\[|\]$/gu, "");
  const isPrivateIpv6 = ipVersion === 6
    && (normalizedIpv6 === "::1"
      || normalizedIpv6.startsWith("fc")
      || normalizedIpv6.startsWith("fd")
      || normalizedIpv6.startsWith("fe80"));

  if (parsed.protocol !== "https:") {
    return {
      publicUrl: parsed.toString(),
      expectedWebhookUrl: new URL("/telegram/webhook", parsed).toString(),
      webhookCapable: false,
      reason: "`HAPPYTG_PUBLIC_URL` must use HTTPS for Telegram webhook delivery."
    };
  }

  if (isLoopbackHostname || isLocalName || isPrivateIpv4 || isPrivateIpv6) {
    return {
      publicUrl: parsed.toString(),
      expectedWebhookUrl: new URL("/telegram/webhook", parsed).toString(),
      webhookCapable: false,
      reason: "`HAPPYTG_PUBLIC_URL` points at a loopback, private, or otherwise non-public host."
    };
  }

  return {
    publicUrl: parsed.toString(),
    expectedWebhookUrl: new URL("/telegram/webhook", parsed).toString(),
    webhookCapable: true,
    reason: "`HAPPYTG_PUBLIC_URL` is a public HTTPS URL."
  };
}

export function resolveTelegramDeliveryMode(options?: {
  env?: NodeJS.ProcessEnv;
  configurationMessage?: string;
}): TelegramDeliverySnapshot {
  const env = options?.env ?? process.env;
  const configuredModeRaw = env.TELEGRAM_UPDATES_MODE?.trim() || "auto";
  const configuredMode = normalizeTelegramUpdatesMode(configuredModeRaw);
  const publicUrl = inspectTelegramPublicUrl(env.HAPPYTG_PUBLIC_URL);
  const configurationMessage = options?.configurationMessage;

  if (configurationMessage) {
    return {
      configuredMode: configuredModeRaw,
      activeMode: "disabled",
      status: "disabled",
      detail: configurationMessage,
      publicUrl: publicUrl.publicUrl,
      expectedWebhookUrl: publicUrl.expectedWebhookUrl
    };
  }

  if (!configuredMode) {
    return {
      configuredMode: configuredModeRaw,
      activeMode: "disabled",
      status: "degraded",
      detail: `Unsupported TELEGRAM_UPDATES_MODE \`${configuredModeRaw}\`. Use \`auto\`, \`polling\`, or \`webhook\`.`,
      publicUrl: publicUrl.publicUrl,
      expectedWebhookUrl: publicUrl.expectedWebhookUrl
    };
  }

  if (configuredMode === "polling") {
    return {
      configuredMode,
      activeMode: "polling",
      status: "ready",
      detail: "Telegram polling mode is active by explicit configuration.",
      publicUrl: publicUrl.publicUrl,
      expectedWebhookUrl: publicUrl.expectedWebhookUrl
    };
  }

  if (configuredMode === "webhook") {
    return {
      configuredMode,
      activeMode: "webhook",
      status: publicUrl.webhookCapable ? "ready" : "degraded",
      detail: publicUrl.webhookCapable
        ? "Telegram webhook mode is selected by explicit configuration."
        : `Telegram webhook mode was requested, but ${publicUrl.reason}`,
      publicUrl: publicUrl.publicUrl,
      expectedWebhookUrl: publicUrl.expectedWebhookUrl
    };
  }

  if (publicUrl.webhookCapable) {
    return {
      configuredMode,
      activeMode: "webhook",
      status: "ready",
      detail: "Telegram auto mode selected webhook delivery because `HAPPYTG_PUBLIC_URL` is webhook-capable.",
      publicUrl: publicUrl.publicUrl,
      expectedWebhookUrl: publicUrl.expectedWebhookUrl
    };
  }

  return {
    configuredMode,
    activeMode: "polling",
    status: "ready",
    detail: `Telegram auto mode selected polling because ${publicUrl.reason}`,
    publicUrl: publicUrl.publicUrl,
    expectedWebhookUrl: publicUrl.expectedWebhookUrl
  };
}

async function telegramApiCall<T>(
  method: string,
  options: {
    botToken: string;
    fetchImpl?: typeof fetch;
    payload?: Record<string, unknown>;
    signal?: AbortSignal;
  }
): Promise<T> {
  const response = await (options.fetchImpl ?? fetch)(`https://api.telegram.org/bot${options.botToken}/${method}`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(options.payload ?? {}),
    signal: options.signal
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Telegram ${method} failed with ${response.status}: ${text}`);
  }

  const payload = JSON.parse(text) as TelegramApiEnvelope<T>;
  if (!payload.ok) {
    throw new Error(`Telegram ${method} failed: ${payload.description ?? "Unknown Telegram API error"}`);
  }

  return payload.result;
}

async function waitForDelay(ms: number, signal: AbortSignal): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    const onAbort = () => {
      cleanup();
      reject(new Error("aborted"));
    };
    const cleanup = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
    };

    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function createTelegramDeliveryState(initial: TelegramDeliverySnapshot) {
  let snapshot = initial;

  return {
    read(): TelegramDeliverySnapshot {
      return snapshot;
    },
    update(patch: Partial<TelegramDeliverySnapshot>): TelegramDeliverySnapshot {
      snapshot = { ...snapshot, ...patch };
      return snapshot;
    }
  };
}

export async function inspectTelegramWebhookDelivery(options: {
  botToken: string;
  expectedWebhookUrl?: string;
  fetchImpl?: typeof fetch;
}): Promise<Partial<TelegramDeliverySnapshot>> {
  const info = await telegramApiCall<TelegramWebhookInfo>("getWebhookInfo", {
    botToken: options.botToken,
    fetchImpl: options.fetchImpl
  });
  const actualWebhookUrl = info.url.trim() || undefined;
  const actualDescription = actualWebhookUrl ? `current webhook URL is ${actualWebhookUrl}` : "current webhook URL is empty";
  const lastErrorMessage = info.last_error_message?.trim() || undefined;

  if (!options.expectedWebhookUrl) {
    return {
      activeMode: "webhook",
      status: "degraded",
      detail: `Telegram webhook mode is selected, but the expected webhook URL could not be derived; ${actualDescription}.`,
      actualWebhookUrl,
      pendingUpdateCount: info.pending_update_count,
      lastErrorMessage
    };
  }

  if (actualWebhookUrl === options.expectedWebhookUrl && !lastErrorMessage) {
    return {
      activeMode: "webhook",
      status: "ready",
      detail: "Telegram webhook mode is active and matches the expected webhook URL.",
      actualWebhookUrl,
      pendingUpdateCount: info.pending_update_count
    };
  }

  const mismatchReason = actualWebhookUrl === options.expectedWebhookUrl
    ? `Telegram reported the expected webhook URL, but also returned an error: ${lastErrorMessage}.`
    : `Telegram webhook mode expects ${options.expectedWebhookUrl}, but ${actualDescription}.`;

  return {
    activeMode: "webhook",
    status: "degraded",
    detail: mismatchReason,
    actualWebhookUrl,
    pendingUpdateCount: info.pending_update_count,
    lastErrorMessage
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
  const configuredBotToken = options.botToken ?? process.env.TELEGRAM_BOT_TOKEN?.trim();
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

export function createTelegramUpdateDispatcher(dependencies: Partial<BotDependencies> = {}) {
  const apiFetch = dependencies.apiFetch ?? createDefaultApiFetch();
  const sendTelegramMessage = dependencies.sendTelegramMessage ?? createDefaultSendTelegramMessage();
  const handlers = createBotHandlers({
    apiFetch,
    sendTelegramMessage,
    resolveInternalUserId: dependencies.resolveInternalUserId
  });

  return {
    async dispatchUpdate(update: TelegramUpdate): Promise<void> {
      if (update.message) {
        await handlers.handleMessage(update.message);
      }
      if (update.callback_query) {
        await handlers.handleCallbackQuery(update.callback_query);
      }
    }
  };
}

export function createBotServer(
  dependencies: Partial<BotDependencies> = {},
  options?: {
    dispatchUpdate?(update: TelegramUpdate): Promise<void>;
    getTelegramDeliverySnapshot?(): TelegramDeliverySnapshot | undefined;
  }
) {
  const apiFetch = dependencies.apiFetch ?? createDefaultApiFetch();
  const dispatcher = options?.dispatchUpdate ?? createTelegramUpdateDispatcher(dependencies).dispatchUpdate;

  return createJsonServer(
    [
      route("GET", "/health", async ({ res }) => {
        json(res, 200, { ok: true, service: "bot" });
      }),
      route("GET", "/ready", async ({ res }) => {
        try {
          await apiFetch<{ ok: boolean }>("/health");
          const telegram = options?.getTelegramDeliverySnapshot?.();
          if (telegram && telegram.status !== "ready") {
            json(res, 503, {
              ok: false,
              service: "bot",
              apiBaseUrl,
              detail: telegram.detail,
              telegram
            });
            return;
          }
          json(res, 200, { ok: true, service: "bot", apiBaseUrl, ...(telegram ? { telegram } : {}) });
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
        await dispatcher(update);
        json(res, 200, { ok: true });
      })
    ],
    logger
  );
}

export function startTelegramPolling(options: StartTelegramPollingOptions): TelegramPollingController {
  const fetchImpl = options.fetchImpl ?? fetch;
  const botLogger = options.logger ?? logger;
  const abortController = new AbortController();
  const pollTimeoutSeconds = options.pollTimeoutSeconds ?? 30;
  const retryDelayMs = options.retryDelayMs ?? 2_000;
  let offset = 0;
  let initialized = false;
  let readyResolved = false;
  let resolveReady!: (value: Partial<TelegramDeliverySnapshot>) => void;
  const ready = new Promise<Partial<TelegramDeliverySnapshot>>((resolve) => {
    resolveReady = resolve;
  });

  const settleReady = (snapshot: Partial<TelegramDeliverySnapshot>) => {
    if (readyResolved) {
      return;
    }
    readyResolved = true;
    resolveReady(snapshot);
  };

  const loop = (async () => {
    while (!abortController.signal.aborted) {
      try {
        if (!initialized) {
          await telegramApiCall<true>("deleteWebhook", {
            botToken: options.botToken,
            fetchImpl,
            payload: { drop_pending_updates: false },
            signal: abortController.signal
          });
          initialized = true;
          const readySnapshot: Partial<TelegramDeliverySnapshot> = {
            activeMode: "polling",
            status: "ready",
            detail: "Telegram polling is active; webhook delivery was disabled at the Telegram API."
          };
          options.onStatus?.(readySnapshot);
          settleReady(readySnapshot);
          botLogger.info("Telegram polling active");
        }

        const updates = await telegramApiCall<TelegramUpdate[]>("getUpdates", {
          botToken: options.botToken,
          fetchImpl,
          payload: {
            allowed_updates: ["message", "callback_query"],
            offset,
            timeout: pollTimeoutSeconds
          },
          signal: abortController.signal
        });
        options.onStatus?.({
          activeMode: "polling",
          status: "ready",
          detail: "Telegram polling is active; webhook delivery was disabled at the Telegram API."
        });
        for (const update of updates) {
          await options.dispatchUpdate(update);
          offset = Math.max(offset, update.update_id + 1);
        }
      } catch (error) {
        if (abortController.signal.aborted) {
          break;
        }
        const detail = error instanceof Error ? error.message : String(error);
        const degradedSnapshot: Partial<TelegramDeliverySnapshot> = {
          activeMode: "polling",
          status: "degraded",
          detail
        };
        options.onStatus?.(degradedSnapshot);
        settleReady(degradedSnapshot);
        botLogger.warn("Telegram polling degraded", { detail });
        try {
          await waitForDelay(retryDelayMs, abortController.signal);
        } catch {
          break;
        }
      }
    }

    settleReady({
      activeMode: "polling",
      status: "disabled",
      detail: "Telegram polling stopped before initialization completed."
    });
  })();

  return {
    ready,
    async stop() {
      abortController.abort();
      await loop.catch(() => undefined);
    }
  };
}

function listen(server: Server, listenPort: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const onListening = () => {
      cleanup();
      resolve();
    };
    const cleanup = () => {
      server.off("error", onError);
      server.off("listening", onListening);
    };

    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(listenPort);
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function startupMetadata(snapshot: TelegramDeliverySnapshot, listenPort: number) {
  return {
    port: listenPort,
    apiBaseUrl,
    telegramConfigured: snapshot.status !== "disabled",
    telegramDeliveryMode: snapshot.activeMode,
    telegramDeliveryConfiguredMode: snapshot.configuredMode,
    telegramDeliveryStatus: snapshot.status,
    telegramDeliveryDetail: snapshot.detail,
    ...(snapshot.publicUrl ? { publicUrl: snapshot.publicUrl } : {}),
    ...(snapshot.expectedWebhookUrl ? { expectedWebhookUrl: snapshot.expectedWebhookUrl } : {}),
    ...(snapshot.actualWebhookUrl ? { actualWebhookUrl: snapshot.actualWebhookUrl } : {}),
    ...(typeof snapshot.pendingUpdateCount === "number" ? { pendingUpdateCount: snapshot.pendingUpdateCount } : {}),
    ...(snapshot.lastErrorMessage ? { lastErrorMessage: snapshot.lastErrorMessage } : {})
  };
}

function logBotStartup(botLogger: Logger, snapshot: TelegramDeliverySnapshot, listenPort: number): void {
  if (snapshot.status === "disabled") {
    botLogger.warn(snapshot.detail, startupMetadata(snapshot, listenPort));
    return;
  }
  if (snapshot.status === "degraded") {
    botLogger.warn("Bot listening with degraded Telegram delivery", startupMetadata(snapshot, listenPort));
    return;
  }
  if (snapshot.activeMode === "polling") {
    botLogger.info("Bot listening with Telegram polling active", startupMetadata(snapshot, listenPort));
    return;
  }
  botLogger.info("Bot listening with Telegram webhook active", startupMetadata(snapshot, listenPort));
}

export function createBotRuntime(
  dependencies: Partial<BotDependencies> = {},
  options?: {
    env?: NodeJS.ProcessEnv;
    port?: number;
    fetchImpl?: typeof fetch;
    logger?: Logger;
    configurationMessage?: string;
  }
) {
  const env = options?.env ?? process.env;
  const configuredBotToken = env.TELEGRAM_BOT_TOKEN?.trim();
  const botLogger = options?.logger ?? logger;
  const listenPort = options?.port ?? readPort(env, ["HAPPYTG_BOT_PORT", "PORT"], 4100);
  const deliveryState = createTelegramDeliveryState(resolveTelegramDeliveryMode({
    env,
    configurationMessage: options?.configurationMessage ?? botConfigurationMessage(env)
  }));
  const dispatcher = createTelegramUpdateDispatcher(dependencies);
  const server = createBotServer(dependencies, {
    dispatchUpdate: dispatcher.dispatchUpdate,
    getTelegramDeliverySnapshot: () => deliveryState.read()
  });
  let polling: TelegramPollingController | undefined;
  let started = false;

  return {
    server,
    deliveryState,
    async start(): Promise<TelegramDeliverySnapshot> {
      if (started) {
        return deliveryState.read();
      }
      started = true;
      try {
        await listen(server, listenPort);

        if (configuredBotToken && deliveryState.read().activeMode === "polling") {
          polling = startTelegramPolling({
            botToken: configuredBotToken,
            dispatchUpdate: dispatcher.dispatchUpdate,
            fetchImpl: options?.fetchImpl,
            logger: botLogger,
            onStatus: (patch) => {
              deliveryState.update(patch);
            }
          });
          deliveryState.update(await polling.ready);
        } else if (configuredBotToken && deliveryState.read().activeMode === "webhook" && deliveryState.read().expectedWebhookUrl) {
          try {
            deliveryState.update(await inspectTelegramWebhookDelivery({
              botToken: configuredBotToken,
              expectedWebhookUrl: deliveryState.read().expectedWebhookUrl,
              fetchImpl: options?.fetchImpl
            }));
          } catch (error) {
            deliveryState.update({
              activeMode: "webhook",
              status: "degraded",
              detail: error instanceof Error ? error.message : String(error)
            });
          }
        }

        const snapshot = deliveryState.read();
        logBotStartup(botLogger, snapshot, listenPort);
        return snapshot;
      } catch (error) {
        started = false;
        throw error;
      }
    },
    async stop(): Promise<void> {
      if (polling) {
        await polling.stop();
      }
      if (started) {
        await close(server);
      }
      started = false;
    }
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  void createBotRuntime({}, {
    configurationMessage: botEnvironment.configurationMessage,
    port
  }).start().catch((error) => {
    logger.error("Bot failed to start", {
      port,
      apiBaseUrl,
      detail: error instanceof Error ? error.message : String(error)
    });
    process.exitCode = 1;
  });
}
