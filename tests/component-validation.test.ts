import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { course, response, sourceSection } from "./fixtures.js";
import { testStore } from "./database.js";
import { normalize } from "../packages/source-usc/src/schema.js";
import { validate } from "../packages/domain/src/validate.js";
import { CourseService } from "../packages/domain/src/service.js";
import { inputs, successEnvelope } from "../packages/contracts/src/index.js";
import { validationReview } from "../packages/contracts/src/review.js";
import { proposal } from "../packages/contracts/src/companion.js";
import { preflight } from "../apps/extension/src/coursebin/preflight.js";
import { ScheduleReview } from "../apps/extension/src/ScheduleReview.js";

const version = "11111111-1111-4111-8111-111111111111";
function fixture() {
  const profiles = [
    {
      code: "EE109",
      school: "ENGV",
      program: "EE",
      types: ["Lecture", "Lab", "Quiz"],
    },
    { code: "CSCI426", school: "ENGV", program: "CSCI", types: ["Lecture"] },
    {
      code: "SSCI165",
      school: "DRNS",
      program: "SSCI",
      types: ["Lecture", "Lab"],
    },
  ];
  const responses = profiles.map((profile, n) => {
    const sections = profile.types.map((type, i) => ({
      ...sourceSection(
        String(10000 + n * 10 + i),
        `${10 + n * 3 + i}:00`,
        `${11 + n * 3 + i}:00`,
      ),
      rnrMode: type,
      linkCode: null,
      notes: null,
      units: type === "Lecture" ? ["4.0"] : ["0.0"],
    }));
    const r = response();
    return {
      ...r,
      school: profile.school,
      program: profile.program,
      checked_at: new Date().toISOString(),
      payload: {
        ...(r.payload as object),
        schoolPrefix: profile.school,
        programPrefix: profile.program,
        courses: [
          {
            ...course(profile.code),
            sections,
            courseNotes: null as string | null,
            termNotes: null as string | null,
          },
        ],
      },
    };
  });
  const courses = normalize(20263, responses),
    sections = courses.flatMap((c) => c.sections);
  const request = inputs.validate_schedule.parse({
    term_code: 20263,
    snapshot_version: version,
    requested_courses: profiles.map((p) => p.code),
    section_ids: sections.map((s) => s.id),
  });
  return { profiles, responses, courses, sections, request };
}
const components = (f: ReturnType<typeof fixture>) =>
  validate(f.request, f.courses, f.sections).checks.filter(
    (c) => c.code === "component_rules",
  );

it("checks all six pilot components with evidence while dates and eligibility stay unknown", () => {
  const f = fixture(),
    result = validate(f.request, f.courses, f.sections);
  expect(result.summary).toMatchObject({
    components: "pass",
    compatibility: "unknown",
    eligibility: "unknown",
  });
  expect(result.status).toBe("indeterminate");
  expect(components(f)).toHaveLength(3);
  expect(
    components(f).every(
      (check) =>
        check.status === "pass" && check.evidence?.sources.length === 2,
    ),
  ).toBe(true);
});

it("requires an EE lab and quiz even when the lecture has been selected", () => {
  const f = fixture();
  f.request.section_ids = f.request.section_ids.filter(
    (id) => !["10001", "10002"].includes(id),
  );
  expect(components(f)[0]).toMatchObject({
    status: "fail",
    message: expect.stringContaining("Lab: 0 selected"),
  });
  expect(components(f)[0]?.message).toContain("Quiz: 0 selected");
  expect(validate(f.request, f.courses, f.sections).status).toBe("infeasible");
});

it("allows one alternative lab but rejects two labs for the same course", () => {
  const f = fixture(),
    lab = { ...structuredClone(f.sections[1]!), id: "10003" };
  f.sections.push(lab);
  f.courses[0]!.section_ids!.push(lab.id);
  f.request.section_ids = f.request.section_ids.map((id) =>
    id === "10001" ? lab.id : id,
  );
  expect(components(f)[0]?.status).toBe("pass");
  f.request.section_ids.push("10001");
  expect(components(f)[0]).toMatchObject({
    status: "fail",
    message: expect.stringContaining("Lab: 2 selected"),
  });
});

it("requires the single-course lecture and SSCI lab independently", () => {
  const f = fixture();
  f.request.section_ids = f.request.section_ids.filter(
    (id) => !["10010", "10021"].includes(id),
  );
  expect(components(f).map((c) => c.status)).toEqual(["pass", "fail", "fail"]);
});

it.each([
  "course-notes",
  "term-notes",
  "section-notes",
  "missing-course-notes",
  "missing-section-notes",
  "legacy-inventory",
  "partial-inventory",
  "duplicate-inventory",
  "new-type",
  "linked",
  "mixed-links",
  "session",
  "additional-program",
])("keeps %s outside the verified profile", (kind) => {
  const f = fixture(),
    c = f.courses[0]!,
    s = f.sections[0]!;
  if (kind === "course-notes")
    c.registration_notes!.course = "Special registration instructions";
  if (kind === "term-notes")
    c.registration_notes!.term = "Special registration instructions";
  if (kind === "section-notes")
    s.registration_notes = "Special registration instructions";
  if (kind === "missing-course-notes") delete c.registration_notes;
  if (kind === "missing-section-notes") delete s.registration_notes;
  if (kind === "legacy-inventory") delete c.section_ids;
  if (kind === "partial-inventory")
    f.sections = f.sections.filter((section) => section.id !== "10001");
  if (kind === "duplicate-inventory") c.section_ids!.push(c.section_ids![0]!);
  if (kind === "new-type") s.type = "Lecture-Lab";
  if (kind === "linked")
    f.sections
      .filter((section) => section.course_key === "EE109")
      .forEach((section) => {
        section.link_code = "A";
      });
  if (kind === "mixed-links") s.link_code = "A";
  if (kind === "session") s.session_code = "060";
  if (kind === "additional-program") c.programs.push("ENGV/CSCI");
  expect(components(f)[0]?.status).toBe("unknown");
});

