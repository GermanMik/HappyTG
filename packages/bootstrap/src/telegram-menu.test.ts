import assert from "node:assert/strict";
import test from "node:test";

import { resolveMiniAppBaseUrl } from "../../shared/src/index.js";
import {
  inspectTelegramMenuDiagnostics,
  resolveTelegramMenuMiniAppUrl,
  runTelegramMenuReset,
  runTelegramMenuSet
} from "./telegram-menu.js";

const TOKEN = "123456:abcdefghijklmnopqrstuvwx";
const MINIAPP_URL = "https://happytg.gerta.crazedns.ru:8443/miniapp";

function telegramOk(result: unknown = true): Response {
  return new Response(JSON.stringify({
    ok: true,
    result
  }), {
    status: 200,
    headers: {
      "content-type": "application/json"
    }
  });
}

test("Mini App URL resolution chooses configured public HTTPS URLs before local legacy app URLs", () => {
  assert.equal(resolveMiniAppBaseUrl({
    HAPPYTG_MINIAPP_URL: "https://mini.example/miniapp",
    HAPPYTG_APP_URL: "https://app.example/miniapp",
    HAPPYTG_PUBLIC_URL: "https://public.example"
  }), "https://mini.example/miniapp");

  assert.equal(resolveMiniAppBaseUrl({
    HAPPYTG_APP_URL: "https://app.example/miniapp",
    HAPPYTG_PUBLIC_URL: "https://public.example"
  }), "https://app.example/miniapp");

  assert.equal(resolveMiniAppBaseUrl({
    HAPPYTG_APP_URL: "http://localhost:3001",
    HAPPYTG_PUBLIC_URL: "https://public.example"
  }), "https://public.example/miniapp");

  assert.equal(resolveMiniAppBaseUrl({
    HAPPYTG_APP_URL: "https://app.example/miniapp",
    HAPPYTG_PUBLIC_URL: "http://localhost:4000"
  }), "https://app.example/miniapp");

  assert.equal(resolveMiniAppBaseUrl({
    HAPPYTG_PUBLIC_URL: "https://public.example:8443"
  }), "https://public.example:8443/miniapp");
});

test("Mini App URL resolution keeps local Mini App port diagnostics separate from the local API URL", () => {
  assert.equal(resolveMiniAppBaseUrl({
    HAPPYTG_MINIAPP_PORT: "3007",
    HAPPYTG_APP_URL: "http://localhost:3007",
    HAPPYTG_PUBLIC_URL: "http://localhost:4000"
  }), "http://localhost:3007");
});

test("Telegram menu setup rejects invalid, local, private, and plain HTTP Mini App URLs", () => {
  for (const value of [
    "not a url",
    "http://happytg.gerta.crazedns.ru/miniapp",
    "https://localhost/miniapp",
    "https://127.0.0.1/miniapp",
    "https://10.0.0.5/miniapp",
    "https://happy.internal/miniapp"
  ]) {
    assert.throws(
      () => resolveTelegramMenuMiniAppUrl({
        HAPPYTG_MINIAPP_URL: value
      }),
      /Mini App URL/
    );
  }
});

test("Telegram menu setup supports explicit public 8443 Mini App URLs", async () => {
  const calls: string[] = [];
  const result = await runTelegramMenuSet({
    dryRun: true,
    env: {
      TELEGRAM_BOT_TOKEN: TOKEN,
      HAPPYTG_MINIAPP_URL: MINIAPP_URL
    },
    fetchImpl: async (input) => {
      calls.push(String(input));
      return new Response("ok", { status: 200 });
    }
  });

  assert.equal(result.miniAppUrl, MINIAPP_URL);
  assert.deepEqual(calls, [MINIAPP_URL]);
  assert.equal(result.telegram.called, false);
});

test("Telegram menu setup sends the MenuButtonWebApp payload after Caddy preflight", async () => {
  const calls: Array<{ url: string; body?: unknown }> = [];
  const result = await runTelegramMenuSet({
    env: {
      TELEGRAM_BOT_TOKEN: TOKEN,
      HAPPYTG_MINIAPP_URL: MINIAPP_URL
    },
    fetchImpl: async (input, init) => {
      const url = String(input);
      calls.push({
        url,
        body: init?.body ? JSON.parse(String(init.body)) : undefined
      });
      if (url.includes("api.telegram.org")) {
        return telegramOk(true);
      }
      return new Response("ok", { status: 200 });
    }
  });

  assert.equal(result.telegram.called, true);
  assert.deepEqual(calls.map((call) => call.url), [
    MINIAPP_URL,
    `https://api.telegram.org/bot${TOKEN}/setChatMenuButton`
  ]);
  assert.deepEqual(calls[1]?.body, {
    menu_button: {
      type: "web_app",
      text: "HappyTG",
      web_app: {
        url: MINIAPP_URL
      }
    }
  });
  assert.doesNotMatch(JSON.stringify(result), new RegExp(TOKEN));
});

