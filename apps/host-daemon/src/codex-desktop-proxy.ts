import type { IncomingMessage, Server, ServerResponse } from "node:http";

import type {
  CodexDesktopControlResult,
  CodexDesktopControlStatus,
  CodexDesktopProject,
  CodexDesktopSession,
  CodexDesktopSessionDetail,
  CreateCodexDesktopTaskRequest
} from "../../../packages/protocol/src/index.js";
import {
  CODEX_DESKTOP_APP_SERVER_UNAVAILABLE_REASON_CODE,
  CodexDesktopControlUnavailableError,
  CodexDesktopStateAdapter,
  createCodexDesktopAppServerControlContract
} from "../../../packages/runtime-adapters/src/index.js";
import {
  createJsonServer,
  createLogger,
  json,
  readJsonBody,
  readPort,
  route,
  type Logger
} from "../../../packages/shared/src/index.js";

export const DEFAULT_CODEX_DESKTOP_PROXY_HOST = "127.0.0.1";
export const DEFAULT_CODEX_DESKTOP_PROXY_PORT = 4318;

export interface CodexDesktopProxyOptions {
  env?: NodeJS.ProcessEnv;
  host?: string;
  port?: number;
  token?: string;
  adapter?: CodexDesktopStateAdapter;
  logger?: Logger;
}

class SerialMutationQueue {
  private tail: Promise<void> = Promise.resolve();

  async run<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.tail.catch(() => undefined);
    let releaseCurrent!: () => void;
    const current = new Promise<void>((resolve) => {
      releaseCurrent = resolve;
    });
    this.tail = previous.then(() => current);

    await previous;
    try {
      return await operation();
    } finally {
      releaseCurrent();
    }
  }
}

class CodexDesktopProxyHttpError extends Error {
  constructor(
    readonly statusCode: 400 | 404 | 409 | 502,
    message: string,
    readonly reasonCode: string
  ) {
    super(message);
    this.name = "CodexDesktopProxyHttpError";
  }
}

function isLoopbackBindHost(host: string): boolean {
  const normalized = host.trim().toLowerCase().replace(/^\[|\]$/gu, "");
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1";
}

function authorizationToken(req: IncomingMessage): string | undefined {
  const value = req.headers.authorization;
  if (typeof value !== "string") {
    return undefined;
  }

  const match = value.match(/^Bearer\s+(.+)$/iu);
  return match?.[1]?.trim();
}

function requireProxyAuth(req: IncomingMessage, res: ServerResponse, token: string | undefined): boolean {
  if (!token) {
    return true;
  }

  if (authorizationToken(req) === token) {
    return true;
  }

  res.setHeader("www-authenticate", "Bearer");
  json(res, 401, {
    error: "Codex Desktop host proxy token is required",
    source: "codex-desktop"
  });
  return false;
}

function proxyErrorStatus(error: unknown): 400 | 404 | 409 | 502 {
  if (error instanceof CodexDesktopProxyHttpError) {
    return error.statusCode;
  }

  return error instanceof CodexDesktopControlUnavailableError ? 409 : 502;
}

function proxyErrorPayload(error: unknown): {
  error: string;
  reason: string;
  reasonCode: string;
  source: "codex-desktop";
} {
  const message = error instanceof Error ? error.message : "Codex Desktop host proxy request failed.";
  return {
    error: message,
    reason: message,
    reasonCode: error instanceof CodexDesktopProxyHttpError
      ? error.reasonCode
      : error instanceof CodexDesktopControlUnavailableError
        ? CODEX_DESKTOP_APP_SERVER_UNAVAILABLE_REASON_CODE
        : "CODEX_DESKTOP_HOST_PROXY_FAILED",
    source: "codex-desktop"
  };
}

async function proxyJson<T>(res: ServerResponse, handler: () => Promise<T>): Promise<void> {
  try {
    json(res, 200, await handler());
  } catch (error) {
    json(res, proxyErrorStatus(error), proxyErrorPayload(error));
  }
}

function createDefaultCodexDesktopAdapter(env: NodeJS.ProcessEnv): CodexDesktopStateAdapter {
  const codexHome = env.CODEX_HOME;
  return new CodexDesktopStateAdapter({
    env,
    codexHome,
    controlContract: createCodexDesktopAppServerControlContract({
      env,
      codexHome
    })
  });
}

