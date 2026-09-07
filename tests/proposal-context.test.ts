import { expect, it } from "vitest";
import {
  planningContext,
  proposalInput,
  protectConstraints,
} from "../packages/contracts/src/companion.js";

const candidate = proposalInput.parse({
  title: "Earlier draft",
  term_code: 20263,
  snapshot_version: "11111111-1111-4111-8111-111111111111",
  requested_courses: ["TEST100"],
  section_ids: ["10001"],
  constraints: { earliest: "08:00" },
});
it("retains courses, hard limits, unavailable blocks and preferences changed after generation", () => {
  const current = planningContext.parse({
    term_code: 20263,
    course_codes: ["TEST100", "TEST200"],
    constraints: {
      earliest: "11:00",
      latest: "17:00",
      min_units: 12,
      max_units: 16,
      unavailable: [{ days: ["Mon"], start: "12:00", end: "13:00" }],
      preferences: { free_days: ["Fri"], instructors: ["Current preference"] },
    },
  });
  const merged = protectConstraints(candidate, current);
  expect(merged.requested_courses).toEqual(["TEST100", "TEST200"]);
  expect(merged.constraints).toEqual(current.constraints);
  expect(candidate.constraints.earliest).toBe("08:00");
});
it("rejects drafts from another semester and contradictory newer constraints", () => {
  expect(() =>
    protectConstraints(
      candidate,
      planningContext.parse({
        term_code: 20271,
        course_codes: [],
        constraints: {},
      }),
    ),
  ).toThrow("semester");
  expect(() =>
    protectConstraints(
      candidate,
      planningContext.parse({
        term_code: 20263,
        course_codes: [],
        constraints: { latest: "07:00" },
      }),
    ),
  ).toThrow();
});
it("rejects a removed course through its old code or a cross-listed alias, including an emptied planner", () => {
  const current = planningContext.parse({
    term_code: 20263,
    course_codes: [],
    removed_courses: [
      { course_code: "TEST100", aliases: ["TEST100", "OTHR100"] },
    ],
    constraints: {},
  });
  for (const code of ["TEST100", "OTHR100"])
    expect(() =>
      protectConstraints({ ...candidate, requested_courses: [code] }, current),
    ).toThrow("removed");
  expect(
    protectConstraints(
      { ...candidate, requested_courses: ["TEST200"] },
      current,
    ).requested_courses,
  ).toEqual(["TEST200"]);
  expect(
    protectConstraints(candidate, { ...current, removed_courses: [] })
      .requested_courses,
  ).toEqual(["TEST100"]);
});
