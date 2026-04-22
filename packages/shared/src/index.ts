import { randomUUID } from "node:crypto";
import { constants as fsConstants, existsSync, promises as fs, readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { isIP } from "node:net";
import os from "node:os";
import path from "node:path";

import { createEmptyStore, type AuditRecord, type HappyTGStore, type SessionEvent } from "../../protocol/src/index.js";

export function createId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 24)}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

function isWindowsPathLike(value: string): boolean {
  return /^[A-Za-z]:([\\/]|$)/u.test(value) || value.startsWith("\\\\") || value.includes("\\");
}

function envKeyFor(
  env: NodeJS.ProcessEnv,
  key: string
): string | undefined {
  if (env[key] !== undefined) {
    return key;
  }

  return Object.keys(env).find((candidate) => candidate.toLowerCase() === key.toLowerCase());
}

function envValue(
  env: NodeJS.ProcessEnv,
  key: string
): string | undefined {
  const resolvedKey = envKeyFor(env, key);
  return resolvedKey ? env[resolvedKey] : undefined;
}

function envValues(
  env: NodeJS.ProcessEnv,
  key: string
): string[] {
  return Object.entries(env)
    .filter(([candidate, value]) => value !== undefined && candidate.toLowerCase() === key.toLowerCase())
    .map(([, value]) => value as string);
}

function pathModuleForHome(
  homeDirectory: string,
  platform: NodeJS.Platform = process.platform
): typeof path.win32 | typeof path.posix {
  if (platform !== "win32") {
    return path.posix;
  }

  return isWindowsPathLike(homeDirectory) ? path.win32 : path.posix;
}

function effectiveHomeDirectory(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform
): string {
  const homeOverride = stripWrappedQuotes(envValue(env, "HOME") ?? "").trim();
  if (homeOverride) {
    return homeOverride;
  }

  if (platform === "win32") {
    const userProfile = stripWrappedQuotes(envValue(env, "USERPROFILE") ?? "").trim();
    if (userProfile) {
      return userProfile;
    }

    const homeDrive = stripWrappedQuotes(envValue(env, "HOMEDRIVE") ?? "").trim();
    const homePath = stripWrappedQuotes(envValue(env, "HOMEPATH") ?? "").trim();
    if (homeDrive && homePath) {
      return path.win32.join(homeDrive, homePath);
    }
  }

  return os.homedir() || process.cwd();
}

