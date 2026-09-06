import express from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { makeMcp } from "./mcp.js";
import type { CourseService } from "../../../packages/domain/src/service.js";
import {
  inputs,
  type ToolName,
} from "../../../packages/contracts/src/index.js";
import { resolve } from "node:path";

export function createApp(
  service: CourseService,
  options: { requestsPerMinute?: number; origins?: string[] } = {},
) {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", false);
  const clients = new Map<string, { count: number; reset: number }>();
  let global = { count: 0, reset: Date.now() + 60000 };
  app.use((req, res, next) => {
    const host = req.hostname;
    if (!["127.0.0.1", "localhost", "[::1]"].includes(host))
      return void res
        .status(403)
        .json({
          error: {
            code: "FORBIDDEN",
            message: "Local development service only.",
          },
        });
    const origin = req.headers.origin;
    const allowed = [`http://${req.headers.host}`, ...(options.origins ?? [])];
    if (origin && !allowed.includes(origin))
      return void res
        .status(403)
        .json({
          error: { code: "FORBIDDEN", message: "Origin is not allowed." },
        });
    if (origin) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
    }
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, Accept, MCP-Protocol-Version, MCP-Session-Id",
    );
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "no-store");
    if (req.method === "OPTIONS") return void res.status(204).end();
    if (req.path === "/health" || req.path.startsWith("/app")) return next();
    const now = Date.now();
    if (global.reset <= now) global = { count: 0, reset: now + 60000 };
    for (const [key, value] of clients)
      if (value.reset <= now) clients.delete(key);
    const key = req.ip ?? "unknown",
      quota = clients.get(key) ?? { count: 0, reset: now + 60000 };
    clients.set(key, quota);
    if (
      ++quota.count > (options.requestsPerMinute ?? 120) ||
      ++global.count > 6000
    ) {
      res.setHeader("Retry-After", "60");
      return void res
        .status(429)
        .json({
          error: {
            code: "RATE_LIMITED",
            message: "Request limit exceeded.",
            retry_after_seconds: 60,
          },
        });
    }
    next();
  });
  app.use(express.json({ limit: "64kb", strict: true }));
  app.get("/health", (_req, res) =>
    res.json({
      status: "ok",
      mode: "local-development",
      metrics: service.metrics,
    }),
  );
  app.post("/api/tools/:name", async (req, res) => {
    const name = req.params.name;
    if (!Object.hasOwn(inputs, name))
      return void res
        .status(404)
        .json({ error: { code: "NOT_FOUND", message: "Unknown tool." } });
    const result = await service.call(name as ToolName, req.body);
    res.status("error" in result ? 400 : 200).json(result);
  });
  app.post("/mcp", async (req, res) => {
    const server = makeMcp(service),
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch {
      if (!res.headersSent)
        res
          .status(500)
          .json({
            jsonrpc: "2.0",
            id: null,
            error: { code: -32603, message: "MCP request failed." },
          });
    }
  });
  app.all("/mcp", (_req, res) =>
    res.status(405).setHeader("Allow", "POST").end(),
  );
  app.use(
    "/app",
    express.static(resolve("apps/extension/build"), { index: "index.html" }),
  );
  app.use(
    (
      error: { type?: string },
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      res
        .status(error.type === "entity.too.large" ? 413 : 400)
        .json({
          error: {
            code: "INVALID_INPUT",
            message: "Request body is invalid or too large.",
          },
        });
    },
  );
  return app;
}
