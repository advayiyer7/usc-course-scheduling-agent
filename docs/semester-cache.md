# Semester cache and scheduled refreshes

Course queries read the durable PostgreSQL/PGlite cache. They do not scrape USC
for every student. The cache stores immutable semester snapshots, so an existing
schedule or paginated request can keep using the version it originally selected.

The worker now automatically reconciles eligible semesters every 24 hours. A
full reconciliation fetches the current program index and every listed
school/program pair. This discovers new offerings and updates USC-supplied
instructor names/assignments, meetings, seats, descriptions and other source
fields together. It does not fetch professor ratings, reviews or biographies.

## Run and configure

The existing `npm run dev` process runs the scheduler when using embedded PGlite.
With `DATABASE_URL`, run `npm run worker` alongside the API. Only one process may
open an embedded database directory. The scheduler is part of the application,
not a Codex reminder or an operating-system cron installation.

Environment variables (also shown in `.env.example`):

| Setting | Default | Behavior |
| --- | --- | --- |
| `SEMESTER_REFRESH_ENABLED` | `true` | Set `false` to stop automatic reconciliation; manual refresh jobs still work. |
| `SEMESTER_REFRESH_HOURS` | `24` | Integer from 1 to 720; delay from successful completion to next refresh. |
| `SEMESTER_REFRESH_TERMS` | unset | Comma-separated valid term codes, at most 12; e.g. `20263,20271`. Explicit terms can bootstrap an empty cache or refresh an archive. |

Without an explicit term list, only already-cached current/upcoming semesters
are refreshed. An empty cache therefore makes no scheduled source requests until
you ingest a term or explicitly configure one. Automatic discovery of newly
published term codes is not implemented. Current semester selection uses Los
Angeles time and approximate boundaries: January–April spring, May–July summer,
August–December fall. Set explicit terms when registration/session dates differ.
Older semesters remain cached and are no longer automatically polled.

On first enablement, the oldest source timestamp plus the interval determines
when a cached term is due. An overdue semester refreshes at the next worker tick.
A targeted update cannot make all the other records appear fresh. Future runs
use a durable `refresh_schedules` row, so restarting the worker does not restart
the cadence or duplicate a completed run. Restart processes to load environment
changes; changing the interval takes effect after the next successful refresh.
Removing a configured term or disabling refresh leaves its cache/history intact.

Bounded lookups and validation report freshness for their relevant courses and
sections, using the oldest contributing observation. Whole-term listings and
searches still report the catalog's oldest observation. This distinction lets a
successfully refreshed selection become current without pretending that every
other department was refreshed. Missing requested records fall back to the
whole-catalog timestamp; older cross-list evidence remains visible.

After `request_refresh`, read current courses/sections without an old snapshot
pin, preserve the student's exact selected section IDs, and validate them against
the newly returned version. A queued or recently completed job is not itself a
freshness guarantee. A saved draft keeps its old version until explicitly
rechecked. Refreshing data does not verify component rules or personal eligibility.

## Failure handling and concurrency

Full refreshes, targeted jobs and manual ingestion share the existing worker
lease and global USC request budget. Multiple scheduler instances cannot fetch
the same semester concurrently while the lease is valid. Publication checks
lease ownership and the base snapshot before switching the current version.
Workers run at most one scheduled semester and then one targeted job per tick.

All responses are staged and validated before publication. Missing programs,
malformed data, source errors and unexpected coverage drops preserve the last
good cache. Clients continue receiving existing freshness metadata. Successful
publication updates the cache atomically; previously pinned versions remain
available. A timestamp means when data was fetched, not when USC changed it.

Failed scheduled refreshes retry after 1, 2, 4, 8, 16, then at most 24 hours.
USC's shared access-denial/Retry-After cooldown still applies. A crashed worker's
due refresh can be retried after its lease expires; a partly fetched semester is
never published. A live worker must remain running for updates to execute. After
downtime, one due reconciliation runs rather than replaying every missed interval.

Inspect schedule state in the application's database:

```sql
SELECT term, to_timestamp(next_at / 1000.0) AS next_refresh,
       last_attempt_at, last_success_at, failures, last_error
FROM refresh_schedules ORDER BY next_at;
```

The cache currently retains all published snapshots. Monitor disk use; automatic
retention/pruning is not implemented because deleting versions can invalidate
saved schedules. Refresh timing is a local polling policy, not a guarantee of
upstream freshness.

## Verification

`npm run check` includes fixture-backed database tests for bootstrapping,
instructor changes, immutable history, persisted cadence/retries, partial source
failure, archived/disabled terms, configuration validation, competing schedulers
and targeted jobs. Tests make no live USC requests. They use PGlite by default;
set the existing `TEST_DATABASE_URL` for the dedicated PostgreSQL test database
to exercise the same suite against PostgreSQL.

Freshness regression tests cover selected versus unrelated records, mixed ages,
old pinned versions, missing records, cross-list evidence and failed refreshes.
The 100-request coalescing test observes one upstream fixture request, a fresh
selected program and unchanged old evidence for another program.
