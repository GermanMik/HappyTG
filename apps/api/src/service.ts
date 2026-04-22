import { createHash } from "node:crypto";
import path from "node:path";
import { readFile } from "node:fs/promises";

import { createApprovalRequest, resolveApprovalRequestIdempotent } from "../../../packages/approval-engine/src/index.js";
import { createDefaultPolicies, evaluatePolicies } from "../../../packages/policy-engine/src/index.js";
import { advanceTaskPhase, initTaskBundle, recordTaskApproval, validateTaskBundle } from "../../../packages/repo-proof/src/index.js";
import { canTransitionSession, nextResumeState, transitionSession } from "../../../packages/session-engine/src/index.js";
import {
  makeLaunchGrantId,
  makeMiniAppSessionToken,
  signMiniAppLaunchPayload,
  validateTelegramMiniAppInitData,
  verifyMiniAppLaunchPayload
} from "../../../packages/telegram-kit/src/index.js";
import type {
  ApprovalDecision,
  ApprovalRequest,
  ClaimPairingRequest,
  CreateMiniAppLaunchGrantRequest,
  CreateMiniAppLaunchGrantResponse,
  CreateMiniAppSessionRequest,
  CreateMiniAppSessionResponse,
  CreatePairingRequest,
  CreatePairingResponse,
  CreateSessionRequest,
  DaemonCompleteRequest,
  DaemonDispatchAckRequest,
  DaemonSessionEventRequest,
  HappyTGStore,
  Host,
  HostHelloRequest,
  HostHelloResponse,
  HostPollRequest,
  HostRegistration,
  MiniAppApprovalCard,
  MiniAppAttentionItem,
  MiniAppDashboardProjection,
  MiniAppDiffProjection,
  MiniAppHostCard,
  MiniAppLaunchGrant,
  MiniAppProjectCard,
  MiniAppReportCard,
  MiniAppSession,
  MiniAppSessionCard,
  MiniAppVerifyProjection,
  PendingDispatch,
  ResolveApprovalRequest,
  Session,
  SessionEvent,
  TaskBundle,
  TelegramIdentity,
  User,
  Workspace
} from "../../../packages/protocol/src/index.js";
import { createId, FileStateStore, fileExists, nowIso } from "../../../packages/shared/src/index.js";

function nextSequence(store: HappyTGStore, sessionId: string): number {
  const last = store.sessionEvents
    .filter((item) => item.sessionId === sessionId)
    .sort((left, right) => left.sequence - right.sequence)
    .at(-1);
  return (last?.sequence ?? 0) + 1;
}

function appendEvent(store: HappyTGStore, sessionId: string, type: SessionEvent["type"], payload: SessionEvent["payload"]): SessionEvent {
  const event: SessionEvent = {
    id: createId("evt"),
    sessionId,
    type,
    payload,
    occurredAt: nowIso(),
    sequence: nextSequence(store, sessionId)
  };
  store.sessionEvents.push(event);
  return event;
}

function appendAudit(store: HappyTGStore, actorType: "user" | "host" | "system", actorRef: string, action: string, targetRef: string, metadata: Record<string, unknown>) {
  store.auditRecords.push({
    id: createId("aud"),
    actorType,
    actorRef,
    action,
    targetRef,
    metadata,
    createdAt: nowIso()
  });
}

function ensurePolicies(store: HappyTGStore): void {
  if (store.policies.length === 0) {
    store.policies.push(...createDefaultPolicies());
  }
}

