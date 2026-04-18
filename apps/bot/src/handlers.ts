import type { CreateSessionRequest, ResolveApprovalRequest } from "../../../packages/protocol/src/index.js";

export interface TelegramUser {
  id: number;
  username?: string;
  first_name?: string;
  last_name?: string;
}

export interface TelegramChat {
  id: number;
}

export interface TelegramMessage {
  message_id: number;
  text?: string;
  chat: TelegramChat;
  from?: TelegramUser;
}

export interface TelegramCallbackQuery {
  id: string;
  data?: string;
  message?: TelegramMessage;
  from: TelegramUser;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
}

export interface BotDependencies {
  apiFetch<T>(pathname: string, init?: RequestInit): Promise<T>;
  sendTelegramMessage(chatId: number, text: string, replyMarkup?: Record<string, unknown>): Promise<void>;
  resolveInternalUserId?(user: TelegramUser): Promise<string | undefined>;
}

export function inlineApprovalKeyboard(approvalId: string) {
  return {
    inline_keyboard: [
      [
        { text: "Approve", callback_data: `approval:approve:${approvalId}` },
        { text: "Reject", callback_data: `approval:reject:${approvalId}` }
      ]
    ]
  };
}

export function createBotHandlers(dependencies: BotDependencies) {
  const resolveInternalUserId = dependencies.resolveInternalUserId ?? (async (user: TelegramUser) => {
    try {
      const result = await dependencies.apiFetch<{ id: string }>(`/api/v1/users/by-telegram/${user.id}`);
      return result.id;
    } catch {
      return undefined;
    }
  });

  async function handleStart(message: TelegramMessage): Promise<void> {
    await dependencies.sendTelegramMessage(
      message.chat.id,
      [
        "HappyTG bot is ready.",
        "Commands:",
        "/pair <PAIRING_CODE>",
        "/hosts",
        "/status <SESSION_ID>",
        "/resume <SESSION_ID>",
        "/doctor <HOST_ID>",
        "/verify <HOST_ID>",
        "/approve <APPROVAL_ID> <approve|reject> [reason]",
        "/session quick <HOST_ID> <WORKSPACE_ID> <PROMPT>",
        "/session proof <HOST_ID> <WORKSPACE_ID> <TITLE> || <PROMPT> || <criterion1;criterion2>"
      ].join("\n")
    );
  }

  async function handlePair(message: TelegramMessage, pairingCode: string): Promise<void> {
    if (!message.from) {
      await dependencies.sendTelegramMessage(message.chat.id, "Telegram user info is missing in this update.");
      return;
    }

    const result = await dependencies.apiFetch<{ user: { id: string; displayName: string }; host: { id: string; label: string } }>("/api/v1/pairing/claim", {
      method: "POST",
      body: JSON.stringify({
        pairingCode,
        telegramUserId: String(message.from.id),
        chatId: String(message.chat.id),
        username: message.from.username,
        displayName: [message.from.first_name, message.from.last_name].filter(Boolean).join(" ") || message.from.username || `tg-${message.from.id}`
      })
    });

    await dependencies.sendTelegramMessage(message.chat.id, `Host paired: ${result.host.label} (${result.host.id}) is now linked to ${result.user.displayName}.`);
  }

  async function handleHosts(message: TelegramMessage): Promise<void> {
    if (!message.from) {
      await dependencies.sendTelegramMessage(message.chat.id, "Telegram user info is missing in this update.");
      return;
    }

    const userId = await resolveInternalUserId(message.from);
    if (!userId) {
      await dependencies.sendTelegramMessage(message.chat.id, "No HappyTG user is linked to this Telegram account yet. Pair a host first.");
      return;
    }

    const result = await dependencies.apiFetch<{ hosts: Array<{ id: string; label: string; status: string; lastSeenAt?: string }> }>(`/api/v1/hosts?userId=${encodeURIComponent(userId)}`);
    if (result.hosts.length === 0) {
      await dependencies.sendTelegramMessage(message.chat.id, "No hosts linked to this Telegram account yet.");
      return;
    }

    await dependencies.sendTelegramMessage(
      message.chat.id,
      result.hosts.map((host) => `- ${host.label} (${host.id}) status=${host.status}${host.lastSeenAt ? ` lastSeen=${host.lastSeenAt}` : ""}`).join("\n")
    );
  }

  async function handleStatus(message: TelegramMessage, sessionId: string): Promise<void> {
    const session = await dependencies.apiFetch<{
      id: string;
      state: string;
      title: string;
      currentSummary?: string;
      lastError?: string;
      approval?: { id: string; state: string; reason: string };
      task?: { id: string; phase: string; verificationState: string };
    }>(`/api/v1/sessions/${sessionId}`);

    const lines = [
      `Session ${session.id}`,
      `State: ${session.state}`,
      `Title: ${session.title}`
    ];
    if (session.task) {
      lines.push(`Task: ${session.task.id} phase=${session.task.phase} verify=${session.task.verificationState}`);
    }
    if (session.approval) {
      lines.push(`Approval: ${session.approval.id} state=${session.approval.state}`);
    }
    if (session.currentSummary) {
      lines.push(`Summary: ${session.currentSummary}`);
    }
    if (session.lastError) {
      lines.push(`Error: ${session.lastError}`);
    }

    await dependencies.sendTelegramMessage(message.chat.id, lines.join("\n"));
  }

  async function handleResume(message: TelegramMessage, sessionId: string): Promise<void> {
    const session = await dependencies.apiFetch<{
      id: string;
      state: string;
      currentSummary?: string;
      lastError?: string;
    }>(`/api/v1/sessions/${sessionId}/resume`, {
      method: "POST"
    });

    const lines = [`Session ${session.id} moved to ${session.state}.`];
    if (session.currentSummary) {
      lines.push(`Summary: ${session.currentSummary}`);
    }
    if (session.lastError) {
      lines.push(`Last error: ${session.lastError}`);
    }
    await dependencies.sendTelegramMessage(message.chat.id, lines.join("\n"));
  }

  async function handleApprovalCommand(message: TelegramMessage, approvalId: string, decisionWord: string, reason?: string): Promise<void> {
    if (!message.from) {
      await dependencies.sendTelegramMessage(message.chat.id, "Telegram user info is missing in this update.");
      return;
    }

    const userId = await resolveInternalUserId(message.from);
    if (!userId) {
      await dependencies.sendTelegramMessage(message.chat.id, "No HappyTG user is linked to this Telegram account yet.");
      return;
    }

    const decision = decisionWord === "approve" ? "approved" : "rejected";
    const payload: ResolveApprovalRequest = {
      userId,
      decision,
      reason
    };
    const result = await dependencies.apiFetch<{ approval: { id: string; state: string }; session: { id: string; state: string } }>(`/api/v1/approvals/${approvalId}/resolve`, {
      method: "POST",
      body: JSON.stringify(payload)
    });

    await dependencies.sendTelegramMessage(message.chat.id, `Approval ${result.approval.id} is now ${result.approval.state}. Session ${result.session.id} -> ${result.session.state}.`);
  }

  async function handleSessionCommand(message: TelegramMessage, parts: string[]): Promise<void> {
    if (!message.from) {
      await dependencies.sendTelegramMessage(message.chat.id, "Telegram user info is missing in this update.");
      return;
    }

    const userId = await resolveInternalUserId(message.from);
    if (!userId) {
      await dependencies.sendTelegramMessage(message.chat.id, "No HappyTG user is linked to this Telegram account yet. Pair a host first.");
      return;
    }

    const mode = parts[0];
    if (mode === "quick") {
      const [hostId, workspaceId, ...promptParts] = parts.slice(1);
      const prompt = promptParts.join(" ").trim();
      const payload: CreateSessionRequest = {
        userId,
        hostId,
        workspaceId,
        mode: "quick",
        runtime: "codex-cli",
        title: `Quick task: ${prompt.slice(0, 40) || "untitled"}`,
        prompt
      };
      const result = await dependencies.apiFetch<{
        session: { id: string; state: string };
        approval?: { id: string; reason: string; state: string };
        dispatch?: { id: string };
      }>("/api/v1/sessions", {
        method: "POST",
        body: JSON.stringify(payload)
      });

      if (result.approval) {
        await dependencies.sendTelegramMessage(
          message.chat.id,
          `Approval required for session ${result.session.id}: ${result.approval.reason}`,
          inlineApprovalKeyboard(result.approval.id)
        );
        return;
      }

      await dependencies.sendTelegramMessage(message.chat.id, `Session ${result.session.id} created with state ${result.session.state}.`);
      return;
    }

    if (mode === "proof") {
      const [hostId, workspaceId, ...rest] = parts.slice(1);
      const joined = rest.join(" ");
      const [title, prompt, criteriaRaw] = joined.split("||").map((item) => item.trim());
      const acceptanceCriteria = (criteriaRaw ?? "Prompt satisfied;Independent verifier passed")
        .split(";")
        .map((item) => item.trim())
        .filter(Boolean);

      const payload: CreateSessionRequest = {
        userId,
        hostId,
        workspaceId,
        mode: "proof",
        runtime: "codex-cli",
        title: title || "Proof task",
        prompt: prompt || title || "Proof task",
        acceptanceCriteria
      };

      const result = await dependencies.apiFetch<{
        session: { id: string; state: string };
        task?: { id: string };
        approval?: { id: string; reason: string; state: string };
      }>("/api/v1/sessions", {
        method: "POST",
        body: JSON.stringify(payload)
      });

      if (result.approval) {
        await dependencies.sendTelegramMessage(
          message.chat.id,
          `Proof session ${result.session.id} created. Approval required: ${result.approval.reason}. Task: ${result.task?.id ?? "pending"}`,
          inlineApprovalKeyboard(result.approval.id)
        );
        return;
      }

      await dependencies.sendTelegramMessage(message.chat.id, `Proof session ${result.session.id} created. Task: ${result.task?.id ?? "n/a"}.`);
      return;
    }

    await dependencies.sendTelegramMessage(message.chat.id, "Usage: /session quick ... or /session proof ...");
  }

  async function handleBootstrapCommand(message: TelegramMessage, hostId: string, command: "doctor" | "verify"): Promise<void> {
    if (!message.from) {
      await dependencies.sendTelegramMessage(message.chat.id, "Telegram user info is missing in this update.");
      return;
    }

    const userId = await resolveInternalUserId(message.from);
    if (!userId) {
      await dependencies.sendTelegramMessage(message.chat.id, "No HappyTG user is linked to this Telegram account yet. Pair a host first.");
      return;
    }

    const result = await dependencies.apiFetch<{
      session: { id: string; state: string; title: string };
      approval?: { id: string; reason: string; state: string };
    }>(`/api/v1/hosts/${hostId}/bootstrap/${command}`, {
      method: "POST",
      body: JSON.stringify({ userId })
    });

    if (result.approval) {
      await dependencies.sendTelegramMessage(
        message.chat.id,
        `${result.session.title} requires approval: ${result.approval.reason}`,
        inlineApprovalKeyboard(result.approval.id)
      );
      return;
    }

    await dependencies.sendTelegramMessage(message.chat.id, `${result.session.title} created as session ${result.session.id}. State: ${result.session.state}.`);
  }

  async function handleMessage(message: TelegramMessage): Promise<void> {
    const text = message.text?.trim();
    if (!text) {
      return;
    }

    const [command, ...rest] = text.split(" ");
    switch (command) {
      case "/start":
      case "/help":
        await handleStart(message);
        return;
      case "/pair":
        if (!rest[0]) {
          await dependencies.sendTelegramMessage(message.chat.id, "Usage: /pair <PAIRING_CODE>");
          return;
        }
        await handlePair(message, rest[0]);
        return;
      case "/hosts":
        await handleHosts(message);
        return;
      case "/status":
        if (!rest[0]) {
          await dependencies.sendTelegramMessage(message.chat.id, "Usage: /status <SESSION_ID>");
          return;
        }
        await handleStatus(message, rest[0]);
        return;
      case "/resume":
        if (!rest[0]) {
          await dependencies.sendTelegramMessage(message.chat.id, "Usage: /resume <SESSION_ID>");
          return;
        }
        await handleResume(message, rest[0]);
        return;
      case "/doctor":
        if (!rest[0]) {
          await dependencies.sendTelegramMessage(message.chat.id, "Usage: /doctor <HOST_ID>");
          return;
        }
        await handleBootstrapCommand(message, rest[0], "doctor");
        return;
      case "/verify":
        if (!rest[0]) {
          await dependencies.sendTelegramMessage(message.chat.id, "Usage: /verify <HOST_ID>");
          return;
        }
        await handleBootstrapCommand(message, rest[0], "verify");
        return;
      case "/approve":
        if (!rest[0] || !rest[1]) {
          await dependencies.sendTelegramMessage(message.chat.id, "Usage: /approve <APPROVAL_ID> <approve|reject> [reason]");
          return;
        }
        await handleApprovalCommand(message, rest[0], rest[1], rest.slice(2).join(" "));
        return;
      case "/session":
        if (rest.length < 4) {
          await dependencies.sendTelegramMessage(message.chat.id, "Usage: /session quick <HOST_ID> <WORKSPACE_ID> <PROMPT> OR /session proof <HOST_ID> <WORKSPACE_ID> <TITLE> || <PROMPT> || <criterion1;criterion2>");
          return;
        }
        await handleSessionCommand(message, rest);
        return;
      default:
        await dependencies.sendTelegramMessage(message.chat.id, `Unknown command: ${command}`);
    }
  }

  async function handleCallbackQuery(callback: TelegramCallbackQuery): Promise<void> {
    const data = callback.data ?? "";
    const [prefix, decision, approvalId] = data.split(":");
    if (prefix !== "approval" || !approvalId) {
      return;
    }

    const payload: ResolveApprovalRequest = {
      userId: (await resolveInternalUserId(callback.from)) ?? "",
      decision: decision === "approve" ? "approved" : "rejected"
    };

    if (!payload.userId) {
      await dependencies.sendTelegramMessage(callback.message?.chat.id ?? callback.from.id, "No HappyTG user is linked to this Telegram account yet.");
      return;
    }

    const result = await dependencies.apiFetch<{ approval: { id: string; state: string }; session: { id: string; state: string } }>(`/api/v1/approvals/${approvalId}/resolve`, {
      method: "POST",
      body: JSON.stringify(payload)
    });

    await dependencies.sendTelegramMessage(
      callback.message?.chat.id ?? callback.from.id,
      `Approval ${result.approval.id} is now ${result.approval.state}. Session ${result.session.id} -> ${result.session.state}.`
    );
  }

  return {
    handleMessage,
    handleCallbackQuery
  };
}

export async function dispatchTelegramUpdate(
  handlers: ReturnType<typeof createBotHandlers>,
  update: TelegramUpdate
): Promise<void> {
  if (update.message) {
    await handlers.handleMessage(update.message);
  }
  if (update.callback_query) {
    await handlers.handleCallbackQuery(update.callback_query);
  }
}
