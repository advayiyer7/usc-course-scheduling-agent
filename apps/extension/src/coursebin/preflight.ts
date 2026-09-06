import { z } from "zod";
import {
  protectConstraints,
  type Proposal,
  type planningContext,
} from "../../../../packages/contracts/src/companion.js";
import { inputs } from "../../../../packages/contracts/src/index.js";
import {
  CoursebinError,
  type Finding,
} from "../../../../packages/contracts/src/coursebin.js";

const review = z.object({
  data: z.object({
    status: z.enum(["feasible", "infeasible", "indeterminate"]),
    checks: z.array(
      z.object({
        code: z.string(),
        status: z.enum(["pass", "fail", "unknown"]),
        message: z.string(),
      }),
    ),
    sections: z.array(
      z.object({
        id: z.string(),
        course_key: z.string(),
        type: z.string(),
        cancelled: z.boolean(),
        meetings: z.array(
          z.object({
            days: z.array(z.string()),
            start: z.string().nullable(),
            end: z.string().nullable(),
          }),
        ),
      }),
    ),
    availability: z.array(
      z.object({
        section_id: z.string(),
        available_seats: z.number().nullable(),
        d_clearance: z.boolean().nullable(),
      }),
    ),
  }),
  meta: z.object({
    snapshot_version: z.string().uuid(),
    term_code: z.number(),
    checked_at: z.string(),
    stale: z.boolean(),
    warnings: z.array(z.string()),
  }),
});

// Explicit allowance: uncertain personal eligibility/dates do not certify enrollment.
// Unknown new check types fail closed until the validator owner assigns a policy.
const advisoryUnknown = new Set([
  "unknown_dates",
  "eligibility",
  "d_clearance",
]);
export async function preflight(
  draft: Proposal,
  context: z.infer<typeof planningContext>,
  fetcher: typeof fetch = fetch,
) {
  const selection = protectConstraints(draft.selection, context);
  const { title: _title, ...request } = selection;
  const response = await fetcher(
    "http://127.0.0.1:3000/api/tools/validate_schedule",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(inputs.validate_schedule.parse(request)),
      signal: AbortSignal.timeout(15000),
    },
  );
  if (!response.ok) throw new CoursebinError("STALE_PROPOSAL");
  const parsed = review.safeParse(await response.json());
  if (!parsed.success) throw new CoursebinError("VALIDATION_BLOCKED");
  const { data, meta } = parsed.data;
  if (
    meta.snapshot_version !== selection.snapshot_version ||
    meta.term_code !== selection.term_code ||
    meta.stale ||
    !Number.isFinite(Date.parse(meta.checked_at))
  )
    throw new CoursebinError("STALE_PROPOSAL");
  if (
    data.sections.length !== selection.section_ids.length ||
    new Set(data.sections.map((s) => s.id)).size !== data.sections.length ||
    !data.sections.every((s) => selection.section_ids.includes(s.id))
  )
    throw new CoursebinError("VALIDATION_BLOCKED");
  const blockers: Finding[] = [],
    warnings: Finding[] = [];
  for (const check of data.checks) {
    if (
      check.status === "fail" ||
      (check.status === "unknown" && !advisoryUnknown.has(check.code))
    )
      blockers.push(check);
    else if (check.status === "unknown") warnings.push(check);
  }
  if (data.status === "infeasible" && !blockers.length)
    blockers.push({
      code: "infeasible",
      message: "The shared validator rejected this selection.",
    });
  if (data.sections.some((s) => s.cancelled))
    blockers.push({
      code: "cancelled",
      message: "A selected section is cancelled.",
    });
  // Require actual component assessment, not absence of a finding.
  if (!data.checks.some((c) => c.code === "component_rules"))
    blockers.push({
      code: "component_rules",
      message: "Required component rules have not been assessed.",
    });
  for (const s of data.availability) {
    if (s.available_seats === 0)
      warnings.push({
        code: "full",
        message: `Section ${s.section_id} was full in the snapshot. WebReg capacity must be checked.`,
      });
    if (s.d_clearance !== false)
      warnings.push({
        code: "d_clearance",
        message: `Section ${s.section_id}: clearance ${s.d_clearance ? "required" : "requirement unknown"}; individual approval is unknown.`,
      });
  }
  warnings.push({
    code: "eligibility",
    message:
      "Adding reserves no seat and does not establish eligibility or clearance. Complete registration yourself in WebReg.",
  });
  warnings.push(
    ...meta.warnings.map((message) => ({ code: "source_warning", message })),
  );
  return { selection, data, blockers, warnings };
}
