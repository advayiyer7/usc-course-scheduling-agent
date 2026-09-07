import { it, expect } from "vitest";
import { testStore } from "./database.js";
import { programs, response, course, sourceSection } from "./fixtures.js";
import { successEnvelope } from "../packages/contracts/src/index.js";
import { UscClient } from "../packages/source-usc/src/client.js";
import { CourseService } from "../packages/domain/src/service.js";
import { runOneJob } from "../apps/worker/src/ingest.js";
it("100 refresh requests cause one fetch and publish a newer immutable snapshot", async () => {
  const store = await testStore();
  try {
    const old = new Date(Date.now() - 3600000).toISOString();
    const other = response([course("OTHER200", [sourceSection("20001")])]);
    other.program = "OTHER";
    other.checked_at = old;
    (other.payload as { programPrefix: string }).programPrefix = "OTHER";
    const before = await store.publish(
      20263,
      [
        ...programs,
        { termCode: 20263, prefix: "OTHER", schools: [{ prefix: "DEMO" }] },
      ],
      [{ ...response(), checked_at: old }, other],
    );
    const service = new CourseService(store);
    const queued = await Promise.all(
      Array.from({ length: 100 }, () =>
        service.call("request_refresh", {
          term_code: 20263,
          course_codes: ["TEST100"],
        }),
      ),
    );
    expect(queued.every((r) => successEnvelope.parse(r).meta.stale)).toBe(true);
    const source = new UscClient(
      store,
      (async () => Response.json(response().payload)) as typeof fetch,
      1,
      1000,
      1,
    );
    await runOneJob(store, source);
    await runOneJob(store, source);
    expect(source.requestCount).toBe(1);
    expect((await store.current(20263))?.id).not.toBe(before.id);
    expect(
      (await store.db.query<{ status: string }>("SELECT status FROM jobs"))[0]
        ?.status,
    ).toBe("complete");
    expect(await store.snapshot(20263, before.id)).toBeDefined();
    const current = successEnvelope.parse(
      await service.call("get_sections", {
        term_code: 20263,
        course_codes: ["TEST100"],
      }),
    );
    expect(current.meta.stale).toBe(false);
    const untouched = successEnvelope.parse(
      await service.call("get_courses", {
        term_code: 20263,
        course_codes: ["OTHER200"],
      }),
    );
    expect(untouched.meta).toMatchObject({ stale: true, checked_at: old });
    const status = successEnvelope.parse(
      await service.call("request_refresh", {
        term_code: 20263,
        course_codes: ["TEST100"],
      }),
    );
    expect(status.meta.stale).toBe(false);
    expect(status.data).toMatchObject({
      jobs: [{ pair: "DEMO/TEST", status: "complete" }],
    });
  } finally {
    await store.db.close();
  }
});
it("a worker source failure keeps the old snapshot and records a failed job", async () => {
  const store = await testStore();
  try {
    const before = await store.publish(20263, programs, [response()]);
    await store.enqueue(20263, "DEMO/TEST");
    const source = new UscClient(
      store,
      (async () => new Response("", { status: 403 })) as typeof fetch,
      1,
      1000,
      1,
    );
    await expect(runOneJob(store, source)).rejects.toMatchObject({
      code: "SOURCE_ACCESS_DENIED",
    });
    expect((await store.current(20263))?.id).toBe(before.id);
    const result = successEnvelope.parse(
      await new CourseService(store).call("get_courses", {
        term_code: 20263,
        course_codes: ["TEST100"],
      }),
    );
    expect(result.meta).toMatchObject({
      snapshot_version: before.id,
      checked_at: before.started_at,
      stale: true,
    });
    expect(
      (await store.db.query<{ status: string }>("SELECT status FROM jobs"))[0]
        ?.status,
    ).toBe("failed");
  } finally {
    await store.db.close();
  }
});