export function resolveHome(
  inputPath: string,
  options?: {
    env?: NodeJS.ProcessEnv;
    platform?: NodeJS.Platform;
  }
): string {
  if (!inputPath.startsWith("~")) {
    return inputPath;
  }

  const homeDirectory = effectiveHomeDirectory(options?.env, options?.platform);
  if (inputPath === "~") {
    return homeDirectory;
  }

  if (inputPath.startsWith("~/") || inputPath.startsWith("~\\")) {
    const pathModule = pathModuleForHome(homeDirectory, options?.platform);
    return pathModule.join(homeDirectory, inputPath.slice(2));
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

export function getLocalStateDir(
  env = process.env,
  platform: NodeJS.Platform = process.platform
): string {
  if (env.HAPPYTG_STATE_DIR) {
    return resolveHome(env.HAPPYTG_STATE_DIR, { env, platform });
  }

  const homeDirectory = effectiveHomeDirectory(env, platform);
  return pathModuleForHome(homeDirectory, platform).join(homeDirectory, ".happytg");
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
    return envValue(env, "PATH") ?? "";
  }

  const delimiter = pathDelimiterForPlatform(platform);
  const seen = new Set<string>();
  const mergedEntries: string[] = [];
  for (const rawValue of envValues(env, "Path")) {
    for (const entry of rawValue.split(delimiter)) {
      const normalizedEntry = stripWrappedQuotes(entry.trim());
      if (!normalizedEntry) {
        continue;
      }

      const dedupeKey = normalizedEntry.toLowerCase();
      if (seen.has(dedupeKey)) {
        continue;
      }

      seen.add(dedupeKey);
      mergedEntries.push(normalizedEntry);
    }
  }

  return mergedEntries.join(delimiter);
}

function envPathExtValue(env: NodeJS.ProcessEnv): string {
  const seen = new Set<string>();
  const mergedEntries: string[] = [];
  for (const rawValue of envValues(env, "PATHEXT")) {
    for (const entry of rawValue.split(";")) {
      const normalizedEntry = entry.trim();
      if (!normalizedEntry) {
        continue;
      }

      const extension = normalizedEntry.startsWith(".")
        ? normalizedEntry
        : `.${normalizedEntry}`;
      const dedupeKey = extension.toLowerCase();
      if (seen.has(dedupeKey)) {
        continue;
      }

      seen.add(dedupeKey);
      mergedEntries.push(extension);
    }
  }

  return mergedEntries.join(";");
}

function pathDelimiterForPlatform(platform: NodeJS.Platform): string {
  return platform === "win32" ? ";" : path.delimiter;
}

function executableExtensions(env: NodeJS.ProcessEnv, platform: NodeJS.Platform = process.platform, command = ""): string[] {
  if (platform !== "win32" || path.extname(command)) {
    return [""];
  }

  const raw = envPathExtValue(env) || ".COM;.EXE;.BAT;.CMD";
  const extensions = raw
    .split(";")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => entry.startsWith(".") ? entry.toLowerCase() : `.${entry.toLowerCase()}`);

  return [...extensions, ""];
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
  const hasExplicitPath = path.isAbsolute(normalized)
    || (platform === "win32" && path.win32.isAbsolute(normalized))
    || normalized.includes("/")
    || normalized.includes("\\");
  const searchRoots = hasExplicitPath
    ? [path.isAbsolute(normalized) ? normalized : path.resolve(cwd, normalized)]
    : envPathValue(env, platform)
      .split(pathDelimiterForPlatform(platform))
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

function unescapeQuotedEnvValue(value: string): string {
  return value
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r")
    .replace(/\\t/g, "\t")
    .replace(/\\"/g, "\"")
    .replace(/\\\\/g, "\\");
}

export function parseDotEnv(source: string): Record<string, string> {
  const values: Record<string, string> = {};

  for (const rawLine of source.split(/\r?\n/u)) {
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const withoutExport = trimmed.startsWith("export ") ? trimmed.slice("export ".length).trim() : trimmed;
    const separatorIndex = withoutExport.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }

    const key = withoutExport.slice(0, separatorIndex).trim();
    if (!key) {
      continue;
    }

    let value = withoutExport.slice(separatorIndex + 1).trim();
    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
      value = unescapeQuotedEnvValue(value.slice(1, -1));
    } else {
      value = value.replace(/\s+#.*$/u, "").trim();
    }

    values[key] = value;
  }

  return values;
}

export function findUpwardFile(startDir: string, fileName: string): string | undefined {
  let currentDir = path.resolve(startDir);

  while (true) {
    const candidate = path.join(currentDir, fileName);
    if (existsSync(candidate)) {
      return candidate;
    }

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      return undefined;
    }
    currentDir = parentDir;
  }
}

export function loadHappyTGEnv(options?: {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  envFilePath?: string;
}): {
  envFilePath?: string;
  loadedKeys: string[];
} {
  const env = options?.env ?? process.env;
  const envFilePath = options?.envFilePath ?? findUpwardFile(options?.cwd ?? process.cwd(), ".env");

  if (!envFilePath || !existsSync(envFilePath)) {
    return {
      envFilePath,
      loadedKeys: []
    };
  }

  const parsed = parseDotEnv(readFileSync(envFilePath, "utf8"));
  const loadedKeys: string[] = [];
  for (const [key, value] of Object.entries(parsed)) {
    if (env[key] !== undefined) {
      continue;
    }

    env[key] = value;
    loadedKeys.push(key);
  }

  return {
    envFilePath,
    loadedKeys
  };
}

export function normalizeSpawnEnv(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform
): NodeJS.ProcessEnv {
  if (platform !== "win32") {
    return {
      ...env
    };
  }

  const normalized: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(env)) {
    const lowered = key.toLowerCase();
    if (lowered === "path" || lowered === "pathext") {
      continue;
    }

    normalized[key] = value;
  }

  const resolvedPath = envPathValue(env, platform);
  if (resolvedPath) {
    normalized.Path = resolvedPath;
  }

  const resolvedPathext = envPathExtValue(env) || executableExtensions(env, platform)
    .filter(Boolean)
    .join(";");
  if (resolvedPathext) {
    normalized.PATHEXT = resolvedPathext;
  }

  return normalized;
}

export type TelegramTokenStatus = "missing" | "placeholder" | "invalid" | "configured";

export function telegramTokenStatus(
  env: NodeJS.ProcessEnv = process.env
): {
  status: TelegramTokenStatus;
  configured: boolean;
} {
  const token = (envValue(env, "TELEGRAM_BOT_TOKEN") ?? "").trim();
  if (!token) {
    return {
      status: "missing",
      configured: false
    };
  }

  if (["replace-me", "changeme", "<token>"].includes(token.toLowerCase())) {
    return {
      status: "placeholder",
      configured: false
    };
  }

  if (!/^\d+:[A-Za-z0-9_-]{20,}$/u.test(token)) {
    return {
      status: "invalid",
      configured: false
    };
  }

  return {
    status: "configured",
    configured: true
  };
}

