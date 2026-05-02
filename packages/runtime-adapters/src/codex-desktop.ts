import { createHash } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import type {
  CodexDesktopControlResult,
  CodexDesktopProject,
  CodexDesktopSession,
  CreateCodexDesktopTaskRequest
} from "../../protocol/src/index.js";
import { normalizeSpawnEnv, resolveExecutable } from "../../shared/src/index.js";

const DEFAULT_UNSUPPORTED_REASON = "Codex Desktop control is unsupported because no stable Desktop/CLI/app-server contract was proven.";
const APP_SERVER_UNAVAILABLE_REASON = "Codex Desktop app-server control is unavailable. Start Codex Desktop or make `codex app-server` available on this host.";
const DEFAULT_MAX_SESSION_FILES = 500;
const DEFAULT_APP_SERVER_REQUEST_TIMEOUT_MS = 10_000;
const DEFAULT_APP_SERVER_STDERR_MAX_BYTES = 8_192;

interface CodexDesktopControlCapabilities {
  supportsResume: boolean;
  supportsStop: boolean;
  supportsNewTask: boolean;
  unsupportedReason?: string;
}

interface SessionDraft {
  id: string;
  title?: string;
  projectPath?: string;
  updatedAt?: string;
  archived?: boolean;
  unknown?: boolean;
}

export interface CodexDesktopControlContract {
  supportsResume?: boolean;
  supportsStop?: boolean;
  supportsNewTask?: boolean;
  unsupportedReason?: string;
  capabilities?(): Promise<CodexDesktopControlCapabilities>;
  resumeSession?(session: CodexDesktopSession): Promise<CodexDesktopControlResult>;
  stopSession?(session: CodexDesktopSession): Promise<CodexDesktopControlResult>;
  createTask?(input: CreateCodexDesktopTaskRequest): Promise<CodexDesktopControlResult>;
  dispose?(): void;
}

export interface CodexDesktopStateAdapterOptions {
  codexHome?: string;
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  platform?: NodeJS.Platform;
  maxSessionFiles?: number;
  controlContract?: CodexDesktopControlContract;
  appServerCommand?: string;
  appServerArgs?: string[];
}

interface JsonRpcErrorObject {
  code?: number;
  message?: string;
  data?: unknown;
}

interface JsonRpcMessage {
  jsonrpc?: "2.0";
  id?: string | number | null;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: JsonRpcErrorObject;
}

interface AppServerThreadStatus {
  type: "notLoaded" | "idle" | "systemError" | "active";
  activeFlags?: unknown[];
}

interface AppServerTurn {
  id: string;
  status: "completed" | "interrupted" | "failed" | "inProgress";
}

interface AppServerThread {
  id: string;
  preview?: string;
  name?: string | null;
  cwd?: string;
  updatedAt?: number;
  status?: AppServerThreadStatus;
  turns?: AppServerTurn[];
}

interface AppServerThreadResponse {
  thread: AppServerThread;
}

interface AppServerThreadListResponse {
  data: AppServerThread[];
}

interface AppServerTurnStartResponse {
  turn: AppServerTurn;
}

interface AppServerTurnsListResponse {
  data: AppServerTurn[];
}

interface PendingJsonRpcRequest {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timer: NodeJS.Timeout;
}

export class CodexDesktopControlUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CodexDesktopControlUnavailableError";
  }
}

function stablePathId(prefix: string, value: string): string {
  return `${prefix}_${createHash("sha256").update(value.toLowerCase()).digest("hex").slice(0, 16)}`;
}

function normalizePathKey(value: string): string {
  return path.normalize(value.trim());
}

function looksPathLike(value: string): boolean {
  return path.isAbsolute(value)
    || /^[A-Za-z]:[\\/]/u.test(value)
    || value.startsWith("\\\\")
    || value.includes("/")
    || value.includes("\\");
}

function safeString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function safeIso(value: unknown): string | undefined {
  const raw = safeString(value);
  if (!raw) {
    return undefined;
  }

  const time = Date.parse(raw);
  return Number.isFinite(time) ? new Date(time).toISOString() : undefined;
}

