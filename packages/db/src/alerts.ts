import type { Database } from "./index.js";

export async function migrateAlerts(db: Database) {
  await db.transaction(async (tx) => {
    await tx.query(`CREATE TABLE IF NOT EXISTS alert_profiles (
      id text PRIMARY KEY, token_hash text UNIQUE NOT NULL, route text UNIQUE NOT NULL,
      revision text, created_at text NOT NULL)`);
    await tx.query(`CREATE TABLE IF NOT EXISTS alert_watches (
      id text PRIMARY KEY, profile_id text NOT NULL REFERENCES alert_profiles(id) ON DELETE CASCADE,
      revision text NOT NULL, data jsonb NOT NULL, active boolean NOT NULL DEFAULT true, created_at text NOT NULL)`);
    await tx.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS alert_watch_identity ON alert_watches(profile_id,revision,(data->>'course_code'),(data->>'section_id')) WHERE active`,
    );
    await tx.query(`CREATE TABLE IF NOT EXISTS alert_events (
      id text PRIMARY KEY, profile_id text NOT NULL REFERENCES alert_profiles(id) ON DELETE CASCADE,
      dedupe text NOT NULL, data jsonb NOT NULL, received_at text NOT NULL,
      check_started_at text, attempts integer NOT NULL DEFAULT 0,
      UNIQUE(profile_id,dedupe))`);
    await tx.query(
      `CREATE INDEX IF NOT EXISTS alert_event_inbox ON alert_events(profile_id,received_at DESC)`,
    );
    await tx.query(`CREATE TABLE IF NOT EXISTS alert_mail_jobs (
      email_id text PRIMARY KEY, profile_id text NOT NULL REFERENCES alert_profiles(id) ON DELETE CASCADE,
      received_at text NOT NULL, status text NOT NULL DEFAULT 'queued',
      attempts integer NOT NULL DEFAULT 0, next_at bigint NOT NULL DEFAULT 0,
      lease_until bigint NOT NULL DEFAULT 0, owner text, result text)`);
  });
}
