import { spawn } from "node:child_process";
import path from "node:path";

import {
  loadHappyTGEnv,
  resolveMiniAppBaseUrl,
  telegramTokenStatus,
  validatePublicHttpsUrl
} from "../../shared/src/index.js";

export const TELEGRAM_MENU_BUTTON_TEXT = "HappyTG";

interface TelegramApiEnvelope<T> {
  ok: boolean;
  description?: string;
  result: T;
}

interface WindowsPowerShellTelegramApiResult<T> {
  ok: boolean;
  result?: T;
  statusCode?: number;
  message?: string;
}

export interface CaddyRoutePreflight {
  ok: boolean;
  url: string;
  status?: number;
  detail: string;
}

export interface TelegramMenuCommandResult {
  kind: "telegram-menu";
  action: "set" | "reset";
  status: "pass";
  dryRun: boolean;
  miniAppUrl?: string;
  payload?: Record<string, unknown>;
  caddy?: CaddyRoutePreflight;
  telegram: {
    method: "setChatMenuButton";
    called: boolean;
    detail: string;
  };
}

export interface TelegramMenuDiagnostics {
  token: {
    status: ReturnType<typeof telegramTokenStatus>["status"];
    configured: boolean;
    message: string;
  };
  miniAppUrl: {
    value?: string;
    ok: boolean;
    message: string;
  };
  caddy: {
    checked: boolean;
    ok?: boolean;
    status?: number;
    message: string;
  };
  menuButton: {
    checked: boolean;
    configured?: boolean;
    message: string;
  };
}

export interface TelegramMenuCommandOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  dryRun?: boolean;
  preflightTimeoutMs?: number;
  platform?: NodeJS.Platform;
  telegramApiPowerShellFallback?: (
    method: "setChatMenuButton" | "getChatMenuButton",
    token: string,
    payload: Record<string, unknown>
  ) => Promise<WindowsPowerShellTelegramApiResult<unknown> | undefined>;
}

export interface TelegramMenuPreflightOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

function envValue(env: NodeJS.ProcessEnv, key: string): string | undefined {
  if (env[key] !== undefined) {
    return env[key];
  }

  const resolvedKey = Object.keys(env).find((candidate) => candidate.toLowerCase() === key.toLowerCase());
  return resolvedKey ? env[resolvedKey] : undefined;
}

function requireTelegramBotToken(env: NodeJS.ProcessEnv): string {
  const status = telegramTokenStatus(env);
  switch (status.status) {
    case "missing":
      throw new Error("TELEGRAM_BOT_TOKEN is missing. Set it in `.env` or the shell before configuring the Telegram menu button.");
    case "placeholder":
      throw new Error("TELEGRAM_BOT_TOKEN still looks like a placeholder. Paste the real BotFather token before configuring the Telegram menu button.");
    case "invalid":
      throw new Error("TELEGRAM_BOT_TOKEN format looks invalid. Paste the full BotFather token before configuring the Telegram menu button.");
    case "configured":
    default:
      return envValue(env, "TELEGRAM_BOT_TOKEN")?.trim() ?? "";
  }
}

