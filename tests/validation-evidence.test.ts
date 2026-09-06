import { it, expect } from "vitest";
import { inputs } from "../packages/contracts/src/index.js";
import { normalize } from "../packages/source-usc/src/schema.js";
import { validate } from "../packages/domain/src/validate.js";
import { response, course, sourceSection } from "./fixtures.js";
function fixture() {
  const courses = normalize(20263, [
    response([
      course(),
      course("TEST200", [sourceSection("10002", "10:30", "11:30")]),
    ]),
  ]);
  const sections = courses.flatMap((c) => c.sections);
  const request = inputs.validate_schedule.parse({
    term_code: 20263,
    snapshot_version: "11111111-1111-4111-8111-111111111111",
    requested_courses: ["TEST100", "TEST200"],
    section_ids: ["10001", "10002"],
  });
  return { courses, sections, request };
}
it("does not infer shared actual dates from equal session identifiers", () => {
  const f = fixture(),
    r = validate(f.request, f.courses, f.sections);
  expect(r.checks.find((c) => c.code === "time_conflict")?.status).toBe(
    "unknown",
  );
  expect(r.status).toBe("indeterminate");
  expect(r.summary.compatibility).toBe("unknown");
});
it("requires a shared meeting weekday inside overlapping date ranges", () => {
  const f = fixture();
  Object.assign(f.sections[0]!.meetings[0]!, {
    start_date: "2026-08-24",
    end_date: "2026-08-30",
  });
  Object.assign(f.sections[1]!.meetings[0]!, {
    start_date: "2026-08-29",
    end_date: "2026-09-07",
  });
  expect(
    validate(f.request, f.courses, f.sections).checks.some(
      (c) => c.code === "time_conflict",
    ),
  ).toBe(false);
  f.sections[0]!.meetings[0]!.end_date = "2026-08-31";
  expect(
    validate(f.request, f.courses, f.sections).checks.find(
      (c) => c.code === "time_conflict",
    )?.status,
  ).toBe("fail");
});
it("treats invalid calendar dates and impossible recurrence as unknown", () => {
  const f = fixture();
  Object.assign(f.sections[0]!.meetings[0]!, {
    start_date: "2026-02-30",
    end_date: "2026-08-31",
  });
  expect(
    validate(f.request, f.courses, f.sections).checks.some(
      (c) => c.code === "unknown_dates",
    ),
  ).toBe(true);
  Object.assign(f.sections[0]!.meetings[0]!, {
    start_date: "2026-08-29",
    end_date: "2026-08-30",
  });
  expect(
    validate(f.request, f.courses, f.sections).checks.some(
      (c) => c.code === "invalid_recurrence",
    ),
  ).toBe(true);
});
it("does not report partial units or successful overlap checks when requested records are missing", () => {
  const f = fixture();
  f.request.section_ids.push("99999");
  f.request.requested_courses.push("TEST999");
  const r = validate(f.request, f.courses, f.sections);
  expect(r.units).toBeNull();
  expect(r.checks.some((c) => c.code === "known_time_conflicts")).toBe(false);
  expect(r.summary.availability).toBe("unknown");
});
it("keeps full seats and required clearance separate from time feasibility", () => {
  const f = fixture();
  for (const s of f.sections)
    Object.assign(s.meetings[0]!, {
      start_date: "2026-08-24",
      end_date: "2026-12-04",
    });
  f.sections[1]!.meetings[0]!.days = ["Tue"];
  f.sections[0]!.registered_seats = f.sections[0]!.total_seats;
  f.sections[0]!.d_clearance = true;
  const r = validate(f.request, f.courses, f.sections);
  expect(r.summary).toEqual({
    compatibility: "pass",
    components: "unknown",
    availability: "full",
    eligibility: "unknown",
  });
  expect(r.status).toBe("indeterminate");
  expect(r.availability[0]!.clearance.requirement).toBe("required");
});
it("does not mark a preferred free day satisfied when meeting days are unknown", () => {
  const f = fixture();
  f.sections[0]!.meetings[0]!.days = [];
  f.request.constraints.preferences.free_days = ["Fri"];
  const r = validate(f.request, f.courses, f.sections);
  expect(r.preferences).toMatchObject({ requested_free_days_met: [] });
});
it("rejects duplicate aliases of one course without double-counting units", () => {
  const f = fixture();
  f.courses[0]!.aliases.push("OTHR100");
  f.request.requested_courses = ["TEST100", "OTHR100"];
  f.request.section_ids = ["10001"];
  const r = validate(f.request, f.courses, f.sections);
  expect(r.checks.find((c) => c.code === "duplicate_alias")?.status).toBe(
    "fail",
  );
  expect(r.units).toBeNull();
});
