import { mkdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import pg from "pg";
import type {
  Course,
  Snapshot,
  SourceResponse,
} from "../../contracts/src/index.js";
import { randomUUID } from "node:crypto";
import {
  digest,
  normalize,
  programsSchema,
} from "../../source-usc/src/schema.js";

export interface Sql {
  query<T = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<T[]>;
}
export interface Database extends Sql {
  transaction<T>(fn: (tx: Sql) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}
export async function openDatabase(
  url?: string,
  dir?: string,
): Promise<Database> {
  if (url) {
    const pool = new pg.Pool({
      connectionString: url,
      max: 8,
      connectionTimeoutMillis: 5000,
      statement_timeout: 30000,
    });
    const wrap = (c: pg.Pool | pg.PoolClient): Sql => ({
      query: async <T>(s: string, p: unknown[] = []) =>
        (await c.query(s, p)).rows as T[],
    });
    return {
      ...wrap(pool),
      transaction: async (fn) => {
        const c = await pool.connect();
        try {
          await c.query("BEGIN");
          const result = await fn(wrap(c));
          await c.query("COMMIT");
          return result;
        } catch (e) {
          await c.query("ROLLBACK");
          throw e;
        } finally {
          c.release();
        }
      },
      close: () => pool.end(),
    };
  }
  if (dir) await mkdir(dir, { recursive: true });
  const db = new PGlite(dir);
  await db.waitReady;
  let tail: Promise<unknown> = Promise.resolve();
  const exclusive = <T>(fn: () => Promise<T>): Promise<T> => {
    const next = tail.then(fn, fn);
    tail = next.catch(() => {});
    return next;
  };
  const query = async <T>(s: string, p: unknown[] = []) =>
    (await db.query<T>(s, p)).rows;
  return {
    query: (s, p) => exclusive(() => query(s, p)),
    transaction: (fn) =>
      exclusive(() =>
        db.transaction((tx) =>
          fn({
            query: async <T>(s: string, p: unknown[] = []) =>
              (await tx.query<T>(s, p)).rows,
          }),
        ),
      ),
    close: () => exclusive(() => db.close()),
  };
}
const migrations = [
  `CREATE TABLE IF NOT EXISTS schema_versions (version integer PRIMARY KEY)`,
  `CREATE TABLE IF NOT EXISTS snapshots (id text PRIMARY KEY, term integer NOT NULL, started_at text NOT NULL, ended_at text NOT NULL, published_at text NOT NULL, coverage text NOT NULL, pair_count integer NOT NULL, course_count integer NOT NULL, section_count integer NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS terms (term integer PRIMARY KEY, snapshot_id text REFERENCES snapshots(id))`,
  `CREATE TABLE IF NOT EXISTS source_responses (snapshot_id text REFERENCES snapshots(id) ON DELETE CASCADE, pair text NOT NULL, checked_at text NOT NULL, url text NOT NULL, hash text NOT NULL, payload jsonb NOT NULL, PRIMARY KEY(snapshot_id,pair))`,
  `CREATE TABLE IF NOT EXISTS program_indexes (snapshot_id text PRIMARY KEY REFERENCES snapshots(id), payload jsonb NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS courses (snapshot_id text REFERENCES snapshots(id) ON DELETE CASCADE, key text NOT NULL, title text NOT NULL, data jsonb NOT NULL, PRIMARY KEY(snapshot_id,key))`,
  `CREATE TABLE IF NOT EXISTS course_aliases (snapshot_id text NOT NULL, alias text NOT NULL, course_key text NOT NULL, PRIMARY KEY(snapshot_id,alias,course_key), FOREIGN KEY(snapshot_id,course_key) REFERENCES courses(snapshot_id,key) ON DELETE CASCADE)`,
  `CREATE TABLE IF NOT EXISTS sections (snapshot_id text NOT NULL, id text NOT NULL, course_key text NOT NULL, data jsonb NOT NULL, PRIMARY KEY(snapshot_id,id), FOREIGN KEY(snapshot_id,course_key) REFERENCES courses(snapshot_id,key) ON DELETE CASCADE)`,
  `CREATE TABLE IF NOT EXISTS meetings (snapshot_id text NOT NULL, section_id text NOT NULL, position integer NOT NULL, data jsonb NOT NULL, PRIMARY KEY(snapshot_id,section_id,position), FOREIGN KEY(snapshot_id,section_id) REFERENCES sections(snapshot_id,id) ON DELETE CASCADE)`,
  `CREATE TABLE IF NOT EXISTS jobs (id text PRIMARY KEY, term integer NOT NULL, pair text NOT NULL, status text NOT NULL DEFAULT 'queued', created_at text NOT NULL, updated_at text NOT NULL, error text)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS active_job ON jobs(term,pair) WHERE status IN ('queued','running')`,
  `CREATE TABLE IF NOT EXISTS worker_lease (id integer PRIMARY KEY, owner text, expires_at bigint NOT NULL DEFAULT 0)`,
  `INSERT INTO worker_lease(id) VALUES (1) ON CONFLICT DO NOTHING`,
  `CREATE TABLE IF NOT EXISTS upstream_budget (id integer PRIMARY KEY, next_at bigint NOT NULL DEFAULT 0)`,
  `INSERT INTO upstream_budget(id) VALUES (1) ON CONFLICT DO NOTHING`,
  `INSERT INTO schema_versions(version) VALUES (1) ON CONFLICT DO NOTHING`,
];
export async function migrate(db: Database) {
  await db.transaction(async (tx) => {
    for (const sql of migrations) await tx.query(sql);
  });
}

export class Store {
  constructor(public db: Database) {}
  async current(term: number) {
    return (
      await this.db.query<Snapshot>(
        "SELECT s.* FROM snapshots s JOIN terms t ON t.snapshot_id=s.id WHERE t.term=$1",
        [term],
      )
    )[0];
  }
  async snapshot(term: number, id?: string) {
    return id
      ? (
          await this.db.query<Snapshot>(
            "SELECT * FROM snapshots WHERE term=$1 AND id=$2",
            [term, id],
          )
        )[0]
      : this.current(term);
  }
  async courses(id: string) {
    return (
      await this.db.query<{ data: Course }>(
        "SELECT data FROM courses WHERE snapshot_id=$1 ORDER BY key",
        [id],
      )
    ).map((r) => r.data);
  }
  async responses(id: string): Promise<SourceResponse[]> {
    return (
      await this.db.query<{
        pair: string;
        checked_at: string;
        url: string;
        payload: unknown;
      }>(
        "SELECT pair,checked_at,url,payload FROM source_responses WHERE snapshot_id=$1 ORDER BY pair",
        [id],
      )
    ).map((r) => ({
      school: r.pair.split("/")[0]!,
      program: r.pair.split("/")[1]!,
      ...r,
    }));
  }
  async publish(
    term: number,
    programs: unknown,
    responses: SourceResponse[],
    expectedBase?: string,
    leaseOwner?: string,
  ) {
    const index = programsSchema.parse(programs);
    if (index.some((p) => p.termCode !== term))
      throw new Error("Program term mismatch");
    const expected = new Set(
      index.flatMap((p) => p.schools.map((s) => `${s.prefix}/${p.prefix}`)),
    );
    const actual = new Set(responses.map((r) => `${r.school}/${r.program}`));
    if (
      actual.size !== responses.length ||
      actual.size !== expected.size ||
      [...expected].some((p) => !actual.has(p))
    )
      throw new Error("Incomplete source coverage");
    if (responses.some((r) => !Number.isFinite(Date.parse(r.checked_at))))
      throw new Error("Invalid source timestamp");
    const cs = normalize(term, responses);
    if (!cs.length) throw new Error("Empty semester rejected");
    const dates = responses.map((r) => r.checked_at).sort();
    const snap: Snapshot = {
      id: randomUUID(),
      term,
      started_at: dates[0]!,
      ended_at: dates.at(-1)!,
      published_at: new Date().toISOString(),
      coverage: "complete_public_index",
      pair_count: expected.size,
      course_count: cs.length,
      section_count: cs.reduce((n, c) => n + c.sections.length, 0),
    };
    await this.db.transaction(async (tx) => {
      if (leaseOwner) {
        const [lease] = await tx.query<{ owner: string; expires_at: string }>(
          "SELECT owner,expires_at FROM worker_lease WHERE id=1 FOR UPDATE",
        );
        if (
          lease?.owner !== leaseOwner ||
          Number(lease.expires_at) <= Date.now()
        )
          throw new Error("Worker lease lost before publication");
      }
      // Serialize publication per term, including the first import. CAS protects targeted updates.
      await tx.query(
        "INSERT INTO terms(term) VALUES ($1) ON CONFLICT DO NOTHING",
        [term],
      );
      const [row] = await tx.query<{ snapshot_id: string | null }>(
        "SELECT snapshot_id FROM terms WHERE term=$1 FOR UPDATE",
        [term],
      );
      if (expectedBase && row?.snapshot_id !== expectedBase)
        throw new Error("Snapshot changed during refresh; retry");
      if (row?.snapshot_id) {
        const [old] = await tx.query<Snapshot>(
          "SELECT * FROM snapshots WHERE id=$1",
          [row.snapshot_id],
        );
        if (
          old &&
          (snap.course_count < old.course_count * 0.9 ||
            snap.section_count < old.section_count * 0.9 ||
            snap.pair_count < old.pair_count)
        )
          throw new Error("Unexpected coverage drop: publication rejected");
        const previous = await tx.query<{ pair: string }>(
          `SELECT pair FROM source_responses WHERE snapshot_id=$1 AND jsonb_array_length(COALESCE(NULLIF(payload->'courses','null'::jsonb),'[]'::jsonb))>0`,
          [row.snapshot_id],
        );
        const emptied = responses.filter(
          (r) =>
            !(r.payload as { courses: unknown[] | null }).courses?.length &&
            previous.some((p) => p.pair === `${r.school}/${r.program}`),
        );
        if (emptied.length)
          throw new Error(
            "Previously nonempty program became empty; publication rejected for review",
          );
      }
      await tx.query(
        "INSERT INTO snapshots VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
        Object.values(snap),
      );
      await tx.query("INSERT INTO program_indexes VALUES ($1,$2::jsonb)", [
        snap.id,
        JSON.stringify(programs),
      ]);
      for (const r of responses)
        await tx.query(
          "INSERT INTO source_responses VALUES ($1,$2,$3,$4,$5,$6::jsonb)",
          [
            snap.id,
            `${r.school}/${r.program}`,
            r.checked_at,
            r.url,
            digest(r.payload),
            JSON.stringify(r.payload),
          ],
        );
      // Chunk JSON recordsets to avoid one SQL round trip per meeting.
      const insert = async (
        table: string,
        columns: string,
        definition: string,
        records: unknown[],
      ) => {
        for (let i = 0; i < records.length; i += 500)
          await tx.query(
            `INSERT INTO ${table} (${columns}) SELECT ${columns} FROM jsonb_to_recordset($1::jsonb) AS x(${definition})`,
            [JSON.stringify(records.slice(i, i + 500))],
          );
      };
      await insert(
        "courses",
        "snapshot_id,key,title,data",
        "snapshot_id text,key text,title text,data jsonb",
        cs.map((c) => ({
          snapshot_id: snap.id,
          key: c.key,
          title: c.title,
          data: { ...c, sections: [] },
        })),
      );
      await insert(
        "course_aliases",
        "snapshot_id,alias,course_key",
        "snapshot_id text,alias text,course_key text",
        cs.flatMap((c) =>
          c.aliases.map((alias) => ({
            snapshot_id: snap.id,
            alias,
            course_key: c.key,
          })),
        ),
      );
      await insert(
        "sections",
        "snapshot_id,id,course_key,data",
        "snapshot_id text,id text,course_key text,data jsonb",
        cs.flatMap((c) =>
          c.sections.map((s) => ({
            snapshot_id: snap.id,
            id: s.id,
            course_key: c.key,
            data: s,
          })),
        ),
      );
      await insert(
        "meetings",
        "snapshot_id,section_id,position,data",
        "snapshot_id text,section_id text,position integer,data jsonb",
        cs.flatMap((c) =>
          c.sections.flatMap((s) =>
            s.meetings.map((m, position) => ({
              snapshot_id: snap.id,
              section_id: s.id,
              position,
              data: m,
            })),
          ),
        ),
      );
      await tx.query("UPDATE terms SET snapshot_id=$1 WHERE term=$2", [
        snap.id,
        term,
      ]);
    });
    return snap;
  }
  async permit(interval: number) {
    return this.db.transaction(async (tx) => {
      const [r] = await tx.query<{ next_at: string }>(
        "SELECT next_at FROM upstream_budget WHERE id=1 FOR UPDATE",
      );
      const at = Math.max(Date.now(), Number(r!.next_at));
      await tx.query("UPDATE upstream_budget SET next_at=$1 WHERE id=1", [
        at + interval,
      ]);
      return at;
    });
  }
  async enqueue(term: number, pair: string) {
    const id = randomUUID(),
      now = new Date().toISOString();
    return this.db.transaction(async (tx) => {
      await tx.query(
        `INSERT INTO jobs(id,term,pair,created_at,updated_at) VALUES($1,$2,$3,$4,$4) ON CONFLICT DO NOTHING`,
        [id, term, pair, now],
      );
      return (
        await tx.query<{ id: string; status: string }>(
          `SELECT id,status FROM jobs WHERE term=$1 AND pair=$2 AND status IN ('queued','running')`,
          [term, pair],
        )
      )[0]!;
    });
  }
  async lease(owner: string) {
    return (
      (
        await this.db.query(
          "UPDATE worker_lease SET owner=$1,expires_at=$2 WHERE id=1 AND (owner=$1 OR expires_at<$3) RETURNING id",
          [owner, Date.now() + 180000, Date.now()],
        )
      ).length > 0
    );
  }
  async release(owner: string) {
    await this.db.query(
      "UPDATE worker_lease SET owner=NULL,expires_at=0 WHERE id=1 AND owner=$1",
      [owner],
    );
  }
}
