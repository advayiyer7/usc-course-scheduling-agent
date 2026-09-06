import { runOneJob } from "../apps/worker/src/ingest.js";
import { it, expect } from "vitest";
import { testStore } from "./database.js";
import { programs, response, course, sourceSection } from "./fixtures.js";
import { UscClient } from "../packages/source-usc/src/client.js";
import { Store } from "../packages/db/src/index.js";
import {
  runScheduledRefresh,
  scheduledPolicy,
  currentTerm,
} from "../apps/worker/src/schedule.js";

const DAY = 86_400_000;
const policy = { enabled: true, intervalMs: DAY, terms: [20263] };
function source(store: Store, payload = response().payload) {
  return new UscClient(
    store,
    (async (url: URL) =>
      Response.json(
        url.pathname.includes("Programs") ? programs : payload,
      )) as typeof fetch,
    1,
    1000,
    1,
  );
}

it("bootstraps a configured semester, caches instructor updates and retains pinned history", async () => {
  const store = await testStore();
  let now = Date.parse("2026-09-07T12:00:00Z");
  try {
    const initial = await runScheduledRefresh(
      store,
      source(store),
      policy,
      () => now,
    );
    expect(initial).toBeTruthy();
    const changed = sourceSection();
    changed.instructors = [{ firstName: "New", lastName: "Professor" }];
    const client = source(
      store,
      response([course("TEST100", [changed])]).payload,
    );
    // Reconstruct service objects to show cadence is stored in SQL, not timers.
    expect(
      await runScheduledRefresh(new Store(store.db), client, policy, () => now),
    ).toBeNull();
    expect(client.requestCount).toBe(0);
    now += DAY;
    const updated = await runScheduledRefresh(store, client, policy, () => now);
    expect(updated!.id).not.toBe(initial!.id);
    const [section] = await store.db.query<{ data: { instructors: string[] } }>(
      "SELECT data FROM sections WHERE snapshot_id=$1",
      [updated!.id],
    );
    expect(section!.data.instructors).toEqual(["New Professor"]);
    const [old] = await store.db.query<{ data: { instructors: string[] } }>(
      "SELECT data FROM sections WHERE snapshot_id=$1",
      [initial!.id],
    );
    expect(old!.data.instructors).toEqual(["Example Instructor"]);
    expect(client.requestCount).toBe(2);
  } finally {
    await store.db.close();
  }
});

it("keeps the last good cache after failure and backs off across worker restarts", async () => {
  const store = await testStore();
  let now = Date.parse("2026-09-08T12:00:00Z");
  try {
    const initial = await store.publish(20263, programs, [response()]);
    const bad = new UscClient(
      store,
      (async () => new Response("", { status: 500 })) as typeof fetch,
      1,
      1000,
      1,
    );
    await expect(
      runScheduledRefresh(store, bad, policy, () => now),
    ).rejects.toThrow();
    expect((await store.current(20263))!.id).toBe(initial.id);
    expect(
      await runScheduledRefresh(new Store(store.db), bad, policy, () => now),
    ).toBeNull();
    expect(bad.requestCount).toBe(1);
    const [state] = await store.db.query<{
      failures: number;
      last_error: string;
    }>("SELECT * FROM refresh_schedules");
    expect(state!.failures).toBe(1);
    expect(state!.last_error).toBeTruthy();
    now += 3_600_000;
    await runScheduledRefresh(store, source(store), policy, () => now);
    const [recovered] = await store.db.query<{
      failures: number;
      last_error: string | null;
    }>("SELECT * FROM refresh_schedules");
    expect(recovered).toMatchObject({ failures: 0, last_error: null });
  } finally {
    await store.db.close();
  }
});

it("a partial full-semester refresh never replaces the cache", async () => {
  const store = await testStore();
  try {
    const initial = await store.publish(20263, programs, [response()]);
    const client = new UscClient(
      store,
      (async (url: URL) => {
        if (url.pathname.includes("Programs"))
          return Response.json([
            ...programs,
            { termCode: 20263, prefix: "OTHER", schools: [{ prefix: "DEMO" }] },
          ]);
        return url.searchParams.get("program") === "OTHER"
          ? new Response("", { status: 404 })
          : Response.json(response().payload);
      }) as typeof fetch,
      1,
      1000,
      1,
    );
    await expect(
      runScheduledRefresh(store, client, policy, () =>
        Date.parse("2026-09-09T12:00:00Z"),
      ),
    ).rejects.toThrow();
    expect((await store.current(20263))!.id).toBe(initial.id);
  } finally {
    await store.db.close();
  }
});

