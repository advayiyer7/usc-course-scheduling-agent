import { openDatabase, migrate, Store } from "./index.js";
import { UscClient } from "../../source-usc/src/client.js";
export async function configuredStore() {
  const db = await openDatabase(
    process.env.DATABASE_URL,
    process.env.PGLITE_DIR ?? "./data/local",
  );
  await migrate(db);
  return new Store(db);
}
function positive(name: string, fallback: number, max: number) {
  const n = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(n) || n < 1 || n > max)
    throw new Error(`Invalid ${name}`);
  return n;
}
export function configuredSource(store: Store) {
  return new UscClient(
    store,
    fetch,
    positive("SOURCE_REQUEST_INTERVAL_MS", 1000, 60000),
    positive("SOURCE_TIMEOUT_MS", 45000, 60000),
    positive("SOURCE_MAX_ATTEMPTS", 3, 5),
  );
}
