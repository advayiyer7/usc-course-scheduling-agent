import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { AppServerRpc, type Rpc } from "../apps/companion/src/rpc.js";
import { NativeDecoder, encodeNative } from "../apps/companion/src/framing.js";
import {
  CompanionSession,
  protectConstraints,
} from "../apps/companion/src/session.js";
import {
  companionRequest,
  trustedLoginUrl,
  type CompanionEvent,
} from "../packages/contracts/src/companion.js";
import type { CourseTools } from "../apps/companion/src/course-tools.js";

const version = "11111111-1111-4111-8111-111111111111";
const context = {
  major: "Computer Science",
  term_code: 20263,
  course_codes: ["TEST100"],
  constraints: {
    earliest: "10:00",
    unavailable: [],
    preferences: { instructors: [], free_days: [] },
  },
};
const selection = {
  title: "Option one",
  term_code: 20263,
  snapshot_version: version,
  requested_courses: ["TEST100"],
  section_ids: ["10001"],
  constraints: context.constraints,
};
class FakeRpc extends EventEmitter implements Rpc {
  calls: { method: string; params: any }[] = [];
  replies: { id: string | number; result: any }[] = [];
  rejections: (string | number)[] = [];
  authenticated = true;
  gate: (() => Promise<unknown>) | undefined;
  async request(method: string, params: any) {
    this.calls.push({ method, params });
    if (this.gate && method === "thread/start") await this.gate();
    if (method === "account/read")
      return {
        account: this.authenticated
          ? { type: "chatgpt", email: "private@example.test", planType: "edu" }
          : null,
      };
    if (method === "account/login/start")
      return {
        loginId: "login1",
        authUrl: "https://auth.openai.com/oauth/authorize?state=secret",
      };
    if (method === "thread/start") return { thread: { id: "thread1" } };
    if (method === "turn/start") return { turn: { id: "turn1" } };
    return {};
  }
  reply(id: string | number, result: unknown) {
    this.replies.push({ id, result });
  }
  reject(id: string | number) {
    this.rejections.push(id);
  }
  close() {}
}
const cleanup: (() => void)[] = [];
afterEach(() => {
  cleanup.splice(0).forEach((fn) => fn());
});
function setup() {
  const rpc = new FakeRpc();
  const events: CompanionEvent[] = [],
    calls: { name: string; args: any }[] = [];
  const tools: CourseTools = {
    async definitions() {
      return [];
    },
    async call(name, args) {
      if (name !== "validate_schedule" && name !== "get_courses")
        throw new Error("Unsupported scheduling tool");
      calls.push({ name, args });
      return {
        data: { status: "indeterminate" },
        meta: {
          snapshot_version: version,
          checked_at: "2026-09-06T20:00:00Z",
          stale: true,
          warnings: ["Unverified component rules"],
        },
      };
    },
    async close() {},
  };
  const session = new CompanionSession(
    rpc,
    tools,
    (e) => events.push(e),
    "/tmp/empty-workspace",
  );
  cleanup.push(() => session.close());
  const command = (method: string, extra = {}) =>
    session.handle({ id: randomUUID(), method, ...extra });
  return { rpc, events, calls, command, session };
}
async function settle() {
  await new Promise((r) => setImmediate(r));
}
describe("native boundary", () => {
  it("handles fragmented headers, UTF-8 bodies and consecutive messages", () => {
    const decoder = new NativeDecoder();
    const bytes = Buffer.concat([
      encodeNative({ message: "Hi 👋" }),
      encodeNative({ n: 2 }),
    ]);
    const values: unknown[] = [];
    for (const byte of bytes) values.push(...decoder.push(Buffer.from([byte])));
    expect(values).toEqual([{ message: "Hi 👋" }, { n: 2 }]);
  });
  it("rejects oversized, malformed and arbitrary runtime commands", () => {
    expect(() =>
      new NativeDecoder().push(Buffer.from([255, 255, 255, 255])),
    ).toThrow();
    expect(() =>
      new NativeDecoder().push(Buffer.from([1, 0, 0, 0, 123])),
    ).toThrow();
    expect(
      companionRequest.safeParse({
        id: randomUUID(),
        method: "exec",
        command: "arbitrary",
      }).success,
    ).toBe(false);
    expect(
      companionRequest.safeParse({
        id: randomUUID(),
        method: "login",
        apiKey: "secret",
      }).success,
    ).toBe(false);
    expect(trustedLoginUrl("https://auth.openai.com/oauth/authorize")).toBe(
      true,
    );
    for (const url of [
      "javascript:alert(1)",
      "http://auth.openai.com",
      "https://auth.openai.com.evil.test",
      "https://auth.openai.com@evil.test",
      "https://auth.openai.com:444",
    ])
      expect(trustedLoginUrl(url)).toBe(false);
  });
});
describe("companion workflow", () => {
  it("reports account state without leaking email or raw account data", async () => {
    const { command, events } = setup();
    await command("status");
    expect(events[0]).toMatchObject({
      type: "status",
      status: { authenticated: true, plan: "edu" },
    });
    expect(JSON.stringify(events)).not.toContain("private@example");
  });
  it("does not start inference when signed out", async () => {
    const { command, rpc, events } = setup();
    rpc.authenticated = false;
    await command("chat", { text: "Plan my classes", context });
    expect(rpc.calls.some((c) => c.method === "turn/start")).toBe(false);
    expect(events.at(-1)).toMatchObject({ type: "reply", ok: false });
  });
  it("uses official login, ignores unrelated callbacks, and clears a cancelled login", async () => {
    const { command, rpc, events } = setup();
    await command("login");
    expect(rpc.calls[0]).toEqual({
      method: "account/login/start",
      params: { type: "chatgpt" },
    });
    rpc.emit("notification", {
      method: "account/login/completed",
      params: { loginId: "other", success: true },
    });
    await settle();
    expect(events.some((e) => e.type === "login_complete")).toBe(false);
    await command("cancel_login");
    expect(rpc.calls.at(-1)?.method).toBe("account/login/cancel");
  });
  it("streams messages, validates draft IDs and preserves planner hard constraints", async () => {
    const { command, rpc, events, calls } = setup();
    await command("chat", { text: "Suggest an option", context });
    const thread = rpc.calls.find((c) => c.method === "thread/start");
    expect(thread?.params).toMatchObject({
      ephemeral: true,
      environments: [],
      sandbox: "read-only",
    });
    rpc.emit("notification", {
      method: "item/agentMessage/delta",
      params: {
        threadId: "thread1",
        turnId: "turn1",
        itemId: "message1",
        delta: "Here is ",
      },
    });
    rpc.emit("notification", {
      method: "item/agentMessage/delta",
      params: {
        threadId: "thread1",
        turnId: "turn1",
        itemId: "message1",
        delta: "a draft.",
      },
    });
    rpc.emit("request", {
      id: 99,
      method: "item/tool/call",
      params: {
        threadId: "thread1",
        turnId: "turn1",
        tool: "present_schedule",
        arguments: {
          ...selection,
          constraints: { ...context.constraints, earliest: "08:00" },
        },
      },
    });
    await settle();
    expect(events.filter((e) => e.type === "message").at(-1)).toMatchObject({
      text: "Here is a draft.",
    });
    expect(calls[0]?.args.constraints.earliest).toBe("10:00");
    expect(events.find((e) => e.type === "proposal")).toMatchObject({
      proposal: { validation: { data: { status: "indeterminate" } } },
    });
    expect(rpc.replies[0]?.result.success).toBe(true);
    expect(rpc.calls.some((c) => /register|coursebin/.test(c.method))).toBe(
      false,
    );
  });
  it("denies commands, unknown tools, out-of-thread calls and duplicate UI requests", async () => {
    const { command, session, rpc, calls } = setup();
    const id = randomUUID();
    await session.handle({ id, method: "status" });
    await session.handle({ id, method: "status" });
    expect(rpc.calls).toHaveLength(1);
    await command("chat", { text: "Help", context });
    rpc.emit("request", {
      id: 1,
      method: "item/commandExecution/requestApproval",
      params: {},
    });
    rpc.emit("request", {
      id: 2,
      method: "item/tool/call",
      params: {
        threadId: "evil",
        turnId: "turn1",
        tool: "get_courses",
        arguments: {},
      },
    });
    rpc.emit("request", {
      id: 3,
      method: "item/tool/call",
      params: {
        threadId: "thread1",
        turnId: "turn1",
        tool: "register_courses",
        arguments: {},
      },
    });
    await settle();
    expect(rpc.rejections).toEqual([1]);
    expect(rpc.replies.every((r) => !r.result.success)).toBe(true);
    expect(calls).toHaveLength(0);
  });
  it("cancels a response while thread startup is pending without sending the prompt", async () => {
    const { command, rpc, events } = setup();
    let release!: () => void;
    rpc.gate = () =>
      new Promise<void>((r) => {
        release = r;
      });
    const starting = command("chat", { text: "Help", context });
    await settle();
    await command("stop");
    release();
    await starting;
    expect(rpc.calls.some((c) => c.method === "turn/start")).toBe(false);
    expect(events).toContainEqual({
      type: "turn_complete",
      status: "interrupted",
    });
  });
  it("caps drafts and rejects stale calls after stop", async () => {
    const { command, rpc, events } = setup();
    await command("chat", { text: "Options", context });
    for (let i = 0; i < 4; i++)
      rpc.emit("request", {
        id: i,
        method: "item/tool/call",
        params: {
          threadId: "thread1",
          turnId: "turn1",
          tool: "present_schedule",
          arguments: selection,
        },
      });
    await settle();
    expect(events.filter((e) => e.type === "proposal")).toHaveLength(3);
    expect(rpc.replies[3]?.result.success).toBe(false);
    await command("stop");
    rpc.emit("request", {
      id: 5,
      method: "item/tool/call",
      params: {
        threadId: "thread1",
        turnId: "turn1",
        tool: "get_courses",
        arguments: {},
      },
    });
    await settle();
    expect(rpc.replies.at(-1)?.result.success).toBe(false);
  });
  it("keeps required courses and detects contradictory constraints", () => {
    expect(
      protectConstraints(
        { ...selection, requested_courses: ["TEST200"] },
        context,
      ).requested_courses,
    ).toEqual(["TEST100", "TEST200"]);
    expect(() =>
      protectConstraints(
        {
          ...selection,
          constraints: {
            ...context.constraints,
            latest: "09:00",
            earliest: "08:00",
          },
        },
        context,
      ),
    ).toThrow();
  });
});
describe("app-server process boundary", () => {
  it("correlates replies and bounds hung requests", async () => {
    const child = spawn(process.execPath, [
      "-e",
      'process.stdin.on("data",d=>{for(const l of d.toString().trim().split("\\n")){const m=JSON.parse(l);if(m.method==="echo")process.stdout.write(JSON.stringify({id:m.id,result:m.params})+"\\n")}})',
    ]);
    const rpc = new AppServerRpc(child, 100);
    cleanup.push(() => rpc.close());
    expect(await rpc.request("echo", { value: 1 })).toEqual({ value: 1 });
    await expect(rpc.request("hang", {})).rejects.toThrow("timed out");
  });
  it("sanitizes provider errors and rejects pending calls on process exit", async () => {
    const child = spawn(process.execPath, [
      "-e",
      'process.stdin.on("data",d=>{const m=JSON.parse(d);if(m.method==="fail")process.stdout.write(JSON.stringify({id:m.id,error:{message:"token=private"}})+"\\n");else process.exit(1)})',
    ]);
    const rpc = new AppServerRpc(child);
    cleanup.push(() => rpc.close());
    await expect(rpc.request("fail", {})).rejects.toThrow(
      "Check account access",
    );
    await expect(rpc.request("exit", {})).rejects.toThrow("disconnected");
  });
});
