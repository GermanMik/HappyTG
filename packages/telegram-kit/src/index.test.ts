import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";

import {
  makeLaunchGrantId,
  signMiniAppLaunchPayload,
  validateTelegramMiniAppInitData,
  verifyMiniAppLaunchPayload
} from "./index.js";

function signedInitData(fields: Record<string, string>, botToken: string): string {
  const params = new URLSearchParams(fields);
  const dataCheckString = [...params.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  const secretKey = createHmac("sha256", "WebAppData").update(botToken).digest();
  const hash = createHmac("sha256", secretKey).update(dataCheckString).digest("hex");
  params.set("hash", hash);
  return params.toString();
}

test("validateTelegramMiniAppInitData accepts signed fresh init data", () => {
  const botToken = "123456:abcdefghijklmnopqrstuvwx";
  const authDate = 1_777_000_000;
  const initData = signedInitData({
    auth_date: String(authDate),
    query_id: "AAE",
    start_param: "home",
    user: JSON.stringify({ id: 42, first_name: "Ada", username: "ada" })
  }, botToken);

  const result = validateTelegramMiniAppInitData(initData, {
    botToken,
    now: new Date((authDate + 10) * 1000)
  });

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.user.id, 42);
    assert.equal(result.startParam, "home");
  }
});

test("validateTelegramMiniAppInitData rejects stale or tampered init data", () => {
  const botToken = "123456:abcdefghijklmnopqrstuvwx";
  const initData = signedInitData({
    auth_date: "100",
    user: JSON.stringify({ id: 42 })
  }, botToken);

  assert.deepEqual(validateTelegramMiniAppInitData(initData, {
    botToken,
    now: new Date(200_000 * 1000),
    maxAgeSeconds: 60
  }), { ok: false, reason: "expired" });

  const tampered = initData.replace("42", "43");
  assert.deepEqual(validateTelegramMiniAppInitData(tampered, {
    botToken,
    now: new Date(110 * 1000)
  }), { ok: false, reason: "bad_hash" });
});

test("signed launch payloads are short and tamper-resistant", () => {
  const grantId = makeLaunchGrantId();
  const payload = signMiniAppLaunchPayload(grantId, "secret");

  assert.ok(payload.length < 70);
  assert.deepEqual(verifyMiniAppLaunchPayload(payload, "secret"), { ok: true, grantId });
  assert.deepEqual(verifyMiniAppLaunchPayload(`${grantId}.bad`, "secret"), { ok: false });
});