test("Telegram menu setup falls back to Windows PowerShell when Node fetch cannot reach Telegram", async () => {
  const calls: Array<{ url: string; body?: unknown }> = [];
  const fallbackCalls: Array<{ method: string; token: string; payload: Record<string, unknown> }> = [];
  const result = await runTelegramMenuSet({
    env: {
      TELEGRAM_BOT_TOKEN: TOKEN,
      HAPPYTG_MINIAPP_URL: MINIAPP_URL
    },
    platform: "win32",
    fetchImpl: async (input, init) => {
      const url = String(input);
      calls.push({
        url,
        body: init?.body ? JSON.parse(String(init.body)) : undefined
      });
      if (url.includes("api.telegram.org")) {
        throw new TypeError("fetch failed");
      }
      return new Response("ok", { status: 200 });
    },
    telegramApiPowerShellFallback: async (method, token, payload) => {
      fallbackCalls.push({
        method,
        token,
        payload
      });
      return {
        ok: true,
        result: true
      };
    }
  });

  assert.equal(result.telegram.called, true);
  assert.deepEqual(calls.map((call) => call.url), [
    MINIAPP_URL,
    `https://api.telegram.org/bot${TOKEN}/setChatMenuButton`
  ]);
  assert.deepEqual(fallbackCalls, [{
    method: "setChatMenuButton",
    token: TOKEN,
    payload: {
      menu_button: {
        type: "web_app",
        text: "HappyTG",
        web_app: {
          url: MINIAPP_URL
        }
      }
    }
  }]);
  assert.doesNotMatch(JSON.stringify(result), new RegExp(TOKEN));
});

test("Telegram menu dry-run does not call Telegram Bot API", async () => {
  const calls: string[] = [];
  await runTelegramMenuSet({
    dryRun: true,
    env: {
      TELEGRAM_BOT_TOKEN: TOKEN,
      HAPPYTG_MINIAPP_URL: MINIAPP_URL
    },
    fetchImpl: async (input) => {
      calls.push(String(input));
      assert.equal(String(input).includes("api.telegram.org"), false);
      return new Response("ok", { status: 200 });
    }
  });

  assert.deepEqual(calls, [MINIAPP_URL]);
});

test("Telegram menu setup fails before network calls when the token is missing", async () => {
  let called = false;
  await assert.rejects(
    () => runTelegramMenuSet({
      env: {
        TELEGRAM_BOT_TOKEN: "",
        HAPPYTG_MINIAPP_URL: MINIAPP_URL
      },
      fetchImpl: async () => {
        called = true;
        return new Response("ok", { status: 200 });
      }
    }),
    /TELEGRAM_BOT_TOKEN is missing/
  );

  assert.equal(called, false);
});

test("Telegram menu setup blocks when public Caddy /miniapp preflight is unavailable", async () => {
  const calls: string[] = [];
  await assert.rejects(
    () => runTelegramMenuSet({
      env: {
        TELEGRAM_BOT_TOKEN: TOKEN,
        HAPPYTG_MINIAPP_URL: MINIAPP_URL
      },
      fetchImpl: async (input) => {
        calls.push(String(input));
        return new Response("bad gateway", { status: 502 });
      }
    }),
    /Refusing to call Telegram setChatMenuButton/
  );

  assert.deepEqual(calls, [MINIAPP_URL]);
});

test("Telegram menu reset sends a default menu button payload", async () => {
  const calls: Array<{ url: string; body?: unknown }> = [];
  const result = await runTelegramMenuReset({
    env: {
      TELEGRAM_BOT_TOKEN: TOKEN
    },
    fetchImpl: async (input, init) => {
      calls.push({
        url: String(input),
        body: init?.body ? JSON.parse(String(init.body)) : undefined
      });
      return telegramOk(true);
    }
  });

  assert.equal(result.action, "reset");
  assert.deepEqual(calls[0]?.body, {
    menu_button: {
      type: "default"
    }
  });
});

test("Telegram menu diagnostics report an unavailable Caddy route without checking menu state", async () => {
  const diagnostics = await inspectTelegramMenuDiagnostics({
    env: {
      TELEGRAM_BOT_TOKEN: TOKEN,
      HAPPYTG_MINIAPP_URL: MINIAPP_URL
    },
    fetchImpl: async () => new Response("not found", { status: 404 })
  });

  assert.equal(diagnostics.token.configured, true);
  assert.equal(diagnostics.miniAppUrl.ok, true);
  assert.equal(diagnostics.caddy.checked, true);
  assert.equal(diagnostics.caddy.ok, false);
  assert.equal(diagnostics.menuButton.checked, false);
  assert.match(diagnostics.menuButton.message, /not checked/i);
});

test("Telegram menu diagnostics explain local polling separately from public HTTPS launch buttons", async () => {
  let called = false;
  const diagnostics = await inspectTelegramMenuDiagnostics({
    env: {
      TELEGRAM_BOT_TOKEN: TOKEN,
      HAPPYTG_MINIAPP_PORT: "3007",
      HAPPYTG_APP_URL: "http://localhost:3007",
      HAPPYTG_PUBLIC_URL: "http://localhost:4000"
    },
    fetchImpl: async () => {
      called = true;
      return new Response("unexpected", { status: 500 });
    }
  });

  assert.equal(diagnostics.miniAppUrl.ok, false);
  assert.equal(diagnostics.miniAppUrl.value, "http://localhost:3007/");
  assert.match(diagnostics.miniAppUrl.message, /Local polling can still use Telegram bot commands/i);
  assert.match(diagnostics.miniAppUrl.message, /public HTTPS \/miniapp URL/i);
  assert.equal(diagnostics.caddy.checked, false);
  assert.equal(called, false);
});
