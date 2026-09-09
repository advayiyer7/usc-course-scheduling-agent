import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { parseHTML } from "linkedom";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { AlertsPanel } from "../apps/extension/src/alerts/AlertsPanel.js";
import { AlertClient } from "../apps/extension/src/alerts/client.js";
import {
  alertPlan,
  type AlertInbox,
} from "../packages/contracts/src/alerts.js";

const plan = alertPlan.parse({
  term_code: 20263,
  course_codes: ["TEST100"],
  section_ids: ["10001"],
  constraints: {},
});
const profileToken = "x".repeat(43),
  watchId = "11111111-1111-4111-8111-111111111111",
  eventId = "22222222-2222-4222-8222-222222222222";
let root: Root, container: HTMLElement, data: AlertInbox;
const prompt = vi.fn(),
  planner = vi.fn();
let fetcher: ReturnType<typeof vi.fn<typeof fetch>>;
const sections = [{ id: "10001", course_code: "TEST100", type: "Lecture" }];
const click = async (text: string) => {
  const b = [...container.querySelectorAll("button")].find(
    (b) => b.textContent === text,
  );
  expect(b).toBeDefined();
  await act(async () => b!.click());
};
const render = async (p = plan, disabled = false) => {
  await act(async () =>
    root.render(
      React.createElement(AlertsPanel, {
        plan: p,
        sections,
        ready: true,
        disabled,
        onPrompt: prompt,
        onPlanner: planner,
      }),
    ),
  );
};
beforeEach(() => {
  const { document, window } = parseHTML(
    '<html><body><div id="root"></div></body></html>',
  );
  vi.stubGlobal("document", document);
  vi.stubGlobal("window", window);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("chrome", {
    storage: {
      local: {
        get: vi.fn(async () => ({ "usc-alert-pairing-v1": profileToken })),
        set: vi.fn(async () => {}),
        remove: vi.fn(async () => {}),
      },
    },
  });
  container = document.getElementById("root") as unknown as HTMLElement;
  root = createRoot(container);
  prompt.mockClear();
  planner.mockClear();
  data = {
    watches: [
      {
        id: watchId,
        course_code: "TEST100",
        section_id: "10001",
        plan,
        revision: "a".repeat(64),
        created_at: new Date().toISOString(),
        active: true,
      },
    ],
    events: [
      {
        id: eventId,
        opening: {
          course_code: "TEST100",
          section_id: "10001",
          reported_seats: 1,
        },
        received_at: new Date().toISOString(),
        source: "pilot",
        status: "review_required",
        watch_ids: [watchId],
        selected_watch_id: null,
        checked_at: null,
        snapshot_version: null,
        current_seats: null,
        warning: "Confirm source and semester.",
      },
    ],
    address: null,
    pilot_enabled: true,
    delivery: {
      queued: 0,
      processed: 0,
      failed: 0,
      rejected: 0,
      last_received_at: null,
    },
    has_more: false,
    meta: {
      checked_at: new Date().toISOString(),
      completeness: "active_watches_and_latest_50_events",
      warnings: [],
    },
  };
  fetcher = vi.fn(async (_url, options) => {
    expect(new Headers(options?.headers).get("Authorization")).toBe(
      `Bearer ${profileToken}`,
    );
    if (String(_url).endsWith("/confirm")) {
      data.events[0] = {
        ...data.events[0]!,
        status: "open",
        selected_watch_id: watchId,
        current_seats: 2,
        checked_at: new Date().toISOString(),
      };
    }
    return Response.json(String(_url).endsWith("/inbox") ? data : { ok: true });
  });
  vi.stubGlobal("fetch", fetcher);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});
it("shows a synthetic event, confirms its term, then prepares a bounded prompt without running AI or WebReg", async () => {
  await render();
  expect(container.textContent).toContain("Synthetic test");
  expect(container.textContent).toContain("not configured");
  expect(
    [...container.querySelectorAll("a")].some((a) => a.href.includes("webreg")),
  ).toBe(false);
  await click("Confirm Fall 2026 alert and recheck");
  const request = fetcher.mock.calls.find((c) =>
    String(c[0]).endsWith("/confirm"),
  )!;
  expect(JSON.parse(String(request[1]?.body))).toMatchObject({
    confirm_term_and_source: true,
    watch_id: watchId,
    event_id: eventId,
  });
  await click("Review with Codex");
  expect(prompt).toHaveBeenCalledOnce();
  expect(prompt.mock.calls[0]?.[0]).toContain('"current_seats":2');
  expect(
    fetcher.mock.calls.every((c) =>
      String(c[0]).startsWith("http://127.0.0.1:3000/api/alerts/"),
    ),
  ).toBe(true);
  expect(
    container.querySelector('a[href="https://webreg.usc.edu/CourseBin"]'),
  ).toBeTruthy();
});
it("hides stale plan actions immediately and never sends the previous selection to the assistant", async () => {
  await render();
  await click("Confirm Fall 2026 alert and recheck");
  await render(alertPlan.parse({ ...plan, section_ids: [], course_codes: [] }));
  expect(container.textContent).not.toContain("Review with Codex");
  expect(
    container.querySelector('a[href="https://webreg.usc.edu/CourseBin"]'),
  ).toBeNull();
  expect(prompt).not.toHaveBeenCalled();
});
it("disables watch changes and confirmation during an active coursebin run", async () => {
  await render(plan, true);
  const button = [...container.querySelectorAll("button")].find(
    (b) => b.textContent === "Confirm Fall 2026 alert and recheck",
  )!;
  expect(button.disabled).toBe(true);
});
it("allows pairing again when the backend has revoked the stored token", async () => {
  fetcher.mockResolvedValue(
    Response.json(
      { error: { message: "Pairing was revoked." } },
      { status: 401 },
    ),
  );
  await render();
  expect(container.textContent).toContain("Set up opening alerts");
  expect(chrome.storage.local.remove).toHaveBeenCalledWith(
    "usc-alert-pairing-v1",
  );
});
it("serializes planner writes across delayed replies and keeps processing after a failed request", async () => {
  let finish: (r: Response) => void = () => {};
  fetcher.mockImplementationOnce(
    () =>
      new Promise<Response>((r) => {
        finish = r;
      }),
  );
  const client = new AlertClient(profileToken);
  const first = client.write("sync", plan),
    second = client.write("sync", { ...plan, section_ids: [] });
  await Promise.resolve();
  expect(fetcher).toHaveBeenCalledTimes(1);
  finish(Response.json({ error: { message: "Failed once" } }, { status: 500 }));
  await expect(first).rejects.toThrow("Failed once");
  await second;
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(
    JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body)).section_ids,
  ).toEqual([]);
});
