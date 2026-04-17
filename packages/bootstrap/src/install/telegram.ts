import { telegramTokenStatus } from "../../../shared/src/index.js";

import type { TelegramBotIdentity, TelegramLookupDiagnostic } from "./types.js";

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

function describeTelegramFetchError(error: unknown): string {
  const code = errorCode(error)
    ?? errorCode(error instanceof Error ? (error as Error & { cause?: unknown }).cause : undefined);
  const message = errorMessage(error)?.trim()
    ?? errorMessage(error instanceof Error ? (error as Error & { cause?: unknown }).cause : undefined)?.trim()
    ?? "Telegram API lookup failed.";
  const lowerMessage = message.toLowerCase();

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
  if (code?.startsWith("ERR_TLS") || code?.startsWith("ERR_SSL") || code?.startsWith("CERT_")
    || /certificate|tls|ssl/iu.test(message)) {
    return "TLS handshake with api.telegram.org failed.";
  }
  if (/proxy/iu.test(message)) {
    return "The configured proxy blocked or rejected the Telegram API request.";
  }
  if (lowerMessage === "fetch failed") {
    return "The network request failed before Telegram returned a response. Check proxy, TLS, firewall, and access to api.telegram.org.";
  }

  return message;
}

export async function fetchTelegramBotIdentity(
  token: string,
  fetchImpl: typeof fetch = fetch
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
    return {
      ok: false,
      error: describeTelegramFetchError(error),
      step: "getMe",
      failureKind: "network_error",
      recoverable: true
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
        message: `Telegram API getMe network request failed: ${input.identity.error ?? "network failure"}.${usernameSuffix}`.replace(/\.\s*\./u, "."),
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
