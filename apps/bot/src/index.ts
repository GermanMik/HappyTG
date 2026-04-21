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

interface WindowsPowerShellTelegramApiResult {
  ok: boolean;
  statusCode?: number;
  message?: string;
  result?: unknown;
}

type InvokeTelegramBotApiViaWindowsPowerShell = (
  method: string,
  botToken: string,
  payload?: Record<string, unknown>,
  options?: {
    platform?: NodeJS.Platform;
    timeoutSec?: number;
  }
) => Promise<WindowsPowerShellTelegramApiResult | undefined>;

interface StartTelegramPollingOptions {
  botToken: string;
  dispatchUpdate(update: TelegramUpdate): Promise<void>;
  fetchImpl?: typeof fetch;
  logger?: Logger;
  platform?: NodeJS.Platform;
  invokeViaWindowsPowerShell?: InvokeTelegramBotApiViaWindowsPowerShell;
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
    logger?: Logger;
    platform?: NodeJS.Platform;
    invokeViaWindowsPowerShell?: InvokeTelegramBotApiViaWindowsPowerShell;
  }
): Promise<T> {
  let response: Response;
  try {
    response = await (options.fetchImpl ?? fetch)(`https://api.telegram.org/bot${options.botToken}/${method}`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify(options.payload ?? {}),
      signal: options.signal
    });
  } catch (error) {
    const fallbackImpl = options.invokeViaWindowsPowerShell
      ?? ((options.fetchImpl ?? fetch) === fetch ? invokeTelegramBotApiViaWindowsPowerShell : undefined);
    if (fallbackImpl && shouldTryWindowsPowerShellTelegramApiFallback(error, options.platform ?? process.platform)) {
      const fallback = await fallbackImpl(method, options.botToken, options.payload, {
        platform: options.platform
      });
      if (fallback?.ok) {
        options.logger?.info(`Telegram ${method} delivered via Windows PowerShell fallback`);
        return fallback.result as T;
      }

      throw new Error(formatTelegramApiFallbackFailure(method, error, fallback));
    }

    throw error;
  }
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
  logger?: Logger;
  platform?: NodeJS.Platform;
  invokeViaWindowsPowerShell?: InvokeTelegramBotApiViaWindowsPowerShell;
}): Promise<Partial<TelegramDeliverySnapshot>> {
  const info = await telegramApiCall<TelegramWebhookInfo>("getWebhookInfo", {
    botToken: options.botToken,
    fetchImpl: options.fetchImpl,
    logger: options.logger,
    platform: options.platform,
    invokeViaWindowsPowerShell: options.invokeViaWindowsPowerShell
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
  nodeTransportTimeoutMs?: number;
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

const NODE_TRANSPORT_ADVICE = "Check Node/undici proxy settings (`HTTPS_PROXY`, `HTTP_PROXY`, `ALL_PROXY`, `NO_PROXY`), WinHTTP proxy differences, firewall or AV TLS interception, and whether IPv4/IPv6 routing to api.telegram.org differs on this machine.";
const WINDOWS_NODE_SENDMESSAGE_TIMEOUT_MS = 1_500;

function createTelegramNodeSendTimeoutError(timeoutMs: number, cause?: unknown): Error & { code: string; cause?: unknown } {
  const error = new Error(`Node HTTPS sendMessage exceeded ${timeoutMs}ms before Windows fallback.`) as Error & {
    code: string;
    cause?: unknown;
  };
  error.code = "HAPPYTG_TELEGRAM_NODE_TIMEOUT";
  if (cause !== undefined) {
    error.cause = cause;
  }
  return error;
}

async function fetchTelegramWithTimeout(
  input: string,
  init: RequestInit,
  options: {
    fetchImpl: typeof fetch;
    timeoutMs?: number;
  }
): Promise<Response> {
  const timeoutMs = options.timeoutMs;
  if (!timeoutMs || timeoutMs <= 0) {
    return await options.fetchImpl(input, init);
  }

  const controller = new AbortController();
  let timedOut = false;
  let timeoutError: Error & { code: string; cause?: unknown } | undefined;
  let timer: NodeJS.Timeout | undefined;
  const request = options.fetchImpl(input, {
    ...init,
    signal: controller.signal
  });
  const timeout = new Promise<Response>((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
      timeoutError = createTelegramNodeSendTimeoutError(timeoutMs);
      reject(timeoutError);
    }, timeoutMs);
  });

  try {
    return await Promise.race([request, timeout]);
  } catch (error) {
    if (timedOut) {
      throw timeoutError ?? createTelegramNodeSendTimeoutError(timeoutMs, error);
    }
    throw error;
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

async function invokeTelegramBotApiViaWindowsPowerShell(
  method: string,
  token: string,
  payload?: Record<string, unknown>,
  options?: {
    platform?: NodeJS.Platform;
    timeoutSec?: number;
  }
): Promise<WindowsPowerShellTelegramApiResult | undefined> {
  if ((options?.platform ?? process.platform) !== "win32") {
    return undefined;
  }

  const script = [
    "$ErrorActionPreference = 'Stop'",
    "$ProgressPreference = 'SilentlyContinue'",
    "$token = $env:HAPPYTG_TELEGRAM_BOT_TOKEN_PROBE",
    "$method = $env:HAPPYTG_TELEGRAM_BOT_API_METHOD",
    "$payloadJson = $env:HAPPYTG_TELEGRAM_BOT_API_PAYLOAD",
    "$timeoutSec = [int]$env:HAPPYTG_TELEGRAM_BOT_API_TIMEOUT_SEC",
    "if (-not $token) {",
    "  @{ ok = $false; message = 'Bot token was not provided to the PowerShell Bot API fallback.' } | ConvertTo-Json -Compress -Depth 100",
    "  exit 0",
    "}",
    "if (-not $method) {",
    "  @{ ok = $false; message = 'Telegram Bot API method was not provided to the PowerShell fallback.' } | ConvertTo-Json -Compress -Depth 100",
    "  exit 0",
    "}",
    "if (-not $payloadJson) { $payloadJson = '{}' }",
    "$uri = \"https://api.telegram.org/bot$token/$method\"",
    "try {",
    "  $response = Invoke-RestMethod -Uri $uri -Method Post -ContentType 'application/json' -Body $payloadJson -TimeoutSec $timeoutSec",
    "  if ($response.ok) {",
    "    @{ ok = $true; result = $response.result } | ConvertTo-Json -Compress -Depth 100",
    "  } else {",
    "    @{ ok = $false; message = if ($response.description) { [string]$response.description } else { 'Telegram API rejected the request.' } } | ConvertTo-Json -Compress -Depth 100",
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
    "        @{ ok = $false; statusCode = $statusCode; message = $description } | ConvertTo-Json -Compress -Depth 100",
    "      } else {",
    "        @{ ok = $false; statusCode = $statusCode; message = $fallbackMessage } | ConvertTo-Json -Compress -Depth 100",
    "      }",
    "    } catch {",
    "      @{ ok = $false; statusCode = $statusCode; message = $fallbackMessage } | ConvertTo-Json -Compress -Depth 100",
    "    }",
    "  } else {",
    "    @{ ok = $false; message = [string]$_.Exception.Message } | ConvertTo-Json -Compress -Depth 100",
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
        HAPPYTG_TELEGRAM_BOT_API_METHOD: method,
        HAPPYTG_TELEGRAM_BOT_API_PAYLOAD: JSON.stringify(payload ?? {}),
        HAPPYTG_TELEGRAM_BOT_API_TIMEOUT_SEC: String(options?.timeoutSec ?? 40)
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
        message: "Windows PowerShell Telegram Bot API fallback timed out."
      });
    }, 45_000);

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
        message: error instanceof Error ? error.message : "Windows PowerShell Telegram Bot API fallback failed to start."
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
          message: stderr.trim() || `Windows PowerShell Telegram Bot API fallback exited with code ${code ?? 1}.`
        });
        return;
      }

      try {
        resolve(JSON.parse(jsonLine) as WindowsPowerShellTelegramApiResult);
      } catch {
        resolve({
          ok: false,
          message: jsonLine
        });
      }
    });
  });
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

