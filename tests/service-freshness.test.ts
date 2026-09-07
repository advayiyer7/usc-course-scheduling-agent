import { afterAll, beforeAll, expect, it } from "vitest";
import { testStore } from "./database.js";
import { course, programs, response, sourceSection } from "./fixtures.js";
import { CourseService } from "../packages/domain/src/service.js";
import { successEnvelope } from "../packages/contracts/src/index.js";
import type { Store } from "../packages/db/src/index.js";

let store: Store, service: CourseService, oldVersion: string, version: string;
const old = new Date(Date.now() - 3600000).toISOString();
const fresh = new Date().toISOString();
const index = [
  ...programs,
  { termCode: 20263, prefix: "OTHER", schools: [{ prefix: "DEMO" }] },
];
const other = response([course("OTHER200", [sourceSection("20001")])]);
other.program = "OTHER";
(other.payload as { programPrefix: string }).programPrefix = "OTHER";
other.checked_at = old;

beforeAll(async () => {
  store = await testStore();
  const initial = { ...response(), checked_at: old };
  oldVersion = (await store.publish(20263, index, [initial, other])).id;
  version = (
    await store.publish(
      20263,
      index,
      [{ ...initial, checked_at: fresh }, other],
      oldVersion,
    )
  ).id;
  service = new CourseService(store);
});
afterAll(async () => {
  await store.db.close();
});

it("dates bounded lookups from refreshed records while term/search evidence stays old", async () => {
  for (const name of ["get_courses", "get_sections"] as const) {
    const result = successEnvelope.parse(
      await service.call(name, { term_code: 20263, course_codes: ["TEST100"] }),
    );
    expect(result.meta).toMatchObject({
      snapshot_version: version,
      checked_at: fresh,
      stale: false,
      fetch_interval: { start: fresh, end: fresh },
    });
  }
  const terms = successEnvelope.parse(await service.call("list_terms", {}));
  const search = successEnvelope.parse(
    await service.call("search_courses", { term_code: 20263, query: "TEST" }),
  );
  expect(terms.meta).toMatchObject({ checked_at: old, stale: true });
  expect(search.meta).toMatchObject({ checked_at: old, stale: true });
});

it("retains oldest evidence for mixed batches and immutable pinned history", async () => {
  for (const name of ["get_courses", "get_sections"] as const) {
    const mixed = successEnvelope.parse(
      await service.call(name, {
        term_code: 20263,
        course_codes: ["TEST100", "OTHER200"],
      }),
    );
    expect(mixed.meta).toMatchObject({
      checked_at: old,
      stale: true,
      fetch_interval: { start: old, end: fresh },
    });
    const pinned = successEnvelope.parse(
      await service.call(name, {
        term_code: 20263,
        course_codes: ["TEST100"],
        snapshot_version: oldVersion,
      }),
    );
    expect(pinned.meta).toMatchObject({
      snapshot_version: oldVersion,
      checked_at: old,
      stale: true,
    });
  }
});

it("validates the selected evidence without treating unknown components as verified", async () => {
  const result = successEnvelope.parse(
    await service.call("validate_schedule", {
      term_code: 20263,
      snapshot_version: version,
      requested_courses: ["TEST100"],
      section_ids: ["10001"],
    }),
  );
  expect(result.meta).toMatchObject({ checked_at: fresh, stale: false });
  expect(result.data).toMatchObject({
    status: "indeterminate",
    checks: expect.arrayContaining([
      expect.objectContaining({ code: "component_rules", status: "unknown" }),
    ]),
  });
  // Even an extra section from an unrequested course contributes its evidence.
  const extra = successEnvelope.parse(
    await service.call("validate_schedule", {
      term_code: 20263,
      snapshot_version: version,
      requested_courses: ["TEST100"],
      section_ids: ["10001", "20001"],
    }),
  );
  expect(extra.meta).toMatchObject({ checked_at: old, stale: true });
});

it("does not date missing records from only the freshly found subset", async () => {
  for (const name of [
    "get_courses",
    "get_sections",
    "request_refresh",
  ] as const) {
    const missing = successEnvelope.parse(
      await service.call(name, {
        term_code: 20263,
        course_codes: ["TEST100", "MISS999"],
      }),
    );
    expect(missing.meta).toMatchObject({ checked_at: old, stale: true });
  }
  for (const overrides of [
    { requested_courses: ["TEST100", "MISS999"] },
    { section_ids: ["10001", "99999"] },
  ]) {
    const missing = successEnvelope.parse(
      await service.call("validate_schedule", {
        term_code: 20263,
        snapshot_version: version,
        requested_courses: ["TEST100"],
        section_ids: ["10001"],
        ...overrides,
      }),
    );
    expect(missing.meta).toMatchObject({ checked_at: old, stale: true });
    expect(missing.data).toMatchObject({ status: "indeterminate" });
  }
});

it("retains older cross-list evidence when only one associated program was refreshed", async () => {
  const alias = course("ALIAS100");
  alias.scheduledCourseCode.courseSmashed = "TEST100";
  const crosslisted = {
    ...other,
    payload: {
      ...(other.payload as object),
      courses: [course("OTHER200", [sourceSection("20001")]), alias],
    },
  };
  const crossVersion = (
    await store.publish(
      20263,
      index,
      [{ ...response(), checked_at: fresh }, crosslisted],
      version,
    )
  ).id;
  const result = successEnvelope.parse(
    await service.call("validate_schedule", {
      term_code: 20263,
      snapshot_version: crossVersion,
      requested_courses: ["ALIAS100"],
      section_ids: ["10001"],
    }),
  );
  expect(result.meta).toMatchObject({
    checked_at: old,
    stale: true,
    fetch_interval: { start: old, end: fresh },
  });
});
