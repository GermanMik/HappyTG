import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export interface TelegramMiniAppUser {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  allows_write_to_pm?: boolean;
}

export interface TelegramMiniAppValidationSuccess {
  ok: true;
  authDate: Date;
  queryId?: string;
  startParam?: string;
  user: TelegramMiniAppUser;
  fields: Record<string, string>;
}

export interface TelegramMiniAppValidationFailure {
  ok: false;
  reason:
    | "missing_hash"
    | "missing_auth_date"
    | "missing_user"
    | "expired"
    | "bad_hash"
    | "bad_payload";
}

export type TelegramMiniAppValidationResult =
  | TelegramMiniAppValidationSuccess
  | TelegramMiniAppValidationFailure;

export interface TelegramMiniAppValidationOptions {
  botToken: string;
  maxAgeSeconds?: number;
  now?: Date;
}

function base64Url(buffer: Buffer): string {
  return buffer
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

function fromBase64Url(value: string): Buffer {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  return Buffer.from(padded, "base64");
}

function safeEqualHex(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "hex");
  const rightBuffer = Buffer.from(right, "hex");
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}

function dataCheckString(params: URLSearchParams): string {
  return [...params.entries()]
    .filter(([key]) => key !== "hash")
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
}

export function validateTelegramMiniAppInitData(
  initData: string,
  options: TelegramMiniAppValidationOptions
): TelegramMiniAppValidationResult {
  try {
    const params = new URLSearchParams(initData);
    const receivedHash = params.get("hash");
    if (!receivedHash) {
      return { ok: false, reason: "missing_hash" };
    }

    const authDateRaw = params.get("auth_date");
    if (!authDateRaw) {
      return { ok: false, reason: "missing_auth_date" };
    }

    const userRaw = params.get("user");
    if (!userRaw) {
      return { ok: false, reason: "missing_user" };
    }

    const authDateSeconds = Number(authDateRaw);
    if (!Number.isFinite(authDateSeconds)) {
      return { ok: false, reason: "bad_payload" };
    }

    const now = options.now ?? new Date();
    const maxAgeSeconds = options.maxAgeSeconds ?? 24 * 60 * 60;
    if ((now.getTime() / 1000) - authDateSeconds > maxAgeSeconds) {
      return { ok: false, reason: "expired" };
    }

    const secretKey = createHmac("sha256", "WebAppData").update(options.botToken).digest();
    const expectedHash = createHmac("sha256", secretKey).update(dataCheckString(params)).digest("hex");
    if (!safeEqualHex(receivedHash, expectedHash)) {
      return { ok: false, reason: "bad_hash" };
    }

    const parsedUser = JSON.parse(userRaw) as TelegramMiniAppUser;
    if (!Number.isFinite(parsedUser.id)) {
      return { ok: false, reason: "bad_payload" };
    }

    const fields: Record<string, string> = {};
    for (const [key, value] of params.entries()) {
      fields[key] = value;
    }

    return {
      ok: true,
      authDate: new Date(authDateSeconds * 1000),
      queryId: params.get("query_id") ?? undefined,
      startParam: params.get("start_param") ?? undefined,
      user: parsedUser,
      fields
    };
  } catch {
    return { ok: false, reason: "bad_payload" };
  }
}

export function makeLaunchGrantId(): string {
  return `lag_${base64Url(randomBytes(12))}`;
}

export function makeMiniAppSessionToken(): string {
  return `mas_${base64Url(randomBytes(24))}`;
}

export function signMiniAppLaunchPayload(grantId: string, secret: string): string {
  const signature = base64Url(createHmac("sha256", secret).update(grantId).digest().subarray(0, 16));
  return `${grantId}.${signature}`;
}

export function verifyMiniAppLaunchPayload(payload: string, secret: string): { ok: true; grantId: string } | { ok: false } {
  const [grantId, signature] = payload.split(".");
  if (!grantId || !signature) {
    return { ok: false };
  }

  const expected = signMiniAppLaunchPayload(grantId, secret).split(".")[1] ?? "";
  const left = fromBase64Url(signature);
  const right = fromBase64Url(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right)) {
    return { ok: false };
  }

  return { ok: true, grantId };
}
