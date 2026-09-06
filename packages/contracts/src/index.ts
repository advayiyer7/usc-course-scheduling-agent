import { z } from "zod";

export const termCode = z
  .number()
  .int()
  .min(20001)
  .max(21003)
  .refine((n) => [1, 2, 3].includes(n % 10));
export const courseCode = z
  .string()
  .trim()
  .max(24)
  .transform((s) => s.toUpperCase().replace(/[ -]/g, ""))
  .pipe(z.string().regex(/^[A-Z]{2,8}\d{3}[A-Z]{0,3}$/));
export const codes = z
  .array(courseCode)
  .min(1)
  .max(20)
  .refine((a) => new Set(a).size === a.length, "Duplicate courses");
export const days = z.enum(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
export const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export const block = z
  .object({ days: z.array(days).min(1).max(7), start: time, end: time })
  .strict()
  .refine((b) => b.start < b.end, "End must follow start");
export const constraints = z
  .object({
    unavailable: z.array(block).max(50).default([]),
    earliest: time.optional(),
    latest: time.optional(),
    min_units: z.number().min(0).max(40).optional(),
    max_units: z.number().min(0).max(40).optional(),
    preferences: z
      .object({
        instructors: z.array(z.string().max(100)).max(20).default([]),
        free_days: z.array(days).max(7).default([]),
      })
      .strict()
      .default({ instructors: [], free_days: [] }),
  })
  .strict()
  .refine(
    (c) => !c.earliest || !c.latest || c.earliest < c.latest,
    "Invalid time range",
  )
  .refine(
    (c) =>
      c.min_units === undefined ||
      c.max_units === undefined ||
      c.min_units <= c.max_units,
    "Invalid unit range",
  );
const snapshot = z.string().uuid().optional();
export const inputs = {
  list_terms: z
    .object({ include_archived: z.boolean().default(false) })
    .strict(),
  search_courses: z
    .object({
      term_code: termCode,
      query: z.string().trim().min(1).max(120),
      program: z
        .string()
        .regex(/^[A-Z]{2,8}$/)
        .optional(),
      limit: z.number().int().min(1).max(50).default(20),
      cursor: z.string().max(2048).optional(),
      snapshot_version: snapshot,
    })
    .strict(),
  get_courses: z
    .object({
      term_code: termCode,
      course_codes: codes,
      snapshot_version: snapshot,
    })
    .strict(),
  get_sections: z
    .object({
      term_code: termCode,
      course_codes: codes,
      snapshot_version: snapshot,
      cursor: z.string().max(2048).optional(),
      limit: z.number().int().min(1).max(100).default(100),
    })
    .strict(),
  validate_schedule: z
    .object({
      term_code: termCode,
      snapshot_version: z.string().uuid(),
      requested_courses: codes,
      section_ids: z
        .array(z.string().regex(/^\d{5}$/))
        .min(1)
        .max(100)
        .refine((a) => new Set(a).size === a.length, "Duplicate section IDs"),
      constraints: constraints.default({
        unavailable: [],
        preferences: { instructors: [], free_days: [] },
      }),
    })
    .strict(),
  request_refresh: z
    .object({ term_code: termCode, course_codes: codes })
    .strict(),
};
export type ToolName = keyof typeof inputs;
export class AppError extends Error {
  constructor(
    public code: string,
    message: string,
    public retry_after_seconds?: number,
  ) {
    super(message);
  }
}
export function errorResult(error: unknown) {
  if (error instanceof z.ZodError)
    return {
      error: {
        code: "INVALID_INPUT",
        message: error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; "),
      },
    };
  if (error instanceof AppError)
    return {
      error: {
        code: error.code,
        message: error.message,
        retry_after_seconds: error.retry_after_seconds,
      },
    };
  return {
    error: {
      code: "INTERNAL_ERROR",
      message: "The request could not be completed.",
    },
  };
}
export interface Meeting {
  days: string[];
  start: string | null;
  end: string | null;
  start_date: string | null;
  end_date: string | null;
  timezone: "America/Los_Angeles";
}
export interface Section {
  id: string;
  course_key: string;
  type: string;
  link_code: string | null;
  meetings: Meeting[];
  instructors: string[];
  total_seats: number | null;
  registered_seats: number | null;
  cancelled: boolean;
  d_clearance: boolean | null;
  units: number[];
  session_code: string | null;
  syllabus_url: string | null;
  checked_at: string;
}
export interface Course {
  key: string;
  code: string;
  title: string;
  description: string | null;
  units: number[];
  aliases: string[];
  prerequisites: unknown;
  corequisites: unknown;
  restrictions: Record<string, unknown>;
  sections: Section[];
  programs: string[];
  checked_at: string;
}
export interface SourceResponse {
  school: string;
  program: string;
  url: string;
  checked_at: string;
  payload: unknown;
}
export interface Snapshot {
  id: string;
  term: number;
  started_at: string;
  ended_at: string;
  published_at: string;
  coverage: string;
  pair_count: number;
  course_count: number;
  section_count: number;
}
export const successEnvelope = z
  .object({
    data: z.unknown(),
    meta: z
      .object({
        term_code: z.number().int().nullable(),
        snapshot_version: z.string().uuid().nullable(),
        checked_at: z.string().nullable(),
        fetch_interval: z
          .object({ start: z.string(), end: z.string() })
          .nullable(),
        stale: z.boolean(),
        coverage_status: z.string(),
        warnings: z.array(z.string()),
      })
      .strict(),
  })
  .strict();
