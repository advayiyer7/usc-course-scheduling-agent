import { configuredStore } from "../packages/db/src/config.js";
import { CourseService } from "../packages/domain/src/service.js";
import { createApp } from "../apps/api/src/http.js";
const store = await configuredStore(),
  service = new CourseService(store);
const snapshot = await store.current(20263);
if (!snapshot) throw new Error("Import Fall 2026 before benchmarking");
const app = createApp(service, { requestsPerMinute: 5000 });
const server = app.listen(0, "127.0.0.1");
await new Promise<void>((r) => server.once("listening", r));
const addr = server.address();
if (!addr || typeof addr === "string") throw new Error("Missing listener");
const url = `http://127.0.0.1:${addr.port}/api/tools/get_sections`;
const durations: number[] = [];
let next = 0,
  failures = 0;
const count = 500,
  concurrency = 20;
const before = await store.db.query(
  "SELECT next_at FROM upstream_budget WHERE id=1",
);
let upstreamRequests = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const target = new URL(input instanceof Request ? input.url : String(input));
  if (target.hostname === "usc.edu" || target.hostname.endsWith(".usc.edu"))
    upstreamRequests++;
  return originalFetch(input, init);
};
const started = performance.now();
try {
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (next++ < count) {
        const at = performance.now();
        const r = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            term_code: 20263,
            course_codes: ["CSCI104", "CSCI170", "MATH225"],
            snapshot_version: snapshot.id,
          }),
        });
        const d = await r.json();
        if (!r.ok || d.error) failures++;
        durations.push(performance.now() - at);
      }
    }),
  );
  const seconds = (performance.now() - started) / 1000;
  durations.sort((a, b) => a - b);
  const after = await store.db.query(
    "SELECT next_at FROM upstream_budget WHERE id=1",
  );
  console.log(
    JSON.stringify(
      {
        dataset: {
          courses: snapshot.course_count,
          sections: snapshot.section_count,
        },
        requests: durations.length,
        concurrency,
        failures,
        seconds: Math.round(seconds * 100) / 100,
        requests_per_second: Math.round(count / seconds),
        p50_ms: Math.round(durations[Math.floor(count * 0.5)]!),
        p95_ms: Math.round(durations[Math.floor(count * 0.95)]!),
        cache: service.metrics,
        upstream_requests: upstreamRequests,
        upstream_budget_unchanged:
          JSON.stringify(before) === JSON.stringify(after),
        scope:
          "Local loopback REST benchmark against stored Fall 2026 data. Limits raised for this run. Not a production capacity claim.",
      },
      null,
      2,
    ),
  );
} finally {
  globalThis.fetch = originalFetch;
  await new Promise<void>((r) => server.close(() => r()));
  await store.db.close();
}