function sanitizeTitle(value: unknown, fallback: string): string {
  const raw = safeString(value);
  if (!raw) {
    return fallback;
  }

  const normalized = raw.replace(/\s+/gu, " ").trim();
  return normalized.length <= 120 ? normalized : `${normalized.slice(0, 117)}...`;
}

function collectPathStrings(value: unknown, output = new Set<string>()): Set<string> {
  if (typeof value === "string") {
    const normalized = normalizePathKey(value);
    if (looksPathLike(normalized)) {
      output.add(normalized);
    }
    return output;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectPathStrings(item, output);
    }
    return output;
  }

  if (value && typeof value === "object") {
    for (const nested of Object.values(value as Record<string, unknown>)) {
      collectPathStrings(nested, output);
    }
  }

  return output;
}

async function readJsonObject(filePath: string): Promise<Record<string, unknown> | undefined> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : undefined;
  } catch {
    return undefined;
  }
}

async function readJsonl(filePath: string, maxLines?: number): Promise<Record<string, unknown>[]> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const lines = raw.split(/\r?\n/u).filter((line) => line.trim());
    const selected = maxLines ? lines.slice(0, maxLines) : lines;
    const records: Record<string, unknown>[] = [];
    for (const line of selected) {
      try {
        const parsed = JSON.parse(line) as unknown;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          records.push(parsed as Record<string, unknown>);
        }
      } catch {
        records.push({ parseError: true });
      }
    }
    return records;
  } catch {
    return [];
  }
}

async function collectJsonlFiles(root: string, maxFiles: number): Promise<string[]> {
  const files: string[] = [];

  async function visit(dir: string): Promise<void> {
    if (files.length >= maxFiles) {
      return;
    }

    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (files.length >= maxFiles) {
        return;
      }
      const entryPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await visit(entryPath);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".jsonl")) {
        files.push(entryPath);
      }
    }
  }

  await visit(root);
  return files;
}

function extractFileSessionId(filePath: string): string | undefined {
  const baseName = path.basename(filePath, ".jsonl");
  const uuid = baseName.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu)?.[0];
  return uuid ?? (baseName || undefined);
}

function metadataFromSessionRecords(filePath: string, records: Record<string, unknown>[], archived: boolean): SessionDraft | undefined {
  const fallbackId = extractFileSessionId(filePath);
  let id: string | undefined;
  let projectPathValue: string | undefined;
  let updatedAt: string | undefined;
  let unknown = false;

  for (const record of records) {
    if (record.parseError) {
      unknown = true;
      continue;
    }

    updatedAt = safeIso(record.timestamp) ?? updatedAt;
    const payload = record.payload;
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      continue;
    }

    const payloadRecord = payload as Record<string, unknown>;
    id = safeString(payloadRecord.id) ?? id;
    const cwd = safeString(payloadRecord.cwd);
    if (cwd && looksPathLike(cwd)) {
      projectPathValue = normalizePathKey(cwd);
    }
    updatedAt = safeIso(payloadRecord.timestamp) ?? updatedAt;
  }

  if (!id && !fallbackId) {
    return undefined;
  }

  return {
    id: id ?? fallbackId!,
    projectPath: projectPathValue,
    updatedAt,
    archived,
    unknown
  };
}

function projectLabel(projectPath: string): string {
  return path.basename(projectPath) || projectPath;
}

