import { z } from "zod";
import { planningContext, proposal, proposalInput } from "./companion.js";
import { courseCode, termCode } from "./index.js";

// Browser-only protocol. Deliberately absent from REST, MCP and native tools.
export const WEBREG_ORIGIN = "https://webreg.usc.edu";
export const COURSEBIN_CHANNEL = "usc-coursebin-v1";
export const sectionId = z.string().regex(/^\d{5}$/);
export const failureCode = z.enum([
  "VALIDATION_BLOCKED",
  "STALE_PROPOSAL",
  "WRONG_SEMESTER",
  "LOGIN_REQUIRED",
  "UI_CHANGED",
  "STATE_CHANGED",
  "SECTION_MISSING",
  "FULL",
  "D_CLEARANCE",
  "WEBREG_REJECTED",
  "UNCONFIRMED",
  "INTERRUPTED",
  "STOPPED",
  "BUSY",
]);
export type FailureCode = z.infer<typeof failureCode>;
export const binEntry = z
  .object({
    section_id: sectionId,
    course_code: z.string().regex(/^[A-Z]{2,8}\d{3}[A-Z]{0,3}$/),
    scheduled: z.boolean(),
    registered: z.boolean(),
  })
  .strict();
export const binSnapshot = z
  .object({
    term_code: termCode,
    entries: z.array(binEntry).max(500),
  })
  .strict()
  .refine(
    (v) =>
      new Set(v.entries.map((e) => e.section_id)).size === v.entries.length,
  );
export type BinSnapshot = z.infer<typeof binSnapshot>;
export const sectionOutcome = z.object({
  section_id: sectionId,
  status: z.enum(["added", "already_present", "failed", "unconfirmed"]),
  code: failureCode.optional(),
});
export const coursebinReport = z.object({
  run_id: z.string().uuid(),
  proposal_id: z.string().uuid(),
  term_code: termCode,
  snapshot_version: z.string().uuid(),
  phase: z.enum(["running", "complete", "stopped"]),
  sections: z.array(sectionOutcome).max(100),
  code: failureCode.optional(),
});
export type CoursebinReport = z.infer<typeof coursebinReport>;
export interface Finding {
  code: string;
  message: string;
}
export interface CoursebinPreview {
  ticket: string;
  expires_at: number;
  selection: z.infer<typeof proposalInput>;
  sections: {
    section_id: string;
    course_code: string;
    type: string;
    meetings: string[];
  }[];
  blockers: Finding[];
  warnings: Finding[];
  already_present: string[];
}
export const coursebinUiRequest = z.discriminatedUnion("method", [
  z
    .object({
      channel: z.literal(COURSEBIN_CHANNEL),
      method: z.literal("prepare"),
      proposal,
      context: planningContext,
    })
    .strict(),
  z
    .object({
      channel: z.literal(COURSEBIN_CHANNEL),
      method: z.literal("execute"),
      ticket: z.string().uuid(),
    })
    .strict(),
  z
    .object({
      channel: z.literal(COURSEBIN_CHANNEL),
      method: z.literal("cancel"),
    })
    .strict(),
  z
    .object({
      channel: z.literal(COURSEBIN_CHANNEL),
      method: z.literal("status"),
    })
    .strict(),
]);
export type CoursebinUiRequest = z.infer<typeof coursebinUiRequest>;
export const contentCommand = z.discriminatedUnion("method", [
  z
    .object({
      channel: z.literal(COURSEBIN_CHANNEL),
      method: z.literal("inspect"),
      term_code: termCode,
    })
    .strict(),
  z
    .object({
      channel: z.literal(COURSEBIN_CHANNEL),
      method: z.literal("add"),
      term_code: termCode,
      section_id: sectionId,
      requested_courses: z.array(courseCode).min(1).max(20),
      document_id: z.string().uuid(),
      expected_bin: binSnapshot,
      expires_at: z.number(),
    })
    .strict(),
]);
export class CoursebinError extends Error {
  constructor(public code: FailureCode) {
    super(failureMessage(code));
  }
}
export function failureMessage(code: FailureCode): string {
  return {
    VALIDATION_BLOCKED: "Resolve the blocking schedule findings before adding.",
    STALE_PROPOSAL:
      "This proposal or its course data is stale. Request a fresh draft.",
    WRONG_SEMESTER:
      "Open the proposal's semester in WebReg, then review this draft again.",
    LOGIN_REQUIRED:
      "Open WebReg and sign in yourself, then review this draft again.",
    UI_CHANGED:
      "WebReg's page or controls could not be verified. No further additions were attempted.",
    STATE_CHANGED:
      "The WebReg page or coursebin changed. Review it before starting another run.",
    SECTION_MISSING: "The exact section was not found in WebReg.",
    FULL: "WebReg reports this section is full or closed.",
    D_CLEARANCE:
      "WebReg reported a D-clearance issue. Review its message and official guidance.",
    WEBREG_REJECTED:
      "WebReg rejected the addition. Review its message in the browser.",
    UNCONFIRMED:
      "The addition could not be confirmed. Inspect the coursebin before retrying.",
    INTERRUPTED:
      "The run was interrupted. Its pending addition is unconfirmed; inspect the coursebin before retrying.",
    STOPPED: "Not attempted because the run stopped.",
    BUSY: "A coursebin action is already in progress.",
  }[code];
}
export function codeOf(error: unknown): FailureCode {
  return error instanceof CoursebinError ? error.code : "UNCONFIRMED";
}
export function binKey(bin: BinSnapshot): string {
  return JSON.stringify([
    bin.term_code,
    [...bin.entries].sort((a, b) => a.section_id.localeCompare(b.section_id)),
  ]);
}