function windowsPowerShellPath(): string {
  return process.env.SystemRoot
    ? path.join(process.env.SystemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
    : "powershell.exe";
}

export function resolveTelegramMenuMiniAppUrl(env: NodeJS.ProcessEnv = process.env): string {
  const resolved = resolveMiniAppBaseUrl(env);
  const validation = validatePublicHttpsUrl(resolved, "Mini App URL");
  if (!validation.ok || !validation.url) {
    throw new Error(validation.reason ?? "Mini App URL is not usable for Telegram WebAppInfo.");
  }

  return validation.url;
}

export function telegramMenuButtonPayload(miniAppUrl: string): Record<string, unknown> {
  return {
    menu_button: {
      type: "web_app",
      text: TELEGRAM_MENU_BUTTON_TEXT,
      web_app: {
        url: miniAppUrl
      }
    }
  };
}

export function telegramMenuResetPayload(): Record<string, unknown> {
  return {
    menu_button: {
      type: "default"
    }
  };
}

export async function checkCaddyMiniAppRoute(
  miniAppUrl: string,
  options: TelegramMenuPreflightOptions = {}
): Promise<CaddyRoutePreflight> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 5_000;
  try {
    const response = await fetchImpl(miniAppUrl, {
      method: "GET",
      redirect: "follow",
      signal: AbortSignal.timeout(timeoutMs)
    });
    if (response.status >= 200 && response.status < 400) {
      return {
        ok: true,
        url: miniAppUrl,
        status: response.status,
        detail: `Public Caddy Mini App route responded with HTTP ${response.status}.`
      };
    }

    return {
      ok: false,
      url: miniAppUrl,
      status: response.status,
      detail: `Public Caddy Mini App route returned HTTP ${response.status}.`
    };
  } catch (error) {
    return {
      ok: false,
      url: miniAppUrl,
      detail: `Public Caddy Mini App route is unavailable: ${error instanceof Error ? error.message : String(error)}`
    };
  }
}

async function callTelegramBotApi<T>(
  method: "setChatMenuButton" | "getChatMenuButton",
  token: string,
  payload: Record<string, unknown>,
  fetchImpl: typeof fetch,
  options: Pick<TelegramMenuCommandOptions, "platform" | "telegramApiPowerShellFallback"> = {}
): Promise<T> {
  let response: Response;
  try {
    response = await fetchImpl(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify(payload)
    });
  } catch (error) {
    const fallback = await callTelegramBotApiViaWindowsPowerShell<T>(method, token, payload, options);
    if (fallback !== undefined) {
      return fallback;
    }
    throw error;
  }
  const text = await response.text();

  if (!response.ok) {
    throw new Error(`Telegram ${method} failed with HTTP ${response.status}: ${text}`);
  }

  let body: TelegramApiEnvelope<T>;
  try {
    body = JSON.parse(text) as TelegramApiEnvelope<T>;
  } catch {
    throw new Error(`Telegram ${method} returned a non-JSON response.`);
  }

  if (!body.ok) {
    throw new Error(`Telegram ${method} failed: ${body.description ?? "Unknown Telegram API error"}`);
  }

  return body.result;
}

async function callTelegramBotApiViaWindowsPowerShell<T>(
  method: "setChatMenuButton" | "getChatMenuButton",
  token: string,
  payload: Record<string, unknown>,
  options: Pick<TelegramMenuCommandOptions, "platform" | "telegramApiPowerShellFallback"> = {}
): Promise<T | undefined> {
  if ((options.platform ?? process.platform) !== "win32") {
    return undefined;
  }

  const fallback = options.telegramApiPowerShellFallback ?? invokeTelegramBotApiViaWindowsPowerShell;
  const result = await fallback(method, token, payload);
  if (result === undefined) {
    return undefined;
  }
  if (result.ok) {
    return result.result as T;
  }

  const message = result.message ?? "Telegram API request failed.";
  if (result.statusCode !== undefined) {
    throw new Error(`Telegram ${method} failed with HTTP ${result.statusCode}: ${message}`);
  }
  throw new Error(`Telegram ${method} Windows PowerShell fallback failed: ${message}`);
}

async function invokeTelegramBotApiViaWindowsPowerShell(
  method: "setChatMenuButton" | "getChatMenuButton",
  token: string,
  payload: Record<string, unknown>
): Promise<WindowsPowerShellTelegramApiResult<unknown> | undefined> {
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
        HAPPYTG_TELEGRAM_BOT_API_PAYLOAD: JSON.stringify(payload),
        HAPPYTG_TELEGRAM_BOT_API_TIMEOUT_SEC: "40"
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
        resolve(JSON.parse(jsonLine) as WindowsPowerShellTelegramApiResult<unknown>);
      } catch {
        resolve({
          ok: false,
          message: jsonLine
        });
      }
    });
  });
}

