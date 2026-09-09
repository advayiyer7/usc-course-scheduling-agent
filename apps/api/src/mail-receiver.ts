import express from "express";
import { Webhook } from "svix";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import {
  AlertError,
  type AlertService,
} from "../../../packages/domain/src/alerts.js";
import { parseHelperEmail } from "../../../packages/domain/src/helper-email.js";
import { alertErrors } from "./alerts.js";

const emailEvent = z.object({
  type: z.literal("email.received"),
  created_at: z.string().datetime(),
  data: z.object({
    email_id: z.string().uuid(),
    to: z.array(z.string().max(254)).min(1).max(20),
  }),
});
const receivedEmail = z.object({
  id: z.string().uuid(),
  message_id: z.string().min(1).max(512).optional(),
  subject: z.string().max(500),
  html: z
    .string()
    .max(256 * 1024)
    .nullable(),
});
export class MailReceiver {
  constructor(
    public alerts: AlertService,
    private apiKey: string,
    private fetcher: typeof fetch = fetch,
  ) {}
  async enqueue(raw: unknown) {
    const event = emailEvent.parse(raw),
      domain = this.alerts.options.domain;
    if (!domain) throw new AlertError(503, "Inbound domain is not configured.");
    const routes = event.data.to
      .filter((to) => to.endsWith(`@${domain}`))
      .map((to) => to.slice(0, -(domain.length + 1)))
      .filter((route) => /^[a-f0-9]{48}$/.test(route));
    if (routes.length !== 1) return; // Reject ambiguous fan-out and unknown recipients without disclosing profiles.
    const age = Date.now() - Date.parse(event.created_at);
    if (age > 7 * 86400_000 || age < -60_000) return;
    await this.alerts.db.transaction(async (tx) => {
      const [profile] = await tx.query<{ id: string }>(
        "SELECT id FROM alert_profiles WHERE route=$1 FOR UPDATE",
        [routes[0]],
      );
      if (!profile) return;
      const [count] = await tx.query<{ n: string }>(
        "SELECT count(*) AS n FROM alert_mail_jobs WHERE profile_id=$1 AND received_at>$2",
        [profile.id, new Date(Date.now() - 86400_000).toISOString()],
      );
      const [duplicate] = await tx.query(
        "SELECT email_id FROM alert_mail_jobs WHERE email_id=$1",
        [event.data.email_id],
      );
      if (duplicate) return;
      if (Number(count?.n) >= 100)
        throw new AlertError(429, "Daily inbound limit reached.");
      await tx.query(
        "INSERT INTO alert_mail_jobs(email_id,profile_id,received_at) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING",
        [event.data.email_id, profile.id, event.created_at],
      );
    });
  }
  async runOne() {
    const owner = randomUUID(),
      now = Date.now();
    await this.alerts.db.query(
      "UPDATE alert_mail_jobs SET status='failed',result='retry_exhausted',owner=NULL WHERE status='running' AND lease_until<$1 AND attempts>=5",
      [now],
    );
    const [job] = await this.alerts.db.query<{
      email_id: string;
      profile_id: string;
      received_at: string;
      attempts: number;
    }>(
      `UPDATE alert_mail_jobs SET status='running',owner=$1,lease_until=$2,attempts=attempts+1 WHERE email_id=(SELECT email_id FROM alert_mail_jobs WHERE (status='queued' AND next_at<=$3 OR status='running' AND lease_until<$3) AND attempts<5 ORDER BY received_at LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING email_id,profile_id,received_at,attempts`,
      [owner, now + 60_000, now],
    );
    if (!job) return false;
    try {
      const response = await this.fetcher(
        `https://api.resend.com/emails/receiving/${job.email_id}?html_format=cid`,
        {
          headers: { Authorization: `Bearer ${this.apiKey}` },
          redirect: "error",
          signal: AbortSignal.timeout(15000),
        },
      );
      if (!response.ok) {
        await response.body?.cancel();
        const retry = response.status === 429 || response.status >= 500;
        if (!retry) {
          await this.finish(job.email_id, owner, "failed", "provider_rejected");
          return true;
        }
        const header = response.headers.get("retry-after");
        const delay =
          header && /^\d+$/.test(header)
            ? Number(header) * 1000
            : header
              ? Date.parse(header) - Date.now()
              : NaN;
        await this.retry(
          job,
          owner,
          Number.isFinite(delay) ? Math.max(1000, delay) : undefined,
        );
        return true;
      }
      const reader = response.body?.getReader();
      if (!reader) throw new Error("Missing body");
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > 512 * 1024) {
            await reader.cancel();
            await this.finish(
              job.email_id,
              owner,
              "rejected",
              "body_too_large",
            );
            return true;
          }
          chunks.push(value);
        }
      } finally {
        reader.releaseLock();
      }
      const email = receivedEmail.safeParse(
        JSON.parse(Buffer.concat(chunks).toString("utf8")),
      );
      if (!email.success || email.data.id !== job.email_id) {
        await this.finish(job.email_id, owner, "rejected", "unknown_template");
        return true;
      }
      const data = parseHelperEmail(email.data.subject, email.data.html);
      if (!data) {
        await this.finish(job.email_id, owner, "rejected", "unknown_template");
        return true;
      }
      const result = await this.alerts.accept(
        job.profile_id,
        email.data.message_id
          ? `message:${email.data.message_id}`
          : `provider:${job.email_id}`,
        data,
        job.received_at,
        "forwarded_email",
      );
      await this.finish(job.email_id, owner, "done", result);
    } catch {
      await this.retry(job, owner);
    }
    return true;
  }
  private async finish(
    id: string,
    owner: string,
    status: string,
    result: string,
  ) {
    await this.alerts.db.query(
      "UPDATE alert_mail_jobs SET status=$3,result=$4,owner=NULL,lease_until=0 WHERE email_id=$1 AND owner=$2",
      [id, owner, status, result],
    );
  }
  private async retry(
    job: { email_id: string; attempts: number },
    owner: string,
    guidance?: number,
  ) {
    if (job.attempts >= 5)
      return this.finish(job.email_id, owner, "failed", "retry_exhausted");
    await this.alerts.db.query(
      "UPDATE alert_mail_jobs SET status='queued',result='retry_pending',owner=NULL,lease_until=0,next_at=$3 WHERE email_id=$1 AND owner=$2",
      [
        job.email_id,
        owner,
        Date.now() + Math.max(guidance ?? 0, 1000 * 2 ** job.attempts),
      ],
    );
  }
}

