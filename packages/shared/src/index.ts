import { randomUUID } from "node:crypto";
import { constants as fsConstants, promises as fs } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import os from "node:os";
import path from "node:path";

import { createEmptyStore, type AuditRecord, type HappyTGStore, type SessionEvent } from "../../protocol/src/index.js";

export function createId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 24)}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function resolveHome(inputPath: string): string {
  if (inputPath.startsWith("~/")) {
    return path.join(os.homedir(), inputPath.slice(2));
  }

  if (inputPath === "~") {
    return os.homedir();
  }

  return inputPath;
}

export function getRepoRoot(cwd = process.cwd()): string {
  return cwd;
}

export function getDataDir(env = process.env): string {
  return resolveHome(env.HAPPYTG_DATA_DIR ?? path.join(getRepoRoot(), ".happytg-dev"));
}

export function getControlPlaneStorePath(env = process.env): string {
  return path.join(getDataDir(env), "control-plane.json");
}

export function getLocalStateDir(env = process.env): string {
  return resolveHome(env.HAPPYTG_STATE_DIR ?? path.join(os.homedir(), ".happytg"));
}

export async function ensureDir(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true });
}

export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function stripWrappedQuotes(value: string): string {
  if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }

  return value;
}

function envPathValue(env: NodeJS.ProcessEnv, platform: NodeJS.Platform = process.platform): string {
  if (platform !== "win32") {
    return env.PATH ?? "";
  }

  const pathKey = Object.keys(env).find((key) => key.toLowerCase() === "path");
  return pathKey ? env[pathKey] ?? "" : "";
}

function executableExtensions(env: NodeJS.ProcessEnv, platform: NodeJS.Platform = process.platform, command = ""): string[] {
  if (platform !== "win32" || path.extname(command)) {
    return [""];
  }

  const raw = env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD";
  const extensions = raw
    .split(";")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => entry.startsWith(".") ? entry.toLowerCase() : `.${entry.toLowerCase()}`);

  return ["", ...extensions];
}

async function isExecutableFile(filePath: string, platform: NodeJS.Platform = process.platform): Promise<boolean> {
  try {
    await fs.access(filePath, platform === "win32" ? fsConstants.F_OK : fsConstants.X_OK);
    return (await fs.stat(filePath)).isFile();
  } catch {
    return false;
  }
}

export async function resolveExecutable(command: string, options?: {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
}): Promise<string | undefined> {
  const normalized = stripWrappedQuotes(command).trim();
  if (!normalized) {
    return undefined;
  }

  const env = options?.env ?? process.env;
  const platform = options?.platform ?? process.platform;
  const cwd = options?.cwd ?? process.cwd();
  const hasExplicitPath = path.isAbsolute(normalized) || normalized.includes("/") || normalized.includes("\\");
  const searchRoots = hasExplicitPath
    ? [path.isAbsolute(normalized) ? normalized : path.resolve(cwd, normalized)]
    : envPathValue(env, platform)
      .split(path.delimiter)
      .map((entry) => stripWrappedQuotes(entry.trim()))
      .filter(Boolean)
      .map((entry) => path.join(entry, normalized));

  for (const root of searchRoots) {
    for (const extension of executableExtensions(env, platform, normalized)) {
      const candidate = extension && !root.toLowerCase().endsWith(extension) ? `${root}${extension}` : root;
      if (await isExecutableFile(candidate, platform)) {
        return candidate;
      }
    }
  }

  return undefined;
}

export async function findExecutable(command: string, env = process.env, platform: NodeJS.Platform = process.platform): Promise<string | undefined> {
  return resolveExecutable(command, { env, platform });
}

export async function findExecutableOnPath(command: string, env = process.env, cwd = process.cwd()): Promise<string | undefined> {
  return resolveExecutable(command, { env, cwd });
}

export async function readJsonFile<T>(filePath: string, fallback: T): Promise<T> {
  if (!(await fileExists(filePath))) {
    return fallback;
  }

  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw) as T;
}

export async function writeJsonFileAtomic(filePath: string, value: unknown): Promise<void> {
  await ensureDir(path.dirname(filePath));
  const tempPath = `${filePath}.tmp`;
  await fs.writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await fs.rename(tempPath, filePath);
}

export async function writeTextFileAtomic(filePath: string, value: string): Promise<void> {
  await ensureDir(path.dirname(filePath));
  const tempPath = `${filePath}.tmp`;
  await fs.writeFile(tempPath, value, "utf8");
  await fs.rename(tempPath, filePath);
}

export async function readTextFileOrEmpty(filePath: string): Promise<string> {
  if (!(await fileExists(filePath))) {
    return "";
  }

  return fs.readFile(filePath, "utf8");
}

