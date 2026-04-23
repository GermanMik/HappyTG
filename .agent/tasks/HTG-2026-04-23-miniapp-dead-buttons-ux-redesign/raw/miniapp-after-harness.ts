import { createServer, request as httpRequest } from "node:http";
import type { AddressInfo, IncomingMessage, ServerResponse } from "node:http";

import { createMiniAppServer } from "../../../../apps/miniapp/src/index.ts";

const authPayload = JSON.stringify({
  appSession: {
    token: "mas_browser_after",
    expiresAt: "2030-01-01T00:00:00.000Z"
  }
});

function proxyToMiniApp(req: IncomingMessage, res: ServerResponse, miniAppPort: number): void {
  const incomingUrl = new URL(req.url ?? "/", "http://127.0.0.1:3310");
  const upstreamPath = `${incomingUrl.pathname.replace(/^\/miniapp/u, "") || "/"}${incomingUrl.search}`;
  const upstream = httpRequest({
    hostname: "127.0.0.1",
    port: miniAppPort,
    path: upstreamPath,
    method: req.method,
    headers: {
      ...req.headers,
      host: "127.0.0.1",
      "x-forwarded-prefix": "/miniapp",
      "x-forwarded-proto": "https",
      "x-forwarded-host": "happytg.gerta.crazedns.ru"
    }
  }, (upstreamRes) => {
    res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers);
    upstreamRes.pipe(res);
  });

  upstream.on("error", (error) => {
    res.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
    res.end(`proxy error: ${error instanceof Error ? error.message : String(error)}`);
  });

  req.pipe(upstream);
}

async function main(): Promise<void> {
  const miniAppServer = createMiniAppServer({
    async fetchJson() {
      return { ok: true } as never;
    }
  });

  await new Promise<void>((resolve) => miniAppServer.listen(0, resolve));
  const miniAppPort = (miniAppServer.address() as AddressInfo).port;

  const publicServer = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1:3310");

    if (url.pathname === "/api/v1/miniapp/auth/session" && req.method === "POST") {
      res.writeHead(200, {
        "content-type": "application/json; charset=utf-8"
      });
      res.end(authPayload);
      return;
    }

    if (url.pathname.startsWith("/miniapp")) {
      proxyToMiniApp(req, res, miniAppPort);
      return;
    }

    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("not found");
  });

  await new Promise<void>((resolve) => publicServer.listen(3310, "127.0.0.1", resolve));
  console.log("HARNESS_READY http://127.0.0.1:3310/miniapp");

  function closeAll(): void {
    publicServer.close(() => {
      miniAppServer.close(() => {
        process.exit(0);
      });
    });
  }

  process.on("SIGINT", closeAll);
  process.on("SIGTERM", closeAll);
}

void main();
