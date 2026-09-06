import { it, expect } from "vitest";
import { inputs } from "../packages/contracts/src/index.js";
import { normalize } from "../packages/source-usc/src/schema.js";
import { validate } from "../packages/domain/src/validate.js";
import { response, sourceSection, course } from "./fixtures.js";
const request = (ids: string[], extra: Record<string, unknown> = {}) =>
  inputs.validate_schedule.parse({
    term_code: 20263,
    snapshot_version: "11111111-1111-4111-8111-111111111111",
    requested_courses: ["TEST100", "TEST200"],
    section_ids: ids,
    constraints: extra,
  });
function data(start: string) {
  const courses = normalize(20263, [
    response([
      course(),
      course("TEST200", [sourceSection("10002", start, "12:00")]),
    ]),
  ]);
  return { courses, sections: courses.flatMap((c) => c.sections) };
}
it("detects overlap while keeping personal eligibility unknown", () => {
  const d = data("10:30");
  const r = validate(request(["10001", "10002"]), d.courses, d.sections);
  expect(r.status).toBe("infeasible");
  expect(
    r.checks.some((c) => c.code === "time_conflict" && c.status === "fail"),
  ).toBe(true);
  expect(r.eligibility.status).toBe("unknown");
});
it("allows exact boundaries but reports unverified component/date rules", () => {
  const d = data("11:00");
  const r = validate(request(["10001", "10002"]), d.courses, d.sections);
  expect(r.status).toBe("indeterminate");
  expect(r.checks.some((c) => c.code === "time_conflict")).toBe(false);
  expect(r.units).toBe(8);
});
it("treats unknown times as unresolved and detects missing requested courses", () => {
  const d = data("11:00");
  d.sections[0]!.meetings[0]!.start = null;
  const r = validate(request(["10001"]), d.courses, d.sections);
  expect(r.checks.some((c) => c.code === "unknown_time")).toBe(true);
  expect(
    r.checks.some((c) => c.code === "course_coverage" && c.status === "fail"),
  ).toBe(true);
});
it("respects known disjoint dates and hard unavailable blocks", () => {
  const d = data("10:30");
  Object.assign(d.sections[0]!.meetings[0]!, {
    start_date: "2026-08-01",
    end_date: "2026-08-31",
  });
  Object.assign(d.sections[1]!.meetings[0]!, {
    start_date: "2026-09-01",
    end_date: "2026-12-01",
  });
  const r = validate(
    request(["10001", "10002"], {
      unavailable: [{ days: ["Mon"], start: "10:00", end: "11:00" }],
    }),
    d.courses,
    d.sections,
  );
  expect(r.checks.some((c) => c.code === "time_conflict")).toBe(false);
  expect(r.checks.some((c) => c.code === "unavailable")).toBe(true);
});
it("rejects cancelled choices, duplicate aliases, and variable unit certainty", () => {
  const d = data("11:00");
  d.sections[0]!.cancelled = true;
  d.sections[0]!.units = [1, 4];
  const r = validate(request(["10001", "10002"]), d.courses, d.sections);
  expect(r.status).toBe("infeasible");
  expect(r.units).toBe(null);
});
it("does not count zero-unit labs as extra credit and surfaces unit limits", () => {
  const d = data("11:00");
  const lab = structuredClone(d.sections[0]!);
  lab.id = "10003";
  lab.units = [0];
  lab.type = "Lab";
  lab.meetings[0]!.days = ["Tue"];
  d.sections.push(lab);
  const r = validate(
    request(["10001", "10002", "10003"], { max_units: 7 }),
    d.courses,
    d.sections,
  );
  expect(r.units).toBe(8);
  expect(r.checks.some((c) => c.code === "units_range")).toBe(true);
});
