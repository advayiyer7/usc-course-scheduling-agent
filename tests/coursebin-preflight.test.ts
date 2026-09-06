import { describe, expect, it, vi } from "vitest";
import { preflight } from "../apps/extension/src/coursebin/preflight.js";
import {
  planningContext,
  proposal,
} from "../packages/contracts/src/companion.js";

const snapshot = "11111111-1111-4111-8111-111111111111";
const checkedAt = "2026-09-06T20:00:00.000Z";
const check = (code: string, status: "pass" | "fail" | "unknown") => ({
  code,
  status,
  message: `Synthetic ${code} finding`,
});
function validation() {
  return {
    data: {
      status: "feasible" as "feasible" | "infeasible" | "indeterminate",
      checks: [
        check("component_rules", "pass"),
        check("known_time_conflicts", "pass"),
      ],
      sections: ["10001", "10002"].map((id, index) => ({
        id,
        course_key: `TEST${index ? "200" : "100"}`,
        type: "Lec",
        cancelled: false,
        meetings: [
          {
            days: ["Mon"],
            start: index ? "12:00" : "10:00",
            end: index ? "13:00" : "11:00",
          },
        ],
      })),
      availability: ["10001", "10002"].map((section_id) => ({
        section_id,
        available_seats: 5 as number | null,
        d_clearance: false as boolean | null,
      })),
    },
    meta: {
      term_code: 20263,
      snapshot_version: snapshot,
      checked_at: checkedAt,
      stale: false,
      warnings: [] as string[],
    },
  };
}
function draft() {
  return proposal.parse({
    id: "22222222-2222-4222-8222-222222222222",
    selection: {
      title: "Synthetic schedule",
      term_code: 20263,
      snapshot_version: snapshot,
      requested_courses: ["TEST100", "TEST200"],
      section_ids: ["10002", "10001"],
      constraints: {},
    },
    validation: validation(),
  });
}
function context() {
  // An empty manual planner must not prevent a draft from being added directly.
  return planningContext.parse({
    term_code: 20263,
    course_codes: [],
    constraints: {},
  });
}
function fetcher(body: unknown = validation(), status = 200) {
  return vi.fn(
    async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      }),
  );
}

