import { afterEach, expect, it, vi } from "vitest";
import { refreshExactSelection } from "../apps/extension/src/planner-refresh.js";
const data = (stale: boolean, ids = ["10001"]) => ({
  meta: { stale, snapshot_version: "fixture" },
  sections: ids.map((id) => ({ id })),
});
afterEach(() => vi.useRealTimers());
it("waits for refreshed data and keeps the exact selected sections", async () => {
  vi.useFakeTimers();
  const latest = vi
    .fn()
    .mockResolvedValueOnce(data(true))
    .mockResolvedValue(data(false));
  const refresh = vi.fn(async () => {});
  const result = refreshExactSelection({
    sectionIds: ["10001"],
    requestRefresh: refresh,
    readLatest: latest,
    signal: new AbortController().signal,
  });
  await vi.advanceTimersByTimeAsync(5000);
  expect(await result).toEqual(data(false));
  expect(refresh).toHaveBeenCalledTimes(1);
  expect(latest).toHaveBeenCalledTimes(2);
});
it("never substitutes or removes a missing selected section", async () => {
  await expect(
    refreshExactSelection({
      sectionIds: ["10001"],
      requestRefresh: async () => {},
      readLatest: async () => data(false, ["10002"]),
      signal: new AbortController().signal,
    }),
  ).rejects.toThrow("planner was kept unchanged");
});
it("reports an unfinished refresh after bounded polling, not a fresh snapshot", async () => {
  vi.useFakeTimers();
  const latest = vi.fn(async () => data(true));
  const result = refreshExactSelection({
    sectionIds: ["10001"],
    requestRefresh: async () => {},
    readLatest: latest,
    signal: new AbortController().signal,
  });
  const rejected = expect(result).rejects.toThrow("still queued or running");
  await vi.advanceTimersByTimeAsync(60000);
  await rejected;
  expect(latest).toHaveBeenCalledTimes(12);
});
it("stops polling on cancellation and rejects late data after interruption", async () => {
  const controller = new AbortController();
  let finish!: (value: ReturnType<typeof data>) => void;
  const result = refreshExactSelection({
    sectionIds: ["10001"],
    requestRefresh: async () => {},
    readLatest: () =>
      new Promise<ReturnType<typeof data>>((resolve) => {
        finish = resolve;
      }),
    signal: controller.signal,
  });
  await Promise.resolve();
  controller.abort(new Error("Stopped"));
  finish(data(false));
  await expect(result).rejects.toThrow("Stopped");
});
