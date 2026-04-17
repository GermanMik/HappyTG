import { spawn } from "node:child_process";
import path from "node:path";

import { telegramTokenStatus } from "../../../shared/src/index.js";

import type { TelegramBotIdentity, TelegramLookupDiagnostic } from "./types.js";

type TelegramFetchErrorKind =
  | "dns_failure"
  | "connect_timeout"
  | "connect_refused"
  | "connection_reset"
  | "tls_error"
  | "proxy_error"
  | "generic_network_error";

interface TelegramFetchErrorDescription {
  kind: TelegramFetchErrorKind;
  message: string;
}

interface TelegramTransportProbeResult {
  kind: "validated" | "invalid_token" | "api_error" | "network_error" | "unexpected_response";
  message?: string;
  username?: string;
  firstName?: string;
  statusCode?: number;
}

interface FetchTelegramBotIdentityOptions {
  platform?: NodeJS.Platform;
  probeNetworkIssue?: (token: string) => Promise<TelegramTransportProbeResult | undefined>;
}

const NODE_TRANSPORT_ADVICE = "Check Node/undici proxy settings (`HTTPS_PROXY`, `HTTP_PROXY`, `ALL_PROXY`, `NO_PROXY`), WinHTTP proxy differences, firewall or AV TLS interception, and whether IPv4/IPv6 routing to api.telegram.org differs on this machine.";

export function normalizeTelegramAllowedUserIds(values: string[]): string[] {
  return values
    .flatMap((value) => value.split(/[,\r\n]+/u))
    .map((value) => value.trim())
    .filter(Boolean);
}

export function validateTelegramBotToken(token: string): string | undefined {
  const trimmed = token.trim();
  if (trimmed.startsWith("@")) {
    return "Telegram bot token field expects the BotFather token, not a bot username like @name.";
  }

  const status = telegramTokenStatus({
    TELEGRAM_BOT_TOKEN: trimmed
  }).status;

  switch (status) {
    case "missing":
      return "Telegram bot token is required.";
    case "placeholder":
      return "Telegram bot token still looks like a placeholder. Paste the real value from @BotFather.";
    case "invalid":
      return "Telegram bot token looks incomplete. Paste the full token from @BotFather.";
    case "configured":
    default:
      return undefined;
  }
}