function describeTelegramTransportFailure(error: unknown): string {
  const detail = telegramTransportError(error);
  const code = detail.code ?? detail.causeCode;
  const message = detail.causeMessage ?? detail.message;
  const lower = message.toLowerCase();

  if (code === "ENOTFOUND" || code === "EAI_AGAIN") {
    return "DNS lookup for api.telegram.org failed.";
  }
  if (code === "ETIMEDOUT" || code === "UND_ERR_CONNECT_TIMEOUT") {
    return "Connection to api.telegram.org timed out.";
  }
  if (code === "ECONNREFUSED") {
    return "Connection to api.telegram.org was refused.";
  }
  if (code === "ECONNRESET" || code === "UND_ERR_SOCKET") {
    return "Connection to api.telegram.org was interrupted before Telegram replied.";
  }
  if (code?.startsWith("ERR_TLS") || code?.startsWith("ERR_SSL") || code?.startsWith("CERT_") || /certificate|tls|ssl/iu.test(message)) {
    return "TLS handshake with api.telegram.org failed.";
  }
  if (/proxy/iu.test(message)) {
    return "The configured proxy blocked or rejected the Telegram API request.";
  }
  if (lower === "fetch failed") {
    return "The network request failed before Telegram returned a response.";
  }

  return detail.message;
}

