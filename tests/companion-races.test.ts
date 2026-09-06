import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { afterEach, expect, it } from "vitest";
import { CompanionSession } from "../apps/companion/src/session.js";
import type { Rpc } from "../apps/companion/src/rpc.js";
import type { CourseTools } from "../apps/companion/src/course-tools.js";
import type { CompanionEvent } from "../packages/contracts/src/companion.js";

const snapshot = "11111111-1111-4111-8111-111111111111";
const context = {
  major: "",
  term_code: 20263,
  course_codes: ["TEST100"],
  constraints: {
    unavailable: [],
    preferences: { instructors: [], free_days: [] },
  },
};
const selection = {
  title: "Synthetic option",
  term_code: 20263,
  snapshot_version: snapshot,
  requested_courses: ["TEST100"],
  section_ids: ["10001"],
  constraints: context.constraints,
};
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
class ControlledRpc extends EventEmitter implements Rpc {
  calls: { method: string; params: any }[] = [];
  replies: { id: string | number; result: any }[] = [];
  startGate: ReturnType<typeof deferred> | undefined;
  interruptGate: ReturnType<typeof deferred> | undefined;
  turnNumber = 0;
  closed = false;
  async request(method: string, params: unknown) {
    this.calls.push({ method, params });
    if (method === "account/read")
      return { account: { type: "chatgpt", planType: "test" } };
    if (method === "thread/start") return { thread: { id: "thread1" } };
    if (method === "turn/start") {
      const id = `turn${++this.turnNumber}`;
      await this.startGate?.promise;
      return { turn: { id } };
    }
    if (method === "turn/interrupt") await this.interruptGate?.promise;
    return {};
  }
  reply(id: string | number, result: unknown) {
    this.replies.push({ id, result });
  }
  reject() {}
  close() {
    this.closed = true;
  }
}
const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).forEach((cleanup) => cleanup()));
const settle = () => new Promise((resolve) => setImmediate(resolve));
function setup() {
  const rpc = new ControlledRpc(),
    events: CompanionEvent[] = [];
  const gates: {
    definitions?: ReturnType<typeof deferred>;
    validation?: ReturnType<typeof deferred>;
  } = {};
  const calls: string[] = [];
  const tools: CourseTools = {
    async definitions() {
      await gates.definitions?.promise;
      return [];
    },
    async call(name) {
      calls.push(name);
      await gates.validation?.promise;
      return {
        data: { status: "indeterminate" },
        meta: {
          snapshot_version: snapshot,
          checked_at: "2026-09-06T00:00:00Z",
          stale: false,
          warnings: [],
        },
      };
    },
    async close() {},
  };
  const session = new CompanionSession(
    rpc,
    tools,
    (event) => events.push(event),
    "/unused-fixture-workspace",
  );
  cleanups.push(() => session.close());
  const command = (method: string, extra = {}) =>
    session.handle({ id: randomUUID(), method, ...extra });
  const chat = () =>
    command("chat", { text: "Plan synthetic courses", context });
  const draft = (id: number, turnId: string) =>
    rpc.emit("request", {
      id,
      method: "item/tool/call",
      params: {
        threadId: "thread1",
        turnId,
        tool: "present_schedule",
        arguments: selection,
      },
    });
  const message = (turnId: string, text: string) =>
    rpc.emit("notification", {
      method: "item/agentMessage/delta",
      params: {
        threadId: "thread1",
        turnId,
        itemId: `${turnId}-message`,
        delta: text,
      },
    });
  const turnEvent = (method: string, id: string) =>
    rpc.emit("notification", {
      method,
      params: { threadId: "thread1", turn: { id, status: "completed" } },
    });
  return {
    rpc,
    events,
    gates,
    calls,
    command,
    chat,
    draft,
    message,
    turnEvent,
  };
}

it("rejects cancelled tools and notifications during the next chat's preparation", async () => {
  const f = setup();
  await f.chat();
  await f.command("stop");
  f.events.length = 0;
  f.gates.definitions = deferred();
  const next = f.chat();
  await settle();
  f.draft(1, "turn1");
  await settle();
  expect(f.events.some((e) => e.type === "proposal")).toBe(false);
  f.message("turn1", "Cancelled output");
  f.turnEvent("turn/started", "turn1");
  f.turnEvent("turn/completed", "turn1");
  await settle();
  expect(f.calls).toEqual([]);
  expect(
    f.events.some((e) =>
      ["message", "proposal", "turn_complete"].includes(e.type),
    ),
  ).toBe(false);
  expect(f.rpc.replies.find((r) => r.id === 1)?.result.success).toBe(false);
  await f.command("status");
  expect(f.events.filter((e) => e.type === "status").at(-1)).toMatchObject({
    status: { busy: true },
  });
  f.gates.definitions.resolve();
  await next;
  f.draft(2, "turn2");
  await settle();
  expect(f.rpc.replies.find((r) => r.id === 2)?.result.success).toBe(true);
});