it("keeps other semesters/courses unknown and resolves aliases by scheduled identity", () => {
  const f = fixture();
  f.courses[0]!.aliases.push("ALIAS109");
  f.request.requested_courses[0] = "ALIAS109";
  expect(components(f)[0]?.status).toBe("pass");
  f.request.term_code = 20271;
  expect(components(f).every((check) => check.status === "unknown")).toBe(true);
  const other = normalize(20263, [response()]);
  expect(
    validate(
      inputs.validate_schedule.parse({
        term_code: 20263,
        snapshot_version: version,
        requested_courses: ["TEST100"],
        section_ids: ["10001"],
      }),
      other,
      other[0]!.sections,
    ).summary.components,
  ).toBe("unknown");
});

it("retains cancellation, meeting conflicts, full seats and clearance findings after component pass", () => {
  const f = fixture();
  f.sections[0]!.cancelled = true;
  f.sections[0]!.registered_seats = f.sections[0]!.total_seats;
  f.sections[0]!.d_clearance = true;
  f.sections[1]!.meetings = structuredClone(f.sections[0]!.meetings);
  const result = validate(f.request, f.courses, f.sections);
  expect(result.summary).toMatchObject({
    components: "pass",
    availability: "full",
    eligibility: "unknown",
  });
  expect(result.status).toBe("infeasible");
  expect(result.checks).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ code: "cancelled", status: "fail" }),
      expect.objectContaining({ code: "time_conflict", status: "unknown" }),
    ]),
  );
});

it("preserves missing-versus-empty notes and conflicting cross-list instructions during normalization", () => {
  const f = fixture();
  const raw = f.responses[0]!.payload.courses[0]!;
  delete (raw as { courseNotes?: unknown }).courseNotes;
  expect(
    normalize(20263, [f.responses[0]!])[0]!.registration_notes,
  ).toBeUndefined();
  const good = fixture().responses[0]!,
    conflicting = structuredClone(good);
  conflicting.payload.courses[0]!.termNotes = "A different requirement";
  expect(
    normalize(20263, [good, conflicting])[0]!.registration_notes,
  ).toBeUndefined();
});

it("persists evidence through publication and the real preflight without granting unknown cases", async () => {
  const f = fixture(),
    store = await testStore();
  try {
    const snapshot = await store.publish(
      20263,
      f.profiles.map((p) => ({
        termCode: 20263,
        prefix: p.program,
        schools: [{ prefix: p.school }],
      })),
      f.responses,
    );
    const service = new CourseService(store);
    const selection = { ...f.request, snapshot_version: snapshot.id };
    const checked = successEnvelope.parse(
      await service.call("validate_schedule", selection),
    );
    expect(validationReview.parse(checked.data).summary.components).toBe(
      "pass",
    );
    const draft = proposal.parse({
      id: version,
      created_at: new Date().toISOString(),
      selection: { ...selection, title: "Synthetic pilot plan" },
      validation: checked,
    });
    const fetcher = (async (_url: unknown, init?: RequestInit) =>
      Response.json(
        await service.call(
          "validate_schedule",
          JSON.parse(init?.body as string),
        ),
      )) as typeof fetch;
    const context = {
      major: "",
      term_code: 20263,
      course_codes: selection.requested_courses,
      constraints: selection.constraints,
    };
    expect((await preflight(draft, context, fetcher)).blockers).toHaveLength(0);
    draft.selection.section_ids = draft.selection.section_ids.filter(
      (id) => id !== "10001",
    );
    expect((await preflight(draft, context, fetcher)).blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "component_rules" }),
      ]),
    );
    const malformed = structuredClone(f.responses);
    malformed[0]!.payload.courses[0]!.courseNotes = 42 as never;
    await expect(
      store.publish(
        20263,
        f.profiles.map((p) => ({
          termCode: 20263,
          prefix: p.program,
          schools: [{ prefix: p.school }],
        })),
        malformed,
        snapshot.id,
      ),
    ).rejects.toThrow();
    expect((await store.current(20263))?.id).toBe(snapshot.id);
  } finally {
    await store.db.close();
  }
});

it("renders reviewed official sources and rejects tampered component evidence URLs", () => {
  const f = fixture(),
    result = validate(f.request, f.courses, f.sections);
  let html = renderToStaticMarkup(
    React.createElement(ScheduleReview, { value: result }),
  );
  expect(html).toContain("USC component selection guide");
  expect(html).toContain('rel="noopener noreferrer"');
  result.checks.find((c) => c.evidence)!.evidence!.sources[0]!.url =
    "https://usc.edu.evil.test/guide";
  html = renderToStaticMarkup(
    React.createElement(ScheduleReview, { value: result }),
  );
  expect(html).toContain("Detailed validation is unavailable");
  expect(html).not.toContain("href=");
});