export interface MiniAppBaseUrlOptions {
  fallbackUrl?: string;
}

export function resolveMiniAppBaseUrl(
  env: NodeJS.ProcessEnv = process.env,
  options: MiniAppBaseUrlOptions = {}
): string | undefined {
  const publicUrlBase = env.HAPPYTG_PUBLIC_URL?.trim();
  let publicUrl: string | undefined;
  if (publicUrlBase) {
    try {
      publicUrl = new URL("/miniapp", publicUrlBase).toString();
    } catch {
      publicUrl = publicUrlBase;
    }
  }

  const candidates = [
    env.HAPPYTG_MINIAPP_URL?.trim() || undefined,
    publicUrl,
    env.HAPPYTG_APP_URL?.trim() || undefined,
    options.fallbackUrl
  ].filter((value): value is string => Boolean(value));

  return candidates.find((candidate) => validatePublicHttpsUrl(candidate).ok) ?? candidates[0];
}

export interface PublicHttpsUrlValidationResult {
  ok: boolean;
  url?: string;
  reason?: string;
}

function ipv4Octets(hostname: string): number[] | undefined {
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/u.test(hostname)) {
    return undefined;
  }

  const octets = hostname.split(".").map((item) => Number.parseInt(item, 10));
  return octets.every((item) => Number.isInteger(item) && item >= 0 && item <= 255) ? octets : undefined;
}

function isPrivateIpv4(hostname: string): boolean {
  const octets = ipv4Octets(hostname);
  if (!octets) {
    return false;
  }

  const [a = 0, b = 0] = octets;
  return a === 0
    || a === 10
    || a === 127
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || (a === 198 && (b === 18 || b === 19));
}

function isPrivateIpv6(hostname: string): boolean {
  const normalized = hostname.replace(/^\[|\]$/gu, "").toLowerCase();
  return normalized === "::"
    || normalized === "::1"
    || normalized.startsWith("fc")
    || normalized.startsWith("fd")
    || normalized.startsWith("fe80:");
}

function isInternalHostname(hostname: string): boolean {
  const normalized = hostname.replace(/^\[|\]$/gu, "").toLowerCase();
  const ipVersion = isIP(normalized);
  if (ipVersion !== 0) {
    return false;
  }

  return normalized === "localhost"
    || normalized === "0.0.0.0"
    || normalized.endsWith(".localhost")
    || normalized.endsWith(".local")
    || normalized.endsWith(".internal")
    || normalized.endsWith(".lan")
    || normalized.endsWith(".home")
    || !normalized.includes(".");
}

export function validatePublicHttpsUrl(rawValue: string | undefined, label = "URL"): PublicHttpsUrlValidationResult {
  const trimmed = rawValue?.trim();
  if (!trimmed) {
    return {
      ok: false,
      reason: `${label} is missing.`
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return {
      ok: false,
      reason: `${label} is not a valid URL.`
    };
  }

  if (parsed.protocol !== "https:") {
    return {
      ok: false,
      url: parsed.toString(),
      reason: `${label} must use HTTPS.`
    };
  }

  if (parsed.username || parsed.password) {
    return {
      ok: false,
      url: parsed.toString(),
      reason: `${label} must not include username or password credentials.`
    };
  }

  const hostname = parsed.hostname.replace(/^\[|\]$/gu, "").toLowerCase();
  const ipVersion = isIP(hostname);
  if (isInternalHostname(hostname) || (ipVersion === 4 && isPrivateIpv4(hostname)) || (ipVersion === 6 && isPrivateIpv6(hostname))) {
    return {
      ok: false,
      url: parsed.toString(),
      reason: `${label} points at a loopback, private, or internal host.`
    };
  }

  return {
    ok: true,
    url: parsed.toString()
  };
}

export function readPort(
  env: NodeJS.ProcessEnv,
  keys: string[],
  fallback: number
): number {
  for (const key of keys) {
    const rawValue = env[key];
    if (!rawValue) {
      continue;
    }

    const parsed = Number(rawValue);
    if (Number.isInteger(parsed) && parsed > 0 && parsed <= 65_535) {
      return parsed;
    }
  }

  return fallback;
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

const SECRET_FIELD_PATTERN = /(token|secret|password|authorization|api[_-]?key|signing[_-]?key|refresh|access[_-]?token|private[_-]?key)/iu;

export function redactSecrets(value: unknown, keyHint = "", depth = 0): unknown {
  if (depth > 8) {
    return "[REDACTED:MAX_DEPTH]";
  }

  if (SECRET_FIELD_PATTERN.test(keyHint)) {
    return value === undefined ? undefined : "[REDACTED]";
  }

  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value !== "object") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactSecrets(item, keyHint, depth + 1));
  }

  const output: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    output[key] = redactSecrets(nested, key, depth + 1);
  }
  return output;
}