it("rejects old packets while awaiting turn/start but permits the new turn's legitimate early notifications", async () => {
  const f = setup();
  await f.chat();
  await f.command("stop");
  f.events.length = 0;
  f.rpc.startGate = deferred();
  const next = f.chat();
  await settle();
  f.turnEvent("turn/started", "turn1");
  f.draft(1, "turn1");
  f.message("turn1", "Old");
  f.turnEvent("turn/completed", "turn1");
  f.draft(2, "unrelated");
  await settle();
  expect(f.calls).toEqual([]);
  expect(
    f.events.some((e) => e.type === "message" || e.type === "proposal"),
  ).toBe(false);
  f.turnEvent("turn/started", "turn2");
  f.message("turn2", "Current");
  f.draft(3, "turn2");
  await settle();
  f.rpc.startGate.resolve();
  await next;
  await settle();
  expect(f.events.filter((e) => e.type === "message")).toEqual([
    { type: "message", id: "turn2-message", text: "Current", complete: false },
  ]);
  expect(f.events.filter((e) => e.type === "proposal")).toHaveLength(1);
  expect(f.calls).toEqual(["validate_schedule"]);
  expect(f.rpc.replies.map((r) => [r.id, r.result.success])).toEqual([
    [1, false],
    [2, false],
    [3, true],
  ]);
});

it("handles an entire fast response before its turn/start reply without reactivating it", async () => {
  const f = setup();
  f.rpc.startGate = deferred();
  const starting = f.chat();
  await settle();
  f.turnEvent("turn/started", "turn1");
  f.message("turn1", "Complete answer");
  f.turnEvent("turn/completed", "turn1");
  f.rpc.startGate.resolve();
  await starting;
  await settle();
  expect(f.events.filter((e) => e.type === "turn_complete")).toEqual([
    { type: "turn_complete", status: "completed" },
  ]);
  await f.command("status");
  expect(f.events.filter((e) => e.type === "status").at(-1)).toMatchObject({
    status: { busy: false },
  });
  await f.chat();
  expect(f.rpc.turnNumber).toBe(2);
});

it("drops delayed output after stop before turn/start resolves and interrupts the cancelled response identity", async () => {
  const f = setup();
  f.rpc.startGate = deferred();
  const starting = f.chat();
  await settle();
  await f.command("stop");
  f.turnEvent("turn/started", "turn1");
  f.message("turn1", "Never publish");
  f.draft(1, "turn1");
  f.rpc.startGate.resolve();
  await starting;
  await settle();
  expect(
    f.events.some((e) => e.type === "message" || e.type === "proposal"),
  ).toBe(false);
  expect(f.calls).toEqual([]);
  expect(f.rpc.replies.find((r) => r.id === 1)?.result.success).toBe(false);
  expect(f.rpc.calls.filter((c) => c.method === "turn/interrupt")).toEqual([
    {
      method: "turn/interrupt",
      params: { threadId: "thread1", turnId: "turn1" },
    },
  ]);
});

it("does not publish an already-validating draft after stop and a subsequent chat", async () => {
  const f = setup();
  await f.chat();
  f.gates.validation = deferred();
  f.draft(1, "turn1");
  await settle();
  await f.command("stop");
  await f.chat();
  f.gates.validation.resolve();
  await settle();
  expect(f.events.filter((e) => e.type === "proposal")).toEqual([]);
  expect(f.rpc.replies.find((r) => r.id === 1)?.result.success).toBe(false);
  f.draft(2, "turn2");
  await settle();
  expect(f.rpc.replies.find((r) => r.id === 2)?.result.success).toBe(true);
});

it("does not emit an old stop completion into a chat started while interruption was pending", async () => {
  const f = setup();
  await f.chat();
  f.rpc.interruptGate = deferred();
  const stopping = f.command("stop");
  await settle();
  await f.chat();
  f.events.length = 0;
  f.rpc.interruptGate.resolve();
  await stopping;
  expect(f.events.some((e) => e.type === "turn_complete")).toBe(false);
  await f.command("status");
  expect(f.events.filter((e) => e.type === "status").at(-1)).toMatchObject({
    status: { busy: true },
  });
});

it("ignores an old turn's terminal messages after the next turn has already started", async () => {
  const f = setup();
  await f.chat();
  await f.command("stop");
  await f.chat();
  f.events.length = 0;
  f.turnEvent("turn/started", "turn1");
  f.turnEvent("turn/completed", "turn1");
  f.message("turn1", "Old response");
  f.rpc.emit("notification", {
    method: "item/completed",
    params: {
      threadId: "thread1",
      turnId: "turn1",
      item: {
        id: "old-message",
        type: "agentMessage",
        text: "Old final answer",
      },
    },
  });
  await settle();
  expect(f.events).toEqual([]);
  f.draft(1, "turn2");
  await settle();
  expect(f.rpc.replies.find((r) => r.id === 1)?.result.success).toBe(true);
});
