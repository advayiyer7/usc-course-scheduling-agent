import { randomUUID } from "node:crypto";
import type { Store } from "../../../packages/db/src/index.js";
import { UscClient } from "../../../packages/source-usc/src/client.js";

export async function withLease<T>(
  store: Store,
  fn: (owner: string) => Promise<T>,
) {
  const owner = randomUUID();
  if (!(await store.lease(owner)))
    throw new Error("Another refresh worker is active");
  let lost = false;
  const timer = setInterval(() => {
    void store
      .lease(owner)
      .then((ok) => {
        if (!ok) lost = true;
      })
      .catch(() => {
        lost = true;
      });
  }, 30000);
  try {
    const result = await fn(owner);
    if (lost) throw new Error("Refresh worker lease lost");
    return result;
  } finally {
    clearInterval(timer);
    await store.release(owner);
  }
}
export async function ingest(store: Store, source: UscClient, term: number) {
  return withLease(store, async (owner) => {
    const base = await store.current(term);
    const programs = await source.programs(term);
    const pairs = [
      ...new Set(
        programs.flatMap((p) =>
          p.schools.map((s) => `${s.prefix}/${p.prefix}`),
        ),
      ),
    ];
    const responses = [];
    for (const pair of pairs) {
      const [school, program] = pair.split("/");
      responses.push(await source.program(term, school!, program!));
    }
    return store.publish(term, programs, responses, base?.id, owner);
  });
}
export async function runOneJob(store: Store, source: UscClient) {
  return withLease(store, async (owner) => {
    // A held lease means any previously running job belonged to an expired worker.
    await store.db.query(
      `UPDATE jobs SET status='queued' WHERE status='running'`,
    );
    const [job] = await store.db.query<{
      id: string;
      term: number;
      pair: string;
    }>(
      `UPDATE jobs SET status='running',updated_at=$1 WHERE id=(SELECT id FROM jobs WHERE status='queued' ORDER BY created_at LIMIT 1) RETURNING id,term,pair`,
      [new Date().toISOString()],
    );
    if (!job) return null;
    try {
      const base = await store.current(job.term);
      if (!base) throw new Error("No base snapshot");
      const [school, program] = job.pair.split("/");
      const response = await source.program(job.term, school!, program!);
      const previous = await store.responses(base.id);
      const [index] = await store.db.query<{ payload: unknown }>(
        "SELECT payload FROM program_indexes WHERE snapshot_id=$1",
        [base.id],
      );
      await store.publish(
        job.term,
        index!.payload,
        previous.map((r) =>
          `${r.school}/${r.program}` === job.pair ? response : r,
        ),
        base.id,
        owner,
      );
      await store.db.query(
        `UPDATE jobs SET status='complete',updated_at=$1 WHERE id=$2`,
        [new Date().toISOString(), job.id],
      );
      return job;
    } catch (e) {
      await store.db.query(
        `UPDATE jobs SET status='failed',error=$1,updated_at=$2 WHERE id=$3`,
        [
          e instanceof Error ? e.message : "Refresh failed",
          new Date().toISOString(),
          job.id,
        ],
      );
      throw e;
    }
  });
}
