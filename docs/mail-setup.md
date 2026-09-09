# Live email setup for the local pilot

Status, September 9, 2026: receiver and queue are implemented; live delivery is awaiting a provider account and approved HTTPS ingress. No domain purchase is required. Resend's [official receiving guide](https://resend.com/docs/dashboard/receiving/introduction) supports the account's managed `<id>.resend.app` subdomain. This project has not created a provider account, exposed a listener or sent an email.

## Account setup needed from the developer

1. Sign in to your own Resend account. In **Emails → Receiving**, use the three-dot menu's **Receiving address** to find your receiving domain. Share only that domain with the implementation agent; keep passwords, API keys and signing secrets out of chat.
2. Create a backend API key that permits retrieving received emails. Place it in `RESEND_API_KEY` in the repository's ignored `.env` or your local secret environment. Do not place it in extension configuration or a `VITE_` variable.
3. Set `ALERTS_INBOUND_DOMAIN` to the receiving domain, with no username or URL. A custom domain can be used later; do not change the MX records of your existing student/personal mailbox.
4. The prepared public route is **POST `/webhooks/resend`**, pointing only at **127.0.0.1:3001**. Choose and approve an HTTPS ingress before enabling it. This step can expose a local service externally and has not been performed. Do not tunnel port 3000: it contains the local planner and pairing endpoints.
5. Create a Resend webhook for **email.received** at that approved HTTPS URL. Put its signing secret in `RESEND_WEBHOOK_SECRET` locally. Follow [Resend's verification instructions](https://resend.com/docs/webhooks/verify-webhooks-requests).

Once all three variables are present, run `npm run mail:check`. It checks configuration only: it does not read your inbox, contact Resend, print secrets, start listeners or send mail. An exit code of 1 means setup is missing or invalid. A passing check does not prove API permissions, webhook reachability or delivery. The runtime uses the same validation before opening its database and will not advertise a forwarding address with only partial mail configuration.

Restart `npm run dev` after configuring it. Stop any previous API first because the embedded database permits only one owning process. Open the extension's **Opening alerts** view to obtain the opaque per-profile address. Each address belongs to that local pairing; keep the local database and pairing while testing.

## Consented delivery test

The next live test requires the developer's chosen mailbox and permission to configure forwarding/send a test email. None is implied by checking local configuration. Complete any mailbox forwarding confirmation through the Resend dashboard yourself. Verification messages are not course alerts and the application deliberately does not follow their links. Some managed USC accounts may restrict forwarding.

Forward a consented USC Schedule Helper notification to the exact address shown in the extension. In Resend, verify successful webhook delivery. Then verify the app shows a single matching event and a processed delivery count, without preserving message bodies or Helper account links. Duplicate delivery must not duplicate the event. Check the real delivery's envelope-recipient behavior before claiming Gmail or Outlook compatibility.

Confirm its source and semester in the extension, request the USC availability check, and use **Review with Codex**. No mailbox connection is granted to Codex. Full, cancelled, expired or uncertain openings remain blocked from being treated as open. Checkout has a separate browser review and authorization boundary; an email does not authorize enrollment.

This local receiver stops when the computer/backend is unavailable. Hosted receiving, production student identity and self-service forwarding confirmation are separate unfinished deployment work.