describe("coursebin proposal preflight", () => {
  it("revalidates the exact pinned draft without requiring manual planner courses", async () => {
    const selected = draft();
    const original = structuredClone(selected);
    const request = fetcher();
    const result = await preflight(selected, context(), request);
    expect(result.blockers).toEqual([]);
    expect(result.selection).toEqual(selected.selection);
    expect(result.selection.section_ids).toEqual(["10002", "10001"]);
    expect(request).toHaveBeenCalledTimes(1);
    const [url, options] = request.mock.calls[0]!;
    expect(url).toBe("http://127.0.0.1:3000/api/tools/validate_schedule");
    expect(options?.method).toBe("POST");
    const { title: _title, ...input } = selected.selection;
    expect(JSON.parse(String(options?.body))).toEqual(input);
    expect(options?.signal).toBeInstanceOf(AbortSignal);
    expect(selected).toEqual(original);
  });

  it("protects new and older hard constraints and courses when revalidating", async () => {
    const selected = draft();
    selected.selection.constraints = planningContext.parse({
      term_code: 20263,
      course_codes: [],
      constraints: {
        earliest: "09:00",
        latest: "17:00",
        min_units: 8,
        max_units: 16,
        unavailable: [{ days: ["Mon"], start: "11:00", end: "12:00" }],
        preferences: {
          free_days: ["Fri"],
          instructors: ["Synthetic Instructor A"],
        },
      },
    }).constraints;
    const current = planningContext.parse({
      term_code: 20263,
      course_codes: ["TEST300"],
      constraints: {
        earliest: "10:00",
        latest: "18:00",
        min_units: 12,
        max_units: 20,
        unavailable: [{ days: ["Tue"], start: "13:00", end: "14:00" }],
        preferences: {
          free_days: ["Thu"],
          instructors: ["Synthetic Instructor B"],
        },
      },
    });
    const review = validation();
    review.data.status = "infeasible";
    review.data.checks.push(check("course_coverage", "fail"));
    const request = fetcher(review);
    const result = await preflight(selected, current, request);
    expect(JSON.parse(String(request.mock.calls[0]?.[1]?.body))).toMatchObject({
      requested_courses: ["TEST300", "TEST100", "TEST200"],
      section_ids: ["10002", "10001"],
      constraints: {
        earliest: "10:00",
        latest: "17:00",
        min_units: 12,
        max_units: 16,
        unavailable: [
          { days: ["Mon"], start: "11:00", end: "12:00" },
          { days: ["Tue"], start: "13:00", end: "14:00" },
        ],
        preferences: {
          free_days: ["Thu", "Fri"],
          instructors: ["Synthetic Instructor B", "Synthetic Instructor A"],
        },
      },
    });
    expect(result.blockers.map((b) => b.code)).toContain("course_coverage");
  });

  it("rejects a draft from a different current semester before contacting the backend", async () => {
    const request = fetcher();
    const current = context();
    current.term_code = 20271;
    await expect(preflight(draft(), current, request)).rejects.toThrow(
      /semester/,
    );
    expect(request).not.toHaveBeenCalled();
  });

  it("rejects contradictory newer constraints before contacting the backend", async () => {
    const selected = draft();
    selected.selection.constraints.earliest = "11:00";
    const current = context();
    current.constraints.latest = "10:00";
    const request = fetcher();
    await expect(preflight(selected, current, request)).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
  });

  it.each(["stale", "snapshot", "semester", "timestamp"] as const)(
    "rejects stale or inconsistent revalidation metadata: %s",
    async (field) => {
      const review = validation();
      if (field === "stale") review.meta.stale = true;
      if (field === "snapshot")
        review.meta.snapshot_version = "33333333-3333-4333-8333-333333333333";
      if (field === "semester") review.meta.term_code = 20271;
      if (field === "timestamp") review.meta.checked_at = "invalid date";
      await expect(
        preflight(draft(), context(), fetcher(review)),
      ).rejects.toMatchObject({ code: "STALE_PROPOSAL" });
    },
  );

  it("does not fall back to the draft's cached validation when revalidation fails", async () => {
    await expect(
      preflight(
        draft(),
        context(),
        fetcher({ error: "Snapshot expired" }, 410),
      ),
    ).rejects.toMatchObject({ code: "STALE_PROPOSAL" });
  });

  it.each(["missing", "duplicate", "replacement", "extra"] as const)(
    "rejects a backend result with %s section identities instead of the exact selection",
    async (change) => {
      const review = validation();
      if (change === "missing") review.data.sections.pop();
      if (change === "duplicate") review.data.sections[1]!.id = "10001";
      if (change === "replacement") review.data.sections[1]!.id = "10009";
      if (change === "extra")
        review.data.sections.push({ ...review.data.sections[0]!, id: "10009" });
      await expect(
        preflight(draft(), context(), fetcher(review)),
      ).rejects.toMatchObject({ code: "VALIDATION_BLOCKED" });
    },
  );

  it("rejects duplicate selected IDs before backend validation", async () => {
    const selected = draft();
    selected.selection.section_ids = ["10001", "10001"];
    const request = fetcher();
    await expect(preflight(selected, context(), request)).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
  });

  it("fails closed on a malformed validation response", async () => {
    await expect(
      preflight(draft(), context(), fetcher({ data: { status: "feasible" } })),
    ).rejects.toMatchObject({ code: "VALIDATION_BLOCKED" });
  });

  it.each([
    ["component_rules", "unknown"],
    ["component_rules", "fail"],
    ["time_conflict", "unknown"],
    ["time_conflict", "fail"],
    ["unknown_time", "unknown"],
    ["section_missing", "unknown"],
    ["course_missing_or_ambiguous", "unknown"],
    ["time_window", "fail"],
    ["units_unknown", "unknown"],
    ["new_unclassified_rule", "unknown"],
  ] as const)("blocks %s findings with status %s", async (code, status) => {
    const review = validation();
    review.data.status = status === "fail" ? "infeasible" : "indeterminate";
    review.data.checks = review.data.checks.filter((c) => c.code !== code);
    review.data.checks.push(check(code, status));
    const result = await preflight(draft(), context(), fetcher(review));
    expect(result.blockers.map((b) => b.code)).toContain(code);
  });

  it("requires explicit component assessment even when the validator says feasible", async () => {
    const review = validation();
    review.data.checks = review.data.checks.filter(
      (c) => c.code !== "component_rules",
    );
    const result = await preflight(draft(), context(), fetcher(review));
    expect(result.blockers.map((b) => b.code)).toContain("component_rules");
  });

  it("blocks cancelled sections and otherwise unexplained infeasible results", async () => {
    const review = validation();
    review.data.status = "infeasible";
    review.data.sections[0]!.cancelled = true;
    const result = await preflight(draft(), context(), fetcher(review));
    expect(result.blockers.map((b) => b.code)).toEqual(
      expect.arrayContaining(["cancelled", "infeasible"]),
    );
  });

  it("shows uncertainty, capacity and clearance as explicit warnings without claiming eligibility", async () => {
    const review = validation();
    review.data.status = "indeterminate";
    review.data.checks.push(
      check("unknown_dates", "unknown"),
      check("eligibility", "unknown"),
      check("d_clearance", "unknown"),
    );
    review.data.availability[0]!.available_seats = 0;
    review.data.availability[0]!.d_clearance = true;
    review.data.availability[1]!.available_seats = null;
    review.data.availability[1]!.d_clearance = null;
    review.meta.warnings.push("Synthetic source freshness warning");
    const result = await preflight(draft(), context(), fetcher(review));
    expect(result.blockers).toEqual([]);
    expect(result.warnings.map((w) => w.code)).toEqual(
      expect.arrayContaining([
        "unknown_dates",
        "eligibility",
        "d_clearance",
        "full",
        "source_warning",
      ]),
    );
    expect(
      result.warnings.some((w) =>
        /individual approval is unknown/.test(w.message),
      ),
    ).toBe(true);
    expect(
      result.warnings.some((w) => /reserves no seat/.test(w.message)),
    ).toBe(true);
    expect(result.warnings.some((w) => /10001.*full/.test(w.message))).toBe(
      true,
    );
  });
});
