import { beforeAll, afterAll, beforeEach, it, expect, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { Webhook } from "svix";
import type { Server } from "node:http";
import { testStore } from "./database.js";
import { programs, course, response, sourceSection } from "./fixtures.js";
import { CourseService } from "../packages/domain/src/service.js";
import { AlertService } from "../packages/domain/src/alerts.js";
import { alertPlan, openingPrompt } from "../packages/contracts/src/alerts.js";
import { createApp } from "../apps/api/src/http.js";
import { MailReceiver, createMailApp } from "../apps/api/src/mail-receiver.js";
import type { Store } from "../packages/db/src/index.js";
import { UscClient } from "../packages/source-usc/src/client.js";
import { runOneJob } from "../apps/worker/src/ingest.js";

let store: Store,
  alerts: AlertService,
  token: string,
  profile: string,
  watch: string;
const plan = alertPlan.parse({
  term_code: 20263,
  course_codes: ["TEST100"],
  section_ids: ["10001"],
  constraints: {},
});
const opening = {
  course_code: "TEST100",
  section_id: "10001",
  reported_seats: 1,
};
const servers: Server[] = [];
async function serve(app: ReturnType<typeof createApp>) {
  const server = app.listen(0, "127.0.0.1");
  servers.push(server);
  await new Promise<void>((r) => server.once("listening", r));
  const a = server.address();
  return `http://127.0.0.1:${typeof a === "object" && a ? a.port : 0}`;
}
async function event() {
  await alerts.accept(
    profile,
    randomUUID(),
    opening,
    new Date().toISOString(),
    "pilot",
  );
  return (await alerts.inbox(profile)).events[0]!;
}
beforeAll(async () => {
  store = await testStore();
  await store.publish(20263, programs, [
    { ...response(), checked_at: new Date().toISOString() },
  ]);
});
beforeEach(async () => {
  alerts = new AlertService(new CourseService(store), {
    domain: "alerts.example.com",
    pilot: true,
  });
  token = (await alerts.pair()).token;
  profile = await alerts.authenticate(token);
  await alerts.sync(profile, plan);
  watch = (
    await alerts.watch(profile, {
      plan,
      course_code: "TEST100",
      section_id: "10001",
    })
  ).id;
});
afterAll(async () => {
  for (const s of servers) await new Promise<void>((r) => s.close(() => r()));
  await store.db.close();
});
it("stores only hashed pairing credentials, isolates profiles, and revokes all associated data", async () => {
  const rows = await store.db.query(
    "SELECT * FROM alert_profiles WHERE id=$1",
    [profile],
  );
  expect(JSON.stringify(rows)).not.toContain(token);
  await expect(alerts.authenticate("invalid")).rejects.toMatchObject({
    status: 401,
  });
  const e = await event(),
    other = await alerts.authenticate((await alerts.pair()).token);
  await expect(
    alerts.confirm(other, {
      plan,
      event_id: e.id,
      watch_id: watch,
      confirm_term_and_source: true,
    }),
  ).rejects.toMatchObject({ status: 409 });
  await alerts.revoke(profile);
  await expect(alerts.authenticate(token)).rejects.toMatchObject({
    status: 401,
  });
  expect(
    await store.db.query("SELECT id FROM alert_events WHERE profile_id=$1", [
      profile,
    ]),
  ).toHaveLength(0);
});
it("deduplicates 100 concurrent deliveries and performs zero upstream refresh requests until student confirmation", async () => {
  const spy = vi.spyOn(alerts.courses, "call");
  const outcomes = await Promise.all(
    Array.from({ length: 100 }, () =>
      alerts.accept(
        profile,
        "same-message",
        opening,
        new Date().toISOString(),
        "forwarded_email",
      ),
    ),
  );
  expect(outcomes.filter((x) => x === "accepted")).toHaveLength(1);
  expect(outcomes.filter((x) => x === "duplicate")).toHaveLength(99);
  expect(spy).not.toHaveBeenCalled();
  expect((await alerts.inbox(profile)).events).toHaveLength(1);
});
it("coalesces 20 confirmed openings for one program into one observed fixture upstream request", async () => {
  await store.db.query("DELETE FROM jobs");
  await store.publish(20263, programs, [response()]);
  await Promise.all(
    Array.from({ length: 20 }, () =>
      alerts.accept(
        profile,
        randomUUID(),
        opening,
        new Date().toISOString(),
        "pilot",
      ),
    ),
  );
  const events = (await alerts.inbox(profile)).events;
  await Promise.all(
    events.map((e) =>
      alerts.confirm(profile, {
        plan,
        event_id: e.id,
        watch_id: watch,
        confirm_term_and_source: true,
      }),
    ),
  );
  expect(
    await store.db.query("SELECT id FROM jobs WHERE status='queued'"),
  ).toHaveLength(1);
  const source = new UscClient(
    store,
    async () => Response.json(response().payload),
    1,
    1000,
    1,
  );
  await runOneJob(store, source);
  await runOneJob(store, source);
  expect(source.requestCount).toBe(1);
  expect(
    (await alerts.inbox(profile)).events.every((e) => e.status === "open"),
  ).toBe(true);
});
it("matches only exact active section/course watches; rejects alerts older than the watch", async () => {
  expect(
    await alerts.accept(
      profile,
      "wrong",
      { ...opening, section_id: "99999" },
      new Date().toISOString(),
      "pilot",
    ),
  ).toBe("unmatched");
  expect(
    await alerts.accept(
      profile,
      "older",
      opening,
      new Date(Date.now() - 3600_000).toISOString(),
      "pilot",
    ),
  ).toBe("unmatched");
  await expect(
    alerts.watch(profile, {
      plan,
      course_code: "MISS999",
      section_id: "10001",
    }),
  ).rejects.toMatchObject({ status: 400 });
});
it("serializes duplicate watches and cancels watches/rechecks when a plan changes", async () => {
  const duplicate = await Promise.all(
    Array.from({ length: 20 }, () =>
      alerts.watch(profile, {
        plan,
        course_code: "TEST100",
        section_id: "10001",
      }),
    ),
  );
  expect(new Set(duplicate.map((w) => w.id))).toEqual(new Set([watch]));
  const e = await event();
  const next = alertPlan.parse({ ...plan, constraints: { earliest: "13:00" } });
  await alerts.sync(profile, next);
  await expect(
    alerts.confirm(profile, {
      plan,
      event_id: e.id,
      watch_id: watch,
      confirm_term_and_source: true,
    }),
  ).rejects.toMatchObject({ status: 409 });
  const inbox = await alerts.inbox(profile);
  expect(inbox.watches).toHaveLength(0);
  expect(inbox.events[0]?.status).toBe("invalidated");
});
it("rechecks the public source after explicit term/source confirmation and bounds retries", async () => {
  const e = await event();
  await alerts.confirm(profile, {
    plan,
    event_id: e.id,
    watch_id: watch,
    confirm_term_and_source: true,
  });
  const inbox = await alerts.inbox(profile),
    checked = inbox.events[0]!;
  expect(checked.status).toBe("open");
  expect(checked.current_seats).toBe(10);
  expect(checked.snapshot_version).toBeTruthy();
  expect(openingPrompt(checked, inbox.watches[0]!)).toContain(
    '"current_seats":10',
  );
  expect(openingPrompt(checked, inbox.watches[0]!)).not.toContain(
    "alerts.example.com",
  );
  await expect(
    alerts.confirm(profile, {
      plan,
      event_id: e.id,
      watch_id: watch,
      confirm_term_and_source: true,
    }),
  ).rejects.toMatchObject({ status: 409 });
});
it("keeps eligibility unknown when the source says full, cancelled or has missing seat counts", async () => {
  for (const [status, fields] of [
    ["full", { registeredSeats: 30 }],
    ["cancelled", { isCancelled: true }],
    ["unavailable", { totalSeats: null }],
  ] as const) {
    const e = await event();
    await alerts.confirm(profile, {
      plan,
      event_id: e.id,
      watch_id: watch,
      confirm_term_and_source: true,
    });
    const fixture = response();
    (fixture.payload as { courses: unknown[] }).courses = [
      { ...course(), sections: [{ ...sourceSection(), ...fields }] },
    ];
    await store.publish(20263, programs, [
      { ...fixture, checked_at: new Date().toISOString() },
    ]);
    expect(
      (await alerts.inbox(profile)).events.find((x) => x.id === e.id)?.status,
    ).toBe(status);
  }
  await store.publish(20263, programs, [
    { ...response(), checked_at: new Date().toISOString() },
  ]);
});
it("times out stale/failed refreshes without treating queuing as fresh evidence", async () => {
  const e = await event();
  await alerts.confirm(profile, {
    plan,
    event_id: e.id,
    watch_id: watch,
    confirm_term_and_source: true,
  });
  await store.publish(20263, programs, [response()]);
  await store.db.query(
    "UPDATE alert_events SET check_started_at=$2 WHERE id=$1",
    [e.id, new Date(Date.now() - 121_000).toISOString()],
  );
  expect((await alerts.inbox(profile)).events[0]?.status).toBe("unavailable");
  await store.publish(20263, programs, [
    { ...response(), checked_at: new Date().toISOString() },
  ]);
});
it("does not let a late reconciliation overwrite concurrent dismissal or a changed plan", async () => {
  const e = await event();
  await alerts.confirm(profile, {
    plan,
    event_id: e.id,
    watch_id: watch,
    confirm_term_and_source: true,
  });
  await Promise.all([alerts.inbox(profile), alerts.dismiss(profile, e.id)]);
  expect((await alerts.inbox(profile)).events[0]?.status).toBe("dismissed");
  await expect(
    alerts.confirm(profile, {
      plan,
      event_id: e.id,
      watch_id: watch,
      confirm_term_and_source: true,
    }),
  ).rejects.toMatchObject({ status: 409 });
});
it("authenticates every private HTTP route, rejects foreign origins and gates synthetic alerts", async () => {
  const base = await serve(createApp(alerts.courses, { alerts }));
  expect((await fetch(base + "/api/alerts/inbox")).status).toBe(401);
  expect(
    (
      await fetch(base + "/api/alerts/inbox", {
        headers: { Authorization: token },
      })
    ).status,
  ).toBe(401);
  expect(
    (
      await fetch(base + "/api/alerts/inbox", {
        headers: { Authorization: `Bearer ${token}` },
      })
    ).status,
  ).toBe(200);
  expect(
    (
      await fetch(base + "/api/alerts/pair", {
        method: "POST",
        headers: { Origin: "https://evil.example" },
      })
    ).status,
  ).toBe(403);
  alerts.options.pilot = false;
  expect(
    (
      await fetch(base + "/api/alerts/simulate", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ watch_id: watch }),
      })
    ).status,
  ).toBe(404);
});
it("verifies raw Svix signatures and time, durably deduplicates before provider fetch, and exposes no pairing on ingress", async () => {
  const secret =
      "whsec_" +
      Buffer.from("synthetic-webhook-secret-32-bytes!").toString("base64"),
    signer = new Webhook(secret);
  const fetched = vi.fn(async () => new Response("{}"));
  const receiver = new MailReceiver(alerts, "synthetic-key", fetched);
  const base = await serve(createMailApp(receiver, secret));
  const id = randomUUID(),
    timestamp = new Date(),
    address = (await alerts.inbox(profile)).address!;
  const body = JSON.stringify({
    type: "email.received",
    created_at: timestamp.toISOString(),
    data: { email_id: randomUUID(), to: [address] },
  });
  const headers = {
    "Content-Type": "application/json",
    "svix-id": id,
    "svix-timestamp": String(Math.floor(timestamp.getTime() / 1000)),
    "svix-signature": signer.sign(id, timestamp, body),
  };
  expect(
    (await fetch(base + "/webhooks/resend", { method: "POST", headers, body }))
      .status,
  ).toBe(202);
  expect(
    (await fetch(base + "/webhooks/resend", { method: "POST", headers, body }))
      .status,
  ).toBe(202);
  expect(
    await store.db.query(
      "SELECT email_id FROM alert_mail_jobs WHERE profile_id=$1",
      [profile],
    ),
  ).toHaveLength(1);
  expect(fetched).not.toHaveBeenCalled();
  expect(
    (
      await fetch(base + "/webhooks/resend", {
        method: "POST",
        headers,
        body: body + " ",
      })
    ).status,
  ).toBe(401);
  const old = new Date(Date.now() - 600_000);
  expect(
    (
      await fetch(base + "/webhooks/resend", {
        method: "POST",
        headers: {
          ...headers,
          "svix-timestamp": String(Math.floor(old.getTime() / 1000)),
          "svix-signature": signer.sign(id, old, body),
        },
        body,
      })
    ).status,
  ).toBe(401);
  expect(
    (await fetch(base + "/api/alerts/pair", { method: "POST" })).status,
  ).toBe(404);
});
it("bounds MIME retrieval, honors retry guidance, and recovers crashed leases without storing raw mail", async () => {
  // Isolate the queue from the preceding ingress test.
  await store.db.query("DELETE FROM alert_mail_jobs");
  const address = (await alerts.inbox(profile)).address!,
    id = randomUUID();
  const fetched = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      new Response("busy", { status: 429, headers: { "Retry-After": "120" } }),
    )
    .mockResolvedValue(
      new Response(
        JSON.stringify({
          id,
          subject: "1 spot open for TEST100!",
          html: '<p>1 spot available in TEST100</p><p>Section 10001</p><a href="https://usc.jonlu.ca/?key=SECRET">dashboard</a>',
        }),
      ),
    );
  const receiver = new MailReceiver(alerts, "synthetic-key", fetched);
  await receiver.enqueue({
    type: "email.received",
    created_at: new Date().toISOString(),
    data: { email_id: id, to: [address] },
  });
  await receiver.runOne();
  const [retry] = await store.db.query<{ next_at: string }>(
    "SELECT next_at FROM alert_mail_jobs WHERE email_id=$1",
    [id],
  );
  expect(Number(retry?.next_at) - Date.now()).toBeGreaterThan(119_000);
  await store.db.query(
    "UPDATE alert_mail_jobs SET status='running',owner='crashed',lease_until=0 WHERE email_id=$1",
    [id],
  );
  await Promise.all([receiver.runOne(), receiver.runOne()]);
  expect(fetched).toHaveBeenCalledTimes(2);
  expect(fetched.mock.calls[1]?.[0]).toBe(
    `https://api.resend.com/emails/receiving/${id}?html_format=cid`,
  );
  expect((await alerts.inbox(profile)).events).toHaveLength(1);
  expect(
    JSON.stringify(await store.db.query("SELECT * FROM alert_mail_jobs")),
  ).not.toMatch(/SECRET|synthetic-key|<p>|dashboard/);
});
it("rejects oversized provider bodies and terminates exhausted leases without fetching again", async () => {
  await store.db.query("DELETE FROM alert_mail_jobs");
  const address = (await alerts.inbox(profile)).address!,
    id = randomUUID();
  const fetched = vi.fn(async () => new Response("x".repeat(512 * 1024 + 1)));
  const receiver = new MailReceiver(alerts, "synthetic-key", fetched);
  await receiver.enqueue({
    type: "email.received",
    created_at: new Date().toISOString(),
    data: { email_id: id, to: [address] },
  });
  await receiver.runOne();
  expect(
    (
      await store.db.query<{ result: string }>(
        "SELECT result FROM alert_mail_jobs WHERE email_id=$1",
        [id],
      )
    )[0]?.result,
  ).toBe("body_too_large");
  await store.db.query(
    "UPDATE alert_mail_jobs SET status='running',attempts=5,lease_until=0 WHERE email_id=$1",
    [id],
  );
  await receiver.runOne();
  expect(fetched).toHaveBeenCalledTimes(1);
  expect(
    (
      await store.db.query<{ result: string }>(
        "SELECT result FROM alert_mail_jobs WHERE email_id=$1",
        [id],
      )
    )[0]?.result,
  ).toBe("retry_exhausted");
});
