import type { Course, Section, Meeting } from "../../contracts/src/index.js";
import { inputs } from "../../contracts/src/index.js";
import type { z } from "zod";
type Request = z.infer<typeof inputs.validate_schedule>;
export interface Check {
  code: string;
  status: "pass" | "fail" | "unknown";
  message: string;
  section_ids?: string[];
}
const intersects = (a: string[], b: string[]) => a.some((d) => b.includes(d));
const timed = (m: Meeting) =>
  !!m.start && !!m.end && m.start < m.end && m.days.length > 0;
const dateOverlap = (a: Meeting, b: Meeting) =>
  !a.start_date ||
  !a.end_date ||
  !b.start_date ||
  !b.end_date ||
  (a.start_date <= b.end_date && b.start_date <= a.end_date);
export function validate(
  request: Request,
  courses: Course[],
  sections: Section[],
) {
  const checks: Check[] = [];
  const add = (
    code: string,
    status: Check["status"],
    message: string,
    ids?: string[],
  ) => checks.push({ code, status, message, section_ids: ids });
  const selected = request.section_ids.flatMap((id) => {
    const s = sections.find((s) => s.id === id);
    if (!s)
      add(
        "section_missing",
        "unknown",
        `Section ${id} was not found in this snapshot.`,
        [id],
      );
    return s ? [s] : [];
  });
  const requested = request.requested_courses.flatMap((code) => {
    const found = courses.filter((c) => c.aliases.includes(code));
    if (found.length !== 1)
      add(
        "course_missing_or_ambiguous",
        "unknown",
        `Course ${code} could not be uniquely resolved.`,
      );
    return found.length === 1 ? found : [];
  });
  if (new Set(requested.map((c) => c.key)).size !== requested.length)
    add(
      "duplicate_alias",
      "fail",
      "Requested course codes include aliases of the same course.",
    );
  for (const c of requested) {
    const chosen = selected.filter((s) => s.course_key === c.key);
    if (!chosen.length)
      add("course_coverage", "fail", `${c.code} has no selected section.`);
    // Until official linking semantics are verified, even a plausible combination is not certified.
    add(
      "component_rules",
      "unknown",
      `Required component and link rules for ${c.code} are not yet verified.`,
      chosen.map((s) => s.id),
    );
  }
  for (const s of selected) {
    if (!requested.some((c) => c.key === s.course_key))
      add(
        "unrequested_course",
        "fail",
        `Section ${s.id} is outside the requested courses.`,
        [s.id],
      );
    if (s.cancelled)
      add("cancelled", "fail", `Section ${s.id} is cancelled.`, [s.id]);
    if (!s.meetings.length || s.meetings.some((m) => !timed(m)))
      add(
        "unknown_time",
        "unknown",
        `Section ${s.id} has incomplete meeting times.`,
        [s.id],
      );
    if (s.meetings.some((m) => !m.start_date || !m.end_date))
      add(
        "unknown_dates",
        "unknown",
        `Section ${s.id} has no verified meeting date range.`,
        [s.id],
      );
    for (const m of s.meetings.filter(timed)) {
      if (
        (request.constraints.earliest &&
          m.start! < request.constraints.earliest) ||
        (request.constraints.latest && m.end! > request.constraints.latest)
      )
        add(
          "time_window",
          "fail",
          `Section ${s.id} falls outside your required time window.`,
          [s.id],
        );
      if (
        request.constraints.unavailable.some(
          (b) =>
            intersects(b.days, m.days) && m.start! < b.end && b.start < m.end!,
        )
      )
        add(
          "unavailable",
          "fail",
          `Section ${s.id} overlaps an unavailable time block.`,
          [s.id],
        );
    }
  }
  for (let i = 0; i < selected.length; i++)
    for (let j = i + 1; j < selected.length; j++) {
      const a = selected[i]!,
        b = selected[j]!;
      for (const x of a.meetings.filter(timed))
        for (const y of b.meetings.filter(timed)) {
          if (
            dateOverlap(x, y) &&
            intersects(x.days, y.days) &&
            x.start! < y.end! &&
            y.start! < x.end!
          ) {
            const datesKnown =
              x.start_date && x.end_date && y.start_date && y.end_date;
            const sameSession =
              a.session_code !== null && a.session_code === b.session_code;
            add(
              "time_conflict",
              datesKnown || sameSession ? "fail" : "unknown",
              `Sections ${a.id} and ${b.id} overlap in their weekly meeting times${datesKnown || sameSession ? "." : "; session/date overlap is unknown."}`,
              [a.id, b.id],
            );
          }
        }
    }
  let units = 0,
    unitsKnown = true;
  for (const c of requested) {
    const credit = selected.filter(
      (s) => s.course_key === c.key && s.units.some((u) => u > 0),
    );
    if (credit.length !== 1 || credit[0]!.units.length !== 1) {
      unitsKnown = false;
      add(
        "units_unknown",
        "unknown",
        `Select one credit-bearing section and resolve variable units for ${c.code}.`,
      );
    } else units += credit[0]!.units[0]!;
  }
  if (
    unitsKnown &&
    ((request.constraints.min_units !== undefined &&
      units < request.constraints.min_units) ||
      (request.constraints.max_units !== undefined &&
        units > request.constraints.max_units))
  )
    add(
      "units_range",
      "fail",
      "Selected units fall outside the required range.",
    );
  if (
    !checks.some((c) => c.code === "time_conflict") &&
    !checks.some((c) => c.code === "unknown_time")
  )
    add(
      "known_time_conflicts",
      "pass",
      "No overlap among the known weekly meeting times.",
    );
  return {
    status: checks.some((c) => c.status === "fail")
      ? "infeasible"
      : checks.some((c) => c.status === "unknown")
        ? "indeterminate"
        : "feasible",
    checks,
    units: unitsKnown ? units : null,
    eligibility: {
      status: "unknown",
      message:
        "Public course data does not establish personal enrollment eligibility.",
    },
    availability: selected.map((s) => ({
      section_id: s.id,
      available_seats:
        s.total_seats === null || s.registered_seats === null
          ? null
          : Math.max(0, s.total_seats - s.registered_seats),
      d_clearance: s.d_clearance,
      checked_at: s.checked_at,
      warning: "Snapshot only; no seat is reserved.",
    })),
    preferences: {
      preferred_instructors_present:
        request.constraints.preferences.instructors.filter((n) =>
          selected.some((s) => s.instructors.includes(n)),
        ),
      requested_free_days_met: request.constraints.preferences.free_days.filter(
        (d) =>
          !selected.some((s) => s.meetings.some((m) => m.days.includes(d))),
      ),
    },
    sections: selected,
  };
}
