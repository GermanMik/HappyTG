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
          ? `Telegram API getMe rejected the token with HTTP ${response.status}.`
          : `Telegram API getMe returned HTTP ${response.status}.`,
        step: "getMe",
        failureKind: rejectedToken ? "invalid_token" : "api_error",
        recoverable: !rejectedToken,
        statusCode: response.status
      };
    }

    const body = await response.json() as {
      ok?: boolean;
      result?: {
        id?: number;
        username?: string;
        first_name?: string;
      };
      description?: string;
    };

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
      error: error instanceof Error ? error.message : "Telegram API lookup failed.",
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
