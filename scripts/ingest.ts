import {
  configuredStore,
  configuredSource,
} from "../packages/db/src/config.js";
import { termCode } from "../packages/contracts/src/index.js";
import { ingest } from "../apps/worker/src/ingest.js";
const term = termCode.parse(Number(process.argv[2]));
const store = await configuredStore();
try {
  console.log(
    JSON.stringify(await ingest(store, configuredSource(store), term), null, 2),
  );
} finally {
  await store.db.close();
}
