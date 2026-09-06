import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { parseHTML } from "linkedom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CoursebinAction,
  CoursebinResult,
} from "../apps/extension/src/coursebin/CoursebinAction.js";
import {
  planningContext,
  proposal,
} from "../packages/contracts/src/companion.js";
import {
  coursebinUiRequest,
  type CoursebinPreview,
} from "../packages/contracts/src/coursebin.js";

const draft = proposal.parse({
  id: "11111111-1111-4111-8111-111111111111",
  selection: {
    title: "Synthetic draft",
    term_code: 20263,
    snapshot_version: "22222222-2222-4222-8222-222222222222",
    requested_courses: ["TEST101"],
    section_ids: ["11111"],
    constraints: {},
  },
  validation: {
    data: { status: "indeterminate" },
    meta: {
      snapshot_version: "22222222-2222-4222-8222-222222222222",
      checked_at: "2026-09-06",
      stale: false,
      warnings: [],
    },
  },
});
const context = planningContext.parse({
  term_code: 20263,
  course_codes: [],
  constraints: {},
});
const report = {
  run_id: "44444444-4444-4444-8444-444444444444",
  proposal_id: draft.id,
  term_code: 20263,
  snapshot_version: draft.selection.snapshot_version,
  phase: "stopped" as const,
  sections: [
    {
      section_id: "11111",
      status: "unconfirmed" as const,
      code: "UNCONFIRMED" as const,
    },
  ],
};
let root: Root;
let container: HTMLElement;
let send: ReturnType<typeof vi.fn>;
let preview: CoursebinPreview;
const onReport = vi.fn(),
  onBusy = vi.fn();
const render = async (value = context) => {
  await act(async () =>
    root.render(
      React.createElement(CoursebinAction, {
        draft,
        context: value,
        disabled: false,
        onBusy,
        onReport,
      }),
    ),
  );
};
const button = (label: string) =>
  [...container.querySelectorAll("button")].find(
    (b) => b.textContent === label,
  )!;
const click = async (element: HTMLElement) => {
  await act(async () => element.click());
};

