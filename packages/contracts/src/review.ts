import { z } from "zod";

export function isOfficialUscUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return (
      u.protocol === "https:" &&
      (u.hostname === "usc.edu" || u.hostname.endsWith(".usc.edu")) &&
      !u.username &&
      !u.password &&
      !u.port &&
      !u.search
    );
  } catch {
    return false;
  }
}
export const officialUscUrl = z
  .string()
  .max(1000)
  .url()
  .refine(isOfficialUscUrl);
export const clearanceRoute = z
  .object({
    id: z.string().max(100),
    title: z.string().max(160),
    url: officialUscUrl,
    audience: z.string().max(240),
    note: z.string().max(600),
    kind: z.enum(["department_instructions", "catalog_directory"]),
    source_url: officialUscUrl,
    verified_at: z.iso.datetime(),
    review_after: z.iso.datetime(),
    stale: z.boolean(),
  })
  .strict();
export const clearanceGuidance = z
  .object({
    course_code: z.string().max(24),
    registry_version: z.string().max(60),
    coverage_status: z.enum([
      "department_instructions",
      "catalog_only",
      "unresolved",
    ]),
    routes: z.array(clearanceRoute).max(5),
    warnings: z.array(z.string().max(600)).max(8),
  })
  .strict();
export const sectionClearance = z
  .object({
    requirement: z.enum(["required", "not_indicated", "unknown"]),
    approval_status: z.literal("unknown"),
    guidance: clearanceGuidance,
  })
  .strict();
export const checkStatus = z.enum(["pass", "fail", "unknown"]);
export const checkEvidence = z
  .object({
    policy_version: z.string().max(100),
    verified_on: z.iso.date(),
    sources: z
      .array(
        z.object({ title: z.string().max(100), url: officialUscUrl }).strict(),
      )
      .min(1)
      .max(3),
  })
  .strict();
export const validationCheck = z.object({
  code: z.string().max(100),
  status: checkStatus,
  message: z.string().max(1000),
  section_ids: z
    .array(z.string().regex(/^\d{5}$/))
    .max(100)
    .optional(),
  evidence: checkEvidence.optional(),
});
export const reviewSummary = z
  .object({
    compatibility: checkStatus,
    components: checkStatus,
    availability: z.enum(["seats_reported", "full", "unknown"]),
    eligibility: z.literal("unknown"),
  })
  .strict();
export const validationReview = z
  .object({
    status: z.enum(["feasible", "infeasible", "indeterminate"]),
    units: z.number().nonnegative().nullable(),
    checks: z.array(validationCheck).max(10000),
    eligibility: z.object({
      status: z.literal("unknown"),
      message: z.string(),
    }),
    summary: reviewSummary,
    availability: z
      .array(
        z.object({
          section_id: z.string().regex(/^\d{5}$/),
          available_seats: z.number().int().nonnegative().nullable(),
          d_clearance: z.boolean().nullable(),
          checked_at: z.string(),
          warning: z.string(),
          clearance: sectionClearance,
        }),
      )
      .max(100),
  })
  .passthrough();
export type ClearanceGuidance = z.infer<typeof clearanceGuidance>;
export type ClearanceRoute = z.infer<typeof clearanceRoute>;
export type ValidationReview = z.infer<typeof validationReview>;
export type ValidationCheck = z.infer<typeof validationCheck>;
