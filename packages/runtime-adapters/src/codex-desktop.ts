import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import type {
  CodexDesktopControlResult,
  CodexDesktopProject,
  CodexDesktopSession,
  CreateCodexDesktopTaskRequest
} from "../../protocol/src/index.js";

const DEFAULT_UNSUPPORTED_REASON = "Codex Desktop control is unsupported because no stable Desktop/CLI/app-server contract was proven.";
const DEFAULT_MAX_SESSION_FILES = 500;

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
  resumeSession?(session: CodexDesktopSession): Promise<CodexDesktopControlResult>;
  stopSession?(session: CodexDesktopSession): Promise<CodexDesktopControlResult>;
  createTask?(input: CreateCodexDesktopTaskRequest): Promise<CodexDesktopControlResult>;
}

export interface CodexDesktopStateAdapterOptions {
  codexHome?: string;
  env?: NodeJS.ProcessEnv;
  maxSessionFiles?: number;
  controlContract?: CodexDesktopControlContract;
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

export class CodexDesktopStateAdapter {
  private readonly env: NodeJS.ProcessEnv;
  private readonly maxSessionFiles: number;
  private readonly controlContract: CodexDesktopControlContract;

  constructor(private readonly options: CodexDesktopStateAdapterOptions = {}) {
    this.env = options.env ?? process.env;
    this.maxSessionFiles = options.maxSessionFiles ?? Number(this.env.HAPPYTG_CODEX_DESKTOP_MAX_SESSION_FILES ?? DEFAULT_MAX_SESSION_FILES);
    this.controlContract = options.controlContract ?? {};
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

  private decorateSession(session: Omit<CodexDesktopSession, "canResume" | "canStop" | "canCreateTask" | "unsupportedReason">): CodexDesktopSession {
    const canResume = Boolean(this.controlContract.supportsResume && this.controlContract.resumeSession);
    const canStop = Boolean(this.controlContract.supportsStop && this.controlContract.stopSession);
    const canCreateTask = Boolean(this.controlContract.supportsNewTask && this.controlContract.createTask);
    const unsupportedReason = canResume && canStop && canCreateTask ? undefined : this.unsupportedReason();
    return {
      ...session,
      canResume,
      canStop,
      canCreateTask,
      ...(unsupportedReason ? { unsupportedReason } : {})
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
        });
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
}

export const defaultCodexDesktopStateAdapter = new CodexDesktopStateAdapter();
