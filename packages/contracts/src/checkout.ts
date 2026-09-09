import { z } from "zod";
import { planningContext, proposal } from "./companion.js";
import { binSnapshot, sectionId } from "./coursebin.js";
import { courseCode, termCode } from "./index.js";

// Read-only browser protocol. There is deliberately no execute/endpoint command.
export const CHECKOUT_CHANNEL = "usc-checkout-review-v1";
export const checkoutSection = z
  .object({
    section_id: sectionId,
    course_code: courseCode,
    session: z.string().regex(/^\d{3}$/),
    type: z.string().trim().min(1).max(40),
    units: z.number().min(0).max(24),
    grade_option: z.string().trim().min(1).max(80),
  })
  .strict();
export const checkoutTransaction = z
  .object({
    term_code: termCode,
    kind: z.literal("register"),
    sections: z.array(checkoutSection).min(1).max(100),
  })
  .strict()
  .refine(
    (v) =>
      new Set(v.sections.map((s) => s.section_id)).size === v.sections.length,
  );
export type CheckoutTransaction = z.infer<typeof checkoutTransaction>;
export const checkoutInspection = z
  .object({
    ok: z.literal(true),
    document_id: z.string().uuid(),
    transaction: checkoutTransaction,
    bin: binSnapshot,
  })
  .strict();
export const checkoutContentRequest = z
  .object({
    channel: z.literal(CHECKOUT_CHANNEL),
    method: z.literal("inspect"),
    term_code: termCode,
  })
  .strict();
export const checkoutUiRequest = z
  .object({
    channel: z.literal(CHECKOUT_CHANNEL),
    method: z.literal("review"),
    proposal,
    context: planningContext,
  })
  .strict();
const finding = z.object({
  code: z.string().max(100),
  message: z.string().max(2000),
});
export const checkoutReview = z
  .object({
    mode: z.literal("read_only"),
    checked_at: z.string().datetime(),
    expires_at: z.number().int(),
    transaction: checkoutTransaction,
    blockers: z.array(finding).max(300),
    warnings: z.array(finding).max(300),
  })
  .strict();
export type CheckoutReview = z.infer<typeof checkoutReview>;
