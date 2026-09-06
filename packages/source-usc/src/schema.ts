import { z } from 'zod';
import { createHash } from 'node:crypto';
import type { Course, Section, SourceResponse } from '../../contracts/src/index.js';

const code = z.object({ courseSmashed: z.string().min(1) }).passthrough();
const nullableText = z.string().nullable();
const meeting = z.object({ dayCode: nullableText, days: z.array(z.string()), startTime: nullableText, endTime: nullableText }).passthrough();
export const sourceSection = z.object({
  sisSectionId: z.string().regex(/^\d{5}$/), courseId: z.number().int(), termCode: z.number().int(),
  linkCode: nullableText, rnrMode: z.string(), schedule: z.array(meeting),
  instructors: z.array(z.object({ firstName: nullableText, lastName: nullableText }).passthrough()),
  totalSeats: z.number().int().nonnegative().nullable(), registeredSeats: z.number().int().nonnegative().nullable(),
  isCancelled: z.boolean(), hasDClearance: z.boolean().nullable(), units: z.array(z.string()),
  session: z.object({ rnrSessionCode: nullableText }).passthrough().nullable(), syllabus: nullableText,
}).passthrough();
export const sourceCourse = z.object({
  courseId: z.number().int(), termCode: z.number().int(), name: z.string(), description: nullableText,
  publishedCourseCode: code, scheduledCourseCode: code, matchedCourseCode: code, courseUnits: z.array(z.number()), sections: z.array(sourceSection).nullable(),
  prerequisiteCourseCodes: z.unknown(), corequisiteCourseCodes: z.unknown(), courseRestrictions: z.unknown(), majorRestrictions: z.unknown(), schoolRestrictions: z.unknown(),
}).passthrough();
export const responseSchema = z.object({ termCode: z.number().int(), schoolPrefix: z.string(), programPrefix: z.string(), courses: z.array(sourceCourse).nullable() }).passthrough();
export const programsSchema = z.array(z.object({ termCode: z.number().int(), prefix: z.string().regex(/^[A-Z]{2,8}$/), schools: z.array(z.object({ prefix: z.string().regex(/^[A-Z]{2,8}$/) }).passthrough()).min(1) }).passthrough()).min(1);
export const termsSchema = z.array(z.object({ termCode: z.number().int(), season: z.string(), year: z.number().int() }).passthrough());
export const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

export function normalize(term: number, responses: SourceResponse[]): Course[] {
  const courses = new Map<string, Course>();
  for (const response of responses) {
    const d = responseSchema.parse(response.payload);
    if (d.termCode !== term || d.schoolPrefix !== response.school || d.programPrefix !== response.program) throw new Error('Source identity mismatch');
    for (const c of d.courses ?? []) {
      if (c.termCode !== term) throw new Error('Course term mismatch');
      const key = c.scheduledCourseCode.courseSmashed;
      const sections: Section[] = (c.sections ?? []).map(s => {
        if (s.termCode !== term) throw new Error('Section term mismatch');
        const units = s.units.map(Number);
        if (units.some(n => !Number.isFinite(n) || n < 0)) throw new Error('Invalid section units');
        return { id: s.sisSectionId, course_key: key, type: s.rnrMode, link_code: s.linkCode,
          meetings: s.schedule.map(m => ({ days: m.days, start: m.startTime, end: m.endTime, start_date: null, end_date: null, timezone: 'America/Los_Angeles' })),
          instructors: s.instructors.map(i => [i.firstName, i.lastName].filter(Boolean).join(' ')).filter(Boolean),
          total_seats: s.totalSeats, registered_seats: s.registeredSeats, cancelled: s.isCancelled, d_clearance: s.hasDClearance,
          units, session_code: s.session?.rnrSessionCode ?? null, syllabus_url: s.syllabus, checked_at: response.checked_at };
      });
      const aliases = [c.publishedCourseCode.courseSmashed, c.matchedCourseCode.courseSmashed, key];
      const existing = courses.get(key);
      if (existing) {
        existing.aliases = [...new Set([...existing.aliases, ...aliases])];
        existing.programs = [...new Set([...existing.programs, `${response.school}/${response.program}`])];
        // Multiple aliases can expose subsets of one scheduled course. Union sections, preserving earliest observation.
        for (const s of sections) if (!existing.sections.some(e => e.id === s.id)) existing.sections.push(s);
        existing.checked_at = [existing.checked_at, response.checked_at].sort()[0]!;
      } else courses.set(key, { key, code: key, title: c.name, description: c.description, units: c.courseUnits, aliases: [...new Set(aliases)],
        prerequisites: c.prerequisiteCourseCodes ?? null, corequisites: c.corequisiteCourseCodes ?? null,
        restrictions: { course: c.courseRestrictions ?? null, major: c.majorRestrictions ?? null, school: c.schoolRestrictions ?? null },
        sections, programs: [`${response.school}/${response.program}`], checked_at: response.checked_at });
    }
  }
  const owners = new Map<string, string>();
  for (const c of courses.values()) for (const s of c.sections) {
    const owner = owners.get(s.id);
    if (owner && owner !== c.key) throw new Error(`Conflicting section identity ${s.id}`);
    owners.set(s.id, c.key);
  }
  return [...courses.values()];
}