beforeEach(() => {
  const { window, document } = parseHTML(
    "<html><body><div id='root'></div></body></html>",
  );
  vi.stubGlobal("window", window);
  vi.stubGlobal("document", document);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.getElementById("root") as unknown as HTMLElement;
  root = createRoot(container);
  preview = {
    ticket: "33333333-3333-4333-8333-333333333333",
    expires_at: Date.now() + 90000,
    selection: draft.selection,
    sections: [
      {
        section_id: "11111",
        course_code: "TEST101",
        type: "Lecture",
        meetings: ["Mon 10:00–11:00"],
      },
    ],
    blockers: [],
    warnings: [
      { code: "eligibility", message: "Eligibility remains unknown." },
    ],
    already_present: [],
  };
  send = vi.fn(async (raw: unknown) => {
    const r = coursebinUiRequest.parse(raw);
    return r.method === "prepare"
      ? { ok: true, preview: structuredClone(preview) }
      : { ok: true, report };
  });
  vi.stubGlobal("chrome", { runtime: { id: "synthetic", sendMessage: send } });
  onReport.mockClear();
  onBusy.mockClear();
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("student-triggered draft card action", () => {
  it("invalidates another card's review when the student reviews a new draft", async () => {
    const second = { ...draft, id: "55555555-5555-4555-8555-555555555555" };
    function Cards() {
      const [owner, setOwner] = React.useState("");
      return React.createElement(
        React.Fragment,
        {},
        ...[draft, second].map((d) =>
          React.createElement(
            "article",
            { key: d.id },
            React.createElement(CoursebinAction, {
              draft: d,
              context,
              disabled: false,
              onBusy,
              onReport,
              reviewOwner: owner,
              onReview: setOwner,
            }),
          ),
        ),
      );
    }
    await act(async () => root.render(React.createElement(Cards)));
    await click(container.querySelectorAll("article button")[0] as HTMLElement);
    expect(container.querySelectorAll(".coursebin-review")).toHaveLength(1);
    await click(
      container.querySelectorAll("article")[1]!.querySelector("button")!,
    );
    expect(
      container
        .querySelectorAll("article")[0]!
        .querySelector(".coursebin-review"),
    ).toBeNull();
    expect(container.querySelectorAll(".coursebin-review")).toHaveLength(1);
  });
  it("shows a definitive expired-ticket error without inventing an interrupted run or replaying a previous report", async () => {
    await render();
    await click(button("Add to coursebin"));
    send.mockResolvedValueOnce({ ok: false, code: "STALE_PROPOSAL" });
    await click(button("Confirm add to Fall 2026 coursebin"));
    expect(container.textContent).toContain("stale");
    expect(container.textContent).not.toContain("reply was interrupted");
    expect(send).toHaveBeenCalledTimes(2);
    expect(onReport).not.toHaveBeenCalled();
  });
  it("works directly from a chat draft with no manually selected courses and requires separate confirmation", async () => {
    await render();
    expect(send).not.toHaveBeenCalled();
    await click(button("Add to coursebin"));
    expect(send.mock.calls.map(([r]) => r.method)).toEqual(["prepare"]);
    expect(send.mock.calls[0]![0].context.course_codes).toEqual([]);
    expect(container.textContent).toContain("TEST101 · 11111 · Lecture");
    expect(container.textContent).toContain("Confirm Fall 2026");
    expect(container.textContent).toContain("Eligibility remains unknown.");
    await click(button("Confirm add to Fall 2026 coursebin"));
    expect(send.mock.calls.map(([r]) => r.method)).toEqual([
      "prepare",
      "execute",
    ]);
    expect(send.mock.calls[1]![0].ticket).toBe(preview.ticket);
    expect(onReport).toHaveBeenCalledWith(report);
    expect(onBusy.mock.calls.map(([value]) => value)).toEqual([
      true,
      false,
      true,
      false,
    ]);
  });
  it("displays blocking findings and cannot confirm unresolved components", async () => {
    preview.blockers = [
      { code: "component_rules", message: "Required components are unknown." },
    ];
    await render();
    await click(button("Add to coursebin"));
    expect(container.textContent).toContain("Required components are unknown.");
    expect(button("Confirm add to Fall 2026 coursebin").disabled).toBe(true);
    await click(button("Confirm add to Fall 2026 coursebin"));
    expect(send.mock.calls).toHaveLength(1);
  });
  it("shows existing sections as skipped and cancellation makes no mutation call", async () => {
    preview.already_present = ["11111"];
    await render();
    await click(button("Add to coursebin"));
    expect(container.textContent).toContain("Already in your coursebin");
    await click(button("Cancel review"));
    expect(container.querySelector(".coursebin-review")).toBeNull();
    expect(send.mock.calls).toHaveLength(1);
  });
  it("invalidates review when planner semester or constraints change", async () => {
    await render();
    await click(button("Add to coursebin"));
    await render(
      planningContext.parse({ ...context, constraints: { earliest: "12:00" } }),
    );
    expect(container.querySelector(".coursebin-review")).toBeNull();
    expect(send.mock.calls).toHaveLength(1);
  });
  it("disables expired reviews", async () => {
    preview.expires_at = Date.now() - 1;
    await render();
    await click(button("Add to coursebin"));
    expect(button("Confirm add to Fall 2026 coursebin").disabled).toBe(true);
    expect(container.textContent).toContain("This review expired");
  });
  it("shows structured unconfirmed results without claiming success or an applied replacement", async () => {
    await act(async () =>
      root.render(React.createElement(CoursebinResult, { report })),
    );
    expect(container.textContent).toContain("11111: unconfirmed");
    expect(container.textContent).toContain(
      "Inspect the coursebin before retrying",
    );
    expect(container.querySelector("pre")!.textContent).toBe(
      JSON.stringify(report, null, 2),
    );
    expect(send).not.toHaveBeenCalled();
  });
});
