import type { Course, Section, Meeting } from "../../contracts/src/index.js";
import { inputs } from "../../contracts/src/index.js";
import type { z } from "zod";
import { validationReview } from "../../contracts/src/review.js";
import { clearanceForSection } from "./clearance.js";
import { checkComponents } from "./components.js";
import type { ValidationCheck } from "../../contracts/src/review.js";
type Request = z.infer<typeof inputs.validate_schedule>;
export type Check = ValidationCheck;
const intersects = (a: string[], b: string[]) => a.some((d) => b.includes(d));
const dayNumbers = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const timed = (m: Meeting) =>
  !!m.start &&
  !!m.end &&
  /^([01]\d|2[0-3]):[0-5]\d$/.test(m.start) &&
  /^([01]\d|2[0-3]):[0-5]\d$/.test(m.end) &&
  m.start < m.end &&
  m.days.length > 0 &&
  m.days.every((d) => dayNumbers.includes(d));
function date(value: string | null): number | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const n = Date.parse(value + "T00:00:00Z");
  return Number.isFinite(n) && new Date(n).toISOString().slice(0, 10) === value
    ? n
    : null;
}
function range(m: Meeting): [number, number] | null {
  const start = date(m.start_date),
    end = date(m.end_date);
  return start !== null && end !== null && start <= end ? [start, end] : null;
}
function occurs(start: number, end: number, days: string[]) {
  const firstDay = new Date(start).getUTCDay();
  return days.some(
    (d) =>
      start + ((dayNumbers.indexOf(d) - firstDay + 7) % 7) * 86400000 <= end,
  );
}
// Calendar arithmetic uses UTC midnight solely to represent local calendar dates.
// A shared session identifier is not evidence of shared actual meeting dates.
function dateOverlap(a: Meeting, b: Meeting): boolean | null {
  const x = range(a),
    y = range(b);
  if (!x || !y) return null;
  const start = Math.max(x[0], y[0]),
    end = Math.min(x[1], y[1]);
  return (
    start <= end &&
    occurs(
      start,
      end,
      a.days.filter((d) => b.days.includes(d)),
    )
  );
}
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
    checks.push(
      checkComponents(
        request.term_code,
        c,
        sections.filter((s) => s.course_key === c.key),
        chosen,
      ),
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
    if (s.meetings.some((m) => !range(m)))
      add(
        "unknown_dates",
        "unknown",
        `Section ${s.id} has a missing or invalid meeting date range.`,
        [s.id],
      );
    for (const m of s.meetings.filter(timed)) {
      const dates = range(m);
      if (dates && !occurs(dates[0], dates[1], m.days)) {
        add(
          "invalid_recurrence",
          "unknown",
          `Section ${s.id}'s meeting days do not occur within its date range.`,
          [s.id],
        );
        continue;
      }
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
            dateOverlap(x, y) !== false &&
            intersects(x.days, y.days) &&
            x.start! < y.end! &&
            y.start! < x.end!
          ) {
            const confirmed = dateOverlap(x, y) === true;
            add(
              "time_conflict",
              confirmed ? "fail" : "unknown",
              `Sections ${a.id} and ${b.id} overlap in their weekly meeting times${confirmed ? " and verified date ranges." : "; actual date overlap is unknown."}`,
              [a.id, b.id],
            );
          }
        }
    }
  let units = 0,
    unitsKnown =
      requested.length === request.requested_courses.length &&
      selected.length === request.section_ids.length &&
      new Set(requested.map((c) => c.key)).size === requested.length;
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
    !checks.some((c) =>
      ["unknown_time", "section_missing", "invalid_recurrence"].includes(
        c.code,
      ),
    )
  )
    add(
      "known_time_conflicts",
      "pass",
      "No overlap found using the known meeting times and available date ranges.",
    );
  const statusOf = (items: Check[]) =>
    items.some((c) => c.status === "fail")
      ? ("fail" as const)
      : items.some((c) => c.status === "unknown")
        ? ("unknown" as const)
        : ("pass" as const);
  const availability = selected.map((s) => {
    const c = courses.find((c) => c.key === s.course_key);
    if (!c) throw new Error("Section has no source course");
    return {
      section_id: s.id,
      available_seats:
        s.total_seats === null || s.registered_seats === null
          ? null
          : Math.max(0, s.total_seats - s.registered_seats),
      d_clearance: s.d_clearance,
      checked_at: s.checked_at,
      warning: "Snapshot only; no seat is reserved.",
      clearance: clearanceForSection(c, s, request.term_code),
    };
  });
  return validationReview.parse({
    status: checks.some((c) => c.status === "fail")
      ? "infeasible"
      : checks.some((c) => c.status === "unknown")
        ? "indeterminate"
        : "feasible",
    checks,
    summary: {
      compatibility: statusOf(
        checks.filter((c) => c.code !== "component_rules"),
      ),
      components: statusOf(
        checks.filter((c) =>
          [
            "component_rules",
            "course_coverage",
            "course_missing_or_ambiguous",
            "section_missing",
          ].includes(c.code),
        ),
      ),
      availability: availability.some((s) => s.available_seats === 0)
        ? "full"
        : availability.length !== request.section_ids.length ||
            availability.some((s) => s.available_seats === null)
          ? "unknown"
          : "seats_reported",
      eligibility: "unknown",
    },
    units: unitsKnown ? units : null,
    eligibility: {
      status: "unknown",
      message:
        "Public course data does not establish personal enrollment eligibility.",
    },
    availability,
    preferences: {
      preferred_instructors_present:
        request.constraints.preferences.instructors.filter((n) =>
          selected.some((s) => s.instructors.includes(n)),
        ),
      requested_free_days_met: selected.some(
        (s) =>
          !s.meetings.length ||
          s.meetings.some(
            (m) =>
              !m.days.length || m.days.some((d) => !dayNumbers.includes(d)),
          ),
      )
        ? []
        : request.constraints.preferences.free_days.filter(
            (d) =>
              !selected.some((s) => s.meetings.some((m) => m.days.includes(d))),
          ),
    },
    sections: selected,
  });
}
