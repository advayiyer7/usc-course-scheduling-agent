import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { parseHTML } from "linkedom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  planningContext,
  proposal,
  type CompanionEvent,
} from "../packages/contracts/src/companion.js";
import { DraftShelf } from "../apps/extension/src/draft-shelf.js";
const peer = vi.hoisted(() => ({
  receive: undefined as ((e: any) => void) | undefined,
  requests: [] as any[],
  fail: false,
}));
vi.mock("../apps/extension/src/companion-client.js", () => ({
  CompanionClient: class {
    constructor(receive: (event: any) => void) {
      peer.receive = receive;
    }
    async request(value: any) {
      peer.requests.push(value);
      if (value.method === "status")
        peer.receive?.({
          type: "status",
          status: {
            authenticated: true,
            plan: "test",
            runtime: "0.153.4",
            busy: false,
          },
        });
      if (value.method === "chat" && peer.fail)
        throw new Error("Test connection failed");
      if (value.method === "stop")
        peer.receive?.({
          type: "turn_complete",
          status: "interrupted",
          generation_id: peer.requests.findLast((r) => r.method === "chat")
            ?.generation_id,
        });
    }
    close() {}
  },
}));
import { ChatPanel } from "../apps/extension/src/ChatPanel.js";
const context = planningContext.parse({
  major: "",
  term_code: 20263,
  course_codes: ["TEST100", "TEST200"],
  selected_section_ids: ["10001", "10002"],
  constraints: {},
});
function draft(index: number) {
  return proposal.parse({
    id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    selection: {
      title: `Plan ${index}`,
      term_code: 20263,
      snapshot_version: "11111111-1111-4111-8111-111111111111",
      requested_courses: ["TEST100"],
      section_ids: ["10001"],
      constraints: {},
    },
    validation: {
      data: { status: "indeterminate" },
      meta: {
        snapshot_version: "11111111-1111-4111-8111-111111111111",
        checked_at: "2026-09-06T20:00:00Z",
        stale: true,
        warnings: [],
      },
    },
  });
}
let root: Root, container: HTMLElement;
const onUndo = vi.fn((_code: string) => {}),
  onLoad = vi.fn(async (_draft: ReturnType<typeof draft>) => {});
const background = vi.fn(async (_request: unknown) => ({
  ok: true,
  active: false,
}));
const button = (name: string) =>
  [...container.querySelectorAll("button")].find(
    (b) => b.textContent === name,
  )!;
const emit = async (event: CompanionEvent) => {
  await act(async () => peer.receive?.(event));
};
const generation = () =>
  peer.requests.findLast((r) => r.method === "chat").generation_id;
const render = async (value = context) => {
  await act(async () =>
    root.render(
      React.createElement(ChatPanel, {
        context: value,
        onLoad,
        onUndoRemoval: onUndo,
        plannerBusy: false,
      }),
    ),
  );
};
const click = async (name: string) => {
  await act(async () => button(name).click());
};
const show = async (n: number, id = generation()) =>
  emit({ type: "proposal", proposal: draft(n), generation_id: id });
const complete = async () =>
  emit({
    type: "turn_complete",
    status: "completed",
    generation_id: generation(),
  });
beforeEach(async () => {
  peer.requests = [];
  peer.fail = false;
  const { window, document } = parseHTML(
    "<html><body><div id='root'></div></body></html>",
  );
  vi.stubGlobal("window", window);
  vi.stubGlobal("document", document);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal("chrome", {
    runtime: {
      id: "fixture-extension",
      sendMessage: background,
    },
    storage: {
      local: { get: vi.fn(async () => ({})), set: vi.fn(async () => {}) },
      onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
    },
  });
  container = document.getElementById("root")!;
  root = createRoot(container);
  onUndo.mockClear();
  onLoad.mockClear();
  background.mockResolvedValue({ ok: true, active: false });
  await render();
  await click("Connect companion");
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});
it("replaces old plans before a new response, caps display at two, and rejects delayed cards from the previous request", async () => {
  await click("Generate plans");
  const previous = generation();
  await show(1);
  await show(2);
  await show(3);
  expect(container.querySelectorAll(".proposal-card")).toHaveLength(2);
  expect(container.textContent).not.toContain("Plan 3");
  await complete();
  await click("Generate plans");
  expect(container.querySelectorAll(".proposal-card")).toHaveLength(0);
  await show(4, previous);
  expect(container.querySelectorAll(".proposal-card")).toHaveLength(0);
  await show(5);
  await show(6);
  await complete();
  expect(
    [...container.querySelectorAll(".proposal-card h3")].map(
      (n) => n.textContent,
    ),
  ).toEqual(["Plan 5", "Plan 6"]);
  expect(button("Show earlier messages (1)")).toBeTruthy();
});
it("invalidates old cards on course removal and sends the latest course, section and removal context", async () => {
  await click("Generate plans");
  await show(1);
  const previous = generation();
  await complete();
  const changed = {
    ...context,
    course_codes: ["TEST100"],
    selected_section_ids: ["10001"],
    removed_courses: [
      { course_code: "TEST200", aliases: ["TEST200", "OTHR200"] },
    ],
  };
  await render(changed);
  expect(container.querySelectorAll(".proposal-card")).toHaveLength(0);
  expect(container.textContent).toContain("Removed from new plans:");
  await show(2, previous);
  expect(container.querySelectorAll(".proposal-card")).toHaveLength(0);
  await click("Generate plans");
  expect(peer.requests.findLast((r) => r.method === "chat").context).toEqual(
    changed,
  );
  await complete();
  await act(async () =>
    container
      .querySelector<HTMLButtonElement>(
        '[aria-label="Undo removal of TEST200"]',
      )!
      .click(),
  );
  expect(onUndo).toHaveBeenCalledWith("TEST200");
});
it("stops obsolete generation after planner edits and ignores its late message and card", async () => {
  await click("Generate plans");
  const previous = generation();
  await render({
    ...context,
    constraints: { ...context.constraints, earliest: "11:00" },
  });
  expect(peer.requests.at(-1).method).toBe("stop");
  await emit({
    type: "message",
    id: "old-message",
    text: "Obsolete schedule",
    complete: true,
  });
  await show(1, previous);
  expect(container.textContent).not.toContain("Obsolete schedule");
  expect(container.querySelectorAll(".proposal-card")).toHaveLength(0);
});
it("does not resurrect old cards when regeneration fails", async () => {
  await click("Generate plans");
  await show(1);
  await complete();
  peer.fail = true;
  await click("Generate plans");
  expect(container.querySelectorAll(".proposal-card")).toHaveLength(0);
  expect(container.textContent).toContain("Test connection failed");
});
it("keeps a running coursebin report and a Stop control even without a draft", async () => {
  background.mockResolvedValue({
    ok: true,
    active: true,
  });
  await act(async () => root.unmount());
  root = createRoot(container);
  await render();
  expect(button("Stop after current section")).toBeTruthy();
  await click("Stop after current section");
  expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
    expect.objectContaining({ method: "cancel" }),
  );
});
it("does not accept retired generations after context returns to an earlier value", () => {
  const shelf = new DraftShelf();
  shelf.begin("old", "A");
  shelf.setContext("B");
  shelf.setContext("A");
  expect(shelf.accept("old", draft(1))).toBeUndefined();
  shelf.begin("new", "A");
  expect(shelf.accept("new", draft(2))).toHaveLength(1);
  shelf.finish("new");
  expect(shelf.accept("new", draft(3))).toBeUndefined();
});
