import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
const base = process.env.API_URL ?? "http://127.0.0.1:3000";
const client = new Client({ name: "usc-local-smoke", version: "0.1.0" });
await client.connect(new StreamableHTTPClientTransport(new URL("/mcp", base)));
try {
  const tools = await client.listTools();
  const result = await client.callTool({
    name: "get_sections",
    arguments: { term_code: 20263, course_codes: ["CSCI104"] },
  });
  if (result.isError || !result.structuredContent)
    throw new Error(JSON.stringify(result));
  const data = result.structuredContent as {
    data: { items: { id: string; type: string }[] };
    meta: { snapshot_version: string };
  };
  const lecture = data.data.items.find((s) => s.type === "Lecture");
  if (!lecture) throw new Error("No CSCI104 lecture found");
  const validation = await client.callTool({
    name: "validate_schedule",
    arguments: {
      term_code: 20263,
      snapshot_version: data.meta.snapshot_version,
      requested_courses: ["CSCI104"],
      section_ids: [lecture.id],
      constraints: { unavailable: [] },
    },
  });
  if (validation.isError) throw new Error(JSON.stringify(validation));
  console.log(
    JSON.stringify(
      {
        tools: tools.tools.map((t) => t.name),
        sections_returned: data.data.items.length,
        sample_section: lecture.id,
        validation: validation.structuredContent,
      },
      null,
      2,
    ),
  );
} finally {
  await client.close();
}
