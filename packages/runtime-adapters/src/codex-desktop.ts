import { createHash } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import type {
  CodexDesktopControlResult,
  CodexDesktopControlStatus,
  CodexDesktopHistoryEntry,
  CodexDesktopProject,
  CodexDesktopSession,
  CodexDesktopSessionDetail,
  ContinueCodexDesktopSessionRequest,
  CreateCodexDesktopTaskRequest
} from "../../protocol/src/index.js";
import { normalizeSpawnEnv, resolveExecutable } from "../../shared/src/index.js";

export const CODEX_DESKTOP_CONTROL_UNSUPPORTED_REASON_CODE = "CODEX_DESKTOP_CONTROL_UNSUPPORTED";
export const CODEX_DESKTOP_APP_SERVER_UNAVAILABLE_REASON_CODE = "CODEX_DESKTOP_APP_SERVER_UNAVAILABLE";
export const CODEX_DESKTOP_HOST_PROXY_UNAVAILABLE_REASON_CODE = "CODEX_DESKTOP_HOST_PROXY_UNAVAILABLE";
export const CODEX_DESKTOP_HISTORY_UNAVAILABLE_REASON_CODE = "CODEX_DESKTOP_HISTORY_UNAVAILABLE";

const DEFAULT_UNSUPPORTED_REASON = "Codex Desktop control is unsupported because no stable Desktop/CLI/app-server contract was proven.";
const APP_SERVER_EXPERIMENTAL_REASON = "Codex Desktop app-server control remains disabled by default because the local Codex CLI marks app-server as experimental.";
const APP_SERVER_UNAVAILABLE_REASON = "Codex Desktop app-server control is unavailable. Start Codex Desktop or make `codex app-server` available on this host.";
const HOST_PROXY_UNAVAILABLE_REASON = "Codex Desktop host proxy is unavailable. Start `pnpm daemon:desktop-proxy` on the Windows host and verify Docker can reach `HAPPYTG_CODEX_DESKTOP_PROXY_URL`.";
const DEFAULT_MAX_SESSION_FILES = 500;
const DEFAULT_HISTORY_MAX_RECORDS = 80;
const DEFAULT_HISTORY_SUMMARY_MAX_CHARS = 320;
const DEFAULT_APP_SERVER_REQUEST_TIMEOUT_MS = 10_000;
const DEFAULT_HOST_PROXY_URL = "http://127.0.0.1:4318";
const DEFAULT_HOST_PROXY_REQUEST_TIMEOUT_MS = 10_000;
const DEFAULT_CONTROL_CAPABILITIES_TIMEOUT_MS = 2500;
const DEFAULT_CONTROL_CAPABILITIES_CACHE_MS = 8_000;
const DEFAULT_APP_SERVER_STDERR_MAX_BYTES = 8_192;
const SECRET_FIELD_RE = /(?:secret|token|password|passwd|credential|authorization|auth|api[_-]?key|private[_-]?key|access[_-]?token|refresh[_-]?token)/iu;
const SECRET_VALUE_RE = /\b(?:RAW_[A-Z0-9_]*SECRET[A-Z0-9_]*|sk-[A-Za-z0-9_-]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|gh[pousr]_[A-Za-z0-9_]{20,}|Bearer\s+[A-Za-z0-9._~-]+|(?:api[_-]?key|token|password|secret)\s*[:=]\s*\S+)/giu;
const HISTORY_TEXT_KEYS = new Set([
  "content",
  "text",
  "message",
  "summary",
  "preview",
  "title",
  "thread_name",
  "input",
  "output",
  "response",
  "reason",
  "error",
  "command"
]);
const HISTORY_CONTAINER_KEYS = new Set([
  "payload",
  "message",
  "messages",
  "item",
  "items",
  "data",
  "event",
  "turn",
  "response"
]);

interface CodexDesktopControlCapabilities {
  supportsResume: boolean;
  supportsContinue: boolean;
  supportsStop: boolean;
  supportsNewTask: boolean;
  unsupportedReason?: string;
  unsupportedReasonCode?: string;
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
  supportsContinue?: boolean;
  supportsStop?: boolean;
  supportsNewTask?: boolean;
  unsupportedReason?: string;
  unsupportedReasonCode?: string;
  capabilities?(): Promise<CodexDesktopControlCapabilities>;
  listProjects?(): Promise<CodexDesktopProject[]>;
  listSessions?(options?: { limit?: number }): Promise<CodexDesktopSession[]>;
  getSessionDetail?(session: CodexDesktopSession, options?: { maxRecords?: number }): Promise<CodexDesktopSessionDetail>;
  resumeSession?(session: CodexDesktopSession): Promise<CodexDesktopControlResult>;
  continueSession?(session: CodexDesktopSession, input: ContinueCodexDesktopSessionRequest): Promise<CodexDesktopControlResult>;
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
  maxHistoryRecords?: number;
  controlContract?: CodexDesktopControlContract;
  appServerCommand?: string;
  appServerArgs?: string[];
}

export interface CodexDesktopHostProxyControlContractOptions {
  baseUrl?: string;
  token?: string;
  fetchImpl?: typeof fetch;
  requestTimeoutMs?: number;
}

