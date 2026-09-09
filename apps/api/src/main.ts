import {
  configuredStore,
  configuredSource,
} from "../../../packages/db/src/config.js";
import { CourseService } from "../../../packages/domain/src/service.js";
import { createApp } from "./http.js";
import { AlertService } from "../../../packages/domain/src/alerts.js";
import { startMailPilot } from "./mail-runtime.js";
import { mailConfig } from "./mail-config.js";
import { runOneJob } from "../../worker/src/ingest.js";
import {
  runScheduledRefresh,
  scheduledPolicy,
} from "../../worker/src/schedule.js";
const refreshPolicy = scheduledPolicy();
const host = process.env.HOST ?? "127.0.0.1";
if (host !== "127.0.0.1")
  throw new Error(
    "This prototype is local-only. Production OAuth and deployment review are required before changing the bind address.",
  );
const port = Number(process.env.PORT ?? 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error("Invalid port");
const mail = mailConfig();
const store = await configuredStore(),
  source = configuredSource(store);
const courses = new CourseService(store);
const alerts = new AlertService(courses, {
  domain: mail?.domain,
  pilot: process.env.ALERTS_PILOT_ENABLED === "true",
});
const stopMail = startMailPilot(alerts, mail);
const app = createApp(courses, {
  alerts,
  origins: (process.env.EXTENSION_ORIGINS ?? "").split(",").filter(Boolean),
});
const server = app.listen(port, host, () =>
  console.log(`USC API: http://${host}:${port} | MCP: /mcp | Calendar: /app/`),
);
server.requestTimeout = 15000;
server.headersTimeout = 10000;
let busy = false;
const timer = !process.env.DATABASE_URL
  ? setInterval(async () => {
      if (busy) return;
      busy = true;
      try {
        await runScheduledRefresh(store, source, refreshPolicy);
        await runOneJob(store, source);
      } catch (e) {
        console.error(e instanceof Error ? e.message : "Refresh failed");
      } finally {
        busy = false;
      }
    }, 2000)
  : undefined;
async function shutdown() {
  if (timer) clearInterval(timer);
  server.close();
  await stopMail();
  while (busy) await new Promise((r) => setTimeout(r, 100));
  await store.db.close();
}
process.once("SIGINT", () => {
  void shutdown();
});
process.once("SIGTERM", () => {
  void shutdown();
});