function quoteWindowsShellArg(value: string): string {
  if (!value) {
    return "\"\"";
  }

  if (!/[\s"&()<>^|%!]/u.test(value)) {
    return value;
  }

  return `"${value.replace(/%/g, "%%").replace(/"/g, "\"\"")}"`;
}

function buildWindowsShellCommand(command: string, args: string[]): string {
  return [command, ...args]
    .map((value) => quoteWindowsShellArg(value))
    .join(" ");
}

function isJavaScriptEntrypoint(filePath: string): boolean {
  return [".js", ".mjs", ".cjs"].includes(path.extname(filePath).toLowerCase());
}

function retainTail(current: string, appended: string, maxBytes: number): string {
  const combined = `${current}${appended}`;
  const buffer = Buffer.from(combined, "utf8");
  return buffer.byteLength <= maxBytes
    ? combined
    : buffer.subarray(buffer.byteLength - maxBytes).toString("utf8");
}

function jsonRpcErrorMessage(error: JsonRpcErrorObject | undefined): string {
  return error?.message ?? "Codex app-server request failed.";
}

function appServerThreadTitle(thread: AppServerThread, fallback: string): string {
  return sanitizeTitle(thread.name ?? thread.preview, fallback);
}

function appServerThreadUpdatedAt(thread: AppServerThread, fallback?: string): string {
  return typeof thread.updatedAt === "number" && Number.isFinite(thread.updatedAt)
    ? new Date(thread.updatedAt * 1000).toISOString()
    : fallback ?? new Date().toISOString();
}

function appServerThreadStatus(thread: AppServerThread, fallback?: CodexDesktopSession["status"]): CodexDesktopSession["status"] {
  if (thread.status?.type === "active") {
    return "active";
  }
  if (thread.status?.type === "systemError") {
    return "unknown";
  }
  return fallback === "archived" ? "archived" : "recent";
}

class CodexAppServerJsonRpcClient {
  private child: ChildProcessWithoutNullStreams | undefined;
  private startPromise: Promise<void> | undefined;
  private nextId = 1;
  private buffer = "";
  private stderrTail = "";
  private readonly pending = new Map<string | number, PendingJsonRpcRequest>();

  constructor(private readonly options: {
    command: string;
    args: string[];
    cwd?: string;
    env: NodeJS.ProcessEnv;
    platform: NodeJS.Platform;
    requestTimeoutMs: number;
  }) {}

  async request<T>(method: string, params: unknown): Promise<T> {
    await this.start();
    return this.sendRequest<T>(method, params);
  }

  dispose(): void {
    this.rejectAll(new CodexDesktopControlUnavailableError("Codex app-server client was disposed."));
    if (this.child && !this.child.killed) {
      this.child.kill();
    }
    this.child = undefined;
  }

  private async start(): Promise<void> {
    if (this.child && !this.child.killed) {
      return;
    }

    if (this.startPromise) {
      return this.startPromise;
    }

    this.startPromise = this.spawnAndInitialize();
    try {
      await this.startPromise;
    } finally {
      this.startPromise = undefined;
    }
  }

  private async spawnAndInitialize(): Promise<void> {
    const resolvedPath = await resolveExecutable(this.options.command, {
      cwd: this.options.cwd,
      env: this.options.env,
      platform: this.options.platform
    });
    const commandPath = resolvedPath ?? this.options.command;
    const command = isJavaScriptEntrypoint(commandPath) ? process.execPath : commandPath;
    const args = isJavaScriptEntrypoint(commandPath)
      ? [commandPath, ...this.options.args]
      : this.options.args;
    const useWindowsShell = this.options.platform === "win32"
      && /\.(cmd|bat)$/iu.test(command);
    const spawnCommand = useWindowsShell
      ? buildWindowsShellCommand(command, args)
      : command;

    this.child = spawn(spawnCommand, useWindowsShell ? [] : args, {
      cwd: this.options.cwd,
      env: normalizeSpawnEnv(this.options.env, this.options.platform),
      shell: useWindowsShell,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"]
    });
    this.buffer = "";
    this.stderrTail = "";

    this.child.stdout.setEncoding("utf8");
    this.child.stdout.on("data", (chunk: string) => {
      this.handleOutput(chunk);
    });
    this.child.stderr.setEncoding("utf8");
    this.child.stderr.on("data", (chunk: string) => {
      this.stderrTail = retainTail(this.stderrTail, chunk, DEFAULT_APP_SERVER_STDERR_MAX_BYTES);
    });
    this.child.on("error", (error) => {
      this.rejectAll(new CodexDesktopControlUnavailableError(error.message));
    });
    this.child.on("close", (code) => {
      this.rejectAll(new CodexDesktopControlUnavailableError(`Codex app-server exited with code ${code ?? "unknown"}.${this.stderrTail ? ` ${this.stderrTail.trim()}` : ""}`));
      this.child = undefined;
    });

    await this.sendRequest("initialize", {
      clientInfo: {
        name: "happytg",
        title: "HappyTG",
        version: "0.0.0"
      },
      capabilities: {
        experimentalApi: true
      }
    });
    this.sendNotification("initialized");
  }

  private handleOutput(chunk: string): void {
    this.buffer += chunk;
    while (true) {
      const newlineIndex = this.buffer.indexOf("\n");
      if (newlineIndex < 0) {
        return;
      }

      const rawLine = this.buffer.slice(0, newlineIndex).trim();
      this.buffer = this.buffer.slice(newlineIndex + 1);
      if (!rawLine) {
        continue;
      }

      let message: JsonRpcMessage;
      try {
        message = JSON.parse(rawLine) as JsonRpcMessage;
      } catch {
        continue;
      }
      this.handleMessage(message);
    }
  }

  private handleMessage(message: JsonRpcMessage): void {
    if (message.id !== undefined && message.id !== null && !message.method) {
      const pending = this.pending.get(message.id);
      if (!pending) {
        return;
      }
      clearTimeout(pending.timer);
      this.pending.delete(message.id);
      if (message.error) {
        pending.reject(new Error(jsonRpcErrorMessage(message.error)));
        return;
      }
      pending.resolve(message.result);
      return;
    }

    if (message.id !== undefined && message.id !== null && message.method) {
      this.respondToServerRequest(message);
    }
  }

  private respondToServerRequest(message: JsonRpcMessage): void {
    let result: unknown;
    switch (message.method) {
      case "item/commandExecution/requestApproval":
        result = { decision: "decline" };
        break;
      case "item/fileChange/requestApproval":
        result = { decision: "decline" };
        break;
      case "item/permissions/requestApproval":
        result = { permissions: {}, scope: "turn", strictAutoReview: true };
        break;
      case "item/tool/requestUserInput":
        result = { answers: {} };
        break;
      default:
        this.write({
          jsonrpc: "2.0",
          id: message.id,
          error: {
            code: -32601,
            message: `HappyTG does not handle app-server request ${message.method}.`
          }
        });
        return;
    }

    this.write({
      jsonrpc: "2.0",
      id: message.id,
      result
    });
  }

  private sendNotification(method: string, params?: unknown): void {
    this.write({
      jsonrpc: "2.0",
      method,
      ...(params === undefined ? {} : { params })
    });
  }

  private sendRequest<T>(method: string, params: unknown): Promise<T> {
    if (!this.child || this.child.killed) {
      throw new CodexDesktopControlUnavailableError(APP_SERVER_UNAVAILABLE_REASON);
    }

    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new CodexDesktopControlUnavailableError(`Codex app-server request ${method} timed out.`));
      }, this.options.requestTimeoutMs);

      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
        timer
      });

      this.write({
        jsonrpc: "2.0",
        id,
        method,
        params
      });
    });
  }

  private write(message: JsonRpcMessage): void {
    if (!this.child || this.child.killed) {
      throw new CodexDesktopControlUnavailableError(APP_SERVER_UNAVAILABLE_REASON);
    }
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private rejectAll(error: Error): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(error);
      this.pending.delete(id);
    }
  }
}