export function expandEnvBoolean(value: string | undefined, fallback = false): boolean {
  if (!value) {
    return fallback;
  }

  return value === "1" || value.toLowerCase() === "true" || value.toLowerCase() === "yes";
}

export interface Logger {
  info(message: string, metadata?: unknown): void;
  warn(message: string, metadata?: unknown): void;
  error(message: string, metadata?: unknown): void;
}

export function createLogger(scope: string): Logger {
  const write = (level: "INFO" | "WARN" | "ERROR", message: string, metadata?: unknown) => {
    const line = {
      at: nowIso(),
      level,
      scope,
      message,
      ...(metadata ? { metadata } : {})
    };
    console.log(JSON.stringify(line));
  };

  return {
    info: (message, metadata) => write("INFO", message, metadata),
    warn: (message, metadata) => write("WARN", message, metadata),
    error: (message, metadata) => write("ERROR", message, metadata)
  };
}

export class FileStateStore {
  private readonly filePath: string;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(filePath = getControlPlaneStorePath()) {
    this.filePath = filePath;
  }

  async read(): Promise<HappyTGStore> {
    return readJsonFile(this.filePath, createEmptyStore());
  }

  async write(store: HappyTGStore): Promise<void> {
    await writeJsonFileAtomic(this.filePath, store);
  }

  async update<T>(mutator: (store: HappyTGStore) => Promise<T> | T): Promise<T> {
    const operation = this.queue.then(async () => {
      const store = await this.read();
      const result = await mutator(store);
      await this.write(store);
      return result;
    });

    this.queue = operation.then(
      () => undefined,
      () => undefined
    );

    return operation;
  }

  async appendSessionEvent(event: SessionEvent): Promise<void> {
    await this.update((store) => {
      store.sessionEvents.push(event);
    });
  }

  async appendAudit(record: AuditRecord): Promise<void> {
    await this.update((store) => {
      store.auditRecords.push(record);
    });
  }
}

type RouteHandler = (context: RouteContext) => Promise<void> | void;

interface RouteDefinition {
  method: string;
  pattern: RegExp;
  paramNames: string[];
  handler: RouteHandler;
}

export interface RouteContext {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  params: Record<string, string>;
}

export function route(method: string, routePath: string, handler: RouteHandler): RouteDefinition {
  const paramNames: string[] = [];
  const patternSource = routePath
    .split("/")
    .map((segment) => {
      if (segment.startsWith(":")) {
        paramNames.push(segment.slice(1));
        return "([^/]+)";
      }

      return segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    })
    .join("/");

  return {
    method: method.toUpperCase(),
    pattern: new RegExp(`^${patternSource}$`),
    paramNames,
    handler
  };
}

export function json<T>(res: ServerResponse, statusCode: number, value: T): void {
  res.statusCode = statusCode;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(`${JSON.stringify(value, null, 2)}\n`);
}

export function text(res: ServerResponse, statusCode: number, value: string): void {
  res.statusCode = statusCode;
  res.setHeader("content-type", "text/plain; charset=utf-8");
  res.end(value);
}

export async function readJsonBody<T>(req: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) {
    return {} as T;
  }

  return JSON.parse(raw) as T;
}

export function createJsonServer(routes: RouteDefinition[], logger: Logger) {
  return createServer(async (req, res) => {
    try {
      if (!req.url || !req.method) {
        json(res, 400, { error: "Bad request" });
        return;
      }

      const url = new URL(req.url, "http://localhost");
      const method = req.method.toUpperCase();
      const routeMatch = routes.find((candidate) => {
        if (candidate.method !== method) {
          return false;
        }

        return candidate.pattern.test(url.pathname);
      });

      if (!routeMatch) {
        json(res, 404, { error: "Not found", path: url.pathname });
        return;
      }

      const match = routeMatch.pattern.exec(url.pathname);
      const params: Record<string, string> = {};
      if (match) {
        routeMatch.paramNames.forEach((name, index) => {
          params[name] = decodeURIComponent(match[index + 1]);
        });
      }

      await routeMatch.handler({ req, res, url, params });
    } catch (error) {
      const serialized = error instanceof Error ? { message: error.message, stack: error.stack } : { error };
      logger.error("Unhandled HTTP error", serialized);
      json(res, 500, {
        error: "Internal server error",
        detail: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });
}

export function parseJsonQuery(url: URL, key: string): string | undefined {
  return url.searchParams.get(key) ?? undefined;
}

export function assertNever(value: never): never {
  throw new Error(`Unexpected value: ${String(value)}`);
}