/** Isolated ingress: no planner, pairing, MCP, USC mutations or static files on this listener. */
export function createMailApp(receiver: MailReceiver, signingSecret: string) {
  const app = express(),
    verifier = new Webhook(signingSecret);
  app.disable("x-powered-by");
  app.set("trust proxy", false);
  let count = 0,
    reset = Date.now() + 60_000;
  app.use((_req, res, next) => {
    if (Date.now() >= reset) {
      count = 0;
      reset = Date.now() + 60_000;
    }
    res.setHeader("Cache-Control", "no-store");
    if (++count > 600) {
      res.setHeader("Retry-After", "60");
      return void res.status(429).end();
    }
    next();
  });
  app.post(
    "/webhooks/resend",
    express.raw({ type: "application/json", limit: "32kb" }),
    async (req, res) => {
      let event: unknown;
      try {
        if (!Buffer.isBuffer(req.body)) throw new Error();
        verifier.verify(req.body.toString("utf8"), {
          "svix-id": req.get("svix-id") ?? "",
          "svix-timestamp": req.get("svix-timestamp") ?? "",
          "svix-signature": req.get("svix-signature") ?? "",
        });
        // Svix 2.x verifies without parsing and returns void.
        event = JSON.parse(req.body.toString("utf8"));
      } catch {
        throw new AlertError(401, "Invalid webhook signature.");
      }
      if (
        z.object({ type: z.string() }).safeParse(event).data?.type !==
        "email.received"
      )
        return void res.status(204).end();
      await receiver.enqueue(event);
      res.status(202).json({ accepted: true });
    },
  );
  app.use(alertErrors);
  return app;
}