export function createCodexDesktopAppServerControlContract(options: {
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  platform?: NodeJS.Platform;
  codexHome?: string;
  command?: string;
  args?: string[];
  requestTimeoutMs?: number;
} = {}): CodexDesktopControlContract {
  const env: NodeJS.ProcessEnv = {
    ...(options.env ?? process.env),
    ...(options.codexHome ? { CODEX_HOME: options.codexHome } : {})
  };
  const mode = env.HAPPYTG_CODEX_DESKTOP_APP_SERVER_MODE ?? "stdio";
  const command = options.command ?? env.HAPPYTG_CODEX_DESKTOP_APP_SERVER_COMMAND ?? env.CODEX_CLI_BIN ?? "codex";
  const args = options.args ?? (
    mode === "proxy"
      ? ["app-server", "proxy"]
      : ["app-server", "--listen", "stdio://"]
  );
  const client = new CodexAppServerJsonRpcClient({
    command,
    args,
    cwd: options.cwd,
    env,
    platform: options.platform ?? process.platform,
    requestTimeoutMs: options.requestTimeoutMs
      ?? Number(env.HAPPYTG_CODEX_DESKTOP_APP_SERVER_TIMEOUT_MS ?? DEFAULT_APP_SERVER_REQUEST_TIMEOUT_MS)
  });

  const toSession = (thread: AppServerThread, fallback?: CodexDesktopSession): CodexDesktopSession => ({
    id: thread.id,
    title: appServerThreadTitle(thread, fallback?.title ?? `Codex Desktop ${thread.id.slice(0, 8)}`),
    projectPath: thread.cwd ? normalizePathKey(thread.cwd) : fallback?.projectPath,
    projectId: fallback?.projectId,
    updatedAt: appServerThreadUpdatedAt(thread, fallback?.updatedAt),
    status: appServerThreadStatus(thread, fallback?.status),
    source: "codex-desktop",
    canResume: true,
    canStop: true,
    canCreateTask: true
  });

  const approvalPolicy = env.HAPPYTG_CODEX_DESKTOP_APPROVAL_POLICY ?? "never";
  const sandbox = env.HAPPYTG_CODEX_DESKTOP_SANDBOX ?? "workspace-write";

  async function ensureAvailable(): Promise<void> {
    try {
      await client.request<AppServerThreadListResponse>("thread/list", {
        limit: 1,
        sourceKinds: [],
        useStateDbOnly: true
      });
    } catch (error) {
      throw new CodexDesktopControlUnavailableError(error instanceof Error ? error.message : APP_SERVER_UNAVAILABLE_REASON);
    }
  }

  return {
    supportsResume: true,
    supportsStop: true,
    supportsNewTask: true,
    unsupportedReason: APP_SERVER_UNAVAILABLE_REASON,
    async capabilities() {
      try {
        await ensureAvailable();
        return {
          supportsResume: true,
          supportsStop: true,
          supportsNewTask: true
        };
      } catch (error) {
        return {
          supportsResume: false,
          supportsStop: false,
          supportsNewTask: false,
          unsupportedReason: error instanceof Error ? error.message : APP_SERVER_UNAVAILABLE_REASON
        };
      }
    },
    async resumeSession(session) {
      const response = await client.request<AppServerThreadResponse>("thread/resume", {
        threadId: session.id,
        cwd: session.projectPath ?? null,
        excludeTurns: true,
        persistExtendedHistory: true
      });
      return {
        ok: true,
        action: "resume",
        source: "codex-desktop",
        session: toSession(response.thread, session)
      };
    },
    async stopSession(session) {
      const turns = await client.request<AppServerTurnsListResponse>("thread/turns/list", {
        threadId: session.id,
        limit: 20
      });
      const runningTurn = turns.data.find((turn) => turn.status === "inProgress");
      if (!runningTurn) {
        throw new CodexDesktopControlUnavailableError("Codex Desktop session has no in-progress turn to stop.");
      }

      await client.request<Record<string, never>>("turn/interrupt", {
        threadId: session.id,
        turnId: runningTurn.id
      });
      return {
        ok: true,
        action: "stop",
        source: "codex-desktop",
        session: {
          ...session,
          status: "recent",
          canResume: true,
          canStop: true,
          canCreateTask: true,
          unsupportedReason: undefined
        }
      };
    },
    async createTask(input) {
      const start = await client.request<AppServerThreadResponse>("thread/start", {
        cwd: input.projectPath ?? null,
        approvalPolicy,
        sandbox,
        serviceName: "HappyTG",
        experimentalRawEvents: false,
        persistExtendedHistory: true
      });
      const turn = await client.request<AppServerTurnStartResponse>("turn/start", {
        threadId: start.thread.id,
        input: [
          {
            type: "text",
            text: input.prompt,
            text_elements: []
          }
        ],
        cwd: input.projectPath ?? null,
        approvalPolicy
      });

      return {
        ok: true,
        action: "new-task",
        source: "codex-desktop",
        session: toSession(start.thread),
        task: {
          id: start.thread.id,
          title: input.title ?? appServerThreadTitle(start.thread, "Desktop task"),
          projectId: input.projectId,
          projectPath: input.projectPath,
          status: turn.turn.status === "inProgress" ? "running" : "created"
        }
      };
    },
    dispose() {
      client.dispose();
    }
  };
}

