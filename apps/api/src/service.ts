import path from "node:path";
import { readFile } from "node:fs/promises";

import { createApprovalRequest, resolveApprovalRequest } from "../../../packages/approval-engine/src/index.js";
import { createDefaultPolicies, evaluatePolicies } from "../../../packages/policy-engine/src/index.js";
import { initTaskBundle, validateTaskBundle } from "../../../packages/repo-proof/src/index.js";
import type {
  ApprovalDecision,
  ApprovalRequest,
  ClaimPairingRequest,
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

export class HappyTGControlPlaneService {
  constructor(private readonly store: FileStateStore = new FileStateStore()) {}

  async listHosts(userId?: string): Promise<Host[]> {
    const store = await this.store.read();
    return store.hosts.filter((item) => !userId || item.pairedUserId === userId);
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
    return this.store.update((store) => {
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
    return this.store.update((store) => {
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
      appendEvent(store, session.id, "session.created", { mode: input.mode, runtime: input.runtime });
      session.state = "prefetching";
      appendEvent(store, session.id, "session.prefetch.completed", {
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
        appendEvent(store, session.id, "task.phase.changed", { taskId: task.id, phase: task.phase });
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

      appendEvent(store, session.id, "policy.evaluated", {
        outcome: policyDecision.outcome,
        effectiveLayer: policyDecision.effectiveLayer,
        reason: policyDecision.reason
      });

      if (policyDecision.outcome === "deny") {
        session.state = "failed";
        session.lastError = policyDecision.reason;
        appendEvent(store, session.id, "session.failed", { reason: policyDecision.reason });
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
        session.approvalId = approval.id;
        session.state = "awaiting_approval";
        session.updatedAt = nowIso();
        appendEvent(store, session.id, "approval.requested", {
          approvalId: approval.id,
          risk: approval.risk,
          reason: approval.reason
        });
        appendAudit(store, "user", input.userId, "approval.requested", approval.id, { sessionId: session.id, actionKind });
        return { session, task, approval };
      }

      const dispatch = makeDispatch(session, actionKind);
      store.pendingDispatches.push(dispatch);
      session.state = "pending_dispatch";
      session.updatedAt = nowIso();
      appendAudit(store, "user", input.userId, "session.dispatched", session.id, { dispatchId: dispatch.id });
      return { session, task, dispatch };
    });
  }

  async createBootstrapSession(input: {
    userId: string;
    hostId: string;
    command: "doctor" | "verify";
  }): Promise<{ session: Session; approval?: ApprovalRequest; dispatch?: PendingDispatch }> {
    return this.store.update((store) => {
      ensurePolicies(store);

      const host = getHostRecord(store, input.hostId);
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
      appendEvent(store, session.id, "session.created", {
        mode: session.mode,
        runtime: session.runtime,
        executionKind: input.command === "doctor" ? "bootstrap_doctor" : "bootstrap_verify"
      });
      session.state = "prefetching";
      appendEvent(store, session.id, "session.prefetch.completed", {
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

      appendEvent(store, session.id, "policy.evaluated", {
        outcome: policyDecision.outcome,
        effectiveLayer: policyDecision.effectiveLayer,
        reason: policyDecision.reason
      });

      if (policyDecision.outcome === "deny") {
        session.state = "failed";
        session.lastError = policyDecision.reason;
        appendEvent(store, session.id, "session.failed", { reason: policyDecision.reason });
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
        session.approvalId = approval.id;
        session.state = "awaiting_approval";
        session.updatedAt = nowIso();
        appendEvent(store, session.id, "approval.requested", {
          approvalId: approval.id,
          risk: approval.risk,
          reason: approval.reason
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
      session.state = "pending_dispatch";
      session.updatedAt = nowIso();
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

      if (approval.state !== "pending") {
        throw new Error(`Approval is already ${approval.state}`);
      }

      const resolved = resolveApprovalRequest(approval, input.userId, input.decision, input.reason);
      Object.assign(approval, resolved.approval);
      store.approvalDecisions.push(resolved.auditDecision);
      appendEvent(store, session.id, "approval.resolved", {
        approvalId: approval.id,
        decision: approval.state
      });

      let dispatch: PendingDispatch | undefined;
      if (resolved.approval.state === "approved") {
        dispatch = makeDispatch(session, approval.actionKind, approval.id);
        store.pendingDispatches.push(dispatch);
        session.state = "pending_dispatch";
      } else {
        session.state = "paused";
        session.lastError = approval.reason;
      }

      session.updatedAt = nowIso();
      appendAudit(store, "user", input.userId, "approval.resolved", approval.id, { sessionId: session.id, decision: approval.state });
      return { approval, session, decision: resolved.auditDecision, dispatch };
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

      session.state = dispatch.mode === "proof" ? "running" : "running";
      session.updatedAt = nowIso();
      appendEvent(store, session.id, "runtime.exec.started", {
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
        appendEvent(store, session.id, "runtime.exec.summary", {
          summary: input.summary
        });
      }

      if (input.error) {
        session.lastError = input.error;
      }

      if (input.state) {
        session.state = input.state;
      }

      session.updatedAt = nowIso();
      return session;
    });
  }

  async updateTaskPhase(taskId: string, phase: TaskBundle["phase"], verificationState?: TaskBundle["verificationState"]): Promise<TaskBundle> {
    return this.store.update((store) => {
      const task = store.tasks.find((item) => item.id === taskId);
      if (!task) {
        throw new Error("Task not found");
      }

      task.phase = phase;
      if (verificationState) {
        task.verificationState = verificationState;
      }
      task.updatedAt = nowIso();

      const session = store.sessions.find((item) => item.id === task.sessionId);
      if (session) {
        appendEvent(store, session.id, "task.phase.changed", {
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
      session.state = input.ok ? "completed" : "failed";
      session.currentSummary = input.summary;
      session.updatedAt = nowIso();
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

      appendEvent(store, session.id, input.ok ? "session.completed" : "session.failed", {
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

      if (session.state === "completed" || session.state === "cancelled") {
        return session;
      }

      session.state = "reconnecting";
      session.updatedAt = nowIso();
      appendEvent(store, session.id, "host.connected", {
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
    sessions: Session[];
    approvals: ApprovalRequest[];
    tasks: TaskBundle[];
  }> {
    const store = await this.store.read();
    const hostIds = new Set(store.hosts.filter((item) => !userId || item.pairedUserId === userId).map((item) => item.id));
    const sessions = store.sessions.filter((item) => hostIds.has(item.hostId));
    const sessionIds = new Set(sessions.map((item) => item.id));
    return {
      hosts: Array.from(hostIds).map((hostId) => store.hosts.find((item) => item.id === hostId)!),
      sessions,
      approvals: store.approvals.filter((item) => sessionIds.has(item.sessionId)),
      tasks: store.tasks.filter((item) => sessionIds.has(item.sessionId))
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