function shouldTryWindowsPowerShellTelegramApiFallback(error: unknown, platform: NodeJS.Platform): boolean {
  if (platform !== "win32") {
    return false;
  }

  const detail = telegramTransportError(error);
  const code = detail.code ?? detail.causeCode;
  const message = `${detail.message}\n${detail.causeMessage ?? ""}`.toLowerCase();

  return code === "ENOTFOUND"
    || code === "EAI_AGAIN"
    || code === "ETIMEDOUT"
    || code === "UND_ERR_CONNECT_TIMEOUT"
    || code === "ECONNREFUSED"
    || code === "ECONNRESET"
    || code === "UND_ERR_SOCKET"
    || code?.startsWith("ERR_TLS") === true
    || code?.startsWith("ERR_SSL") === true
    || code?.startsWith("CERT_") === true
    || message.includes("fetch failed")
    || message.includes("proxy")
    || message.includes("certificate")
    || message.includes("tls")
    || message.includes("ssl");
}

function formatTelegramApiFallbackFailure(
  method: string,
  error: unknown,
  fallback?: WindowsPowerShellTelegramApiResult
): string {
  const nodeFailure = describeTelegramTransportFailure(error);
  const fallbackDetail = fallback?.message
    ? `Windows PowerShell Bot API fallback also failed: ${fallback.message}.`
    : "Windows PowerShell Bot API fallback also failed.";

  return `Telegram ${method} could not be confirmed through Node HTTPS (${nodeFailure}) or the Windows PowerShell Bot API fallback. ${fallbackDetail} ${NODE_TRANSPORT_ADVICE}`.trim();
}