function defaultControlContract(options: CodexDesktopStateAdapterOptions, codexHome: string): CodexDesktopControlContract {
  const env = options.env ?? process.env;
  const mode = env.HAPPYTG_CODEX_DESKTOP_CONTROL ?? (options.codexHome ? "off" : "app-server");
  if (mode === "off" || mode === "unsupported" || mode === "false") {
    return {};
  }

  return createCodexDesktopAppServerControlContract({
    env,
    cwd: options.cwd,
    platform: options.platform,
    codexHome,
    command: options.appServerCommand,
    args: options.appServerArgs
  });
}

export class CodexDesktopStateAdapter {
  private readonly env: NodeJS.ProcessEnv;
  private readonly maxSessionFiles: number;
  private readonly controlContract: CodexDesktopControlContract;

  constructor(private readonly options: CodexDesktopStateAdapterOptions = {}) {
    this.env = options.env ?? process.env;
    this.maxSessionFiles = options.maxSessionFiles ?? Number(this.env.HAPPYTG_CODEX_DESKTOP_MAX_SESSION_FILES ?? DEFAULT_MAX_SESSION_FILES);
    this.controlContract = options.controlContract ?? defaultControlContract(options, this.codexHome());
  }

  private codexHome(): string {
    return this.options.codexHome
      ?? this.env.CODEX_HOME
      ?? path.join(os.homedir(), ".codex");
  }

