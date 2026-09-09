import { z } from "zod";
import { constraints, courseCode, termCode } from "./index.js";

export const alertPlan = z
  .object({
    term_code: termCode,
    course_codes: z.array(courseCode).max(20),
    section_ids: z.array(z.string().regex(/^\d{5}$/)).max(100),
    constraints,
  })
  .strict()
  .refine(
    (p) =>
      new Set(p.course_codes).size === p.course_codes.length &&
      new Set(p.section_ids).size === p.section_ids.length,
    "Duplicate selections",
  );
export type AlertPlan = z.infer<typeof alertPlan>;
// Snapshot publication does not change a student's intent. Sorting keeps transport order irrelevant.
export function planIdentity(raw: AlertPlan): string {
  const p = alertPlan.parse(raw);
  return JSON.stringify({
    ...p,
    course_codes: [...p.course_codes].sort(),
    section_ids: [...p.section_ids].sort(),
  });
}
export const watchInput = z
  .object({
    plan: alertPlan,
    course_code: courseCode,
    section_id: z.string().regex(/^\d{5}$/),
  })
  .strict();
export const alertWatch = watchInput.extend({
  id: z.string().uuid(),
  revision: z.string().regex(/^[a-f0-9]{64}$/),
  created_at: z.string().datetime(),
  active: z.boolean(),
});
export type AlertWatch = z.infer<typeof alertWatch>;
export const opening = z
  .object({
    course_code: courseCode,
    section_id: z.string().regex(/^\d{5}$/),
    reported_seats: z.number().int().min(1).max(10000),
  })
  .strict();
export type Opening = z.infer<typeof opening>;
export const alertEvent = z.object({
  id: z.string().uuid(),
  received_at: z.string().datetime(),
  opening,
  source: z.enum(["pilot", "forwarded_email"]),
  status: z.enum([
    "review_required",
    "checking",
    "open",
    "full",
    "cancelled",
    "unavailable",
    "expired",
    "invalidated",
    "dismissed",
  ]),
  watch_ids: z.array(z.string().uuid()).max(20),
  selected_watch_id: z.string().uuid().nullable(),
  checked_at: z.string().datetime().nullable(),
  snapshot_version: z.string().uuid().nullable(),
  current_seats: z.number().int().nullable(),
  warning: z.string().max(500),
});
export type AlertEvent = z.infer<typeof alertEvent>;
export const alertInbox = z.object({
  watches: z.array(alertWatch).max(20),
  events: z.array(alertEvent).max(50),
  has_more: z.boolean(),
  address: z.string().max(254).nullable(),
  pilot_enabled: z.boolean(),
  delivery: z.object({
    queued: z.number().int().nonnegative(),
    processed: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    rejected: z.number().int().nonnegative(),
    last_received_at: z.string().datetime().nullable(),
  }),
  meta: z.object({
    checked_at: z.string().datetime(),
    completeness: z.literal("active_watches_and_latest_50_events"),
    warnings: z.array(z.string().max(500)).max(10),
  }),
});
export type AlertInbox = z.infer<typeof alertInbox>;
export const confirmOpening = z
  .object({
    event_id: z.string().uuid(),
    watch_id: z.string().uuid(),
    plan: alertPlan,
    confirm_term_and_source: z.literal(true),
  })
  .strict();

export function openingPrompt(event: AlertEvent, watch: AlertWatch): string {
  // Only schema-checked data crosses into chat, never email prose, URLs or account tokens.
  const e = alertEvent.parse(event),
    w = alertWatch.parse(watch);
  if (e.selected_watch_id !== w.id || !e.watch_ids.includes(w.id))
    throw new Error("Opening does not match this watch.");
  return `Help me review this reported course opening against my current planner. Use the course tools to recheck availability and validate the complete schedule. Explain any D-clearance, required components or eligibility unknowns. Do not claim enrollment or submit checkout. Alert data: ${JSON.stringify({ term_code: w.plan.term_code, course_code: e.opening.course_code, section_id: e.opening.section_id, source: e.source, status: e.status, received_at: e.received_at, checked_at: e.checked_at, current_seats: e.current_seats })}. If it still fits, guide me to My planner → Add to coursebin and the WebReg checkout review. If it is full, suggest alternatives without changing my selections.`;
}
