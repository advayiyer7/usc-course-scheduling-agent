import {
  termCode,
  type Course,
  type Section,
} from "../../contracts/src/index.js";
import {
  clearanceGuidance,
  sectionClearance,
  type ClearanceRoute,
} from "../../contracts/src/review.js";
import {
  clearanceRegistry,
  CLEARANCE_REGISTRY_VERSION,
  DIRECTORY_EVIDENCE,
  VERIFIED_AT,
  REVIEW_AFTER,
} from "../../source-usc/src/clearance-registry.js";

export function guidanceForCourse(
  course: Course,
  term: number,
  now = Date.now(),
) {
  termCode.parse(term);
  // Routing follows the scheduled identity, not the alias a student searched for.
  const match = /^([A-Z]{2,8})(\d{3})[A-Z]{0,3}$/.exec(course.key);
  const prefix = match?.[1],
    number = Number(match?.[2]);
  const pairs = course.programs
    .map((p) => p.split("/"))
    .filter(
      (p): p is [string, string] =>
        p.length === 2 &&
        p.every((v) => /^[A-Z]{2,8}$/.test(v!)) &&
        (p[1] === prefix ||
          // Fall 2026's public index groups scheduled SOWK courses under
          // on-campus SWKC and online SWKO; these are source groupings, not aliases.
          (term === 20263 &&
            prefix === "SOWK" &&
            p[0] === "SWDP" &&
            ["SWKC", "SWKO"].includes(p[1]!))),
    );
  const schools = pairs.map((p) => p[0]);
  const stale = now > Date.parse(REVIEW_AFTER);
  const matches = match
    ? clearanceRegistry.filter(
        (e) =>
          e.terms.includes(term) &&
          (!e.prefixes || e.prefixes.includes(prefix!)) &&
          (!e.schools || e.schools.some((s) => schools.includes(s))) &&
          (e.min_number === undefined || number >= e.min_number) &&
          (e.max_number === undefined || number <= e.max_number),
      )
    : [];
  const routes: ClearanceRoute[] = matches.slice(0, 3).map((e) => ({
    id: e.id,
    title: e.title,
    url: e.url,
    audience: e.audience,
    note: e.note,
    kind: "department_instructions" as const,
    source_url: e.url,
    verified_at: VERIFIED_AT,
    review_after: REVIEW_AFTER,
    stale,
  }));
  for (const [school, program] of pairs.slice(0, 2))
    routes.push({
      id: `catalog-${school}-${program}`,
      title: `${program} official semester instructions`,
      url: `https://classes.usc.edu/term/${term}/catalogue/school/${school}/program/${program}`,
      audience: "Students seeking this scheduled course",
      note: "Check the departmental clearance information at the top of the program page. This is a directory route, not a verified application form.",
      kind: "catalog_directory",
      source_url: DIRECTORY_EVIDENCE,
      verified_at: VERIFIED_AT,
      review_after: REVIEW_AFTER,
      stale,
    });
  return clearanceGuidance.parse({
    course_code: course.code,
    registry_version: CLEARANCE_REGISTRY_VERSION,
    coverage_status: matches.length
      ? "department_instructions"
      : pairs.length
        ? "catalog_only"
        : "unresolved",
    routes,
    warnings: [
      "Choose the instructions for your student group and current registration period. No clearance request has been submitted or approved by this tool.",
      ...(!matches.length
        ? [
            "No researched department-specific instructions match this course and term. Use its official semester directory or ask the teaching department.",
          ]
        : []),
      ...(stale
        ? [
            "Clearance guidance is due for re-verification; confirm current instructions on USC's site.",
          ]
        : []),
      ...(!pairs.length || new Set(schools).size > 1
        ? [
            "The scheduled course's department could not be uniquely identified from source associations.",
          ]
        : []),
    ],
  });
}
export function clearanceForSection(
  course: Course,
  section: Section,
  term: number,
  now = Date.now(),
) {
  return sectionClearance.parse({
    requirement:
      section.d_clearance === true
        ? "required"
        : section.d_clearance === false
          ? "not_indicated"
          : "unknown",
    approval_status: "unknown",
    guidance: guidanceForCourse(course, term, now),
  });
}
