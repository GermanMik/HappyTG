import { telegramTokenStatus } from "../../../shared/src/index.js";

import type { TelegramBotIdentity } from "./types.js";

export function normalizeTelegramAllowedUserIds(values: string[]): string[] {
  return values
    .flatMap((value) => value.split(","))
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
      error: "Bot token was not provided."
    };
  }

  try {
    const response = await fetchImpl(`https://api.telegram.org/bot${token}/getMe`);
    if (!response.ok) {
      return {
        ok: false,
        error: `Telegram API returned ${response.status}.`
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
      return {
        ok: false,
        error: body.description ?? "Telegram API rejected the token."
      };
    }

    return {
      ok: true,
      id: body.result.id,
      username: body.result.username,
      firstName: body.result.first_name
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Telegram API lookup failed."
    };
  }
}

export function pairTargetLabel(identity?: TelegramBotIdentity): string {
  if (identity?.username) {
    return `@${identity.username}`;
  }

  return "the configured Telegram bot";
}
