import { z } from "zod";
import { constraints, inputs, termCode } from "./index.js";

export const NATIVE_HOST = "edu.usc.course_planner";
export const CODEX_VERSION = "0.153.4";
export const MAX_NATIVE_BYTES = 512 * 1024;
export const planningContext = z
  .object({
    major: z.string().trim().max(120).default(""),
    term_code: termCode,
    course_codes: z.array(z.string().max(24)).max(20),
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
  z.object({ type: z.literal("proposal"), proposal }),
  z.object({
    type: z.literal("turn_complete"),
    status: z.enum(["completed", "interrupted", "failed"]),
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
