import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { configuredStore } from "../../../packages/db/src/config.js";
import { CourseService } from "../../../packages/domain/src/service.js";
import { makeMcp } from "./mcp.js";
// Use PostgreSQL for simultaneous HTTP + stdio processes, or a separate embedded database.
const store = await configuredStore(),
  server = makeMcp(new CourseService(store));
await server.connect(new StdioServerTransport());
async function stop() {
  await server.close();
  await store.db.close();
}
process.once("SIGINT", () => {
  void stop();
});
process.once("SIGTERM", () => {
  void stop();
});