export function createLogger(scope: string): Logger {
  const write = (level: "INFO" | "WARN" | "ERROR", message: string, metadata?: unknown) => {
    const line = {
      at: nowIso(),
      level,
      scope,
      message,
      ...(metadata ? { metadata: redactSecrets(metadata) } : {})
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

export function html(res: ServerResponse, statusCode: number, value: string): void {
  res.statusCode = statusCode;
  res.setHeader("content-type", "text/html; charset=utf-8");
  res.end(value);
}

export interface CorsOptions {
  allowedOrigins: string[];
  allowedMethods?: string[];
  allowedHeaders?: string[];
  allowCredentials?: boolean;
  maxAgeSeconds?: number;
}

export function parseCorsOriginList(value: string | undefined): string[] {
  return [...new Set((value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0 && item !== "*"))];
}

export function createDevCorsOptions(env: NodeJS.ProcessEnv = process.env): CorsOptions | undefined {
  if (env.NODE_ENV === "production") {
    return undefined;
  }

  const allowedOrigins = parseCorsOriginList(env.HAPPYTG_DEV_CORS_ORIGINS);
  if (allowedOrigins.length === 0) {
    return undefined;
  }

  return {
    allowedOrigins,
    allowedMethods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["content-type", "authorization"],
    allowCredentials: false,
    maxAgeSeconds: 600
  };
}

export function renderPrometheusMetrics(service: string, startedAt = Date.now() - Math.round(process.uptime() * 1000)): string {
  const uptimeSeconds = Math.max(0, Math.round((Date.now() - startedAt) / 1000));
  const memory = process.memoryUsage();
  const serviceLabel = service.replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
  return [
    "# HELP happytg_service_up Whether the HappyTG service process is running.",
    "# TYPE happytg_service_up gauge",
    `happytg_service_up{service="${serviceLabel}"} 1`,
    "# HELP happytg_service_uptime_seconds Process uptime in seconds.",
    "# TYPE happytg_service_uptime_seconds gauge",
    `happytg_service_uptime_seconds{service="${serviceLabel}"} ${uptimeSeconds}`,
    "# HELP happytg_nodejs_memory_rss_bytes Node.js RSS memory in bytes.",
    "# TYPE happytg_nodejs_memory_rss_bytes gauge",
    `happytg_nodejs_memory_rss_bytes{service="${serviceLabel}"} ${memory.rss}`,
    ""
  ].join("\n");
}

function setCorsHeaders(req: IncomingMessage, res: ServerResponse, options?: CorsOptions): boolean {
  if (!options) {
    return false;
  }

  const origin = req.headers.origin;
  if (typeof origin !== "string") {
    return false;
  }

  res.setHeader("vary", "Origin");
  if (!options.allowedOrigins.includes(origin)) {
    return false;
  }

  res.setHeader("access-control-allow-origin", origin);
  res.setHeader("access-control-allow-methods", (options.allowedMethods ?? ["GET", "POST", "OPTIONS"]).join(", "));
  res.setHeader("access-control-allow-headers", (options.allowedHeaders ?? ["content-type", "authorization"]).join(", "));
  if (options.allowCredentials) {
    res.setHeader("access-control-allow-credentials", "true");
  }
  if (options.maxAgeSeconds !== undefined) {
    res.setHeader("access-control-max-age", String(options.maxAgeSeconds));
  }

  return true;
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

export function createJsonServer(routes: RouteDefinition[], logger: Logger, options?: { cors?: CorsOptions }) {
  return createServer(async (req, res) => {
    try {
      if (!req.url || !req.method) {
        json(res, 400, { error: "Bad request" });
        return;
      }

      const corsAllowed = setCorsHeaders(req, res, options?.cors);
      if (req.method.toUpperCase() === "OPTIONS") {
        if (!options?.cors) {
          json(res, 404, { error: "Not found", path: req.url });
          return;
        }

        if (!corsAllowed) {
          json(res, 403, { error: "CORS origin is not allowed" });
          return;
        }

        res.statusCode = 204;
        res.end();
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
