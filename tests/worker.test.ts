import { it, expect } from "vitest";
import { testStore } from "./database.js";
import { programs, response } from "./fixtures.js";
import { UscClient } from "../packages/source-usc/src/client.js";
import { CourseService } from "../packages/domain/src/service.js";
import { runOneJob } from "../apps/worker/src/ingest.js";
it("100 refresh requests cause one fetch and publish a newer immutable snapshot", async () => {
  const store = await testStore();
  try {
    const before = await store.publish(20263, programs, [response()]);
    const service = new CourseService(store);
    await Promise.all(
      Array.from({ length: 100 }, () =>
        service.call("request_refresh", {
          term_code: 20263,
          course_codes: ["TEST100"],
        }),
      ),
    );
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
    expect(
      (await store.db.query<{ status: string }>("SELECT status FROM jobs"))[0]
        ?.status,
    ).toBe("failed");
  } finally {
    await store.db.close();
  }
});