function errorCode(value: unknown): string | undefined {
  if (!value || typeof value !== "object" || !("code" in value)) {
    return undefined;
  }

  const code = (value as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

function errorMessage(value: unknown): string | undefined {
  if (value instanceof Error) {
    return value.message;
  }
  if (typeof value === "string") {
    return value;
  }
  if (value && typeof value === "object" && "message" in value) {
    const message = (value as { message?: unknown }).message;
    return typeof message === "string" ? message : undefined;
  }

  return undefined;
}

function describeTelegramFetchError(error: unknown): TelegramFetchErrorDescription {
  const code = errorCode(error)
    ?? errorCode(error instanceof Error ? (error as Error & { cause?: unknown }).cause : undefined);
  const message = errorMessage(error)?.trim()
    ?? errorMessage(error instanceof Error ? (error as Error & { cause?: unknown }).cause : undefined)?.trim()
    ?? "Telegram API lookup failed.";
  const lowerMessage = message.toLowerCase();

  if (code === "ENOTFOUND" || code === "EAI_AGAIN") {
    return {
      kind: "dns_failure",
      message: "DNS lookup for api.telegram.org failed."
    };
  }
  if (code === "ETIMEDOUT" || code === "UND_ERR_CONNECT_TIMEOUT") {
    return {
      kind: "connect_timeout",
      message: "Connection to api.telegram.org timed out."
    };
  }
  if (code === "ECONNREFUSED") {
    return {
      kind: "connect_refused",
      message: "Connection to api.telegram.org was refused."
    };
  }
  if (code === "ECONNRESET" || code === "UND_ERR_SOCKET") {
    return {
      kind: "connection_reset",
      message: "Connection to api.telegram.org was interrupted before Telegram replied."
    };
  }
  if (code?.startsWith("ERR_TLS") || code?.startsWith("ERR_SSL") || code?.startsWith("CERT_")
    || /certificate|tls|ssl/iu.test(message)) {
    return {
      kind: "tls_error",
      message: "TLS handshake with api.telegram.org failed."
    };
  }
  if (/proxy/iu.test(message)) {
    return {
      kind: "proxy_error",
      message: "The configured proxy blocked or rejected the Telegram API request."
    };
  }
  if (lowerMessage === "fetch failed") {
    return {
      kind: "generic_network_error",
      message: "The network request failed before Telegram returned a response. Check proxy, TLS, firewall, and access to api.telegram.org."
    };
  }

  return {
    kind: "generic_network_error",
    message
  };
}

async function probeTelegramGetMeViaWindowsPowerShell(token: string): Promise<TelegramTransportProbeResult | undefined> {
  if (process.platform !== "win32") {
    return undefined;
  }

  const powershellPath = process.env.SystemRoot
    ? path.join(process.env.SystemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
    : "powershell.exe";
  const script = [
    "$ErrorActionPreference = 'Stop'",
    "$ProgressPreference = 'SilentlyContinue'",
    "$token = $env:HAPPYTG_TELEGRAM_BOT_TOKEN_PROBE",
    "if (-not $token) {",
    "  @{ kind = 'unexpected_response'; message = 'Bot token was not provided to the PowerShell probe.' } | ConvertTo-Json -Compress",
    "  exit 0",
    "}",
    "$uri = \"https://api.telegram.org/bot$token/getMe\"",
    "try {",
    "  $response = Invoke-RestMethod -Uri $uri -Method Get -TimeoutSec 20",
    "  if ($response.ok -and $response.result) {",
    "    @{ kind = 'validated'; username = $response.result.username; firstName = $response.result.first_name } | ConvertTo-Json -Compress",
    "  } else {",
    "    $description = if ($response.description) { [string]$response.description } else { 'Telegram API rejected the token.' }",
    "    $kind = if ($description -match 'unauthorized|invalid token|bot not found') { 'invalid_token' } else { 'api_error' }",
    "    @{ kind = $kind; message = $description } | ConvertTo-Json -Compress",
    "  }",
    "} catch {",
    "  $response = $_.Exception.Response",
    "  if ($response) {",
    "    $statusCode = [int]$response.StatusCode",
    "    $fallbackKind = if ($statusCode -eq 401 -or $statusCode -eq 404) { 'invalid_token' } else { 'api_error' }",
    "    $fallbackMessage = [string]$_.Exception.Message",
    "    try {",
    "      $stream = $response.GetResponseStream()",
    "      $reader = [System.IO.StreamReader]::new($stream)",
      "      $body = $reader.ReadToEnd()",
      "      if ($body) {",
      "        $json = $body | ConvertFrom-Json",
      "        $description = if ($json.description) { [string]$json.description } else { [string]$_.Exception.Message }",
      "        $kind = if ($description -match 'unauthorized|invalid token|bot not found') { 'invalid_token' } else { 'api_error' }",
    "        @{ kind = $kind; message = $description; statusCode = $statusCode } | ConvertTo-Json -Compress",
      "      } else {",
    "        @{ kind = $fallbackKind; message = $fallbackMessage; statusCode = $statusCode } | ConvertTo-Json -Compress",
      "      }",
    "    } catch {",
    "      @{ kind = $fallbackKind; message = $fallbackMessage; statusCode = $statusCode } | ConvertTo-Json -Compress",
    "    }",
    "  } else {",
    "    @{ kind = 'network_error'; message = [string]$_.Exception.Message } | ConvertTo-Json -Compress",
    "  }",
    "}"
  ].join("\n");

  return new Promise((resolve) => {
    const child = spawn(powershellPath, [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      script
    ], {
      env: {
        ...process.env,
        HAPPYTG_TELEGRAM_BOT_TOKEN_PROBE: token
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
        kind: "network_error",
        message: "Windows PowerShell Bot API probe timed out."
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
        kind: "unexpected_response",
        message: error instanceof Error ? error.message : "Windows PowerShell Bot API probe failed to start."
      });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (settled) {
        return;
      }
      settled = true;
      const rawOutput = stdout.trim();
      const jsonLine = rawOutput
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .filter(Boolean)
        .pop();
      if (!jsonLine) {
        resolve({
          kind: "unexpected_response",
          message: stderr.trim() || `Windows PowerShell Bot API probe exited with code ${code ?? 1}.`
        });
        return;
      }

      try {
        resolve(JSON.parse(jsonLine) as TelegramTransportProbeResult);
      } catch {
        resolve({
          kind: "unexpected_response",
          message: jsonLine
        });
      }
    });
  });
}

function networkFollowUpMessage(baseMessage: string, probeResult?: TelegramTransportProbeResult): {
  failureKind: TelegramBotIdentity["failureKind"];
  message: string;
  recoverable: boolean;
  username?: string;
  firstName?: string;
  statusCode?: number;
  transportProbeValidated?: boolean;
} {
  if (!probeResult) {
    return {
      failureKind: "network_error",
      message: baseMessage,
      recoverable: true
    };
  }

  switch (probeResult.kind) {
    case "validated": {
      const usernameLabel = probeResult.username ? ` @${probeResult.username}` : "";
      return {
        failureKind: "network_error",
        message: `${baseMessage} A Windows PowerShell Bot API probe with the same token validated${usernameLabel} on this host, so this looks specific to Node HTTPS/undici transport rather than a bad token or a general Telegram outage. Telegram Desktop may still work because it uses MTProto instead of Bot API HTTPS. ${NODE_TRANSPORT_ADVICE}`,
        recoverable: true,
        username: probeResult.username,
        firstName: probeResult.firstName,
        transportProbeValidated: true
      };
    }
    case "invalid_token":
      return {
        failureKind: "invalid_token",
        message: `Telegram API getMe rejected the configured token: ${probeResult.message ?? "Unauthorized"}. Node HTTPS also failed earlier with: ${baseMessage} This means Telegram was reachable through a second transport, but the token itself is invalid.`,
        recoverable: false,
        statusCode: probeResult.statusCode
      };
    case "api_error":
      return {
        failureKind: "api_error",
        message: `Telegram API getMe could not be confirmed through Node HTTPS (${baseMessage}), but a Windows PowerShell Bot API probe reached Telegram and got: ${probeResult.message ?? "unexpected API response"}.`,
        recoverable: true,
        statusCode: probeResult.statusCode
      };
    case "network_error":
      return {
        failureKind: "network_error",
        message: `${baseMessage} A Windows PowerShell Bot API probe also failed: ${probeResult.message ?? "network error"}. Telegram Desktop may still work because it uses MTProto instead of Bot API HTTPS, but Bot API HTTPS appears blocked or timing out from this machine. ${NODE_TRANSPORT_ADVICE}`,
        recoverable: true
      };
    case "unexpected_response":
    default:
      return {
        failureKind: "unexpected_response",
        message: `Telegram API getMe could not be confirmed: ${baseMessage} The Windows PowerShell follow-up probe returned an unexpected result: ${probeResult.message ?? "unexpected response"}.`,
        recoverable: true
      };
  }
}

export async function fetchTelegramBotIdentity(
  token: string,
  fetchImpl: typeof fetch = fetch,
  options?: FetchTelegramBotIdentityOptions
): Promise<TelegramBotIdentity> {
  if (!token.trim()) {
    return {
      ok: false,
      error: "Bot token was not provided.",
      step: "getMe",
      failureKind: "missing_token",
      recoverable: false
    };
  }

  try {
    const response = await fetchImpl(`https://api.telegram.org/bot${token}/getMe`);
    if (!response.ok) {
      const rejectedToken = response.status === 401 || response.status === 404;
      return {
        ok: false,
        error: rejectedToken
          ? `Telegram API getMe rejected the token with HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ""}.`
          : `Telegram Bot API returned HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ""}.`,
        step: "getMe",
        failureKind: rejectedToken ? "invalid_token" : "api_error",
        recoverable: !rejectedToken,
        statusCode: response.status
      };
    }

    type TelegramGetMeResponse = {
      ok?: boolean;
      result?: {
        id?: number;
        username?: string;
        first_name?: string;
      };
      description?: string;
    };
    let body: TelegramGetMeResponse;
    try {
      body = await response.json() as TelegramGetMeResponse;
    } catch {
      return {
        ok: false,
        error: "Telegram API getMe returned a non-JSON response.",
        step: "getMe",
        failureKind: "unexpected_response",
        recoverable: true
      };
    }

    if (!body.ok || !body.result) {
      const description = body.description ?? "Telegram API rejected the token.";
      const rejectedToken = /unauthorized|invalid token|bot not found/iu.test(description);
      return {
        ok: false,
        error: description,
        step: "getMe",
        failureKind: rejectedToken ? "invalid_token" : "unexpected_response",
        recoverable: !rejectedToken
      };
    }

    return {
      ok: true,
      id: body.result.id,
      username: body.result.username,
      firstName: body.result.first_name,
      step: "getMe"
    };
  } catch (error) {
    const describedError = describeTelegramFetchError(error);
    const shouldRunFollowUpProbe = (options?.platform ?? process.platform) === "win32"
      && (Boolean(options?.probeNetworkIssue) || fetchImpl === fetch);
    const probeResult = shouldRunFollowUpProbe
      ? await (options?.probeNetworkIssue ?? probeTelegramGetMeViaWindowsPowerShell)(token)
      : undefined;
    if (probeResult?.kind === "validated") {
      return {
        ok: true,
        username: probeResult.username,
        firstName: probeResult.firstName,
        step: "getMe",
        transportProbeValidated: true
      };
    }
    const followUp = networkFollowUpMessage(describedError.message, probeResult);
    return {
      ok: false,
      error: followUp.message,
      step: "getMe",
      failureKind: followUp.failureKind,
      recoverable: followUp.recoverable,
      username: followUp.username,
      firstName: followUp.firstName,
      statusCode: followUp.statusCode,
      transportProbeValidated: followUp.transportProbeValidated
    };
  }
}

export function pairTargetLabel(identity?: TelegramBotIdentity): string {
  if (identity?.username) {
    return `@${identity.username}`;
  }

  return "the configured Telegram bot";
}

export function telegramLookupDiagnostic(input: {
  botToken: string;
  identity?: TelegramBotIdentity;
  knownUsername?: string;
}): TelegramLookupDiagnostic {
  if (!input.botToken.trim()) {
    return {
      attempted: false,
      step: "getMe",
      status: "not-attempted",
      message: "No Telegram bot token was provided.",
      failureKind: "missing_token",
      recoverable: false,
      affectsConfiguration: true
    };
  }

  if (!input.identity) {
    return {
      attempted: false,
      step: "getMe",
      status: "not-attempted",
      message: "Telegram bot identity lookup did not run.",
      recoverable: true,
      affectsConfiguration: false
    };
  }

  if (input.identity.ok) {
    return {
      attempted: true,
      step: "getMe",
      status: "validated",
      message: input.identity.username
        ? `Telegram API getMe validated @${input.identity.username}.`
        : "Telegram API getMe validated the configured bot token.",
      recoverable: false,
      affectsConfiguration: false
    };
  }

  const usernameSuffix = input.knownUsername || input.identity.username
    ? ` Existing bot username @${(input.knownUsername ?? input.identity.username ?? "").replace(/^@/u, "")} was kept.`
    : "";

  switch (input.identity.failureKind) {
    case "invalid_token":
      return {
        attempted: true,
        step: input.identity.step ?? "getMe",
        status: "failed",
        message: `${input.identity.error ?? "Telegram API rejected the configured token."}${usernameSuffix}`,
        failureKind: "invalid_token",
        recoverable: false,
        affectsConfiguration: true
      };
    case "network_error":
      return {
        attempted: true,
        step: input.identity.step ?? "getMe",
        status: "warning",
        message: input.identity.transportProbeValidated
          ? `Telegram API getMe network request failed: ${input.identity.error ?? "network failure"}`
          : `Telegram API getMe network request failed: ${input.identity.error ?? "network failure"}.${usernameSuffix}`.replace(/\.\s*\./u, "."),
        failureKind: "network_error",
        recoverable: true,
        affectsConfiguration: false
      };
    case "api_error":
    case "unexpected_response":
    default:
      return {
        attempted: true,
        step: input.identity.step ?? "getMe",
        status: "warning",
        message: `Telegram API getMe could not confirm the bot identity: ${input.identity.error ?? "unexpected response"}.${usernameSuffix}`.replace(/\.\s*\./u, "."),
        failureKind: input.identity.failureKind ?? "unexpected_response",
        recoverable: input.identity.recoverable ?? true,
        affectsConfiguration: false
      };
  }
}
