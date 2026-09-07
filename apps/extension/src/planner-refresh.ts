/** Wait only for fresh public data; never alter or substitute selected sections. */
export async function refreshExactSelection<
  T extends {
    meta?: { stale: boolean; snapshot_version: string };
    sections: { id: string }[];
  },
>({
  sectionIds,
  requestRefresh,
  readLatest,
  signal,
}: {
  sectionIds: string[];
  requestRefresh: (signal: AbortSignal) => Promise<unknown>;
  readLatest: (signal: AbortSignal) => Promise<T>;
  signal: AbortSignal;
}): Promise<T> {
  signal.throwIfAborted();
  await requestRefresh(signal);
  for (let attempt = 0; attempt < 12; attempt++) {
    signal.throwIfAborted();
    const data = await readLatest(signal);
    signal.throwIfAborted();
    if (data.meta && !data.meta.stale) {
      if (sectionIds.some((id) => !data.sections.some((s) => s.id === id)))
        throw new Error(
          "A selected section is missing from the refreshed data. Your planner was kept unchanged; review the sections before continuing.",
        );
      return data;
    }
    if (attempt < 11)
      await new Promise<void>((resolve, reject) => {
        const abort = () => {
          clearTimeout(timer);
          reject(signal.reason);
        };
        const timer = setTimeout(() => {
          signal.removeEventListener("abort", abort);
          resolve();
        }, 5000);
        signal.addEventListener("abort", abort, { once: true });
      });
  }
  throw new Error(
    "Fresh data was not available within the wait. The refresh may still be pending or may have failed. Your exact sections are unchanged. Try Refresh data and recheck again.",
  );
}
