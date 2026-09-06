import pg from "pg";
import { randomUUID } from "node:crypto";
import { openDatabase, migrate, Store } from "../packages/db/src/index.js";
export async function testStore() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    const db = await openDatabase();
    await migrate(db);
    return new Store(db);
  }
  const parsed = new URL(url);
  if (parsed.pathname !== "/usc_test")
    throw new Error(
      "TEST_DATABASE_URL must target the dedicated usc_test database.",
    );
  const admin = new pg.Pool({ connectionString: url, max: 1 });
  const schema = "test_" + randomUUID().replaceAll("-", "");
  await admin.query(`CREATE SCHEMA ${schema}`);
  parsed.searchParams.set("options", `-c search_path=${schema}`);
  const db = await openDatabase(parsed.href);
  const close = db.close.bind(db);
  db.close = async () => {
    try {
      await close();
    } finally {
      await admin.query(`DROP SCHEMA ${schema} CASCADE`);
      await admin.end();
    }
  };
  await migrate(db);
  return new Store(db);
}
