import { afterAll, beforeAll, expect, it } from "vitest";
import { createApp } from "../apps/api/src/http.js";
import { CourseService } from "../packages/domain/src/service.js";
import { testStore } from "./database.js";
import { McpCourseTools } from "../apps/companion/src/course-tools.js";
let tools: McpCourseTools;
let close: () => Promise<void>;
beforeAll(async () => {
  const store = await testStore();
  const server = createApp(new CourseService(store)).listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("No server address");
  tools = new McpCourseTools(`http://127.0.0.1:${address.port}/mcp`);
  close = async () => {
    await tools.close();
    await new Promise<void>((r) => server.close(() => r()));
    await store.db.close();
  };
});
afterAll(async () => {
  await close?.();
});
it("discovers real MCP tools, exports Codex schemas and retains freshness metadata", async () => {
  const definitions = (await tools.definitions()) as {
    type: string;
    name: string;
    inputSchema: unknown;
  }[];
  expect(definitions).toHaveLength(7);
  expect(definitions.every((d) => d.type === "function" && d.inputSchema)).toBe(
    true,
  );
  expect(definitions.map((d) => d.name)).toContain("present_schedule");
  const value = await tools.call("list_terms", {});
  expect(value).toMatchObject({
    data: [],
    meta: { coverage_status: "ingested_terms_only" },
  });
});
it("rejects source redirects/remote endpoints, unknown tools and malformed arguments", async () => {
  expect(() => new McpCourseTools("https://evil.test/mcp")).toThrow();
  expect(
    () => new McpCourseTools("http://user:secret@127.0.0.1:3000/mcp"),
  ).toThrow();
  await expect(tools.call("register_courses", {})).rejects.toThrow(
    "Unsupported",
  );
  await expect(tools.call("get_courses", { term_code: 1 })).rejects.toThrow(
    "Invalid",
  );
});
