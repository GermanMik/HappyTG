import assert from "node:assert/strict";
import test from "node:test";

import type { BotDependencies } from "./handlers.js";
import { createBotHandlers } from "./handlers.js";

interface CapturedMessage {
  chatId: number;
  text: string;
  replyMarkup?: Record<string, unknown>;
}

test("resume command sends session transition summary", async () => {
  const messages: CapturedMessage[] = [];
  const calls: Array<{ pathname: string; init?: RequestInit }> = [];
  const apiFetch: BotDependencies["apiFetch"] = async (pathname, init) => {
    calls.push({ pathname, init });
    if (pathname === "/api/v1/sessions/ses_1/resume") {
      return {
        id: "ses_1",
        state: "reconnecting",
        currentSummary: "Waiting for host reconnect"
      } as never;
    }
    throw new Error(`Unexpected path ${pathname}`);
  };
  const handlers = createBotHandlers({
    apiFetch,
    async sendTelegramMessage(chatId, text, replyMarkup) {
      messages.push({ chatId, text, replyMarkup });
    }
  });

  await handlers.handleMessage({
    message_id: 1,
    text: "/resume ses_1",
    chat: { id: 100 }
  });

  assert.equal(calls[0]?.pathname, "/api/v1/sessions/ses_1/resume");
  assert.equal(calls[0]?.init?.method, "POST");
  assert.match(messages[0]?.text ?? "", /Session ses_1 moved to reconnecting/);
  assert.match(messages[0]?.text ?? "", /Waiting for host reconnect/);
});

test("doctor command resolves telegram identity and creates bootstrap session", async () => {
  const messages: CapturedMessage[] = [];
  const calls: Array<{ pathname: string; init?: RequestInit }> = [];
  const apiFetch: BotDependencies["apiFetch"] = async (pathname, init) => {
    calls.push({ pathname, init });
    if (pathname === "/api/v1/users/by-telegram/42") {
      return { id: "usr_42" } as never;
    }
    if (pathname === "/api/v1/hosts/host_1/bootstrap/doctor") {
      return {
        session: {
          id: "ses_doc",
          state: "pending_dispatch",
          title: "Bootstrap doctor: devbox"
        }
      } as never;
    }
    throw new Error(`Unexpected path ${pathname}`);
  };
  const handlers = createBotHandlers({
    apiFetch,
    async sendTelegramMessage(chatId, text, replyMarkup) {
      messages.push({ chatId, text, replyMarkup });
    }
  });

  await handlers.handleMessage({
    message_id: 2,
    text: "/doctor host_1",
    chat: { id: 101 },
    from: { id: 42, username: "dev" }
  });

  assert.deepEqual(
    calls.map((call) => call.pathname),
    ["/api/v1/users/by-telegram/42", "/api/v1/hosts/host_1/bootstrap/doctor"]
  );
  assert.match(messages[0]?.text ?? "", /Bootstrap doctor: devbox created as session ses_doc/);
});

test("verify command surfaces approval keyboard when required", async () => {
  const messages: CapturedMessage[] = [];
  const apiFetch: BotDependencies["apiFetch"] = async (pathname) => {
    if (pathname === "/api/v1/users/by-telegram/77") {
      return { id: "usr_77" } as never;
    }
    if (pathname === "/api/v1/hosts/host_2/bootstrap/verify") {
      return {
        session: {
          id: "ses_verify",
          state: "awaiting_approval",
          title: "Bootstrap verify: buildbox"
        },
        approval: {
          id: "apr_1",
          reason: "Policy requires approval",
          state: "pending"
        }
      } as never;
    }
    throw new Error(`Unexpected path ${pathname}`);
  };
  const handlers = createBotHandlers({
    apiFetch,
    async sendTelegramMessage(chatId, text, replyMarkup) {
      messages.push({ chatId, text, replyMarkup });
    }
  });

  await handlers.handleMessage({
    message_id: 3,
    text: "/verify host_2",
    chat: { id: 102 },
    from: { id: 77, username: "ops" }
  });

  assert.match(messages[0]?.text ?? "", /requires approval/);
  assert.deepEqual(messages[0]?.replyMarkup, {
    inline_keyboard: [
      [
        { text: "Approve", callback_data: "approval:approve:apr_1" },
        { text: "Reject", callback_data: "approval:reject:apr_1" }
      ]
    ]
  });
});

test("approval callback resolves with the linked HappyTG user", async () => {
  const messages: CapturedMessage[] = [];
  const calls: Array<{ pathname: string; init?: RequestInit }> = [];
  const apiFetch: BotDependencies["apiFetch"] = async (pathname, init) => {
    calls.push({ pathname, init });
    if (pathname === "/api/v1/users/by-telegram/88") {
      return { id: "usr_88" } as never;
    }
    if (pathname === "/api/v1/approvals/apr_9/resolve") {
      return {
        approval: { id: "apr_9", state: "approved" },
        session: { id: "ses_9", state: "pending_dispatch" }
      } as never;
    }
    throw new Error(`Unexpected path ${pathname}`);
  };
  const handlers = createBotHandlers({
    apiFetch,
    async sendTelegramMessage(chatId, text, replyMarkup) {
      messages.push({ chatId, text, replyMarkup });
    }
  });

  await handlers.handleCallbackQuery({
    id: "cb_1",
    data: "approval:approve:apr_9",
    from: { id: 88, username: "lead" },
    message: {
      message_id: 4,
      chat: { id: 103 },
      text: "Approve?"
    }
  });

  assert.deepEqual(
    calls.map((call) => call.pathname),
    ["/api/v1/users/by-telegram/88", "/api/v1/approvals/apr_9/resolve"]
  );
  assert.match(messages[0]?.text ?? "", /Approval apr_9 is now approved/);
  assert.match(messages[0]?.text ?? "", /Session ses_9 -> pending_dispatch/);
});