export async function runTelegramMenuSet(options: TelegramMenuCommandOptions = {}): Promise<TelegramMenuCommandResult> {
  const env = options.env ?? process.env;
  loadHappyTGEnv({
    cwd: options.cwd,
    env
  });
  const token = requireTelegramBotToken(env);
  const miniAppUrl = resolveTelegramMenuMiniAppUrl(env);
  const payload = telegramMenuButtonPayload(miniAppUrl);
  const caddy = await checkCaddyMiniAppRoute(miniAppUrl, {
    fetchImpl: options.fetchImpl,
    timeoutMs: options.preflightTimeoutMs
  });

  if (!caddy.ok) {
    throw new Error(`${caddy.detail} Refusing to call Telegram setChatMenuButton for ${miniAppUrl}.`);
  }

  if (options.dryRun) {
    return {
      kind: "telegram-menu",
      action: "set",
      status: "pass",
      dryRun: true,
      miniAppUrl,
      payload,
      caddy,
      telegram: {
        method: "setChatMenuButton",
        called: false,
        detail: "Dry-run completed; Telegram Bot API was not called."
      }
    };
  }

  await callTelegramBotApi<true>("setChatMenuButton", token, payload, options.fetchImpl ?? fetch, options);
  return {
    kind: "telegram-menu",
    action: "set",
    status: "pass",
    dryRun: false,
    miniAppUrl,
    payload,
    caddy,
    telegram: {
      method: "setChatMenuButton",
      called: true,
      detail: "Telegram setChatMenuButton accepted the HappyTG Mini App menu button."
    }
  };
}

export async function runTelegramMenuReset(options: TelegramMenuCommandOptions = {}): Promise<TelegramMenuCommandResult> {
  const env = options.env ?? process.env;
  loadHappyTGEnv({
    cwd: options.cwd,
    env
  });
  const token = requireTelegramBotToken(env);
  const payload = telegramMenuResetPayload();

  await callTelegramBotApi<true>("setChatMenuButton", token, payload, options.fetchImpl ?? fetch, options);
  return {
    kind: "telegram-menu",
    action: "reset",
    status: "pass",
    dryRun: false,
    payload,
    telegram: {
      method: "setChatMenuButton",
      called: true,
      detail: "Telegram setChatMenuButton reset the bot menu button to the default state."
    }
  };
}

export async function inspectTelegramMenuDiagnostics(options: TelegramMenuCommandOptions = {}): Promise<TelegramMenuDiagnostics> {
  const env = options.env ?? process.env;
  const tokenState = telegramTokenStatus(env);
  const resolvedUrl = resolveMiniAppBaseUrl(env);
  const validation = validatePublicHttpsUrl(resolvedUrl, "Mini App URL");
  const caddy = validation.ok && validation.url
    ? await checkCaddyMiniAppRoute(validation.url, {
      fetchImpl: options.fetchImpl,
      timeoutMs: options.preflightTimeoutMs ?? 3_000
    })
    : undefined;

  return {
    token: {
      status: tokenState.status,
      configured: tokenState.configured,
      message: tokenState.configured
        ? "TELEGRAM_BOT_TOKEN is configured."
        : tokenState.status === "invalid"
          ? "TELEGRAM_BOT_TOKEN format looks invalid."
          : "TELEGRAM_BOT_TOKEN is missing or still a placeholder."
    },
    miniAppUrl: {
      value: validation.url ?? resolvedUrl,
      ok: validation.ok,
      message: validation.ok
        ? "Mini App URL is public HTTPS."
        : `${validation.reason ?? "Mini App URL is not configured."} Local polling can still use Telegram bot commands; Telegram WebApp buttons and menu setup require a public HTTPS /miniapp URL.`
    },
    caddy: caddy
      ? {
        checked: true,
        ok: caddy.ok,
        status: caddy.status,
        message: caddy.detail
      }
      : {
        checked: false,
        message: "Public Caddy Mini App route was not checked because the Mini App URL is missing or unsafe."
      },
    menuButton: {
      checked: false,
      message: "Telegram menu button state is not checked during doctor/verify to avoid leaking tokens through network diagnostics. Run `pnpm happytg telegram menu set --dry-run`, then `pnpm happytg telegram menu set`."
    }
  };
}
