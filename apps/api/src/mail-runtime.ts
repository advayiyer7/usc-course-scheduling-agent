import { type AlertService } from "../../../packages/domain/src/alerts.js";
import { createMailApp, MailReceiver } from "./mail-receiver.js";

export function startMailPilot(alerts: AlertService) {
  const key = process.env.RESEND_API_KEY,
    secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!!key !== !!secret || (!!key && !alerts.options.domain))
    throw new Error(
      "Configure ALERTS_INBOUND_DOMAIN, RESEND_API_KEY and RESEND_WEBHOOK_SECRET together.",
    );
  const receiver = key && secret ? new MailReceiver(alerts, key) : undefined;
  const port = Number(process.env.ALERTS_MAIL_PORT ?? 3001);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("Invalid ALERTS_MAIL_PORT");
  // Even with keys, this pilot remains local. Never tunnel the main planner listener.
  const server =
    receiver && secret
      ? createMailApp(receiver, secret).listen(port, "127.0.0.1")
      : undefined;
  if (server) {
    server.requestTimeout = 15000;
    server.headersTimeout = 10000;
  }
  let busy: Promise<void> | undefined,
    lastCleanup = 0;
  const timer = setInterval(() => {
    if (busy) return;
    busy = (async () => {
      if (Date.now() - lastCleanup > 3600_000) {
        await alerts.cleanup();
        lastCleanup = Date.now();
      }
      await receiver?.runOne();
    })()
      .catch(() => {
        console.error(
          "Alert maintenance failed; will retry. No message content was logged.",
        );
      })
      .finally(() => {
        busy = undefined;
      });
  }, 2000);
  return async () => {
    clearInterval(timer);
    if (server)
      await new Promise<void>((resolve) => server.close(() => resolve()));
    await busy;
  };
}
