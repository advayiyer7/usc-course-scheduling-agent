import { testStore } from "./database.js";
import { it, expect, beforeAll, afterAll } from "vitest";
import { Store } from "../packages/db/src/index.js";
import { CourseService } from "../packages/domain/src/service.js";
import { createApp } from "../apps/api/src/http.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { programs, response, course, sourceSection } from "./fixtures.js";
import type { Server } from "node:http";
import {
  validationReview,
  clearanceGuidance,
  sectionClearance,
} from "../packages/contracts/src/review.js";
let store: Store,
  service: CourseService,
  server: Server,
  base: string,
  version: string;
beforeAll(async () => {
  store = await testStore();
  version = (
    await store.publish(20263, programs, [
      response([
        course(),
        course("TEST200", [sourceSection("10002", "12:00", "13:00")]),
      ]),
    ])
  ).id;
  service = new CourseService(store);
  server = createApp(service, { requestsPerMinute: 500 }).listen(
    0,
    "127.0.0.1",
  );
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  base = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
});
afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await store.db.close();
});
it("pins pagination across publication and rejects changed query/tampering", async () => {
  const a = await service.call("search_courses", {
    term_code: 20263,
    query: "TEST",
    limit: 1,
  });
  const data = a.data as { next_cursor: string };
  await store.publish(20263, programs, [
    response([course(), course("TEST200", [sourceSection("10002")])]),
  ]);
  const b = await service.call("search_courses", {
    term_code: 20263,
    query: "TEST",
    limit: 1,
    cursor: data.next_cursor,
  });
  expect((b.meta as { snapshot_version: string }).snapshot_version).toBe(
    version,
  );
  expect((b.data as { items: unknown[] }).items).toHaveLength(1);
  expect(
    await service.call("search_courses", {
      term_code: 20263,
      query: "different",
      limit: 1,
      cursor: data.next_cursor,
    }),
  ).toHaveProperty("error");
  expect(
    await service.call("search_courses", {
      term_code: 20263,
      query: "TEST",
      limit: 1,
      cursor: data.next_cursor + "broken",
    }),
  ).toHaveProperty("error");
});
it("returns partial batch misses explicitly and bounds inputs", async () => {
  const r = await service.call("get_sections", {
    term_code: 20263,
    course_codes: ["TEST100", "MISS999"],
  });
  expect((r.data as { missing_courses: string[] }).missing_courses).toEqual([
    "MISS999",
  ]);
  expect(
    await service.call("get_courses", {
      term_code: 20263,
      course_codes: Array(21).fill("TEST100"),
    }),
  ).toHaveProperty("error");
});
it("serves REST and MCP from the same service, including assistant instructions", async () => {
  const client = new Client({ name: "integration-test", version: "1.0.0" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(base + "/mcp")),
  );
  try {
    expect((await client.listTools()).tools.map((t) => t.name)).toContain(
      "validate_schedule",
    );
    const args = {
      term_code: 20263,
      course_codes: ["TEST100"],
      snapshot_version: version,
    };
    const rest = await (
      await fetch(base + "/api/tools/get_courses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(args),
      })
    ).json();
    const mcp = await client.callTool({ name: "get_courses", arguments: args });
    expect(mcp.structuredContent).toEqual(rest);
    expect(
      clearanceGuidance.safeParse(rest.data[0].courses[0].clearance_guidance)
        .success,
    ).toBe(true);
    const sectionResult = await client.callTool({
      name: "get_sections",
      arguments: args,
    });
    expect(
      sectionClearance.safeParse(
        (sectionResult.structuredContent as any).data.items[0].clearance,
      ).success,
    ).toBe(true);
    const selection = {
      term_code: 20263,
      snapshot_version: version,
      requested_courses: ["TEST100"],
      section_ids: ["10001"],
    };
    const restReview = await (
      await fetch(base + "/api/tools/validate_schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(selection),
      })
    ).json();
    const mcpReview = await client.callTool({
      name: "validate_schedule",
      arguments: selection,
    });
    expect(mcpReview.structuredContent).toEqual(restReview);
    expect(validationReview.safeParse(restReview.data).success).toBe(true);
    expect(restReview.data.summary.eligibility).toBe("unknown");
    expect(
      (await client.readResource({ uri: "usc://assistant/instructions" }))
        .contents[0],
    ).toHaveProperty("text");
    expect(
      (
        await client.getPrompt({
          name: "plan-semester",
          arguments: { semester: "Fall 2026", courses: "TEST100" },
        })
      ).messages[0]?.content,
    ).toHaveProperty("text");
  } finally {
    await client.close();
  }
});
it("shares a dataset load under 100 concurrent lookups and no source fetches", async () => {
  const s = new CourseService(store);
  await Promise.all(
    Array.from({ length: 100 }, () =>
      s.call("get_courses", { term_code: 20263, course_codes: ["TEST100"] }),
    ),
  );
  expect(s.metrics.dataset_loads).toBe(1);
  expect(s.metrics.cache_hits).toBe(99);
});
it("rejects untrusted origins and malformed bodies", async () => {
  expect(
    (
      await fetch(base + "/api/tools/list_terms", {
        method: "POST",
        headers: {
          Origin: "https://evil.example",
          "Content-Type": "application/json",
        },
        body: "{}",
      })
    ).status,
  ).toBe(403);
  expect(
    (
      await fetch(base + "/api/tools/list_terms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{broken",
      })
    ).status,
  ).toBe(400);
});
it("enforces rate limits before tools run", async () => {
  const limited = createApp(service, { requestsPerMinute: 1 }).listen(
    0,
    "127.0.0.1",
  );
  await new Promise<void>((resolve) => limited.once("listening", resolve));
  const addr = limited.address();
  const url = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}/api/tools/list_terms`;
  try {
    expect(
      (
        await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        })
      ).status,
    ).toBe(200);
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    expect(r.status).toBe(429);
    expect(r.headers.get("Retry-After")).toBe("60");
  } finally {
    await new Promise<void>((resolve) => limited.close(() => resolve()));
  }
});