export function createCodexDesktopHostProxyServer(options: CodexDesktopProxyOptions = {}): Server {
  const env = options.env ?? process.env;
  const logger = options.logger ?? createLogger("codex-desktop-host-proxy");
  const token = (options.token ?? env.HAPPYTG_CODEX_DESKTOP_PROXY_TOKEN?.trim()) || undefined;
  const adapter = options.adapter ?? createDefaultCodexDesktopAdapter(env);
  const queue = new SerialMutationQueue();

  return createJsonServer(
    [
      route("GET", "/ready", async ({ res }) => {
        json(res, 200, {
          ok: true,
          service: "codex-desktop-host-proxy",
          authRequired: Boolean(token)
        });
      }),
      route("GET", "/api/v1/codex-desktop/projects", async ({ req, res }) => {
        if (!requireProxyAuth(req, res, token)) {
          return;
        }

        await proxyJson<{ projects: CodexDesktopProject[] }>(res, async () => ({
          projects: await adapter.listProjects()
        }));
      }),
      route("GET", "/api/v1/codex-desktop/control", async ({ req, res }) => {
        if (!requireProxyAuth(req, res, token)) {
          return;
        }

        await proxyJson<{ control: CodexDesktopControlStatus }>(res, async () => ({
          control: await adapter.controlStatus({ validateAvailability: true })
        }));
      }),
      route("GET", "/api/v1/codex-desktop/sessions", async ({ req, res, url }) => {
        if (!requireProxyAuth(req, res, token)) {
          return;
        }

        const rawLimit = Number(url.searchParams.get("limit"));
        const limit = Number.isInteger(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 500) : undefined;
        await proxyJson<{ sessions: CodexDesktopSession[] }>(res, async () => ({
          sessions: await adapter.listSessions({ limit })
        }));
      }),
      route("GET", "/api/v1/codex-desktop/sessions/:id", async ({ req, res, params }) => {
        if (!requireProxyAuth(req, res, token)) {
          return;
        }

        await proxyJson<CodexDesktopSessionDetail>(res, async () => {
          const detail = await adapter.getSessionDetail(params.id);
          if (!detail) {
            throw new CodexDesktopProxyHttpError(404, "Codex Desktop session not found", "CODEX_DESKTOP_SESSION_NOT_FOUND");
          }
          return detail;
        });
      }),
      route("POST", "/api/v1/codex-desktop/sessions/:id/resume", async ({ req, res, params }) => {
        if (!requireProxyAuth(req, res, token)) {
          return;
        }

        await proxyJson<CodexDesktopControlResult>(res, async () => queue.run(async () => {
          const session = await adapter.getSession(params.id);
          if (!session) {
            throw new CodexDesktopProxyHttpError(404, "Codex Desktop session not found", "CODEX_DESKTOP_SESSION_NOT_FOUND");
          }

          return adapter.resumeSession(session);
        }));
      }),
      route("POST", "/api/v1/codex-desktop/sessions/:id/stop", async ({ req, res, params }) => {
        if (!requireProxyAuth(req, res, token)) {
          return;
        }

        await proxyJson<CodexDesktopControlResult>(res, async () => queue.run(async () => {
          const session = await adapter.getSession(params.id);
          if (!session) {
            throw new CodexDesktopProxyHttpError(404, "Codex Desktop session not found", "CODEX_DESKTOP_SESSION_NOT_FOUND");
          }

          return adapter.stopSession(session);
        }));
      }),
      route("POST", "/api/v1/codex-desktop/tasks", async ({ req, res }) => {
        if (!requireProxyAuth(req, res, token)) {
          return;
        }

        const body = await readJsonBody<CreateCodexDesktopTaskRequest>(req);
        if (!body.prompt?.trim()) {
          json(res, 400, {
            error: "prompt is required",
            source: "codex-desktop"
          });
          return;
        }

        await proxyJson<CodexDesktopControlResult>(res, async () => queue.run(() => adapter.createTask(body)));
      })
    ],
    logger
  );
}

export async function startCodexDesktopHostProxy(options: CodexDesktopProxyOptions = {}): Promise<Server> {
  const env = options.env ?? process.env;
  const logger = options.logger ?? createLogger("codex-desktop-host-proxy");
  const host = (options.host ?? env.HAPPYTG_CODEX_DESKTOP_PROXY_HOST?.trim()) || DEFAULT_CODEX_DESKTOP_PROXY_HOST;
  const port = options.port ?? readPort(env, ["HAPPYTG_CODEX_DESKTOP_PROXY_PORT"], DEFAULT_CODEX_DESKTOP_PROXY_PORT);
  const token = (options.token ?? env.HAPPYTG_CODEX_DESKTOP_PROXY_TOKEN?.trim()) || undefined;

  if (!isLoopbackBindHost(host) && !token) {
    throw new Error("HAPPYTG_CODEX_DESKTOP_PROXY_TOKEN is required when HAPPYTG_CODEX_DESKTOP_PROXY_HOST is not loopback.");
  }

  const server = createCodexDesktopHostProxyServer({
    ...options,
    env,
    host,
    port,
    token,
    logger
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve();
    });
  });

  logger.info("Codex Desktop host proxy listening", {
    host,
    port,
    authRequired: Boolean(token)
  });
  return server;
}