export function createDefaultSendTelegramMessage(options: CreateDefaultSendTelegramMessageOptions = {}) {
  const configuredBotToken = options.botToken ?? process.env.TELEGRAM_BOT_TOKEN?.trim();
  const fetchImpl = options.fetchImpl ?? fetch;
  const platform = options.platform ?? process.platform;
  const nodeTransportTimeoutMs = options.nodeTransportTimeoutMs
    ?? (platform === "win32" ? WINDOWS_NODE_SENDMESSAGE_TIMEOUT_MS : undefined);
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
      const response = await fetchTelegramWithTimeout(
        `https://api.telegram.org/bot${configuredBotToken}/sendMessage`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json"
          },
          body: JSON.stringify(payload)
        },
        {
          fetchImpl,
          timeoutMs: nodeTransportTimeoutMs
        }
      );

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
            signal: abortController.signal,
            logger: botLogger,
            platform: options.platform,
            invokeViaWindowsPowerShell: options.invokeViaWindowsPowerShell
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
          signal: abortController.signal,
          logger: botLogger,
          platform: options.platform,
          invokeViaWindowsPowerShell: options.invokeViaWindowsPowerShell
        });
        options.onStatus?.({
          activeMode: "polling",
          status: "ready",
          detail: "Telegram polling is active; webhook delivery was disabled at the Telegram API."
        });
        for (const update of updates) {
          const nextOffset = Math.max(offset, update.update_id + 1);
          try {
            await options.dispatchUpdate(update);
          } catch (error) {
            const detail = error instanceof Error ? error.message : String(error);
            botLogger.error("Telegram update handler failed", {
              updateId: update.update_id,
              updateType: update.callback_query ? "callback_query" : update.message ? "message" : "unknown",
              detail
            });
          } finally {
            offset = nextOffset;
          }
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

export function formatBotPortReuseMessage(listenPort: number): string {
  return `Port ${listenPort} already has a HappyTG Bot. Reuse the running bot if it is yours, or start a new one with HAPPYTG_BOT_PORT/PORT, then try again.`;
}

export function formatBotPortConflictMessageDetailed(
  listenPort: number,
  options?: {
    service?: string;
    description?: string;
  }
): string {
  if (options?.service) {
    return `Port ${listenPort} is already in use by HappyTG ${options.service}, not HappyTG Bot. Free it, or start the bot with HAPPYTG_BOT_PORT/PORT, then try again.`;
  }

  if (options?.description) {
    return `Port ${listenPort} is already in use by ${options.description}. Free it, or start the bot with HAPPYTG_BOT_PORT/PORT, then try again.`;
  }

  return `Port ${listenPort} is already in use by another process. Free it, or start the bot with HAPPYTG_BOT_PORT/PORT, then try again.`;
}

export interface BotStartupResult {
  status: "listening" | "reused";
  port: number;
}

interface PortOccupantInfo {
  service?: string;
  description?: string;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function detectPortOccupant(listenPort: number, fetchImpl: typeof fetch = fetch): Promise<PortOccupantInfo> {
  for (const pathname of ["/ready", "/health", "/"]) {
    try {
      const response = await fetchImpl(`http://127.0.0.1:${listenPort}${pathname}`, {
        signal: AbortSignal.timeout(750)
      });
      const contentType = response.headers.get("content-type") ?? "";
      const bodyText = contentType.includes("application/json") || contentType.startsWith("text/")
        ? await response.text()
        : "";
      if (contentType.includes("application/json")) {
        try {
          const payload = JSON.parse(bodyText) as { service?: string };
          if (payload.service) {
            return {
              service: payload.service
            };
          }
        } catch {
          // Ignore malformed JSON and keep probing for another fingerprint.
        }
      }

      if (!response.ok) {
        continue;
      }

      const titleMatch = bodyText.match(/<title>([^<]+)<\/title>/iu);
      const title = titleMatch?.[1]?.trim();
      return {
        description: title ? `HTTP listener (${title})` : `HTTP listener (${response.status})`
      };
    } catch {
      continue;
    }
  }

  return {};
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

export async function startBotServer(
  server = createBotServer(),
  options?: {
    port?: number;
    logger?: Pick<Logger, "info">;
    fetchImpl?: typeof fetch;
    reuseProbeWindowMs?: number;
    reuseProbeIntervalMs?: number;
  }
): Promise<BotStartupResult> {
  const listenPort = options?.port ?? port;
  const activeLogger = options?.logger ?? logger;
  const fetchImpl = options?.fetchImpl ?? fetch;
  const reuseProbeWindowMs = options?.reuseProbeWindowMs ?? 2_000;
  const reuseProbeIntervalMs = options?.reuseProbeIntervalMs ?? Math.min(100, reuseProbeWindowMs);

  async function listenOnce(): Promise<"listening" | "in_use"> {
    return await new Promise<"listening" | "in_use">((resolve, reject) => {
      const onError = (error: NodeJS.ErrnoException) => {
        cleanup();
        if (error.code === "EADDRINUSE") {
          resolve("in_use");
          return;
        }
        reject(error);
      };
      const onListening = () => {
        cleanup();
        resolve("listening");
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

  if (await listenOnce() === "listening") {
    return { status: "listening", port: listenPort };
  }

  const occupant = await detectPortOccupant(listenPort, fetchImpl);
  if (occupant.service !== "bot") {
    throw new Error(formatBotPortConflictMessageDetailed(listenPort, occupant));
  }

  if (reuseProbeWindowMs > 0) {
    for (let waitedMs = 0; waitedMs < reuseProbeWindowMs; waitedMs += reuseProbeIntervalMs) {
      await delay(reuseProbeIntervalMs);
      const occupantAfterDelay = await detectPortOccupant(listenPort, fetchImpl);
      if (!occupantAfterDelay.service && !occupantAfterDelay.description) {
        if (await listenOnce() === "listening") {
          return { status: "listening", port: listenPort };
        }

        const retryOccupant = await detectPortOccupant(listenPort, fetchImpl);
        if (retryOccupant.service !== "bot") {
          throw new Error(formatBotPortConflictMessageDetailed(listenPort, retryOccupant));
        }
        continue;
      }

      if (occupantAfterDelay.service !== "bot") {
        throw new Error(formatBotPortConflictMessageDetailed(listenPort, occupantAfterDelay));
      }
    }
  }

  activeLogger.info(formatBotPortReuseMessage(listenPort), {
    port: listenPort,
    apiBaseUrl
  });
  return { status: "reused", port: listenPort };
}

export function createBotRuntime(
  dependencies: Partial<BotDependencies> = {},
  options?: {
    env?: NodeJS.ProcessEnv;
    port?: number;
    fetchImpl?: typeof fetch;
    logger?: Logger;
    platform?: NodeJS.Platform;
    invokeTelegramApiViaWindowsPowerShell?: InvokeTelegramBotApiViaWindowsPowerShell;
    configurationMessage?: string;
    reuseProbeWindowMs?: number;
    reuseProbeIntervalMs?: number;
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
  let ownsServer = false;

  return {
    server,
    deliveryState,
    async start(): Promise<TelegramDeliverySnapshot> {
      if (started) {
        return deliveryState.read();
      }
      started = true;
      try {
        const startup = await startBotServer(server, {
          port: listenPort,
          logger: botLogger,
          reuseProbeWindowMs: options?.reuseProbeWindowMs,
          reuseProbeIntervalMs: options?.reuseProbeIntervalMs
        });
        ownsServer = startup.status === "listening";

        if (startup.status === "reused") {
          return deliveryState.read();
        }

        if (configuredBotToken && deliveryState.read().activeMode === "polling") {
          polling = startTelegramPolling({
            botToken: configuredBotToken,
            dispatchUpdate: dispatcher.dispatchUpdate,
            fetchImpl: options?.fetchImpl,
            logger: botLogger,
            platform: options?.platform,
            invokeViaWindowsPowerShell: options?.invokeTelegramApiViaWindowsPowerShell,
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
              fetchImpl: options?.fetchImpl,
              logger: botLogger,
              platform: options?.platform,
              invokeViaWindowsPowerShell: options?.invokeTelegramApiViaWindowsPowerShell
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
        ownsServer = false;
        throw error;
      }
    },
    async stop(): Promise<void> {
      if (polling) {
        await polling.stop();
        polling = undefined;
      }
      if (ownsServer) {
        await close(server);
      }
      ownsServer = false;
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
