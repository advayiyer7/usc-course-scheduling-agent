export interface MailConfig {
  domain: string;
  apiKey: string;
  webhookSecret: string;
  port: number;
}

/** Validate before opening a database/listener. Errors never contain supplied values. */
export function mailConfig(
  env: NodeJS.ProcessEnv = process.env,
): MailConfig | undefined {
  const domain = env.ALERTS_INBOUND_DOMAIN;
  const apiKey = env.RESEND_API_KEY;
  const webhookSecret = env.RESEND_WEBHOOK_SECRET;
  if (!domain && !apiKey && !webhookSecret) return undefined;
  if (!domain || !apiKey || !webhookSecret)
    throw new Error(
      "Set ALERTS_INBOUND_DOMAIN, RESEND_API_KEY and RESEND_WEBHOOK_SECRET together in the backend environment.",
    );
  if (
    domain.length > 253 ||
    !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain)
  )
    throw new Error(
      "ALERTS_INBOUND_DOMAIN must be a lowercase receiving domain, without a username, URL or path.",
    );
  if (!/^re_[A-Za-z0-9_-]{10,200}$/.test(apiKey))
    throw new Error("RESEND_API_KEY does not have the expected key format.");
  if (!/^whsec_[A-Za-z0-9+/]{20,200}={0,2}$/.test(webhookSecret))
    throw new Error(
      "RESEND_WEBHOOK_SECRET does not have the expected signing-secret format.",
    );
  const port = Number(env.ALERTS_MAIL_PORT ?? 3001);
  if (
    !Number.isInteger(port) ||
    port < 1024 ||
    port > 65535 ||
    port === Number(env.PORT ?? 3000)
  )
    throw new Error(
      "ALERTS_MAIL_PORT must be an unprivileged port different from the planner API port.",
    );
  return { domain, apiKey, webhookSecret, port };
}

/** Local configuration check only: no emails, secrets or provider requests. */
export function mailReadiness(env: NodeJS.ProcessEnv = process.env) {
  try {
    const config = mailConfig(env);
    if (!config)
      return {
        ready: false,
        message:
          "Live receiving is not configured. Create a Resend account, get its Receiving address domain, and configure the three backend variables. See docs/mail-setup.md.",
      };
    return {
      ready: true,
      message: `Local configuration is valid. The isolated receiver will use 127.0.0.1:${config.port}/webhooks/resend. Provider credentials, HTTPS ingress and actual forwarding still need a live delivery check.`,
    };
  } catch (error) {
    return {
      ready: false,
      message:
        error instanceof Error ? error.message : "Invalid mail configuration.",
    };
  }
}