interface JsonlReadResult {
  records: Record<string, unknown>[];
  truncated: boolean;
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
  items?: Record<string, unknown>[];
  startedAt?: number | null;
  completedAt?: number | null;
  durationMs?: number | null;
  error?: unknown;
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

async function readJsonlBounded(filePath: string, maxLines: number): Promise<JsonlReadResult> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const lines = raw.split(/\r?\n/u).filter((line) => line.trim());
    const selected = lines.slice(0, maxLines);
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
    return {
      records,
      truncated: lines.length > selected.length
    };
  } catch {
    return {
      records: [],
      truncated: false
    };
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

function boundedText(value: string, maxChars = DEFAULT_HISTORY_SUMMARY_MAX_CHARS): string {
  const normalized = value.replace(/\s+/gu, " ").trim();
  return normalized.length <= maxChars ? normalized : `${normalized.slice(0, maxChars - 3)}...`;
}

function redactHistoryText(value: string): string {
  const redacted = value.replace(SECRET_VALUE_RE, "[redacted]");
  return boundedText(redacted);
}

function collectHistoryText(value: unknown, output: string[], keyPath: string[] = [], depth = 0): void {
  if (output.length >= 6 || depth > 5 || value === undefined || value === null) {
    return;
  }

  const key = keyPath.at(-1) ?? "";
  if (SECRET_FIELD_RE.test(key)) {
    output.push("[redacted]");
    return;
  }

  if (typeof value === "string") {
    if (HISTORY_TEXT_KEYS.has(key) || keyPath.length === 0) {
      const text = redactHistoryText(value);
      if (text) {
        output.push(text);
      }
    }
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value.slice(0, 12)) {
      collectHistoryText(item, output, keyPath, depth + 1);
    }
    return;
  }

  if (!value || typeof value !== "object") {
    return;
  }

  for (const [nestedKey, nestedValue] of Object.entries(value as Record<string, unknown>)) {
    if (output.length >= 6) {
      return;
    }
    if (SECRET_FIELD_RE.test(nestedKey)) {
      output.push("[redacted]");
      continue;
    }
    if (HISTORY_TEXT_KEYS.has(nestedKey) || HISTORY_CONTAINER_KEYS.has(nestedKey)) {
      collectHistoryText(nestedValue, output, [...keyPath, nestedKey], depth + 1);
    }
  }
}

function parsePositiveIntegerMs(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return Math.floor(parsed);
}

