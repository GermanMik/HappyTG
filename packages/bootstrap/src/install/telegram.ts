import type { TelegramBotIdentity } from "./types.js";

export function normalizeTelegramAllowedUserIds(values: string[]): string[] {
  return values
    .flatMap((value) => value.split(","))
    .map((value) => value.trim())
    .filter(Boolean);
}

export function maskTelegramToken(token: string): string {
  const trimmed = token.trim();
  if (!trimmed) {
    return "";
  }

  const [prefix, suffix] = trimmed.split(":", 2);
  if (!suffix) {
    return "*".repeat(Math.min(trimmed.length, 8));
  }

  return `${prefix}:${"*".repeat(Math.min(Math.max(suffix.length - 4, 4), 24))}${suffix.slice(-4)}`;
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