function makePairingCode(): string {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

function getOrCreateUser(store: HappyTGStore, input: ClaimPairingRequest): { user: User; identity: TelegramIdentity } {
  const existingIdentity = store.telegramIdentities.find((item) => item.telegramUserId === input.telegramUserId && item.status === "active");
  if (existingIdentity) {
    const existingUser = store.users.find((item) => item.id === existingIdentity.userId);
    if (!existingUser) {
      throw new Error("Telegram identity references missing user");
    }

    return { user: existingUser, identity: existingIdentity };
  }

  const now = nowIso();
  const user: User = {
    id: createId("usr"),
    displayName: input.displayName,
    status: "active",
    createdAt: now
  };
  const identity: TelegramIdentity = {
    id: createId("tgi"),
    userId: user.id,
    telegramUserId: input.telegramUserId,
    chatId: input.chatId,
    username: input.username,
    linkedAt: now,
    status: "active"
  };

  store.users.push(user);
  store.telegramIdentities.push(identity);
  return { user, identity };
}

function syncWorkspaces(store: HappyTGStore, host: Host, workspaces: HostHelloRequest["workspaces"]): Workspace[] {
  const now = nowIso();
  return workspaces.map((candidate) => {
    const existing = store.workspaces.find((item) => item.hostId === host.id && item.path === candidate.path);
    if (existing) {
      existing.repoName = candidate.repoName;
      existing.defaultBranch = candidate.defaultBranch;
      existing.updatedAt = now;
      existing.status = "active";
      return existing;
    }

    const created: Workspace = {
      id: createId("ws"),
      hostId: host.id,
      path: candidate.path,
      repoName: candidate.repoName,
      defaultBranch: candidate.defaultBranch,
      status: "active",
      createdAt: now,
      updatedAt: now
    };
    store.workspaces.push(created);
    return created;
  });
}

function makeDispatch(session: Session, actionKind: PendingDispatch["actionKind"], approvalId?: string): PendingDispatch {
  const now = nowIso();
  return {
    id: createId("dsp"),
    sessionId: session.id,
    hostId: session.hostId,
    workspaceId: session.workspaceId,
    executionKind: "runtime_session",
    mode: session.mode,
    runtime: session.runtime,
    actionKind,
    prompt: session.prompt,
    title: session.title,
    taskId: session.taskId,
    approvalId,
    status: "queued",
    idempotencyKey: `dispatch_${session.id}_${Date.now()}`,
    createdAt: now,
    updatedAt: now
  };
}

function getHostWorkspace(store: HappyTGStore, hostId: string, workspaceId?: string): Workspace {
  const workspace = workspaceId
    ? store.workspaces.find((item) => item.id === workspaceId && item.hostId === hostId)
    : store.workspaces.find((item) => item.hostId === hostId && item.status === "active");
  if (!workspace) {
    throw new Error("Workspace not found on selected host");
  }

  return workspace;
}

function getHostRecord(store: HappyTGStore, hostId: string): Host {
  const host = store.hosts.find((item) => item.id === hostId);
  if (!host) {
    throw new Error("Host not found");
  }

  return host;
}

function moveSession(session: Session, to: Session["state"], options?: { summary?: string; error?: string }): void {
  Object.assign(session, transitionSession(session, to, options));
}

function replayApprovalDecisionState(state: ApprovalRequest["state"]): ApprovalDecision["decision"] {
  switch (state) {
    case "approved_once":
    case "approved_phase":
    case "approved_session":
    case "denied":
    case "expired":
    case "superseded":
      return state;
    default:
      return "superseded";
  }
}

function assertHostUserAccess(host: Host, userId: string): void {
  if (host.pairedUserId !== userId) {
    throw new Error("Host is not paired to this user");
  }
}

function ensureMiniAppCollections(store: HappyTGStore): void {
  const legacyStore = store as HappyTGStore & {
    miniAppLaunchGrants?: MiniAppLaunchGrant[];
    miniAppSessions?: MiniAppSession[];
  };
  legacyStore.miniAppLaunchGrants ??= [];
  legacyStore.miniAppSessions ??= [];
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function secondsFromEnv(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function miniAppLaunchSecret(): string {
  return process.env.HAPPYTG_MINIAPP_LAUNCH_SECRET
    ?? process.env.JWT_SIGNING_KEY
    ?? process.env.TELEGRAM_WEBHOOK_SECRET
    ?? "happytg-dev-miniapp-launch-secret";
}

function telegramDisplayName(user: { first_name?: string; last_name?: string; username?: string; id: number }): string {
  return [user.first_name, user.last_name].filter(Boolean).join(" ") || user.username || `tg-${user.id}`;
}

function isTerminalSessionState(state: Session["state"]): boolean {
  return ["completed", "failed", "cancelled"].includes(state);
}

function classifyArtifactPath(filePath: string): "code" | "config" | "test" | "docs" | "artifact" {
  const normalized = filePath.replaceAll("\\", "/").toLowerCase();
  if (normalized.includes("/test") || normalized.endsWith(".test.ts") || normalized.endsWith(".spec.ts")) {
    return "test";
  }
  if (normalized.includes("/docs/") || normalized.endsWith(".md")) {
    return "docs";
  }
  if (normalized.endsWith(".json") || normalized.endsWith(".yaml") || normalized.endsWith(".yml") || normalized.endsWith(".toml") || normalized.endsWith(".env")) {
    return "config";
  }
  if (/\.(ts|tsx|js|jsx|go|py|rs|java|cs)$/u.test(normalized)) {
    return "code";
  }
  return "artifact";
}

function sessionCard(store: HappyTGStore, session: Session): MiniAppSessionCard {
  const host = store.hosts.find((item) => item.id === session.hostId);
  const workspace = store.workspaces.find((item) => item.id === session.workspaceId);
  const task = session.taskId ? store.tasks.find((item) => item.id === session.taskId) : undefined;
  const approval = session.approvalId ? store.approvals.find((item) => item.id === session.approvalId) : undefined;
  const needsAttention = approval?.state === "waiting_human"
    ? "approval"
    : session.state === "blocked" || session.state === "needs_approval"
      ? "blocked"
      : task && ["failed", "inconclusive", "stale"].includes(task.verificationState)
        ? "verify"
        : undefined;
  const nextAction = needsAttention === "approval"
    ? "open approval"
    : needsAttention === "verify"
      ? "open verify"
      : session.state === "paused" || session.state === "resuming"
        ? "resume"
        : "open";

  return {
    id: session.id,
    title: session.title,
    state: session.state,
    runtime: session.runtime,
    phase: task?.phase,
    verificationState: task?.verificationState,
    hostLabel: host?.label,
    repoName: workspace?.repoName,
    lastUpdatedAt: session.updatedAt,
    attention: needsAttention,
    href: `/session/${encodeURIComponent(session.id)}`,
    nextAction
  };
}

function approvalCard(store: HappyTGStore, approval: ApprovalRequest): MiniAppApprovalCard {
  const session = store.sessions.find((item) => item.id === approval.sessionId);
  return {
    id: approval.id,
    sessionId: approval.sessionId,
    title: session?.title ?? approval.actionKind,
    reason: approval.reason,
    risk: approval.risk,
    state: approval.state,
    expiresAt: approval.expiresAt,
    scope: approval.scope,
    nonce: approval.nonce,
    href: `/approval/${encodeURIComponent(approval.id)}`
  };
}

function hostCard(store: HappyTGStore, host: Host): MiniAppHostCard {
  const workspaces = store.workspaces.filter((item) => item.hostId === host.id && item.status === "active");
  const sessions = store.sessions.filter((item) => item.hostId === host.id && !isTerminalSessionState(item.state));
  const lastError = store.sessions
    .filter((item) => item.hostId === host.id && item.lastError)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .at(0)?.lastError;

  return {
    id: host.id,
    label: host.label,
    status: host.status,
    lastSeenAt: host.lastSeenAt,
    activeSessions: sessions.length,
    repoNames: workspaces.map((item) => item.repoName),
    lastError,
    href: `/host/${encodeURIComponent(host.id)}`
  };
}

function projectCard(store: HappyTGStore, workspace: Workspace): MiniAppProjectCard {
  const host = store.hosts.find((item) => item.id === workspace.hostId);
  const activeSessions = store.sessions.filter((item) => item.workspaceId === workspace.id && !isTerminalSessionState(item.state)).length;
  return {
    id: workspace.id,
    hostId: workspace.hostId,
    hostLabel: host?.label,
    hostStatus: host?.status,
    repoName: workspace.repoName,
    path: workspace.path,
    defaultBranch: workspace.defaultBranch,
    activeSessions,
    href: `/project/${encodeURIComponent(workspace.id)}`,
    newSessionHref: `/new-task?hostId=${encodeURIComponent(workspace.hostId)}&workspaceId=${encodeURIComponent(workspace.id)}`
  };
}

function reportCards(store: HappyTGStore, sessions: Session[]): MiniAppReportCard[] {
  const sessionIds = new Set(sessions.map((item) => item.id));
  return store.tasks
    .filter((task) => sessionIds.has(task.sessionId))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, 12)
    .map((task) => ({
      id: task.id,
      title: task.title,
      status: task.verificationState,
      generatedAt: task.updatedAt,
      href: `/task/${encodeURIComponent(task.id)}`
    }));
}

function scopedMiniAppStore(store: HappyTGStore, userId?: string) {
  if (!userId) {
    return {
      hosts: [],
      workspaces: [],
      sessions: [],
      approvals: [],
      tasks: []
    };
  }

  const hostIds = new Set(store.hosts.filter((item) => !userId || item.pairedUserId === userId).map((item) => item.id));
  const sessions = store.sessions.filter((item) => hostIds.has(item.hostId));
  const sessionIds = new Set(sessions.map((item) => item.id));
  return {
    hosts: store.hosts.filter((item) => hostIds.has(item.id)),
    workspaces: store.workspaces.filter((item) => hostIds.has(item.hostId) && item.status === "active"),
    sessions,
    approvals: store.approvals.filter((item) => sessionIds.has(item.sessionId)),
    tasks: store.tasks.filter((item) => sessionIds.has(item.sessionId))
  };
}

export class HappyTGControlPlaneService {
  constructor(private readonly store: FileStateStore = new FileStateStore()) {}

  async createMiniAppLaunchGrant(input: CreateMiniAppLaunchGrantRequest): Promise<CreateMiniAppLaunchGrantResponse> {
    return this.store.update((store) => {
      ensureMiniAppCollections(store);
      const now = nowIso();
      const ttlSeconds = Math.min(input.ttlSeconds ?? secondsFromEnv("MINIAPP_LAUNCH_GRANT_TTL_SECONDS", 600), 24 * 60 * 60);
      const id = makeLaunchGrantId();
      const payload = signMiniAppLaunchPayload(id, miniAppLaunchSecret());
      const grant: MiniAppLaunchGrant = {
        id,
        kind: input.kind,
        targetId: input.targetId,
        userId: input.userId,
        issuedByUserId: input.issuedByUserId,
        payload,
        nonce: createId("nonce"),
        expiresAt: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
        maxUses: input.maxUses ?? 1,
        uses: 0,
        createdAt: now,
        updatedAt: now
      };
      store.miniAppLaunchGrants.push(grant);
      appendAudit(store, "system", "miniapp", "miniapp.launch_grant.created", grant.id, {
        kind: grant.kind,
        targetId: grant.targetId,
        userId: grant.userId,
        expiresAt: grant.expiresAt
      });

      const botUsername = process.env.TELEGRAM_BOT_USERNAME?.trim();
      return {
        grant,
        startAppPayload: payload,
        launchUrl: botUsername ? `https://t.me/${botUsername}?startapp=${encodeURIComponent(payload)}` : undefined
      };
    });
  }

  async createMiniAppSession(input: CreateMiniAppSessionRequest): Promise<CreateMiniAppSessionResponse> {
    const botToken = process.env.TELEGRAM_BOT_TOKEN?.trim();
    if (!botToken) {
      throw new Error("Telegram bot token is required for Mini App auth");
    }

    const validation = validateTelegramMiniAppInitData(input.initData, {
      botToken,
      maxAgeSeconds: secondsFromEnv("MINIAPP_INITDATA_MAX_AGE_SECONDS", 86_400)
    });
    if (!validation.ok) {
      throw new Error(`Mini App initData invalid: ${validation.reason}`);
    }

    return this.store.update((store) => {
      ensureMiniAppCollections(store);
      const userContext = getOrCreateUser(store, {
        pairingCode: "",
        telegramUserId: String(validation.user.id),
        chatId: String(validation.user.id),
        username: validation.user.username,
        displayName: telegramDisplayName(validation.user)
      });

      const rawPayload = input.startAppPayload ?? validation.startParam;
      let grant: MiniAppLaunchGrant | undefined;
      if (rawPayload) {
        const verifiedPayload = verifyMiniAppLaunchPayload(rawPayload, miniAppLaunchSecret());
        if (!verifiedPayload.ok) {
          throw new Error("Mini App launch payload signature is invalid");
        }

        grant = store.miniAppLaunchGrants.find((item) => item.id === verifiedPayload.grantId);
        if (!grant) {
          throw new Error("Mini App launch grant was not found");
        }
        if (grant.revokedAt) {
          throw new Error("Mini App launch grant was revoked");
        }
        if (Date.parse(grant.expiresAt) <= Date.now()) {
          throw new Error("Mini App launch grant expired");
        }
        if (grant.uses >= grant.maxUses) {
          throw new Error("Mini App launch grant already used");
        }
        if (grant.userId && grant.userId !== userContext.user.id) {
          throw new Error("Mini App launch grant is not available to this user");
        }

        grant.uses += 1;
        grant.updatedAt = nowIso();
      }

      const token = makeMiniAppSessionToken();
      const now = nowIso();
      const appSession: MiniAppSession = {
        id: createId("mas"),
        userId: userContext.user.id,
        telegramUserId: String(validation.user.id),
        launchGrantId: grant?.id,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + secondsFromEnv("MINIAPP_SESSION_TTL_SECONDS", 3600) * 1000).toISOString(),
        createdAt: now,
        lastSeenAt: now
      };
      store.miniAppSessions.push(appSession);
      appendAudit(store, "user", userContext.user.id, "miniapp.session.created", appSession.id, {
        telegramUserId: appSession.telegramUserId,
        launchGrantId: appSession.launchGrantId
      });

      return {
        appSession: {
          id: appSession.id,
          token,
          expiresAt: appSession.expiresAt
        },
        user: userContext.user,
        launch: grant ? {
          kind: grant.kind,
          targetId: grant.targetId
        } : undefined
      };
    });
  }

  async authenticateMiniAppSession(token: string): Promise<User | undefined> {
    if (!token) {
      return undefined;
    }

    return this.store.update((store) => {
      ensureMiniAppCollections(store);
      const session = store.miniAppSessions.find((item) => item.tokenHash === hashToken(token));
      if (!session || session.revokedAt || Date.parse(session.expiresAt) <= Date.now()) {
        return undefined;
      }

      session.lastSeenAt = nowIso();
      return store.users.find((item) => item.id === session.userId && item.status === "active");
    });
  }

  async revokeMiniAppSession(sessionId: string, actorUserId?: string): Promise<MiniAppSession> {
    return this.store.update((store) => {
      ensureMiniAppCollections(store);
      const session = store.miniAppSessions.find((item) => item.id === sessionId);
      if (!session) {
        throw new Error("Mini App session not found");
      }
      if (actorUserId && session.userId !== actorUserId) {
        throw new Error("Mini App session is not available to this user");
      }

      if (!session.revokedAt) {
        session.revokedAt = nowIso();
        appendAudit(store, actorUserId ? "user" : "system", actorUserId ?? "miniapp", "miniapp.session.revoked", session.id, {
          userId: session.userId
        });
      }

      return session;
    });
  }

  async revokeMiniAppLaunchGrant(grantId: string, actorUserId?: string): Promise<MiniAppLaunchGrant> {
    return this.store.update((store) => {
      ensureMiniAppCollections(store);
      const grant = store.miniAppLaunchGrants.find((item) => item.id === grantId);
      if (!grant) {
        throw new Error("Mini App launch grant not found");
      }

      if (!grant.revokedAt) {
        grant.revokedAt = nowIso();
        grant.updatedAt = grant.revokedAt;
        appendAudit(store, actorUserId ? "user" : "system", actorUserId ?? "miniapp", "miniapp.launch_grant.revoked", grant.id, {
          kind: grant.kind,
          targetId: grant.targetId,
          userId: grant.userId
        });
      }

      return grant;
    });
  }

  async resolveMiniAppUserId(token?: string, userIdHint?: string): Promise<string | undefined> {
    if (token) {
      return (await this.authenticateMiniAppSession(token))?.id;
    }

    if (process.env.NODE_ENV !== "production") {
      return userIdHint;
    }

    return undefined;
  }

  async listHosts(userId?: string): Promise<Host[]> {
    const store = await this.store.read();
    return store.hosts.filter((item) => !userId || item.pairedUserId === userId);
  }

  async listWorkspaces(hostId: string, userId?: string): Promise<Workspace[]> {
    const store = await this.store.read();
    const host = getHostRecord(store, hostId);
    if (userId) {
      assertHostUserAccess(host, userId);
    }

    return store.workspaces.filter((item) => item.hostId === host.id && item.status === "active");
  }

  async listSessions(userId?: string): Promise<Session[]> {
    const store = await this.store.read();
    const hostIds = new Set(store.hosts.filter((item) => !userId || item.pairedUserId === userId).map((item) => item.id));
    return store.sessions
      .filter((item) => hostIds.has(item.hostId))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  async listApprovals(userId?: string, states?: string[]): Promise<ApprovalRequest[]> {
    const store = await this.store.read();
    const hostIds = new Set(store.hosts.filter((item) => !userId || item.pairedUserId === userId).map((item) => item.id));
    const sessionIds = new Set(store.sessions.filter((item) => hostIds.has(item.hostId)).map((item) => item.id));
    const stateFilter = new Set(states?.filter(Boolean));
    return store.approvals
      .filter((item) => sessionIds.has(item.sessionId))
      .filter((item) => stateFilter.size === 0 || stateFilter.has(item.state))
      .sort((left, right) => left.expiresAt.localeCompare(right.expiresAt));
  }

  async getUserByTelegram(telegramUserId: string): Promise<User | undefined> {
    const store = await this.store.read();
    const identity = store.telegramIdentities.find((item) => item.telegramUserId === telegramUserId && item.status === "active");
    if (!identity) {
      return undefined;
    }

    return store.users.find((item) => item.id === identity.userId);
  }

  async getHost(hostId: string): Promise<Host | undefined> {
    const store = await this.store.read();
    return store.hosts.find((item) => item.id === hostId);
  }

  async startPairing(input: CreatePairingRequest): Promise<CreatePairingResponse> {
    return this.store.update(async (store) => {
      const now = nowIso();
      let host = store.hosts.find((item) => item.fingerprint === input.fingerprint);
      if (!host) {
        host = {
          id: createId("host"),
          label: input.hostLabel,
          fingerprint: input.fingerprint,
          status: "registering",
          capabilities: [],
          runtimePreference: "codex-cli",
          createdAt: now,
          updatedAt: now
        };
        store.hosts.push(host);
      } else {
        host.label = input.hostLabel;
        host.status = "registering";
        host.updatedAt = now;
      }

      const registration: HostRegistration = {
        id: createId("reg"),
        hostId: host.id,
        pairingCode: makePairingCode(),
        expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
        status: "issued",
        createdAt: now
      };
      store.hostRegistrations.push(registration);
      appendAudit(store, "host", host.id, "pairing.started", registration.id, { hostLabel: host.label });
      return {
        hostId: host.id,
        registrationId: registration.id,
        pairingCode: registration.pairingCode,
        expiresAt: registration.expiresAt
      };
    });
  }

  async claimPairing(input: ClaimPairingRequest): Promise<{ user: User; host: Host; identity: TelegramIdentity }> {
    return this.store.update(async (store) => {
      const registration = store.hostRegistrations.find((item) => item.pairingCode === input.pairingCode && item.status === "issued");
      if (!registration) {
        throw new Error("Pairing code not found");
      }

      if (new Date(registration.expiresAt).getTime() < Date.now()) {
        registration.status = "expired";
        throw new Error("Pairing code expired");
      }

      const host = store.hosts.find((item) => item.id === registration.hostId);
      if (!host) {
        throw new Error("Host for pairing code not found");
      }

      const { user, identity } = getOrCreateUser(store, input);
      registration.status = "claimed";
      registration.claimedByUserId = user.id;

      host.status = "paired";
      host.pairedUserId = user.id;
      host.updatedAt = nowIso();

      appendAudit(store, "user", user.id, "pairing.claimed", host.id, { registrationId: registration.id });
      return { user, host, identity };
    });
  }

  async hostHello(input: HostHelloRequest): Promise<HostHelloResponse> {
    return this.store.update((store) => {
      const host = store.hosts.find((item) => item.id === input.hostId && item.fingerprint === input.fingerprint);
      if (!host) {
        throw new Error("Host is not registered or fingerprint mismatched");
      }

      host.status = host.pairedUserId ? "active" : "registering";
      host.capabilities = input.capabilities;
      host.lastSeenAt = nowIso();
      host.updatedAt = nowIso();

      const workspaces = syncWorkspaces(store, host, input.workspaces);
      const pendingDispatches = store.pendingDispatches.filter((item) => item.hostId === host.id && item.status === "queued");
      appendAudit(store, "host", host.id, "host.hello", host.id, { workspaces: workspaces.length });

      return {
        host,
        workspaces,
        pendingDispatches
      };
    });
  }

  async hostHeartbeat(hostId: string): Promise<{ ok: true; host: Host }> {
    return this.store.update((store) => {
      const host = store.hosts.find((item) => item.id === hostId);
      if (!host) {
        throw new Error("Host not found");
      }

      host.lastSeenAt = nowIso();
      host.updatedAt = nowIso();
      if (host.pairedUserId) {
        host.status = "active";
      }

      return { ok: true, host };
    });
  }

  async hostPoll(input: HostPollRequest): Promise<{ dispatches: PendingDispatch[] }> {
    const store = await this.store.read();
    return {
      dispatches: store.pendingDispatches.filter((item) => item.hostId === input.hostId && item.status === "queued")
    };
  }

  async getSession(sessionId: string): Promise<(Session & { task?: TaskBundle; approval?: ApprovalRequest }) | undefined> {
    const store = await this.store.read();
    const session = store.sessions.find((item) => item.id === sessionId);
    if (!session) {
      return undefined;
    }

    return {
      ...session,
      task: session.taskId ? store.tasks.find((item) => item.id === session.taskId) : undefined,
      approval: session.approvalId ? store.approvals.find((item) => item.id === session.approvalId) : undefined
    };
  }

  async createSession(input: CreateSessionRequest): Promise<{ session: Session; task?: TaskBundle; approval?: ApprovalRequest; dispatch?: PendingDispatch }> {
    return this.store.update(async (store) => {
      ensurePolicies(store);

      const workspace = getHostWorkspace(store, input.hostId, input.workspaceId);
      const host = getHostRecord(store, input.hostId);
      assertHostUserAccess(host, input.userId);

      const now = nowIso();
      const session: Session = {
        id: createId("ses"),
        userId: input.userId,
        hostId: input.hostId,
        workspaceId: input.workspaceId,
        mode: input.mode,
        runtime: input.runtime,
        state: "created",
        title: input.title,
        prompt: input.prompt,
        createdAt: now,
        updatedAt: now
      };
      store.sessions.push(session);
      appendEvent(store, session.id, "SessionCreated", { mode: input.mode, runtime: input.runtime });
      moveSession(session, "preparing");
      appendEvent(store, session.id, "PromptBuilt", {
        sources: ["user", "host", "workspace", "policy", "runtime"]
      });

      let task: TaskBundle | undefined;
      if (input.mode === "proof") {
        const taskId = `HTG-${String(store.tasks.length + 1).padStart(4, "0")}`;
        task = await initTaskBundle({
          repoRoot: workspace.path,
          taskId,
          sessionId: session.id,
          workspaceId: workspace.id,
          title: input.title,
          acceptanceCriteria: input.acceptanceCriteria ?? ["Prompt satisfied", "Independent verifier passed"],
          mode: "proof"
        });
        store.tasks.push(task);
        session.taskId = task.id;
        appendEvent(store, session.id, "TaskBundleInitialized", { taskId: task.id, phase: task.phase });
      }

      const actionKind = input.riskyAction ?? (input.mode === "proof" ? "workspace_write" : "workspace_read");
      const policyDecision = evaluatePolicies({
        actionKind,
        scopeRefs: {
          global: "global",
          workspace: workspace.id,
          session: session.id,
          command: actionKind
        },
        policies: store.policies
      });

      appendEvent(store, session.id, "PolicyEvaluated", {
        outcome: policyDecision.outcome,
        effectiveLayer: policyDecision.effectiveLayer,
        reason: policyDecision.reason
      });

      if (policyDecision.outcome === "deny") {
        session.lastError = policyDecision.reason;
        moveSession(session, "failed", { error: policyDecision.reason });
        appendEvent(store, session.id, "SessionFailed", { reason: policyDecision.reason });
        appendAudit(store, "user", input.userId, "session.denied", session.id, { actionKind, reason: policyDecision.reason });
        return { session, task };
      }

      if (policyDecision.outcome === "require_approval") {
        const approval = createApprovalRequest({
          sessionId: session.id,
          actionKind,
          risk: input.mode === "proof" ? "high" : "medium",
          reason: policyDecision.reason
        });
        store.approvals.push(approval);
        if (task) {
          await recordTaskApproval(task, approval.id);
        }
        session.approvalId = approval.id;
        moveSession(session, "needs_approval");
        appendEvent(store, session.id, "ApprovalRequested", {
          approvalId: approval.id,
          risk: approval.risk,
          scope: approval.scope,
          reason: approval.reason,
          expiresAt: approval.expiresAt
        });
        appendAudit(store, "user", input.userId, "approval.requested", approval.id, { sessionId: session.id, actionKind });
        return { session, task, approval };
      }

      const dispatch = makeDispatch(session, actionKind);
      store.pendingDispatches.push(dispatch);
      moveSession(session, "ready");
      appendAudit(store, "user", input.userId, "session.dispatched", session.id, { dispatchId: dispatch.id });
      return { session, task, dispatch };
    });
  }

  async createBootstrapSession(input: {
    userId: string;
    hostId: string;
    command: "doctor" | "verify";
  }): Promise<{ session: Session; approval?: ApprovalRequest; dispatch?: PendingDispatch }> {
    return this.store.update(async (store) => {
      ensurePolicies(store);

      const host = getHostRecord(store, input.hostId);
      assertHostUserAccess(host, input.userId);
      const workspace = getHostWorkspace(store, input.hostId);
      const now = nowIso();
      const actionKind = input.command === "doctor" ? "read_status" : "verification_run";
      const session: Session = {
        id: createId("ses"),
        userId: input.userId,
        hostId: input.hostId,
        workspaceId: workspace.id,
        mode: "quick",
        runtime: "codex-cli",
        state: "created",
        title: `Bootstrap ${input.command}: ${host.label}`,
        prompt: `Run happytg ${input.command} on host ${host.label}`,
        createdAt: now,
        updatedAt: now
      };
      store.sessions.push(session);
      appendEvent(store, session.id, "SessionCreated", {
        mode: session.mode,
        runtime: session.runtime,
        executionKind: input.command === "doctor" ? "bootstrap_doctor" : "bootstrap_verify"
      });
      moveSession(session, "preparing");
      appendEvent(store, session.id, "PromptBuilt", {
        sources: ["user", "host", "policy", "bootstrap", "resume"]
      });

      const policyDecision = evaluatePolicies({
        actionKind,
        scopeRefs: {
          global: "global",
          workspace: workspace.id,
          session: session.id,
          command: input.command
        },
        policies: store.policies
      });

      appendEvent(store, session.id, "PolicyEvaluated", {
        outcome: policyDecision.outcome,
        effectiveLayer: policyDecision.effectiveLayer,
        reason: policyDecision.reason
      });

      if (policyDecision.outcome === "deny") {
        session.lastError = policyDecision.reason;
        moveSession(session, "failed", { error: policyDecision.reason });
        appendEvent(store, session.id, "SessionFailed", { reason: policyDecision.reason });
        appendAudit(store, "user", input.userId, "bootstrap.denied", session.id, { actionKind, command: input.command });
        return { session };
      }

      if (policyDecision.outcome === "require_approval") {
        const approval = createApprovalRequest({
          sessionId: session.id,
          actionKind,
          risk: "medium",
          reason: policyDecision.reason
        });
        store.approvals.push(approval);
        if (session.taskId) {
          const task = store.tasks.find((item) => item.id === session.taskId);
          if (task) {
            await recordTaskApproval(task, approval.id);
          }
        }
        session.approvalId = approval.id;
        moveSession(session, "needs_approval");
        appendEvent(store, session.id, "ApprovalRequested", {
          approvalId: approval.id,
          risk: approval.risk,
          scope: approval.scope,
          reason: approval.reason,
          expiresAt: approval.expiresAt
        });
        appendAudit(store, "user", input.userId, "bootstrap.approval.requested", approval.id, {
          sessionId: session.id,
          command: input.command
        });
        return { session, approval };
      }

      const dispatch = makeDispatch(session, actionKind);
      dispatch.executionKind = input.command === "doctor" ? "bootstrap_doctor" : "bootstrap_verify";
      store.pendingDispatches.push(dispatch);
      moveSession(session, "ready");
      appendAudit(store, "user", input.userId, "bootstrap.dispatched", session.id, {
        dispatchId: dispatch.id,
        command: input.command
      });
      return { session, dispatch };
    });
  }

  async resolveApproval(approvalId: string, input: ResolveApprovalRequest): Promise<{ approval: ApprovalRequest; session: Session; decision: ApprovalDecision; dispatch?: PendingDispatch }> {
    return this.store.update((store) => {
      const approval = store.approvals.find((item) => item.id === approvalId);
      if (!approval) {
        throw new Error("Approval not found");
      }

      const session = store.sessions.find((item) => item.id === approval.sessionId);
      if (!session) {
        throw new Error("Session not found for approval");
      }
      if (session.userId !== input.userId) {
        throw new Error("Approval is not available to this user");
      }

      const resolved = resolveApprovalRequestIdempotent({
        request: approval,
        actorUserId: input.userId,
        decision: input.decision,
        reason: input.reason,
        scope: input.scope,
        nonce: input.nonce
      });
      Object.assign(approval, resolved.approval);
      if (resolved.auditDecision) {
        store.approvalDecisions.push(resolved.auditDecision);
        appendEvent(store, session.id, "ApprovalResolved", {
          approvalId: approval.id,
          decision: approval.state
        });
      }

      let dispatch: PendingDispatch | undefined;
      if (resolved.approval.state === "approved_once" || resolved.approval.state === "approved_phase" || resolved.approval.state === "approved_session") {
        if (resolved.changed) {
          dispatch = makeDispatch(session, approval.actionKind, approval.id);
          store.pendingDispatches.push(dispatch);
          moveSession(session, "ready");
        }
      } else if (resolved.changed) {
        moveSession(session, "paused", { error: approval.reason });
        session.lastError = approval.reason;
      }

      session.updatedAt = nowIso();
      appendAudit(store, "user", input.userId, resolved.idempotent ? "approval.replayed" : "approval.resolved", approval.id, {
        sessionId: session.id,
        decision: approval.state
      });
      return {
        approval,
        session,
        decision: resolved.auditDecision ?? {
          id: `apd_replay_${approval.id}`,
          approvalRequestId: approval.id,
          actorUserId: input.userId,
          decision: replayApprovalDecisionState(approval.state),
          reason: input.reason,
          decidedAt: nowIso()
        },
        dispatch
      };
    });
  }

  async ackDispatch(input: DaemonDispatchAckRequest): Promise<PendingDispatch> {
    return this.store.update((store) => {
      const dispatch = store.pendingDispatches.find((item) => item.id === input.dispatchId && item.sessionId === input.sessionId);
      if (!dispatch) {
        throw new Error("Dispatch not found");
      }

      dispatch.status = "running";
      dispatch.updatedAt = nowIso();

      const session = store.sessions.find((item) => item.id === dispatch.sessionId);
      if (!session) {
        throw new Error("Session not found for dispatch");
      }

      moveSession(session, "running");
      appendEvent(store, session.id, "ToolCallStarted", {
        dispatchId: dispatch.id,
        runtime: dispatch.runtime
      });
      return dispatch;
    });
  }

  async updateSessionFromDaemon(input: DaemonSessionEventRequest): Promise<Session> {
    return this.store.update((store) => {
      const session = store.sessions.find((item) => item.id === input.sessionId);
      if (!session) {
        throw new Error("Session not found");
      }

      if (input.summary) {
        session.currentSummary = input.summary;
        appendEvent(store, session.id, "SummaryGenerated", {
          summary: input.summary
        });
      }

      if (input.error) {
        session.lastError = input.error;
      }

      if (input.state) {
        if (!canTransitionSession(session.state, input.state)) {
          throw new Error(`Illegal daemon session transition: ${session.state} -> ${input.state}`);
        }
        moveSession(session, input.state, {
          summary: input.summary,
          error: input.error
        });
      } else if (input.summary || input.error) {
        session.updatedAt = nowIso();
      }

      return session;
    });
  }

  async updateTaskPhase(taskId: string, phase: TaskBundle["phase"], verificationState?: TaskBundle["verificationState"]): Promise<TaskBundle> {
    return this.store.update(async (store) => {
      const task = store.tasks.find((item) => item.id === taskId);
      if (!task) {
        throw new Error("Task not found");
      }

      const nextVerificationState = verificationState
        ?? ((phase === "build" || phase === "fix") && task.verificationState === "passed" ? "stale" : task.verificationState);
      const updatedTask = await advanceTaskPhase(task, phase, "TaskBundleUpdated", nextVerificationState);
      Object.assign(task, updatedTask);

      const session = store.sessions.find((item) => item.id === task.sessionId);
      if (session) {
        if (phase === "verify" && canTransitionSession(session.state, "verifying")) {
          moveSession(session, "verifying");
        }
        appendEvent(store, session.id, "TaskBundleUpdated", {
          taskId: task.id,
          phase: task.phase,
          verificationState: task.verificationState
        });
      }

      return task;
    });
  }

  async completeDispatch(input: DaemonCompleteRequest): Promise<Session> {
    return this.store.update((store) => {
      const dispatch = store.pendingDispatches.find((item) => item.id === input.dispatchId && item.sessionId === input.sessionId);
      if (!dispatch) {
        throw new Error("Dispatch not found");
      }

      const session = store.sessions.find((item) => item.id === input.sessionId);
      if (!session) {
        throw new Error("Session not found");
      }

      dispatch.status = input.ok ? "completed" : "failed";
      dispatch.updatedAt = nowIso();
      moveSession(session, input.ok ? "completed" : "failed", {
        summary: input.summary,
        error: input.ok ? undefined : input.summary
      });
      if (!input.ok) {
        session.lastError = input.summary;
      }

      if (input.stdoutArtifactPath && session.taskId) {
        store.evidenceArtifacts.push({
          id: createId("art"),
          taskId: session.taskId,
          kind: "raw",
          path: input.stdoutArtifactPath,
          storageKind: "repo-local",
          createdAt: nowIso()
        });
      }

      appendEvent(store, session.id, input.ok ? "SessionCompleted" : "SessionFailed", {
        summary: input.summary
      });
      appendAudit(store, "host", input.hostId, "dispatch.completed", dispatch.id, { ok: input.ok });
      return session;
    });
  }

  async resumeSession(sessionId: string): Promise<Session> {
    return this.store.update((store) => {
      const session = store.sessions.find((item) => item.id === sessionId);
      if (!session) {
        throw new Error("Session not found");
      }

      const nextState = nextResumeState(session);
      if (nextState === session.state) {
        return session;
      }

      moveSession(session, nextState);
      appendEvent(store, session.id, "SessionResumed", {
        resumed: true
      });
      return session;
    });
  }

  async getTask(taskId: string): Promise<{ task: TaskBundle; validation: Awaited<ReturnType<typeof validateTaskBundle>> } | undefined> {
    const store = await this.store.read();
    const task = store.tasks.find((item) => item.id === taskId);
    if (!task) {
      return undefined;
    }

    return {
      task,
      validation: await validateTaskBundle(task.rootPath)
    };
  }

  async listTaskArtifacts(taskId: string): Promise<{ artifacts: string[] }> {
    const task = await this.getTask(taskId);
    if (!task) {
      throw new Error("Task not found");
    }

    return {
      artifacts: [
        path.join(task.task.rootPath, "spec.md"),
        path.join(task.task.rootPath, "state.json"),
        path.join(task.task.rootPath, "evidence.md"),
        path.join(task.task.rootPath, "evidence.json"),
        path.join(task.task.rootPath, "verdict.json"),
        path.join(task.task.rootPath, "problems.md"),
        path.join(task.task.rootPath, "raw", "build.txt"),
        path.join(task.task.rootPath, "raw", "test-unit.txt"),
        path.join(task.task.rootPath, "raw", "test-integration.txt"),
        path.join(task.task.rootPath, "raw", "lint.txt")
      ]
    };
  }

  async readTaskArtifact(taskId: string, relativePath: string): Promise<{ path: string; content: string }> {
    const task = await this.getTask(taskId);
    if (!task) {
      throw new Error("Task not found");
    }

    const targetPath = path.resolve(task.task.rootPath, relativePath);
    const bundleRoot = path.resolve(task.task.rootPath);
    if (!targetPath.startsWith(`${bundleRoot}${path.sep}`) && targetPath !== bundleRoot) {
      throw new Error("Artifact path escapes task bundle root");
    }

    if (!(await fileExists(targetPath))) {
      throw new Error("Artifact file not found");
    }

    return {
      path: targetPath,
      content: await readFile(targetPath, "utf8")
    };
  }

  async getApproval(approvalId: string): Promise<ApprovalRequest | undefined> {
    const store = await this.store.read();
    return store.approvals.find((item) => item.id === approvalId);
  }

  async getMiniAppOverview(userId?: string): Promise<{
    hosts: Host[];
    workspaces: Workspace[];
    sessions: Session[];
    approvals: ApprovalRequest[];
    tasks: TaskBundle[];
  }> {
    const store = await this.store.read();
    const scoped = scopedMiniAppStore(store, userId);
    return {
      hosts: scoped.hosts,
      workspaces: scoped.workspaces,
      sessions: scoped.sessions,
      approvals: scoped.approvals,
      tasks: scoped.tasks
    };
  }

  async getMiniAppDashboard(userId?: string): Promise<MiniAppDashboardProjection> {
    const store = await this.store.read();
    const scoped = scopedMiniAppStore(store, userId);
    const activeSessions = scoped.sessions.filter((item) => !isTerminalSessionState(item.state));
    const pendingApprovals = scoped.approvals.filter((item) => item.state === "waiting_human" || item.state === "pending");
    const blockedSessions = scoped.sessions.filter((item) => item.state === "blocked" || item.state === "needs_approval");
    const verifyProblems = scoped.tasks.filter((item) => ["failed", "inconclusive", "stale"].includes(item.verificationState));
    const recentSession = scoped.sessions.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)).at(0);
    const lastHost = recentSession ? store.hosts.find((item) => item.id === recentSession.hostId) : scoped.hosts.at(0);
    const lastWorkspace = recentSession ? store.workspaces.find((item) => item.id === recentSession.workspaceId) : scoped.workspaces.at(0);

    const attention: MiniAppAttentionItem[] = [
      ...pendingApprovals.map((approval) => ({
        id: approval.id,
        kind: "approval" as const,
        title: "Нужно подтверждение",
        detail: approval.reason,
        severity: approval.risk === "critical" || approval.risk === "high" ? "danger" as const : "warn" as const,
        href: `/approval/${encodeURIComponent(approval.id)}`,
        nextAction: "Открыть approval"
      })),
      ...blockedSessions.map((session) => ({
        id: session.id,
        kind: "session" as const,
        title: "Сессия остановилась",
        detail: session.title,
        severity: "warn" as const,
        href: `/session/${encodeURIComponent(session.id)}`,
        nextAction: "Открыть сессию"
      })),
      ...verifyProblems.map((task) => ({
        id: task.id,
        kind: "verification" as const,
        title: task.verificationState === "stale" ? "Verify устарел" : "Verify требует внимания",
        detail: task.title,
        severity: task.verificationState === "failed" ? "danger" as const : "warn" as const,
        href: `/verify/${encodeURIComponent(task.sessionId)}`,
        nextAction: task.verificationState === "failed" ? "Запустить fix" : "Открыть отчет"
      })),
      ...scoped.hosts
        .filter((host) => host.status === "stale" || host.status === "revoked")
        .map((host) => ({
          id: host.id,
          kind: "host" as const,
          title: "Host offline",
          detail: host.label,
          severity: "warn" as const,
          href: `/host/${encodeURIComponent(host.id)}`,
          nextAction: "Проверить host"
        }))
    ].slice(0, 5);

    return {
      stats: {
        activeSessions: activeSessions.length,
        pendingApprovals: pendingApprovals.length,
        blockedSessions: blockedSessions.length,
        verifyProblems: verifyProblems.length
      },
      lastContext: lastHost || lastWorkspace ? {
        hostId: lastHost?.id,
        hostLabel: lastHost?.label,
        workspaceId: lastWorkspace?.id,
        repoName: lastWorkspace?.repoName
      } : undefined,
      attention,
      recentSessions: scoped.sessions
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
        .slice(0, 5)
        .map((session) => sessionCard(store, session)),
      recentReports: reportCards(store, scoped.sessions).slice(0, 5)
    };
  }

  async listMiniAppSessions(userId?: string): Promise<{ sessions: MiniAppSessionCard[] }> {
    const store = await this.store.read();
    const scoped = scopedMiniAppStore(store, userId);
    return {
      sessions: scoped.sessions
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
        .map((session) => sessionCard(store, session))
    };
  }

  async getMiniAppSessionDetail(sessionId: string, userId?: string): Promise<{
    session: MiniAppSessionCard & Pick<Session, "prompt" | "currentSummary" | "lastError" | "mode" | "runtime">;
    host?: MiniAppHostCard;
    workspace?: Workspace;
    task?: TaskBundle;
    approval?: MiniAppApprovalCard;
    events: SessionEvent[];
    actions: string[];
  }> {
    const store = await this.store.read();
    const scoped = scopedMiniAppStore(store, userId);
    const session = scoped.sessions.find((item) => item.id === sessionId);
    if (!session) {
      throw new Error("Session not found");
    }

    const host = store.hosts.find((item) => item.id === session.hostId);
    const task = session.taskId ? store.tasks.find((item) => item.id === session.taskId) : undefined;
    const approval = session.approvalId ? store.approvals.find((item) => item.id === session.approvalId) : undefined;
    const actions = [
      approval?.state === "waiting_human" ? "open_approval" : undefined,
      task && ["failed", "inconclusive", "stale"].includes(task.verificationState) ? "open_verify" : undefined,
      session.state === "paused" || session.state === "resuming" ? "resume" : undefined,
      "summary",
      "diff"
    ].filter((item): item is string => Boolean(item));

    return {
      session: {
        ...sessionCard(store, session),
        prompt: session.prompt,
        currentSummary: session.currentSummary,
        lastError: session.lastError,
        mode: session.mode,
        runtime: session.runtime
      },
      host: host ? hostCard(store, host) : undefined,
      workspace: store.workspaces.find((item) => item.id === session.workspaceId),
      task,
      approval: approval ? approvalCard(store, approval) : undefined,
      events: store.sessionEvents
        .filter((item) => item.sessionId === session.id)
        .sort((left, right) => left.sequence - right.sequence),
      actions
    };
  }

  async listMiniAppApprovals(userId?: string): Promise<{ approvals: MiniAppApprovalCard[] }> {
    const store = await this.store.read();
    const scoped = scopedMiniAppStore(store, userId);
    return {
      approvals: scoped.approvals
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
        .map((approval) => approvalCard(store, approval))
    };
  }

  async getMiniAppApprovalDetail(approvalId: string, userId?: string): Promise<{ approval: MiniAppApprovalCard; session?: MiniAppSessionCard }> {
    const store = await this.store.read();
    const scoped = scopedMiniAppStore(store, userId);
    const approval = scoped.approvals.find((item) => item.id === approvalId);
    if (!approval) {
      throw new Error("Approval not found");
    }

    const session = store.sessions.find((item) => item.id === approval.sessionId);
    return {
      approval: approvalCard(store, approval),
      session: session ? sessionCard(store, session) : undefined
    };
  }

  async listMiniAppHosts(userId?: string): Promise<{ hosts: MiniAppHostCard[] }> {
    const store = await this.store.read();
    const scoped = scopedMiniAppStore(store, userId);
    return {
      hosts: scoped.hosts.map((host) => hostCard(store, host))
    };
  }

  async listMiniAppProjects(userId?: string): Promise<{ projects: MiniAppProjectCard[] }> {
    const store = await this.store.read();
    const scoped = scopedMiniAppStore(store, userId);
    return {
      projects: scoped.workspaces
        .sort((left, right) => left.repoName.localeCompare(right.repoName))
        .map((workspace) => projectCard(store, workspace))
    };
  }

  async getMiniAppHostDetail(hostId: string, userId?: string): Promise<{ host: MiniAppHostCard; workspaces: Workspace[]; sessions: MiniAppSessionCard[] }> {
    const store = await this.store.read();
    const scoped = scopedMiniAppStore(store, userId);
    const host = scoped.hosts.find((item) => item.id === hostId);
    if (!host) {
      throw new Error("Host not found");
    }

    return {
      host: hostCard(store, host),
      workspaces: scoped.workspaces.filter((item) => item.hostId === host.id),
      sessions: scoped.sessions.filter((item) => item.hostId === host.id).map((session) => sessionCard(store, session))
    };
  }

  async listMiniAppReports(userId?: string): Promise<{ reports: MiniAppReportCard[] }> {
    const store = await this.store.read();
    const scoped = scopedMiniAppStore(store, userId);
    return {
      reports: reportCards(store, scoped.sessions)
    };
  }

  async getMiniAppBundleDetail(taskId: string, userId?: string): Promise<{
    task: TaskBundle;
    sections: Array<{ id: string; label: string; files: string[] }>;
    validation: Awaited<ReturnType<typeof validateTaskBundle>>;
  }> {
    const store = await this.store.read();
    const scoped = scopedMiniAppStore(store, userId);
    const task = scoped.tasks.find((item) => item.id === taskId);
    if (!task) {
      throw new Error("Task not found");
    }

    const artifacts = await this.listTaskArtifacts(taskId);
    const relativeArtifacts = artifacts.artifacts.map((item) => path.basename(item));
    return {
      task,
      validation: await validateTaskBundle(task.rootPath),
      sections: [
        { id: "spec", label: "Spec", files: relativeArtifacts.filter((item) => ["spec.md", "task.md", "frozen-spec.md", "plan.md"].includes(item)) },
        { id: "build", label: "Build", files: relativeArtifacts.filter((item) => ["build-log.md", "fix-log.md"].includes(item)) },
        { id: "evidence", label: "Evidence", files: relativeArtifacts.filter((item) => ["evidence.md", "evidence.json"].includes(item)) },
        { id: "verify", label: "Verify", files: relativeArtifacts.filter((item) => ["verify-report.md", "verdict.json", "problems.md"].includes(item)) },
        { id: "final", label: "Final", files: relativeArtifacts.filter((item) => ["final-summary.md", "state.json"].includes(item)) }
      ]
    };
  }

  async getMiniAppDiffSummary(sessionId: string, userId?: string): Promise<MiniAppDiffProjection> {
    const detail = await this.getMiniAppSessionDetail(sessionId, userId);
    const artifacts = detail.task ? (await this.listTaskArtifacts(detail.task.id)).artifacts : [];
    const files = artifacts.map((artifactPath) => ({
      path: path.basename(artifactPath),
      category: classifyArtifactPath(artifactPath),
      status: "unknown" as const,
      summary: "Repo-local proof artifact"
    }));
    const highRiskFiles = files
      .filter((file) => file.category === "config" || file.path.toLowerCase().includes("package.json"))
      .map((file) => file.path);

    return {
      sessionId,
      taskId: detail.task?.id,
      summary: {
        changedFiles: files.length,
        highRiskFiles
      },
      files,
      rawAvailable: artifacts.some((item) => item.toLowerCase().endsWith(".diff") || item.toLowerCase().includes("build"))
    };
  }

  async getMiniAppVerifySummary(sessionId: string, userId?: string): Promise<MiniAppVerifyProjection> {
    const detail = await this.getMiniAppSessionDetail(sessionId, userId);
    const task = detail.task;
    const state = task?.verificationState ?? "not_started";
    const checkedCriteria = state === "passed" ? task?.acceptanceCriteria ?? [] : [];
    const failedCriteria = ["failed", "inconclusive"].includes(state) ? task?.acceptanceCriteria ?? [] : [];
    return {
      sessionId,
      taskId: task?.id,
      state,
      checkedCriteria,
      failedCriteria,
      nextAction: state === "passed"
        ? "open_summary"
        : state === "failed"
          ? "run_fix"
          : state === "stale"
            ? "rerun_verify"
            : "open_evidence",
      reportHref: task ? `/task/${encodeURIComponent(task.id)}#verify` : undefined,
      evidenceHref: task ? `/task/${encodeURIComponent(task.id)}#evidence` : undefined
    };
  }

  async getSessionTimeline(sessionId: string): Promise<{
    session: Session;
    task?: TaskBundle;
    approval?: ApprovalRequest;
    events: SessionEvent[];
  }> {
    const store = await this.store.read();
    const session = store.sessions.find((item) => item.id === sessionId);
    if (!session) {
      throw new Error("Session not found");
    }

    return {
      session,
      task: session.taskId ? store.tasks.find((item) => item.id === session.taskId) : undefined,
      approval: session.approvalId ? store.approvals.find((item) => item.id === session.approvalId) : undefined,
      events: store.sessionEvents
        .filter((item) => item.sessionId === sessionId)
        .sort((left, right) => left.sequence - right.sequence)
    };
  }
}
