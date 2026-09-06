import type { Store } from "../../../packages/db/src/index.js";
import type { UscClient } from "../../../packages/source-usc/src/client.js";
import { termCode } from "../../../packages/contracts/src/index.js";
import { refreshTerm, withLease } from "./ingest.js";

const HOUR = 3_600_000;
export interface RefreshPolicy {
  enabled: boolean;
  intervalMs: number;
  // Undefined selects already cached current/upcoming terms. Explicit terms
  // can bootstrap a new cache or refresh an archived semester.
  terms?: number[];
}
export function scheduledPolicy(
  env: NodeJS.ProcessEnv = process.env,
): RefreshPolicy {
  const enabled = env.SEMESTER_REFRESH_ENABLED ?? "true";
  if (!["true", "false"].includes(enabled))
    throw new Error("Invalid SEMESTER_REFRESH_ENABLED");
  const hours = Number(env.SEMESTER_REFRESH_HOURS ?? 24);
  if (!Number.isInteger(hours) || hours < 1 || hours > 24 * 30)
    throw new Error("SEMESTER_REFRESH_HOURS must be an integer from 1 to 720");
  const terms =
    env.SEMESTER_REFRESH_TERMS === undefined
      ? undefined
      : [
          ...new Set(
            env.SEMESTER_REFRESH_TERMS.split(",").map((value) =>
              termCode.parse(Number(value.trim())),
            ),
          ),
        ];
  if (terms && terms.length > 12)
    throw new Error("At most 12 scheduled semesters are supported");
  return { enabled: enabled === "true", intervalMs: hours * HOUR, terms };
}

// Approximate semester boundary, evaluated in USC's timezone. Operators can
// override the term list for actual registration/session dates.
export function currentTerm(now: number): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "numeric",
  }).formatToParts(now);
  const year = Number(parts.find((p) => p.type === "year")!.value);
  const month = Number(parts.find((p) => p.type === "month")!.value);
  return year * 10 + (month <= 4 ? 1 : month <= 7 ? 2 : 3);
}

export async function runScheduledRefresh(
  store: Store,
  source: UscClient,
  policy: RefreshPolicy,
  clock: () => number = Date.now,
) {
  if (!policy.enabled) return null;
  // Quick read-only check avoids competing for the worker lease on every tick.
  const terms =
    policy.terms ??
    (
      await store.db.query<{ term: number }>(
        "SELECT term FROM terms WHERE snapshot_id IS NOT NULL AND term >= $1 ORDER BY term",
        [currentTerm(clock())],
      )
    ).map((row) => row.term);
  if (!terms.length) return null;
  for (const term of terms) {
    const base = await store.current(term);
    // Use the oldest record timestamp; a targeted refresh cannot postpone a
    // full reconciliation of the rest of the semester.
    const due = base
      ? Date.parse(base.started_at) + policy.intervalMs
      : clock();
    await store.db.query(
      "INSERT INTO refresh_schedules(term,next_at) VALUES($1,$2) ON CONFLICT DO NOTHING",
      [term, due],
    );
  }
  const due = () =>
    store.db.query<{ term: number; failures: number }>(
      "SELECT term,failures FROM refresh_schedules WHERE term=ANY($1::int[]) AND next_at <= $2 ORDER BY next_at,term LIMIT 1",
      [terms, clock()],
    );
  if (!(await due()).length) return null;
  return withLease(store, async (owner) => {
    // Recheck after obtaining the lease: another worker may have completed it.
    const [job] = await due();
    if (!job) return null;
    await store.db.query(
      "UPDATE refresh_schedules SET last_attempt_at=$1 WHERE term=$2",
      [new Date(clock()).toISOString(), job.term],
    );
    try {
      const snapshot = await refreshTerm(store, source, job.term, owner);
      await store.db.query(
        "UPDATE refresh_schedules SET next_at=$1,failures=0,last_success_at=$2,last_error=NULL WHERE term=$3 AND EXISTS (SELECT 1 FROM worker_lease WHERE id=1 AND owner=$4 AND expires_at>$5)",
        [
          clock() + policy.intervalMs,
          new Date(clock()).toISOString(),
          job.term,
          owner,
          Date.now(),
        ],
      );
      return snapshot;
    } catch (error) {
      const delay = Math.min(24 * HOUR, HOUR * 2 ** Math.min(job.failures, 5));
      await store.db.query(
        "UPDATE refresh_schedules SET next_at=$1,failures=failures+1,last_error=$2 WHERE term=$3 AND EXISTS (SELECT 1 FROM worker_lease WHERE id=1 AND owner=$4 AND expires_at>$5)",
        [
          clock() + delay,
          (error instanceof Error
            ? error.message
            : "Semester refresh failed"
          ).slice(0, 1000),
          job.term,
          owner,
          Date.now(),
        ],
      );
      throw error;
    }
  });
}
