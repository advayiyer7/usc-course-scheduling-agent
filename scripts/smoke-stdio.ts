import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
const transport = new StdioClientTransport({
  command: process.execPath,
  args: ["--import=tsx", "apps/api/src/stdio.ts"],
  stderr: "pipe",
});
const client = new Client({ name: "usc-stdio-smoke", version: "0.1.0" });
try {
  await client.connect(transport);
  const result = await client.callTool({
    name: "search_courses",
    arguments: { term_code: 20263, query: "CSCI104" },
  });
  if (result.isError || !result.structuredContent)
    throw new Error(JSON.stringify(result));
  console.log(
    JSON.stringify(
      {
        transport: "stdio",
        tools: (await client.listTools()).tools.map((t) => t.name),
        result: result.structuredContent,
      },
      null,
      2,
    ),
  );
} finally {
  await client.close();
}
