import { Router, type ErrorRequestHandler } from "express";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { alertPlan } from "../../../packages/contracts/src/alerts.js";
import {
  AlertError,
  type AlertService,
} from "../../../packages/domain/src/alerts.js";
import {
  parseHelperEmail,
  pilotEmail,
} from "../../../packages/domain/src/helper-email.js";

export function alertRoutes(alerts: AlertService) {
  const router = Router();
  router.post("/pair", async (_req, res) => res.json(await alerts.pair()));
  router.use(async (req, res, next) => {
    try {
      res.locals.profile = await alerts.authenticate(
        req.headers.authorization?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1],
      );
      next();
    } catch (e) {
      next(e);
    }
  });
  router.post("/sync", async (req, res) =>
    res.json(await alerts.sync(res.locals.profile, alertPlan.parse(req.body))),
  );
  router.get("/inbox", async (_req, res) =>
    res.json(await alerts.inbox(res.locals.profile)),
  );
  router.post("/watches", async (req, res) =>
    res.json(await alerts.watch(res.locals.profile, req.body)),
  );
  router.post("/remove-watch", async (req, res) => {
    await alerts.removeWatch(
      res.locals.profile,
      z.object({ id: z.string().uuid() }).strict().parse(req.body).id,
    );
    res.json({ ok: true });
  });
  router.post("/revoke", async (_req, res) => {
    await alerts.revoke(res.locals.profile);
    res.json({ ok: true });
  });
  router.post("/confirm", async (req, res) => {
    await alerts.confirm(res.locals.profile, req.body);
    res.json({ ok: true });
  });
  router.post("/dismiss", async (req, res) => {
    await alerts.dismiss(
      res.locals.profile,
      z.object({ id: z.string().uuid() }).strict().parse(req.body).id,
    );
    res.json({ ok: true });
  });
  router.post("/simulate", async (req, res) => {
    if (!alerts.options.pilot)
      throw new AlertError(
        404,
        "Synthetic alerts are disabled. Set ALERTS_PILOT_ENABLED=true locally to test.",
      );
    const { watch_id } = z
      .object({ watch_id: z.string().uuid() })
      .strict()
      .parse(req.body);
    const inbox = await alerts.inbox(res.locals.profile),
      watch = inbox.watches.find((w) => w.id === watch_id);
    if (!watch) throw new AlertError(409, "Save an active watch first.");
    const mail = pilotEmail(watch.course_code, watch.section_id),
      opening = parseHelperEmail(mail.subject, mail.html);
    if (!opening) throw new Error("Synthetic parser fixture failed");
    res.json({
      result: await alerts.accept(
        res.locals.profile,
        randomUUID(),
        opening,
        new Date().toISOString(),
        "pilot",
      ),
    });
  });
  router.use(alertErrors);
  return router;
}
export const alertErrors: ErrorRequestHandler = (error, _req, res, _next) => {
  const status =
    error instanceof AlertError
      ? error.status
      : error instanceof z.ZodError
        ? 400
        : error?.type === "entity.too.large"
          ? 413
          : 500;
  // Never echo provider bodies, headers, credentials or database diagnostics.
  res
    .status(status)
    .json({
      error: {
        message:
          error instanceof AlertError
            ? error.message
            : status === 400
              ? "Invalid alert request."
              : "Alert request could not be completed.",
      },
    });
};
