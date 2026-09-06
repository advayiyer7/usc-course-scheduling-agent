import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  inputs,
  successEnvelope,
  type ToolName,
} from "../../../packages/contracts/src/index.js";
import type { CourseService } from "../../../packages/domain/src/service.js";
const descriptions: Record<ToolName, string> = {
  list_terms:
    "List ingested USC semesters, snapshot versions and coverage. Does not fetch USC.",
  search_courses:
    "Search course codes and titles in a stored semester. Returns up to 50 summaries. Follow cursors with the same query.",
  get_courses:
    "Retrieve up to 20 courses, aliases, units, prerequisites and restrictions. Null means unknown, not unrestricted.",
  get_sections:
    "Retrieve paginated section components, times, instructor names and timestamped seat counts for up to 20 courses. Locations and meeting dates are not verified. Follow all pages before assuming completeness.",
  validate_schedule:
    "Check exact selected section IDs against hard time constraints, known overlaps, cancellations and course coverage. Reports indeterminate when dates or required component rules are unknown. Never establishes personal enrollment eligibility.",
  request_refresh:
    "Queue a shared, budgeted refresh for selected courses. Repeated requests are coalesced/cooldown-limited. Queued does not mean fresh; do not poll repeatedly.",
};
export function makeMcp(service: CourseService) {
  const instructions = readFileSync(
    resolve("prompts/scheduling-assistant.system.md"),
    "utf8",
  );
  const server = new McpServer(
    { name: "usc-course-scheduling-agent", version: "0.1.0" },
    { instructions },
  );
  for (const name of Object.keys(inputs) as ToolName[]) {
    server.registerTool(
      name,
      {
        description: descriptions[name],
        inputSchema: inputs[name],
        outputSchema: successEnvelope,
        annotations: {
          readOnlyHint: name !== "request_refresh",
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: name === "request_refresh",
        },
      },
      async (args: unknown) => {
        const result = await service.call(name, args);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result) }],
          structuredContent: result,
          isError: "error" in result,
        };
      },
    );
  }
  server.registerResource(
    "assistant-instructions",
    "usc://assistant/instructions",
    {
      mimeType: "text/markdown",
      description:
        "Scheduling behavior and limitations; host instructions retain precedence.",
    },
    async (uri) => ({
      contents: [
        { uri: uri.href, mimeType: "text/markdown", text: instructions },
      ],
    }),
  );
  server.registerPrompt(
    "plan-semester",
    {
      description:
        "Start a USC scheduling conversation using verified course data.",
      argsSchema: {
        semester: z.string().max(40),
        courses: z.string().max(500),
        preferences: z.string().max(1000).optional(),
      },
    },
    async ({ semester, courses, preferences }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Help plan ${semester}. Requested courses: ${courses}. Preferences: ${preferences ?? "Ask about unavailable times."}\nUse the USC tools and validate section IDs before presenting a schedule. Report missing data, snapshot age, and separate eligibility from time feasibility.`,
          },
        },
      ],
    }),
  );
  return server;
}