it("freezes archived terms by default, honors disable, and respects the shared worker lease", async () => {
  const store = await testStore();
  try {
    await store.publish(20263, programs, [response()]);
    const client = source(store);
    expect(
      await runScheduledRefresh(
        store,
        client,
        { ...policy, terms: undefined },
        () => Date.parse("2027-02-01T12:00:00Z"),
      ),
    ).toBeNull();
    expect(
      await runScheduledRefresh(store, client, { ...policy, enabled: false }),
    ).toBeNull();
    await store.lease("other-worker");
    await expect(
      runScheduledRefresh(store, client, policy, () =>
        Date.parse("2026-09-09T12:00:00Z"),
      ),
    ).rejects.toThrow("Another refresh worker");
    expect(client.requestCount).toBe(0);
    await store.release("other-worker");
    await runScheduledRefresh(store, client, policy, () =>
      Date.parse("2026-09-09T12:00:00Z"),
    );
    expect(client.requestCount).toBe(2);
  } finally {
    await store.db.close();
  }
});

it("validates operator configuration and uses Los Angeles semester boundaries", () => {
  expect(scheduledPolicy({})).toEqual({
    enabled: true,
    intervalMs: DAY,
    terms: undefined,
  });
  expect(
    scheduledPolicy({ SEMESTER_REFRESH_TERMS: "20263,20271,20263" }).terms,
  ).toEqual([20263, 20271]);
  for (const env of [
    { SEMESTER_REFRESH_HOURS: "0" },
    { SEMESTER_REFRESH_HOURS: "1.5" },
    { SEMESTER_REFRESH_TERMS: "20264" },
    { SEMESTER_REFRESH_TERMS: "" },
    { SEMESTER_REFRESH_ENABLED: "yes" },
  ]) {
    expect(() => scheduledPolicy(env)).toThrow();
  }
  expect(currentTerm(Date.parse("2027-01-01T00:00:00Z"))).toBe(20263);
  expect(currentTerm(Date.parse("2027-05-02T12:00:00Z"))).toBe(20272);
});

it("serializes two schedulers and a targeted job without losing updates", async () => {
  const store = await testStore();
  const now = () => Date.parse("2026-09-09T12:00:00Z");
  let release!: () => void;
  let entered!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  try {
    await store.publish(20263, programs, [response()]);
    await store.enqueue(20263, "DEMO/TEST");
    const fullSource = new UscClient(
      store,
      (async (url: URL) => {
        if (url.pathname.includes("Programs")) {
          entered();
          await gate;
          return Response.json(programs);
        }
        return Response.json(response().payload);
      }) as typeof fetch,
      1,
      1000,
      1,
    );
    const running = runScheduledRefresh(store, fullSource, policy, now);
    await started;
    try {
      await expect(
        runScheduledRefresh(new Store(store.db), source(store), policy, now),
      ).rejects.toThrow("Another refresh worker");
      await expect(runOneJob(store, source(store))).rejects.toThrow(
        "Another refresh worker",
      );
    } finally {
      release();
      await running;
    }
    expect(
      await runScheduledRefresh(store, source(store), policy, now),
    ).toBeNull();
    const afterFull = await store.current(20263);
    const changed = sourceSection();
    changed.registeredSeats = 25;
    await runOneJob(
      store,
      source(store, response([course("TEST100", [changed])]).payload),
    );
    const afterTargeted = await store.current(20263);
    expect(afterTargeted!.id).not.toBe(afterFull!.id);
    expect(await store.snapshot(20263, afterFull!.id)).toBeDefined();
    const [job] = await store.db.query<{ status: string }>(
      "SELECT status FROM jobs",
    );
    expect(job!.status).toBe("complete");
    const [raw] = await store.db.query<{ payload: unknown }>(
      "SELECT payload FROM source_responses WHERE snapshot_id=$1",
      [afterTargeted!.id],
    );
    expect(raw!.payload).toMatchObject({
      courses: [{ sections: [{ registeredSeats: 25 }] }],
    });
  } finally {
    release();
    await store.db.close();
  }
});
