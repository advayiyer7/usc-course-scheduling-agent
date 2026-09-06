import { setTimeout as sleep } from "node:timers/promises";
import {
  configuredStore,
  configuredSource,
} from "../../../packages/db/src/config.js";
import { runOneJob } from "./ingest.js";
if (!process.env.DATABASE_URL)
  throw new Error(
    "A separate worker requires DATABASE_URL. Embedded development runs a worker in the API process.",
  );
const store = await configuredStore(),
  source = configuredSource(store);
let stopped = false;
process.on("SIGINT", () => {
  stopped = true;
});
process.on("SIGTERM", () => {
  stopped = true;
});
try {
  while (!stopped) {
    try {
      await runOneJob(store, source);
    } catch (e) {
      console.error(e instanceof Error ? e.message : "Worker failed");
    }
    await sleep(2000);
  }
} finally {
  await store.db.close();
}