  private unsupportedReason(): string {
    return this.controlContract.unsupportedReason ?? DEFAULT_UNSUPPORTED_REASON;
  }

  canCreateTask(): boolean {
    return Boolean(this.controlContract.supportsNewTask && this.controlContract.createTask);
  }

  controlUnsupportedReason(): string {
    return this.unsupportedReason();
  }

  private async controlCapabilities(): Promise<CodexDesktopControlCapabilities> {
    if (this.controlContract.capabilities) {
      return this.controlContract.capabilities();
    }

    return {
      supportsResume: Boolean(this.controlContract.supportsResume && this.controlContract.resumeSession),
      supportsStop: Boolean(this.controlContract.supportsStop && this.controlContract.stopSession),
      supportsNewTask: Boolean(this.controlContract.supportsNewTask && this.controlContract.createTask),
      unsupportedReason: this.unsupportedReason()
    };
  }

  private decorateSession(session: Omit<CodexDesktopSession, "canResume" | "canStop" | "canCreateTask" | "unsupportedReason">, capabilities: CodexDesktopControlCapabilities): CodexDesktopSession {
    const canResume = Boolean(capabilities.supportsResume && this.controlContract.resumeSession);
    const canStop = Boolean(capabilities.supportsStop && this.controlContract.stopSession);
    const canCreateTask = Boolean(capabilities.supportsNewTask && this.controlContract.createTask);
    const unsupportedReason = canResume && canStop && canCreateTask ? undefined : this.unsupportedReason();
    return {
      ...session,
      canResume,
      canStop,
      canCreateTask,
      ...(unsupportedReason ? { unsupportedReason: capabilities.unsupportedReason ?? unsupportedReason } : {})
    };
  }

  async listProjects(): Promise<CodexDesktopProject[]> {
    const globalState = await readJsonObject(path.join(this.codexHome(), ".codex-global-state.json"));
    if (!globalState) {
      return [];
    }

    const activePaths = collectPathStrings(globalState["active-workspace-roots"]);
    const allPaths = new Set<string>();
    collectPathStrings(globalState["electron-saved-workspace-roots"], allPaths);
    collectPathStrings(globalState["project-order"], allPaths);
    collectPathStrings(globalState["thread-workspace-root-hints"], allPaths);
    collectPathStrings(globalState["active-workspace-roots"], allPaths);

    return [...allPaths]
      .sort((left, right) => projectLabel(left).localeCompare(projectLabel(right)))
      .map((projectPath) => ({
        id: stablePathId("cdp", projectPath),
        label: projectLabel(projectPath),
        path: projectPath,
        source: "codex-desktop" as const,
        active: activePaths.has(projectPath)
      }));
  }

