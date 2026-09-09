import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  alertInbox,
  alertEvent,
  alertWatch,
  confirmOpening,
  planIdentity,
  watchInput,
  type AlertEvent,
  type AlertWatch,
  type AlertPlan,
  type Opening,
} from "../../contracts/src/alerts.js";
import type { Section, Course } from "../../contracts/src/index.js";
import type { Sql } from "../../db/src/index.js";
import type { CourseService } from "./service.js";

const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const stamp = () => new Date().toISOString();
const maxAge = 30 * 60_000;
export class AlertError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export class AlertService {
  constructor(
    public courses: CourseService,
    public options: { domain?: string; pilot?: boolean } = {},
  ) {
    if (
      options.domain &&
      !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(
        options.domain,
      )
    )
      throw new Error("Invalid ALERTS_INBOUND_DOMAIN");
  }
  get db() {
    return this.courses.store.db;
  }
  async pair() {
    const token = randomBytes(32).toString("base64url"),
      id = randomUUID();
    await this.db.transaction(async (tx) => {
      // This is a local pilot pairing route, not public self-service signup.
      await tx.query("LOCK TABLE alert_profiles IN SHARE ROW EXCLUSIVE MODE");
      const [count] = await tx.query<{ n: string }>(
        "SELECT count(*) AS n FROM alert_profiles",
      );
      if (Number(count?.n) >= 100)
        throw new AlertError(429, "Local pilot profile limit reached.");
      await tx.query(
        "INSERT INTO alert_profiles(id,token_hash,route,created_at) VALUES ($1,$2,$3,$4)",
        [id, hash(token), randomBytes(24).toString("hex"), stamp()],
      );
    });
    return { token };
  }
  async authenticate(token: unknown) {
    if (typeof token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(token))
      throw new AlertError(401, "Pair this extension with the alert service.");
    const [p] = await this.db.query<{ id: string }>(
      "SELECT id FROM alert_profiles WHERE token_hash=$1",
      [hash(token)],
    );
    if (!p)
      throw new AlertError(401, "Pairing was revoked. Connect alerts again.");
    return p.id;
  }
  async lockProfile(tx: Sql, profile: string) {
    const [p] = await tx.query<{ revision: string }>(
      "SELECT revision FROM alert_profiles WHERE id=$1 FOR UPDATE",
      [profile],
    );
    if (!p) throw new AlertError(401, "Pairing was revoked.");
    return p;
  }
  async sync(profile: string, plan: AlertPlan) {
    const revision = hash(planIdentity(plan));
    await this.db.transaction(async (tx) => {
      await this.lockProfile(tx, profile);
      await tx.query("UPDATE alert_profiles SET revision=$2 WHERE id=$1", [
        profile,
        revision,
      ]);
      await tx.query(
        "UPDATE alert_watches SET active=false WHERE profile_id=$1 AND revision<>$2",
        [profile, revision],
      );
    });
    return { revision };
  }
  async watch(profile: string, raw: unknown) {
    const input = watchInput.parse(raw),
      revision = hash(planIdentity(input.plan));
    if (
      !input.plan.course_codes.includes(input.course_code) ||
      !input.plan.section_ids.includes(input.section_id)
    )
      throw new AlertError(400, "Choose a section in the current planner.");
    const snapshot = await this.courses.store.current(input.plan.term_code);
    if (!snapshot)
      throw new AlertError(409, "Load this semester's course data first.");
    const [row] = await this.db.query<{ data: Section; course: Course }>(
      "SELECT s.data,c.data AS course FROM sections s JOIN courses c ON c.snapshot_id=s.snapshot_id AND c.key=s.course_key WHERE s.snapshot_id=$1 AND s.id=$2",
      [snapshot.id, input.section_id],
    );
    if (!row?.course.aliases.includes(input.course_code) || row.data.cancelled)
      throw new AlertError(
        409,
        "That course and section do not match an active catalog entry.",
      );
    return this.db.transaction(async (tx) => {
      const p = await this.lockProfile(tx, profile);
      if (p.revision !== revision)
        throw new AlertError(
          409,
          "Planner changed. Sync the current plan first.",
        );
      const existing = await tx.query<{ id: string; data: AlertWatch }>(
        "SELECT id,data FROM alert_watches WHERE profile_id=$1 AND active AND revision=$2",
        [profile, revision],
      );
      const same = existing.find(
        (w) =>
          w.data.course_code === input.course_code &&
          w.data.section_id === input.section_id,
      );
      if (same) return { id: same.id };
      if (existing.length >= 20)
        throw new AlertError(429, "At most 20 sections can be watched.");
      const w: AlertWatch = {
        ...input,
        id: randomUUID(),
        revision,
        created_at: stamp(),
        active: true,
      };
      await tx.query(
        "INSERT INTO alert_watches(id,profile_id,revision,data,created_at) VALUES ($1,$2,$3,$4::jsonb,$5)",
        [w.id, profile, revision, JSON.stringify(w), w.created_at],
      );
      return { id: w.id };
    });
  }
  async removeWatch(profile: string, id: string) {
    await this.db.transaction(async (tx) => {
      await this.lockProfile(tx, profile);
      await tx.query(
        "UPDATE alert_watches SET active=false WHERE profile_id=$1 AND id=$2",
        [profile, id],
      );
    });
  }
  async revoke(profile: string) {
    await this.db.query("DELETE FROM alert_profiles WHERE id=$1", [profile]);
  }
  async accept(
    profile: string,
    dedupe: string,
    data: Opening,
    receivedAt: string,
    source: AlertEvent["source"],
  ) {
    // Every candidate requires review: delivery authenticity is not sender/semester authenticity.
    return this.db.transaction(async (tx) => {
      const p = await this.lockProfile(tx, profile);
      const [duplicate] = await tx.query(
        "SELECT id FROM alert_events WHERE profile_id=$1 AND dedupe=$2",
        [profile, hash(dedupe)],
      );
      if (duplicate) return "duplicate";
      const matches = await tx.query<{ id: string }>(
        "SELECT id FROM alert_watches WHERE profile_id=$1 AND active AND revision=$2 AND data->>'course_code'=$3 AND data->>'section_id'=$4 AND created_at<=$5 ORDER BY id LIMIT 20",
        [profile, p.revision, data.course_code, data.section_id, receivedAt],
      );
      if (!matches.length) return "unmatched";
      const [count] = await tx.query<{ n: string }>(
        "SELECT count(*) AS n FROM alert_events WHERE profile_id=$1",
        [profile],
      );
      if (Number(count?.n) >= 500)
        throw new AlertError(429, "Alert retention limit reached.");
      const age = Date.now() - Date.parse(receivedAt);
      const e: AlertEvent = {
        id: randomUUID(),
        received_at: receivedAt,
        opening: data,
        source,
        status: age > maxAge || age < -60_000 ? "expired" : "review_required",
        watch_ids: matches.map((w) => w.id),
        selected_watch_id: null,
        checked_at: null,
        snapshot_version: null,
        current_seats: null,
        warning:
          "The email does not establish its semester or current availability. Confirm its source and saved watch before rechecking. Helper may need its watch re-enabled after this alert.",
      };
      const rows = await tx.query(
        "INSERT INTO alert_events(id,profile_id,dedupe,data,received_at) VALUES ($1,$2,$3,$4::jsonb,$5) ON CONFLICT(profile_id,dedupe) DO NOTHING RETURNING id",
        [e.id, profile, hash(dedupe), JSON.stringify(e), receivedAt],
      );
      return rows.length ? "accepted" : "duplicate";
    });
  }
  async confirm(profile: string, raw: unknown) {
    const r = confirmOpening.parse(raw),
      revision = hash(planIdentity(r.plan));
    const w = await this.db.transaction(async (tx) => {
      const p = await this.lockProfile(tx, profile);
      const [row] = await tx.query<{
        data: AlertEvent;
        check_started_at: string | null;
        attempts: number;
      }>(
        "SELECT data,check_started_at,attempts FROM alert_events WHERE profile_id=$1 AND id=$2 FOR UPDATE",
        [profile, r.event_id],
      );
      const [watch] = await tx.query<{ data: AlertWatch }>(
        "SELECT data FROM alert_watches WHERE profile_id=$1 AND id=$2 AND revision=$3 AND active",
        [profile, r.watch_id, revision],
      );
      if (
        !row ||
        !watch ||
        p.revision !== revision ||
        !row.data.watch_ids.includes(r.watch_id)
      )
        throw new AlertError(
          409,
          "The saved watch no longer matches your planner.",
        );
      if (
        ["dismissed", "invalidated"].includes(row.data.status) ||
        Date.now() - Date.parse(row.data.received_at) > maxAge
      )
        throw new AlertError(
          409,
          "This alert is no longer actionable. Re-enable the watch in Schedule Helper.",
        );
      if (
        row.data.status === "checking" ||
        (row.check_started_at &&
          Date.now() - Date.parse(row.check_started_at) < 60_000)
      )
        throw new AlertError(
          409,
          "A check was recently requested. Wait a minute before trying again.",
        );
      if (row.attempts >= 3)
        throw new AlertError(
          429,
          "Check limit reached for this alert. Review the course in your planner.",
        );
      await tx.query(
        "UPDATE alert_events SET data=$3::jsonb,check_started_at=$4,attempts=attempts+1 WHERE profile_id=$1 AND id=$2",
        [
          profile,
          r.event_id,
          JSON.stringify({
            ...row.data,
            status: "checking",
            selected_watch_id: r.watch_id,
            current_seats: null,
            checked_at: null,
            snapshot_version: null,
            warning:
              "Waiting for fresh USC public data. No registration has been submitted.",
          }),
          stamp(),
        ],
      );
      return watch.data;
    });
    // This uses the existing queue/coalescing/cooldown. No new source client or per-student polling budget.
    await this.courses.call("request_refresh", {
      term_code: w.plan.term_code,
      course_codes: [w.course_code],
    });
  }
  async dismiss(profile: string, id: string) {
    await this.db.query(
      "UPDATE alert_events SET data=jsonb_set(data,'{status}','\"dismissed\"') WHERE profile_id=$1 AND id=$2",
      [profile, id],
    );
  }
  async inbox(profile: string) {
    const [p] = await this.db.query<{ route: string; revision: string }>(
      "SELECT route,revision FROM alert_profiles WHERE id=$1",
      [profile],
    );
    if (!p) throw new AlertError(401, "Pairing was revoked.");
    const watches = (
      await this.db.query<{ data: unknown }>(
        "SELECT data FROM alert_watches WHERE profile_id=$1 AND active ORDER BY created_at DESC LIMIT 20",
        [profile],
      )
    ).map((r) => alertWatch.parse(r.data));
    const rows = await this.db.query<{
      data: AlertEvent;
      check_started_at: string | null;
    }>(
      "SELECT data,check_started_at FROM alert_events WHERE profile_id=$1 ORDER BY received_at DESC,id DESC LIMIT 51",
      [profile],
    );
    const events: AlertEvent[] = [];
    for (const row of rows.slice(0, 50)) {
      const e = alertEvent.parse(row.data),
        old = e.status;
      const w = watches.find(
        (w) => w.id === e.selected_watch_id && w.revision === p.revision,
      );
      if (e.status !== "dismissed") {
        if (Date.now() - Date.parse(e.received_at) > maxAge)
          e.status = "expired";
        else if (
          !e.watch_ids.some((id) =>
            watches.some((w) => w.id === id && w.revision === p.revision),
          ) ||
          (e.selected_watch_id && !w)
        )
          e.status = "invalidated";
        else if (e.status === "checking" && w) {
          const s = await this.courses.store.current(w.plan.term_code);
          const [record] = s
            ? await this.db.query<{ data: Section; course: Course }>(
                "SELECT s.data,c.data AS course FROM sections s JOIN courses c ON c.snapshot_id=s.snapshot_id AND c.key=s.course_key WHERE s.snapshot_id=$1 AND s.id=$2",
                [s.id, w.section_id],
              )
            : [];
          const section = record?.course.aliases.includes(w.course_code)
            ? record.data
            : undefined;
          if (
            section &&
            s &&
            Date.now() - Date.parse(section.checked_at) <= 300_000 &&
            Date.parse(section.checked_at) <= Date.now() + 60_000
          ) {
            e.checked_at = section.checked_at;
            e.snapshot_version = s.id;
            e.current_seats =
              section.total_seats === null || section.registered_seats === null
                ? null
                : section.total_seats - section.registered_seats;
            e.status = section.cancelled
              ? "cancelled"
              : e.current_seats === null
                ? "unavailable"
                : e.current_seats > 0
                  ? "open"
                  : "full";
            e.warning =
              "Public seat data is a snapshot, not enrollment eligibility or a reserved seat. Recheck after USC sign-in. Checkout can include other pending changes.";
          } else if (
            row.check_started_at &&
            Date.now() - Date.parse(row.check_started_at) > 120_000
          ) {
            e.status = "unavailable";
            e.warning =
              "Fresh data was not available within two minutes. The source may have failed or the worker may be offline. Your selection is unchanged.";
          }
        }
      }
      if (e.status !== old) {
        // A concurrent dismissal/recheck must win over this read's reconciliation.
        await this.db.query(
          "UPDATE alert_events SET data=$3::jsonb WHERE profile_id=$1 AND id=$2 AND data=$4::jsonb",
          [profile, e.id, JSON.stringify(e), JSON.stringify(row.data)],
        );
      }
      events.push(e);
    }
    const delivery = {
      queued: 0,
      processed: 0,
      failed: 0,
      rejected: 0,
      last_received_at: null as string | null,
    };
    for (const r of await this.db.query<{
      status: string;
      n: string;
      last_at: string;
    }>(
      "SELECT status,count(*) AS n,max(received_at) AS last_at FROM alert_mail_jobs WHERE profile_id=$1 GROUP BY status",
      [profile],
    )) {
      if (["queued", "running"].includes(r.status))
        delivery.queued += Number(r.n);
      else if (r.status === "done") delivery.processed += Number(r.n);
      else if (r.status === "failed") delivery.failed += Number(r.n);
      else if (r.status === "rejected") delivery.rejected += Number(r.n);
      if (!delivery.last_received_at || r.last_at > delivery.last_received_at)
        delivery.last_received_at = r.last_at;
    }
    return alertInbox.parse({
      watches,
      events,
      has_more: rows.length > 50,
      address: this.options.domain ? `${p.route}@${this.options.domain}` : null,
      pilot_enabled: !!this.options.pilot,
      delivery,
      meta: {
        checked_at: stamp(),
        completeness: "active_watches_and_latest_50_events",
        warnings: [
          "Forwarded email sender authenticity has not been verified. Confirm the original alert yourself.",
          "Opening events expire after seven days. Active watches remain until cancelled. No email bodies, account links or USC credentials are stored.",
          "Registration checkout automation is not enabled.",
        ],
      },
    });
  }
  async cleanup() {
    const cutoff = new Date(Date.now() - 7 * 86400_000).toISOString();
    await this.db.query("DELETE FROM alert_events WHERE received_at<$1", [
      cutoff,
    ]);
    await this.db.query("DELETE FROM alert_mail_jobs WHERE received_at<$1", [
      cutoff,
    ]);
    await this.db.query(
      "DELETE FROM alert_watches WHERE NOT active AND created_at<$1",
      [cutoff],
    );
  }
}
