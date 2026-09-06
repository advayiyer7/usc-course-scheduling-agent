import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { z } from "zod";
import {
  inputs,
  successEnvelope,
  type ToolName,
} from "../../../packages/contracts/src/index.js";
import { proposalInput } from "../../../packages/contracts/src/companion.js";

export interface CourseTools {
  definitions(): Promise<unknown[]>;
  call(name: string, args: unknown): Promise<Record<string, unknown>>;
  close(): Promise<void>;
}
export class McpCourseTools implements CourseTools {
  private client: Client | undefined;
  private ready: Promise<Client> | undefined;
  constructor(private endpoint = "http://127.0.0.1:3000/mcp") {
    const url = new URL(endpoint);
    if (
      url.protocol !== "http:" ||
      url.hostname !== "127.0.0.1" ||
      url.username ||
      url.password ||
      url.pathname !== "/mcp" ||
      url.search ||
      url.hash
    )
      throw new Error("The local pilot only supports the local course service");
  }
  private async connect() {
    this.ready ??= (async () => {
      const client = new Client({ name: "usc-companion", version: "0.2.0" });
      this.client = client;
      try {
        await client.connect(
          new StreamableHTTPClientTransport(new URL(this.endpoint), {
            fetch: (url, init) =>
              fetch(url, {
                ...init,
                redirect: "error",
                signal: AbortSignal.any([
                  ...(init?.signal ? [init.signal] : []),
                  AbortSignal.timeout(15000),
                ]),
              }),
          }),
        );
        return client;
      } catch {
        await client.close().catch(() => {});
        this.ready = undefined;
        throw new Error(
          "Start the local course service with npm run dev, then try again.",
        );
      }
    })();
    return this.ready;
  }
  async definitions() {
    const client = await this.connect();
    const { tools } = await client.listTools({}, { timeout: 15000 });
    // Only expose our fixed contract, regardless of what a server advertises.
    const allowed = tools.filter((t) => Object.hasOwn(inputs, t.name));
    if (allowed.length !== Object.keys(inputs).length)
      throw new Error(
        "Course service tool versions do not match this companion",
      );
    return [
      ...allowed.map((t) => ({
        type: "function",
        name: t.name,
        description: t.description ?? t.name,
        inputSchema: t.inputSchema,
        deferLoading: false,
      })),
      {
        type: "function",
        name: "present_schedule",
        description:
          "Validate a proposed schedule and show a draft card in the student's extension. Supply exact source IDs and snapshot. Unknown rules remain indeterminate. Does not change the student's calendar, coursebin, or enrollment. At most three drafts per turn.",
        inputSchema: z.toJSONSchema(proposalInput, { io: "input" }),
        deferLoading: false,
      },
    ];
  }
  async call(name: string, args: unknown): Promise<Record<string, unknown>> {
    if (!Object.hasOwn(inputs, name))
      throw new Error("Unsupported scheduling tool");
    const parsed = inputs[name as ToolName].safeParse(args);
    if (!parsed.success) throw new Error("Invalid scheduling tool arguments");
    const client = await this.connect();
    const result = await client.callTool(
      { name, arguments: parsed.data },
      undefined,
      { timeout: 15000 },
    );
    if (result.isError)
      throw new Error(
        "The course service rejected this request. Check semester, snapshot, and section IDs.",
      );
    if (JSON.stringify(result.structuredContent).length > 450000)
      throw new Error("Tool result too large; narrow the search");
    return successEnvelope.parse(result.structuredContent);
  }
  async close() {
    await this.client?.close();
    this.ready = undefined;
    this.client = undefined;
  }
}