  async listSessions(): Promise<CodexDesktopSession[]> {
    const codexHome = this.codexHome();
    const projects = await this.listProjects();
    const projectByPath = new Map(projects.map((project) => [normalizePathKey(project.path).toLowerCase(), project]));
    const globalState = await readJsonObject(path.join(codexHome, ".codex-global-state.json"));
    const threadHints = globalState?.["thread-workspace-root-hints"];
    const drafts = new Map<string, SessionDraft>();

    const putDraft = (candidate: SessionDraft) => {
      const existing = drafts.get(candidate.id);
      drafts.set(candidate.id, {
        ...existing,
        ...candidate,
        title: candidate.title ?? existing?.title,
        projectPath: candidate.projectPath ?? existing?.projectPath,
        updatedAt: candidate.updatedAt ?? existing?.updatedAt,
        archived: Boolean(existing?.archived || candidate.archived),
        unknown: Boolean(existing?.unknown || candidate.unknown)
      });
    };

    for (const record of await readJsonl(path.join(codexHome, "session_index.jsonl"))) {
      const id = safeString(record.id);
      if (!id) {
        continue;
      }

      let hintedProjectPath: string | undefined;
      if (threadHints && typeof threadHints === "object" && !Array.isArray(threadHints)) {
        const directHint = (threadHints as Record<string, unknown>)[id];
        const hintPath = safeString(directHint);
        if (hintPath && looksPathLike(hintPath)) {
          hintedProjectPath = normalizePathKey(hintPath);
        }
      }

      putDraft({
        id,
        title: sanitizeTitle(record.thread_name, `Codex Desktop ${id.slice(0, 8)}`),
        updatedAt: safeIso(record.updated_at),
        projectPath: hintedProjectPath
      });
    }

    for (const filePath of await collectJsonlFiles(path.join(codexHome, "sessions"), this.maxSessionFiles)) {
      const metadata = metadataFromSessionRecords(filePath, await readJsonl(filePath, 40), false);
      if (metadata) {
        putDraft(metadata);
      }
    }

    for (const filePath of await collectJsonlFiles(path.join(codexHome, "archived_sessions"), this.maxSessionFiles)) {
      const metadata = metadataFromSessionRecords(filePath, await readJsonl(filePath, 40), true);
      if (metadata) {
        putDraft(metadata);
      }
    }

    const capabilities = await this.controlCapabilities();

    return [...drafts.values()]
      .map((draft) => {
        const normalizedProjectPath = draft.projectPath ? normalizePathKey(draft.projectPath) : undefined;
        const project = normalizedProjectPath ? projectByPath.get(normalizedProjectPath.toLowerCase()) : undefined;
        const status: CodexDesktopSession["status"] = draft.archived
          ? "archived"
          : draft.unknown
            ? "unknown"
            : "recent";
        return this.decorateSession({
          id: draft.id,
          title: sanitizeTitle(draft.title, `Codex Desktop ${draft.id.slice(0, 8)}`),
          projectPath: normalizedProjectPath,
          projectId: project?.id,
          updatedAt: draft.updatedAt ?? new Date(0).toISOString(),
          status,
          source: "codex-desktop"
        }, capabilities);
      })
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  async getSession(sessionId: string): Promise<CodexDesktopSession | undefined> {
    return (await this.listSessions()).find((session) => session.id === sessionId);
  }

  async resumeSession(session: CodexDesktopSession): Promise<CodexDesktopControlResult> {
    if (!session.canResume) {
      throw new Error(session.unsupportedReason ?? this.unsupportedReason());
    }

    if (!this.controlContract.resumeSession) {
      throw new Error(this.unsupportedReason());
    }

    return this.controlContract.resumeSession(session);
  }

  async stopSession(session: CodexDesktopSession): Promise<CodexDesktopControlResult> {
    if (!session.canStop) {
      throw new Error(session.unsupportedReason ?? this.unsupportedReason());
    }

    if (!this.controlContract.stopSession) {
      throw new Error(this.unsupportedReason());
    }

    return this.controlContract.stopSession(session);
  }

  async createTask(input: CreateCodexDesktopTaskRequest): Promise<CodexDesktopControlResult> {
    if (!this.controlContract.supportsNewTask || !this.controlContract.createTask) {
      throw new Error(this.unsupportedReason());
    }

    return this.controlContract.createTask(input);
  }

  dispose(): void {
    this.controlContract.dispose?.();
  }
}

export const defaultCodexDesktopStateAdapter = new CodexDesktopStateAdapter();
