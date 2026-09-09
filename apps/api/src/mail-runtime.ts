import { type AlertService } from "../../../packages/domain/src/alerts.js";
import { createMailApp, MailReceiver } from "./mail-receiver.js";
import { mailConfig } from "./mail-config.js";

export function startMailPilot(alerts: AlertService, config = mailConfig()) {
  const receiver = config ? new MailReceiver(alerts, config.apiKey) : undefined;
  // Even with keys, this pilot remains local. Never tunnel the main planner listener.
  const server =
    receiver && config
      ? createMailApp(receiver, config.webhookSecret).listen(
          config.port,
          "127.0.0.1",
        )
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