function objectValue(record: Record<string, unknown>, key: string): Record<string, unknown> | undefined {
  const value = record[key];
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function nestedString(record: Record<string, unknown>, key: string): string | undefined {
  const direct = safeString(record[key]);
  if (direct) {
    return direct;
  }

  const payload = objectValue(record, "payload");
  return payload ? safeString(payload[key]) : undefined;
}

function nestedIso(record: Record<string, unknown>, key: string): string | undefined {
  const direct = safeIso(record[key]);
  if (direct) {
    return direct;
  }

  const payload = objectValue(record, "payload");
  return payload ? safeIso(payload[key]) : undefined;
}

function historyRole(record: Record<string, unknown>): CodexDesktopHistoryEntry["role"] | undefined {
  const role = nestedString(record, "role")?.toLowerCase();
  if (role === "user" || role === "assistant" || role === "system" || role === "tool") {
    return role;
  }

  const raw = [
    nestedString(record, "type"),
    nestedString(record, "kind"),
    nestedString(record, "event")
  ].filter(Boolean).join(" ").toLowerCase();

  if (raw.includes("usermessage") || raw.includes("user_message") || raw.includes("user message")) {
    return "user";
  }
  if (
    raw.includes("agentmessage")
    || raw.includes("agent_message")
    || raw.includes("assistantmessage")
    || raw.includes("assistant_message")
    || raw.includes("assistant message")
  ) {
    return "assistant";
  }
  if (raw.includes("systemmessage") || raw.includes("system_message") || raw.includes("system message")) {
    return "system";
  }
  if (raw.includes("toolmessage") || raw.includes("tool_message") || raw.includes("tool message")) {
    return "tool";
  }

  return undefined;
}

function historyKind(record: Record<string, unknown>, role?: CodexDesktopHistoryEntry["role"]): CodexDesktopHistoryEntry["kind"] {
  if (record.parseError) {
    return "unknown";
  }

  const raw = [
    nestedString(record, "type"),
    nestedString(record, "kind"),
    nestedString(record, "event"),
    role
  ].filter(Boolean).join(" ").toLowerCase();

  if (role || raw.includes("message")) {
    return "message";
  }
  if (raw.includes("turn")) {
    return "turn";
  }
  if (raw.includes("event")) {
    return "event";
  }
  if (raw) {
    return "metadata";
  }
  return "unknown";
}

function historyOccurredAt(record: Record<string, unknown>, fallback: string): string {
  return nestedIso(record, "timestamp")
    ?? nestedIso(record, "created_at")
    ?? nestedIso(record, "createdAt")
    ?? nestedIso(record, "updated_at")
    ?? nestedIso(record, "updatedAt")
    ?? fallback;
}

function historySummary(record: Record<string, unknown>, kind: CodexDesktopHistoryEntry["kind"]): string {
  if (record.parseError) {
    return "Unreadable Codex Desktop JSONL record.";
  }

  const texts: string[] = [];
  collectHistoryText(record, texts);
  const unique = [...new Set(texts.filter(Boolean))];
  return unique.length > 0
    ? boundedText(unique.join(" "))
    : `Codex Desktop ${kind} record.`;
}

function historyEntryFromRecord(input: {
  filePath: string;
  record: Record<string, unknown>;
  sequence: number;
  fallbackOccurredAt: string;
}): CodexDesktopHistoryEntry {
  const role = historyRole(input.record);
  const kind = historyKind(input.record, role);
  const title = role ? `${role} ${kind}` : kind;
  return {
    id: `cdh_${createHash("sha256").update(`${input.filePath}:${input.sequence}`).digest("hex").slice(0, 16)}`,
    sequence: input.sequence,
    occurredAt: historyOccurredAt(input.record, input.fallbackOccurredAt),
    kind,
    ...(role ? { role } : {}),
    title,
    summary: historySummary(input.record, kind),
    source: "codex-desktop"
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

function appServerUnixSecondsToIso(value: unknown, fallback: string): string {
  return typeof value === "number" && Number.isFinite(value)
    ? new Date(value * 1000).toISOString()
    : fallback;
}

function appServerTurnOccurredAt(turn: AppServerTurn, fallback: string): string {
  return appServerUnixSecondsToIso(turn.completedAt ?? turn.startedAt, fallback);
}

function appServerHistoryFromThread(input: {
  thread: AppServerThread;
  fallbackOccurredAt: string;
  maxRecords: number;
}): { history: CodexDesktopHistoryEntry[]; historyTruncated: boolean } {
  const history: CodexDesktopHistoryEntry[] = [];
  let historyTruncated = false;

  for (const turn of input.thread.turns ?? []) {
    if (history.length >= input.maxRecords) {
      historyTruncated = true;
      break;
    }

    const occurredAt = appServerTurnOccurredAt(turn, input.fallbackOccurredAt);
    const items = Array.isArray(turn.items) ? turn.items : [];
    if (items.length === 0) {
      history.push({
        id: `cdh_${createHash("sha256").update(`app-server:${input.thread.id}:${turn.id}:turn`).digest("hex").slice(0, 16)}`,
        sequence: history.length + 1,
        occurredAt,
        kind: "turn",
        title: "turn",
        summary: `Codex Desktop turn ${turn.status}.`,
        source: "codex-desktop"
      });
      continue;
    }

    for (const item of items) {
      if (history.length >= input.maxRecords) {
        historyTruncated = true;
        break;
      }

      history.push(historyEntryFromRecord({
        filePath: `app-server:${input.thread.id}:${turn.id}`,
        record: item,
        sequence: history.length + 1,
        fallbackOccurredAt: occurredAt
      }));
    }
  }

  return { history, historyTruncated };
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
    canContinue: true,
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
    supportsContinue: true,
    supportsStop: true,
    supportsNewTask: true,
    unsupportedReason: APP_SERVER_UNAVAILABLE_REASON,
    unsupportedReasonCode: CODEX_DESKTOP_APP_SERVER_UNAVAILABLE_REASON_CODE,
    async capabilities() {
      try {
        await ensureAvailable();
        return {
          supportsResume: true,
          supportsContinue: true,
          supportsStop: true,
          supportsNewTask: true
        };
      } catch (error) {
        return {
          supportsResume: false,
          supportsContinue: false,
          supportsStop: false,
          supportsNewTask: false,
          unsupportedReason: error instanceof Error ? error.message : APP_SERVER_UNAVAILABLE_REASON,
          unsupportedReasonCode: CODEX_DESKTOP_APP_SERVER_UNAVAILABLE_REASON_CODE
        };
      }
    },
    async listSessions(options = {}) {
      const response = await client.request<AppServerThreadListResponse>("thread/list", {
        limit: Number.isInteger(options.limit) && options.limit && options.limit > 0 ? options.limit : 50,
        sourceKinds: [],
        useStateDbOnly: true
      });
      return response.data.map((thread) => toSession(thread));
    },
    async getSessionDetail(session, options = {}) {
      const response = await client.request<AppServerThreadResponse>("thread/read", {
        threadId: session.id,
        includeTurns: true
      });
      const resolvedSession = toSession(response.thread, session);
      const maxRecords = Number.isInteger(options.maxRecords) && options.maxRecords && options.maxRecords > 0
        ? options.maxRecords
        : DEFAULT_HISTORY_MAX_RECORDS;
      const { history, historyTruncated } = appServerHistoryFromThread({
        thread: response.thread,
        fallbackOccurredAt: resolvedSession.updatedAt,
        maxRecords
      });
      return {
        session: resolvedSession,
        history,
        historyTruncated
      };
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
    async continueSession(session, input) {
      const turn = await client.request<AppServerTurnStartResponse>("turn/start", {
        threadId: session.id,
        input: [
          {
            type: "text",
            text: input.prompt,
            text_elements: []
          }
        ],
        cwd: session.projectPath ?? null,
        approvalPolicy
      });
      return {
        ok: true,
        action: "continue",
        source: "codex-desktop",
        session: {
          ...session,
          updatedAt: new Date().toISOString(),
          status: turn.turn.status === "inProgress" ? "active" : "recent",
          canResume: true,
          canContinue: true,
          canStop: true,
          canCreateTask: true,
          unsupportedReason: undefined,
          unsupportedReasonCode: undefined
        }
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
          canContinue: true,
          canStop: true,
          canCreateTask: true,
          unsupportedReason: undefined,
          unsupportedReasonCode: undefined
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

function hostProxyUrl(pathname: string, baseUrl: string): URL {
  const normalizedBaseUrl = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return new URL(pathname.replace(/^\//u, ""), normalizedBaseUrl);
}

function headerRecord(headers: HeadersInit | undefined): Record<string, string> {
  if (!headers) {
    return {};
  }

  if (headers instanceof Headers) {
    const output: Record<string, string> = {};
    headers.forEach((value, key) => {
      output[key] = value;
    });
    return output;
  }

  if (Array.isArray(headers)) {
    return Object.fromEntries(headers);
  }

  return headers;
}

function hostProxyErrorMessage(status: number, payload: unknown, fallback: string): string {
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    const record = payload as Record<string, unknown>;
    const reason = safeString(record.reason) ?? safeString(record.error) ?? safeString(record.detail);
    if (reason) {
      return reason;
    }
  }

  if (typeof payload === "string" && payload.trim()) {
    return payload.trim();
  }

  return `${fallback} (${status}).`;
}

export function createCodexDesktopHostProxyControlContract(options: CodexDesktopHostProxyControlContractOptions = {}): CodexDesktopControlContract {
  const baseUrl = options.baseUrl?.trim() || process.env.HAPPYTG_CODEX_DESKTOP_PROXY_URL?.trim() || DEFAULT_HOST_PROXY_URL;
  const token = options.token ?? process.env.HAPPYTG_CODEX_DESKTOP_PROXY_TOKEN;
  const fetchImpl = options.fetchImpl ?? fetch;
  const requestTimeoutMs = options.requestTimeoutMs
    ?? Number(process.env.HAPPYTG_CODEX_DESKTOP_PROXY_TIMEOUT_MS ?? DEFAULT_HOST_PROXY_REQUEST_TIMEOUT_MS);

  async function request<T>(pathname: string, init: RequestInit = {}): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), requestTimeoutMs);
    const headers = {
      accept: "application/json",
      ...headerRecord(init.headers),
      ...(token ? { authorization: `Bearer ${token}` } : {})
    };

    try {
      const response = await fetchImpl(hostProxyUrl(pathname, baseUrl), {
        ...init,
        headers,
        signal: controller.signal
      });
      const text = await response.text();
      const payload = text
        ? (() => {
            try {
              return JSON.parse(text) as unknown;
            } catch {
              return text;
            }
          })()
        : undefined;

      if (!response.ok) {
        throw new CodexDesktopControlUnavailableError(hostProxyErrorMessage(response.status, payload, `Codex Desktop host proxy request ${pathname} failed`));
      }

      return payload as T;
    } catch (error) {
      if (error instanceof CodexDesktopControlUnavailableError) {
        throw error;
      }

      const message = error instanceof Error && error.name === "AbortError"
        ? `Codex Desktop host proxy request ${pathname} timed out.`
        : error instanceof Error
          ? error.message
          : HOST_PROXY_UNAVAILABLE_REASON;
      throw new CodexDesktopControlUnavailableError(message);
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    supportsResume: true,
    supportsContinue: true,
    supportsStop: true,
    supportsNewTask: true,
    unsupportedReason: HOST_PROXY_UNAVAILABLE_REASON,
    unsupportedReasonCode: CODEX_DESKTOP_HOST_PROXY_UNAVAILABLE_REASON_CODE,
    async capabilities() {
      try {
        const response = await request<{ control: CodexDesktopControlStatus }>("/api/v1/codex-desktop/control");
        return {
          supportsResume: response.control.canResume,
          supportsContinue: Boolean(response.control.canContinue),
          supportsStop: response.control.canStop,
          supportsNewTask: response.control.canCreateTask,
          unsupportedReason: response.control.unsupportedReason,
          unsupportedReasonCode: response.control.unsupportedReasonCode
        };
      } catch (error) {
        return {
          supportsResume: false,
          supportsContinue: false,
          supportsStop: false,
          supportsNewTask: false,
          unsupportedReason: error instanceof Error ? error.message : HOST_PROXY_UNAVAILABLE_REASON,
          unsupportedReasonCode: CODEX_DESKTOP_HOST_PROXY_UNAVAILABLE_REASON_CODE
        };
      }
    },
    async listProjects() {
      const response = await request<{ projects: CodexDesktopProject[] }>("/api/v1/codex-desktop/projects");
      return response.projects;
    },
    async listSessions(options = {}) {
      const params = Number.isInteger(options.limit) && options.limit && options.limit > 0
        ? `?limit=${encodeURIComponent(String(options.limit))}`
        : "";
      const response = await request<{ sessions: CodexDesktopSession[] }>(`/api/v1/codex-desktop/sessions${params}`);
      return response.sessions;
    },
    async getSessionDetail(session) {
      return request<CodexDesktopSessionDetail>(`/api/v1/codex-desktop/sessions/${encodeURIComponent(session.id)}`);
    },
    async resumeSession(session) {
      return request<CodexDesktopControlResult>(`/api/v1/codex-desktop/sessions/${encodeURIComponent(session.id)}/resume`, {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: "{}"
      });
    },
    async continueSession(session, input) {
      return request<CodexDesktopControlResult>(`/api/v1/codex-desktop/sessions/${encodeURIComponent(session.id)}/continue`, {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify(input)
      });
    },
    async stopSession(session) {
      return request<CodexDesktopControlResult>(`/api/v1/codex-desktop/sessions/${encodeURIComponent(session.id)}/stop`, {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: "{}"
      });
    },
    async createTask(input) {
      return request<CodexDesktopControlResult>("/api/v1/codex-desktop/tasks", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify(input)
      });
    }
  };
}

function defaultControlContract(options: CodexDesktopStateAdapterOptions, codexHome: string): CodexDesktopControlContract {
  const env = options.env ?? process.env;
  const mode = env.HAPPYTG_CODEX_DESKTOP_CONTROL?.trim().toLowerCase();
  if (mode === "app-server") {
    return createCodexDesktopAppServerControlContract({
      env,
      codexHome
    });
  }
  if (mode === "host-proxy") {
    return createCodexDesktopHostProxyControlContract({
      baseUrl: env.HAPPYTG_CODEX_DESKTOP_PROXY_URL,
      token: env.HAPPYTG_CODEX_DESKTOP_PROXY_TOKEN,
      requestTimeoutMs: Number(env.HAPPYTG_CODEX_DESKTOP_PROXY_TIMEOUT_MS ?? DEFAULT_HOST_PROXY_REQUEST_TIMEOUT_MS)
    });
  }

  const reason = mode && mode !== "off" && mode !== "unsupported" && mode !== "false"
    ? `${DEFAULT_UNSUPPORTED_REASON} ${APP_SERVER_EXPERIMENTAL_REASON}`
    : DEFAULT_UNSUPPORTED_REASON;
  return {
    unsupportedReason: reason,
    unsupportedReasonCode: CODEX_DESKTOP_CONTROL_UNSUPPORTED_REASON_CODE
  };
}

export class CodexDesktopStateAdapter {
  private readonly env: NodeJS.ProcessEnv;
  private readonly maxSessionFiles: number;
  private readonly maxHistoryRecords: number;
  private readonly controlCapabilitiesTimeoutMs: number;
  private readonly controlCapabilitiesCacheMs: number;
  private readonly controlContract: CodexDesktopControlContract;
  private readonly recentControlSessions = new Map<string, CodexDesktopSession>();
  private readonly recentControlHistory = new Map<string, CodexDesktopHistoryEntry[]>();
  private controlCapabilitiesCache?: {
    expiresAt: number;
    capabilities: CodexDesktopControlCapabilities;
  };
  private controlCapabilitiesInFlight?: Promise<CodexDesktopControlCapabilities>;

  constructor(private readonly options: CodexDesktopStateAdapterOptions = {}) {
    this.env = options.env ?? process.env;
    this.maxSessionFiles = options.maxSessionFiles ?? Number(this.env.HAPPYTG_CODEX_DESKTOP_MAX_SESSION_FILES ?? DEFAULT_MAX_SESSION_FILES);
    this.maxHistoryRecords = options.maxHistoryRecords ?? Number(this.env.HAPPYTG_CODEX_DESKTOP_MAX_HISTORY_RECORDS ?? DEFAULT_HISTORY_MAX_RECORDS);
    this.controlCapabilitiesTimeoutMs = parsePositiveIntegerMs(this.env.HAPPYTG_CODEX_DESKTOP_CONTROL_CAPABILITIES_TIMEOUT_MS, DEFAULT_CONTROL_CAPABILITIES_TIMEOUT_MS);
    this.controlCapabilitiesCacheMs = parsePositiveIntegerMs(this.env.HAPPYTG_CODEX_DESKTOP_CONTROL_CAPABILITIES_TTL_MS, DEFAULT_CONTROL_CAPABILITIES_CACHE_MS);
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

  private unsupportedReasonCode(): string {
    return this.controlContract.unsupportedReasonCode ?? CODEX_DESKTOP_CONTROL_UNSUPPORTED_REASON_CODE;
  }

  canCreateTask(): boolean {
    return Boolean(this.controlContract.supportsNewTask && this.controlContract.createTask);
  }

  controlUnsupportedReason(): string {
    return this.unsupportedReason();
  }

  controlUnsupportedReasonCode(): string {
    return this.unsupportedReasonCode();
  }

  private async controlCapabilities(): Promise<CodexDesktopControlCapabilities> {
    const now = Date.now();
    if (this.controlCapabilitiesCache && this.controlCapabilitiesCache.expiresAt > now) {
      return this.controlCapabilitiesCache.capabilities;
    }

    if (this.controlCapabilitiesInFlight) {
      return this.controlCapabilitiesInFlight;
    }

    this.controlCapabilitiesInFlight = (async () => {
      try {
        const capabilities = this.controlContract.capabilities
          ? await this.withControlTimeout(this.controlContract.capabilities())
          : {
            supportsResume: Boolean(this.controlContract.supportsResume && this.controlContract.resumeSession),
            supportsContinue: Boolean(this.controlContract.supportsContinue && this.controlContract.continueSession),
            supportsStop: Boolean(this.controlContract.supportsStop && this.controlContract.stopSession),
            supportsNewTask: Boolean(this.controlContract.supportsNewTask && this.controlContract.createTask),
            unsupportedReason: this.unsupportedReason(),
            unsupportedReasonCode: this.unsupportedReasonCode()
          };
        this.controlCapabilitiesCache = {
          expiresAt: Date.now() + this.controlCapabilitiesCacheMs,
          capabilities
        };
        return capabilities;
      } catch (error) {
        const fallback = {
          supportsResume: false,
          supportsContinue: false,
          supportsStop: false,
          supportsNewTask: false,
          unsupportedReason: error instanceof Error ? error.message : this.unsupportedReason(),
          unsupportedReasonCode: this.unsupportedReasonCode()
        };
        this.controlCapabilitiesCache = {
          expiresAt: Date.now() + this.controlCapabilitiesCacheMs,
          capabilities: fallback
        };
        return fallback;
      } finally {
        this.controlCapabilitiesInFlight = undefined;
      }
    })();

    return this.controlCapabilitiesInFlight;
  }

  private decorateSession(session: Omit<CodexDesktopSession, "canResume" | "canContinue" | "canStop" | "canCreateTask" | "unsupportedReason" | "unsupportedReasonCode">, capabilities: CodexDesktopControlCapabilities): CodexDesktopSession {
    const canResume = Boolean(capabilities.supportsResume && this.controlContract.resumeSession);
    const canContinue = Boolean(capabilities.supportsContinue && this.controlContract.continueSession);
    const canStop = Boolean(capabilities.supportsStop && this.controlContract.stopSession);
    const canCreateTask = Boolean(capabilities.supportsNewTask && this.controlContract.createTask);
    const unsupportedReason = canResume && canContinue && canStop && canCreateTask ? undefined : this.unsupportedReason();
    return {
      ...session,
      canResume,
      canContinue,
      canStop,
      canCreateTask,
      ...(unsupportedReason ? {
        unsupportedReason: capabilities.unsupportedReason ?? unsupportedReason,
        unsupportedReasonCode: capabilities.unsupportedReasonCode ?? this.unsupportedReasonCode()
      } : {})
    };
  }

  private async withControlTimeout<T>(promise: Promise<T>): Promise<T> {
    return await new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new CodexDesktopControlUnavailableError(`Codex Desktop control request timed out after ${this.controlCapabilitiesTimeoutMs}ms.`));
      }, this.controlCapabilitiesTimeoutMs);

      promise.then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (error) => {
          clearTimeout(timer);
          reject(error);
        }
      );
    });
  }

  async listProjects(): Promise<CodexDesktopProject[]> {
    if (this.controlContract.listProjects) {
      try {
        return await this.withControlTimeout(this.controlContract.listProjects());
      } catch {
        // Local Codex Desktop state remains useful when a host proxy is temporarily unavailable.
      }
    }

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

  async controlStatus(options: { validateAvailability?: boolean } = {}): Promise<CodexDesktopControlStatus> {
    const capabilities = options.validateAvailability === false
      ? {
          supportsResume: Boolean(this.controlContract.supportsResume && this.controlContract.resumeSession),
          supportsContinue: Boolean(this.controlContract.supportsContinue && this.controlContract.continueSession),
          supportsStop: Boolean(this.controlContract.supportsStop && this.controlContract.stopSession),
          supportsNewTask: Boolean(this.controlContract.supportsNewTask && this.controlContract.createTask),
          unsupportedReason: this.unsupportedReason(),
          unsupportedReasonCode: this.unsupportedReasonCode()
      }
      : await this.controlCapabilities();
    const canResume = Boolean(capabilities.supportsResume && this.controlContract.resumeSession);
    const canContinue = Boolean(capabilities.supportsContinue && this.controlContract.continueSession);
    const canStop = Boolean(capabilities.supportsStop && this.controlContract.stopSession);
    const canCreateTask = Boolean(capabilities.supportsNewTask && this.controlContract.createTask);
    const unsupportedReason = canResume && canContinue && canStop && canCreateTask
      ? undefined
      : capabilities.unsupportedReason ?? this.unsupportedReason();

    return {
      canResume,
      canContinue,
      canStop,
      canCreateTask,
      ...(unsupportedReason ? {
        unsupportedReason,
        unsupportedReasonCode: capabilities.unsupportedReasonCode ?? this.unsupportedReasonCode()
      } : {})
    };
  }

  private rememberControlSession(session: CodexDesktopSession): void {
    this.recentControlSessions.set(session.id, session);
    if (this.recentControlSessions.size <= 100) {
      return;
    }

    const oldest = this.recentControlSessions.keys().next().value as string | undefined;
    if (oldest) {
      this.recentControlSessions.delete(oldest);
    }
  }

  private sessionFromCreatedTask(input: CreateCodexDesktopTaskRequest, result: CodexDesktopControlResult): CodexDesktopSession | undefined {
    const id = result.session?.id ?? result.task?.id;
    if (!id) {
      return undefined;
    }

    return {
      id,
      title: sanitizeTitle(result.task?.title ?? input.title ?? result.session?.title ?? input.prompt, `Codex Desktop ${id.slice(0, 8)}`),
      projectPath: result.session?.projectPath ?? result.task?.projectPath ?? input.projectPath,
      projectId: result.session?.projectId ?? result.task?.projectId ?? input.projectId,
      updatedAt: result.session?.updatedAt ?? new Date().toISOString(),
      status: result.session?.status ?? (result.task?.status === "running" ? "active" : "recent"),
      source: "codex-desktop",
      canResume: result.session?.canResume ?? true,
      canContinue: result.session?.canContinue ?? true,
      canStop: result.session?.canStop ?? true,
      canCreateTask: result.session?.canCreateTask ?? true,
      unsupportedReason: result.session?.unsupportedReason,
      unsupportedReasonCode: result.session?.unsupportedReasonCode
    };
  }

  private historyFromCreatedTask(input: CreateCodexDesktopTaskRequest, result: CodexDesktopControlResult, session: CodexDesktopSession): CodexDesktopHistoryEntry[] {
    const taskStatus = result.task?.status ?? "created";
    return [
      {
        id: `cdh_${createHash("sha256").update(`created:${session.id}:prompt`).digest("hex").slice(0, 16)}`,
        sequence: 1,
        occurredAt: session.updatedAt,
        kind: "message",
        role: "user",
        title: "user message",
        summary: redactHistoryText(input.prompt),
        source: "codex-desktop"
      },
      {
        id: `cdh_${createHash("sha256").update(`created:${session.id}:task`).digest("hex").slice(0, 16)}`,
        sequence: 2,
        occurredAt: session.updatedAt,
        kind: "turn",
        title: "turn",
        summary: `Codex Desktop task ${taskStatus}.`,
        source: "codex-desktop"
      }
    ];
  }

  async listSessions(options: { limit?: number } = {}): Promise<CodexDesktopSession[]> {
    const codexHome = this.codexHome();
    const maxSessionFiles = Number.isInteger(options.limit) && options.limit && options.limit > 0
      ? Math.min(options.limit, this.maxSessionFiles)
      : this.maxSessionFiles;
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

    for (const filePath of await collectJsonlFiles(path.join(codexHome, "sessions"), maxSessionFiles)) {
      const metadata = metadataFromSessionRecords(filePath, await readJsonl(filePath, 40), false);
      if (metadata) {
        putDraft(metadata);
      }
    }

    for (const filePath of await collectJsonlFiles(path.join(codexHome, "archived_sessions"), maxSessionFiles)) {
      const metadata = metadataFromSessionRecords(filePath, await readJsonl(filePath, 40), true);
      if (metadata) {
        putDraft(metadata);
      }
    }

    const capabilities = await this.controlCapabilities();
    const sessionsById = new Map<string, CodexDesktopSession>();
    const projectSession = (session: Omit<CodexDesktopSession, "canResume" | "canStop" | "canCreateTask" | "unsupportedReason" | "unsupportedReasonCode">): CodexDesktopSession => {
      const normalizedProjectPath = session.projectPath ? normalizePathKey(session.projectPath) : undefined;
      const project = normalizedProjectPath ? projectByPath.get(normalizedProjectPath.toLowerCase()) : undefined;
      return this.decorateSession({
        ...session,
        projectPath: normalizedProjectPath,
        projectId: session.projectId ?? project?.id
      }, capabilities);
    };

    for (const draft of drafts.values()) {
        const status: CodexDesktopSession["status"] = draft.archived
          ? "archived"
          : draft.unknown
            ? "unknown"
            : "recent";
        const session = projectSession({
          id: draft.id,
          title: sanitizeTitle(draft.title, `Codex Desktop ${draft.id.slice(0, 8)}`),
          projectPath: draft.projectPath,
          updatedAt: draft.updatedAt ?? new Date(0).toISOString(),
          status,
          source: "codex-desktop"
        });
        sessionsById.set(session.id, session);
    }

    for (const session of this.recentControlSessions.values()) {
      sessionsById.set(session.id, projectSession({
        id: session.id,
        title: session.title,
        projectPath: session.projectPath,
        projectId: session.projectId,
        updatedAt: session.updatedAt,
        status: session.status,
        source: "codex-desktop"
      }));
    }

    if (this.controlContract.listSessions && (capabilities.supportsResume || capabilities.supportsContinue || capabilities.supportsStop || capabilities.supportsNewTask)) {
      try {
        const appServerSessions = await this.withControlTimeout(this.controlContract.listSessions({ limit: maxSessionFiles }));
        for (const session of appServerSessions) {
          sessionsById.set(session.id, projectSession({
            id: session.id,
            title: session.title,
            projectPath: session.projectPath,
            projectId: session.projectId,
            updatedAt: session.updatedAt,
            status: session.status,
            source: "codex-desktop"
          }));
        }
      } catch {
        // File-backed projections remain useful even when app-server listing is temporarily unavailable.
      }
    }

    return [...sessionsById.values()]
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .slice(0, options.limit);
  }

  async getSession(sessionId: string): Promise<CodexDesktopSession | undefined> {
    const cached = this.recentControlSessions.get(sessionId);
    if (cached) {
      return cached;
    }

    const recent = (await this.listSessions({ limit: 50 })).find((session) => session.id === sessionId);
    if (recent || this.maxSessionFiles <= 50) {
      return recent;
    }

    return (await this.listSessions()).find((session) => session.id === sessionId);
  }

  private async sessionJsonlFiles(sessionId: string): Promise<string[]> {
    const codexHome = this.codexHome();
    const sessionFiles = await collectJsonlFiles(path.join(codexHome, "sessions"), this.maxSessionFiles);
    const archivedFiles = await collectJsonlFiles(path.join(codexHome, "archived_sessions"), this.maxSessionFiles);
    const files = [...sessionFiles, ...archivedFiles];
    const directMatches = files.filter((filePath) => extractFileSessionId(filePath) === sessionId);
    if (directMatches.length > 0) {
      return directMatches;
    }

    const matches: string[] = [];
    for (const filePath of files) {
      const archived = filePath.includes(`${path.sep}archived_sessions${path.sep}`);
      const metadata = metadataFromSessionRecords(filePath, await readJsonl(filePath, 40), archived);
      if (metadata?.id === sessionId) {
        matches.push(filePath);
      }
    }
    return matches;
  }

  async getSessionDetail(sessionId: string): Promise<CodexDesktopSessionDetail | undefined> {
    const session = await this.getSession(sessionId);
    if (!session) {
      return undefined;
    }

    const maxRecords = Number.isInteger(this.maxHistoryRecords) && this.maxHistoryRecords > 0
      ? this.maxHistoryRecords
      : DEFAULT_HISTORY_MAX_RECORDS;
    const recentHistory = this.recentControlHistory.get(sessionId);
    if (recentHistory) {
      return {
        session,
        history: recentHistory.slice(0, maxRecords),
        historyTruncated: recentHistory.length > maxRecords
      };
    }

    const files = this.recentControlSessions.has(sessionId) ? [] : await this.sessionJsonlFiles(sessionId);
    const history: CodexDesktopHistoryEntry[] = [];
    let historyTruncated = false;

    for (const filePath of files) {
      if (history.length >= maxRecords) {
        historyTruncated = true;
        break;
      }

      const remaining = maxRecords - history.length;
      const result = await readJsonlBounded(filePath, remaining);
      historyTruncated = historyTruncated || result.truncated;
      for (const record of result.records) {
        history.push(historyEntryFromRecord({
          filePath,
          record,
          sequence: history.length + 1,
          fallbackOccurredAt: session.updatedAt
        }));
      }
    }

    if (this.controlContract.getSessionDetail) {
      try {
        const appServerDetail = await this.withControlTimeout(this.controlContract.getSessionDetail(session, { maxRecords }));
        if (appServerDetail.history.length > 0 || files.length === 0) {
          return {
            session: appServerDetail.session,
            history: appServerDetail.history,
            historyTruncated: appServerDetail.historyTruncated
          };
        }
      } catch {
        // JSONL and recent in-memory projections remain usable when app-server history is unavailable.
      }
    }

    return {
      session,
      history,
      historyTruncated,
      ...(files.length === 0 ? {
        historyUnsupportedReason: "No Codex Desktop JSONL history file was found for this session.",
        historyUnsupportedReasonCode: CODEX_DESKTOP_HISTORY_UNAVAILABLE_REASON_CODE
      } : {})
    };
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

  async continueSession(session: CodexDesktopSession, input: ContinueCodexDesktopSessionRequest): Promise<CodexDesktopControlResult> {
    if (!(session.canContinue ?? session.canResume)) {
      throw new Error(session.unsupportedReason ?? this.unsupportedReason());
    }

    if (!this.controlContract.continueSession) {
      throw new Error(this.unsupportedReason());
    }

    const result = await this.controlContract.continueSession(session, input);
    if (result.session) {
      this.rememberControlSession(result.session);
    }
    return result;
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

    const result = await this.controlContract.createTask(input);
    const session = this.sessionFromCreatedTask(input, result);
    if (!session) {
      return result;
    }

    this.rememberControlSession(session);
    this.recentControlHistory.set(session.id, this.historyFromCreatedTask(input, result, session));
    return {
      ...result,
      session
    };
  }

  dispose(): void {
    this.controlContract.dispose?.();
  }
}

export const defaultCodexDesktopStateAdapter = new CodexDesktopStateAdapter();
