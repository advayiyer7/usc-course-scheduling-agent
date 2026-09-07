import type { Course, Section } from "../../contracts/src/index.js";
import type { ValidationCheck } from "../../contracts/src/review.js";
import {
  componentPolicies,
  componentPolicyTerm,
  componentPolicyEvidence,
} from "../../source-usc/src/component-policies.js";

const noInstructions = (value: string | null | undefined) =>
  value === null || (typeof value === "string" && value.trim() === "");

export function checkComponents(
  term: number,
  course: Course,
  offered: Section[],
  selected: Section[],
): ValidationCheck {
  const result = (
    status: ValidationCheck["status"],
    message: string,
    evidence = false,
  ): ValidationCheck => ({
    code: "component_rules",
    status,
    message,
    section_ids: selected.map((s) => s.id),
    ...(evidence ? { evidence: componentPolicyEvidence } : {}),
  });
  const policy = Object.hasOwn(componentPolicies, course.key)
    ? componentPolicies[course.key as keyof typeof componentPolicies]
    : undefined;
  if (
    term !== componentPolicyTerm ||
    !policy ||
    course.programs.length !== 1 ||
    course.programs[0] !== policy.program
  )
    return result(
      "unknown",
      `Required component and link rules for ${course.code} are not yet verified.`,
    );
  const inventory = course.section_ids;
  if (
    !inventory?.length ||
    inventory.length !== new Set(inventory).size ||
    offered.length !== inventory.length ||
    new Set(offered.map((s) => s.id)).size !== offered.length ||
    offered.some(
      (s) => s.course_key !== course.key || !inventory.includes(s.id),
    )
  )
    return result(
      "unknown",
      `${course.code}: a complete normalized section inventory is required. Refresh course data and recheck.`,
    );
  if (
    !course.registration_notes ||
    !noInstructions(course.registration_notes.course) ||
    !noInstructions(course.registration_notes.term) ||
    offered.some((s) => !noInstructions(s.registration_notes))
  )
    return result(
      "unknown",
      `${course.code}: registration notes are missing or contain instructions outside the verified profile. Refresh or obtain department guidance.`,
    );
  // The reviewed pilot supports only regular-session, explicitly unlinked
  // components. Combined modes, partial links and new types need fresh evidence.
  const types = new Set<string>(policy.types);
  if (
    offered.some(
      (s) =>
        s.link_code !== null || s.session_code !== "001" || !types.has(s.type),
    ) ||
    [...types].some((type) => !offered.some((s) => s.type === type))
  )
    return result(
      "unknown",
      `${course.code}: section types, sessions or links differ from the verified Fall 2026 profile.`,
    );
  if (
    selected.some(
      (s) => !inventory.includes(s.id) || s.course_key !== course.key,
    )
  )
    return result(
      "unknown",
      `${course.code}: a selected section is outside its verified inventory.`,
    );
  const errors = [...types].flatMap((type) => {
    const count = selected.filter((s) => s.type === type).length;
    return count === 1
      ? []
      : [`${type}: ${count} selected, exactly 1 required`];
  });
  if (errors.length)
    return result("fail", `${course.code}: ${errors.join("; ")}.`, true);
  return result(
    "pass",
    `${course.code}: one ${[...types].join(", one ")} selected; the complete source inventory has no lecture-specific links or additional registration notes.`,
    true,
  );
}
