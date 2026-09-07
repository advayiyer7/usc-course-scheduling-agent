import { z } from "zod";
import { constraints, courseCode, inputs, termCode } from "./index.js";

export const NATIVE_HOST = "edu.usc.course_planner";
export const CODEX_VERSION = "0.153.4";
export const MAX_NATIVE_BYTES = 512 * 1024;
export const MAX_SCHEDULE_DRAFTS = 2;
export const removedCourses = z
  .array(
    z
      .object({
        course_code: courseCode,
        aliases: z.array(courseCode).max(30),
      })
      .strict(),
  )
  .max(100);
export const planningContext = z
  .object({
    major: z.string().trim().max(120).default(""),
    term_code: termCode,
    course_codes: z.array(z.string().max(24)).max(20),
    selected_section_ids: z
      .array(z.string().regex(/^\d{5}$/))
      .max(100)
      .optional(),
    snapshot_version: z.string().uuid().optional(),
    removed_courses: removedCourses.optional(),
    constraints,
  })
  .strict();
export const proposalInput = inputs.validate_schedule.extend({
  title: z.string().trim().min(1).max(100),
});
export type ProposalInput = z.infer<typeof proposalInput>;
export const proposal = z.object({
  id: z.string().uuid(),
  selection: proposalInput,
  validation: z
    .object({
      data: z
        .object({ status: z.enum(["feasible", "infeasible", "indeterminate"]) })
        .passthrough(),
      meta: z
        .object({
          snapshot_version: z.string().uuid(),
          checked_at: z.string(),
          stale: z.boolean(),
          warnings: z.array(z.string()),
        })
        .passthrough(),
    })
    .passthrough(),
});
export type Proposal = z.infer<typeof proposal>;
const messageId = z.string().uuid();
export const companionRequest = z.discriminatedUnion("method", [
  z.object({ id: messageId, method: z.literal("status") }).strict(),
  z.object({ id: messageId, method: z.literal("login") }).strict(),
  z.object({ id: messageId, method: z.literal("cancel_login") }).strict(),
  z.object({ id: messageId, method: z.literal("logout") }).strict(),
  z.object({ id: messageId, method: z.literal("reset") }).strict(),
  z.object({ id: messageId, method: z.literal("stop") }).strict(),
  z
    .object({
      id: messageId,
      method: z.literal("chat"),
      text: z.string().trim().min(1).max(6000),
      context: planningContext,
      generation_id: messageId.optional(),
    })
    .strict(),
]);
export type CompanionRequest = z.infer<typeof companionRequest>;
export const accountStatus = z.object({
  authenticated: z.boolean(),
  plan: z.string().max(80).nullable(),
  runtime: z.literal(CODEX_VERSION),
  busy: z.boolean(),
});
export const companionEvent = z.discriminatedUnion("type", [
  z.object({ type: z.literal("status"), status: accountStatus }),
  z.object({ type: z.literal("login"), url: z.string().url() }),
  z.object({ type: z.literal("login_complete"), success: z.boolean() }),
  z.object({
    type: z.literal("message"),
    id: z.string().max(200),
    text: z.string().max(64000),
    complete: z.boolean(),
  }),
  z.object({ type: z.literal("tool"), name: z.string().max(80) }),
  z.object({
    type: z.literal("proposal"),
    proposal,
    generation_id: messageId.optional(),
  }),
  z.object({
    type: z.literal("turn_complete"),
    status: z.enum(["completed", "interrupted", "failed"]),
    generation_id: messageId.optional(),
  }),
  z.object({ type: z.literal("error"), message: z.string().max(1000) }),
  z.object({
    type: z.literal("reply"),
    id: messageId,
    ok: z.boolean(),
    error: z.string().max(1000).optional(),
  }),
]);
export type CompanionEvent = z.infer<typeof companionEvent>;
export function trustedLoginUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return (
      u.protocol === "https:" &&
      u.hostname === "auth.openai.com" &&
      !u.username &&
      !u.password &&
      !u.port
    );
  } catch {
    return false;
  }
}

export function protectConstraints(
  candidate: z.infer<typeof proposalInput>,
  context: z.infer<typeof planningContext>,
) {
  if (candidate.term_code !== context.term_code)
    throw new Error("Proposal semester differs from the current planner");
  const removed = new Set(
    context.removed_courses?.flatMap((c) => [c.course_code, ...c.aliases]) ??
      [],
  );
  const resurrected = candidate.requested_courses.filter((code) =>
    removed.has(code),
  );
  if (resurrected.length)
    throw new Error(
      `These courses were removed from the planner: ${resurrected.join(", ")}. Rebuild the proposal without them. The student can undo a removal to allow it again.`,
    );
  const a = candidate.constraints,
    b = context.constraints;
  const unavailable = [
    ...new Map(
      [...a.unavailable, ...b.unavailable].map((v) => [JSON.stringify(v), v]),
    ).values(),
  ];
  const times = (x?: string, y?: string, latest = false) =>
    x && y ? (latest ? [x, y].sort()[0] : [x, y].sort()[1]) : (x ?? y);
  return proposalInput.parse({
    ...candidate,
    requested_courses: [
      ...new Set([...context.course_codes, ...candidate.requested_courses]),
    ],
    constraints: constraints.parse({
      ...a,
      preferences: {
        instructors: [
          ...new Set([
            ...b.preferences.instructors,
            ...a.preferences.instructors,
          ]),
        ],
        free_days: [
          ...new Set([...b.preferences.free_days, ...a.preferences.free_days]),
        ],
      },
      unavailable,
      earliest: times(a.earliest, b.earliest),
      latest: times(a.latest, b.latest, true),
      min_units:
        a.min_units === undefined
          ? b.min_units
          : b.min_units === undefined
            ? a.min_units
            : Math.max(a.min_units, b.min_units),
      max_units:
        a.max_units === undefined
          ? b.max_units
          : b.max_units === undefined
            ? a.max_units
            : Math.min(a.max_units, b.max_units),
    }),
  });
}
