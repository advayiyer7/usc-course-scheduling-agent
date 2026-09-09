# Opening-alert forwarding pilot

Implemented September 9, 2026. The user selected a forwarding pilot without a domain/provider account. This is local software; no inbox, forwarding rule, paid service or deployment has been configured. Registration checkout is not automated by this milestone.

## Student workflow and local test

1. Generate schedules in extension chat and choose **Edit in planner**. Open **Opening alerts**, select **Set up opening alerts**, then **Watch section** for the desired sections. Only your watched plan is copied into the local backend. Editing the plan invalidates its old watches; an offline UI synchronizes when it reconnects.
2. Independently enable Helper email notifications for those exact sections and semester through [USC Schedule Helper](https://usc.jonlu.ca). There is no extension-to-extension link or presumed partner API.
3. With live receiving configured, forward only `schedule-helper@jonlu.ca` messages to the opaque address displayed in the extension. A signed provider webhook queues a delivery; our worker retrieves its MIME-decoded HTML through the provider API. No student mailbox sign-in is needed. Links, account keys, raw HTML and attachments are not retained or sent to Codex.
4. The extension badge and **Reported openings** show matching events. Confirm the original message's source and saved semester before requesting a USC check. Helper's template does not render the semester. Signed provider delivery proves neither original sender authenticity nor enrollment authorization. We do not trust arbitrary From or Authentication-Results headers as authentication.
5. A check uses the existing shared USC refresh queue. It can use a recent cache under the existing five-minute freshness policy and displays the selected record's timestamp. Full, cancelled, unknown and timed-out checks remain separate. A two-minute timeout does not imply successful refresh. No seat is reserved.
6. **Review with Codex** prepares a schema-checked prompt in chat; the student sends it using their own companion. No LLM runs for webhook processing or polling. Open WebReg, complete USC sign-in, select the saved semester, refresh the complete planner and use its reviewed **Add to coursebin** action. Review every pending change and submit checkout in WebReg.

Extension 0.3.1 adds **Read pending checkout** in My planner: a [read-only view and plan comparison](checkout-review.md) on the active Checkout page. It does not submit registration.

For a synthetic local test, stop the existing API cleanly first: PGlite permits one process per data directory. Start:

```sh
ALERTS_PILOT_ENABLED=true npm run dev
```

Build with `npm run build`, reload the unpacked extension at `chrome://extensions`, and reopen the side panel. Select Fall 2026, load your chosen draft and save a watch. **Test alert** exercises the same HTML parser and matching service. Confirm its semester, wait for the USC check and select **Review with Codex**. The claimed synthetic seat count is replaced by source data: a full course remains full. Changing a selected section or constraint invalidates the old watch/actions. Test alert sends no email and submits no enrollment. Set `ALERTS_PILOT_ENABLED=false` to disable its server route and button.

The badge checks the local inbox once per minute while Chrome is available; an open panel checks every 15 seconds. Neither polls USC nor invokes Codex. A future hosted receiver could receive while the laptop sleeps; this local pilot needs the local backend and browser running to receive/display events. Delivery speed and successful registration are not guaranteed.

## Live receiving setup still required

Use the concrete [live setup checklist](mail-setup.md) and `npm run mail:check`. A Resend-managed receiving subdomain avoids a domain purchase. Runtime configuration rejects partial credentials and a receiver port that conflicts with the planner before starting the database.

Resend is the prepared adapter, not a purchased service. Follow its official [receiving setup](https://resend.com/docs/dashboard/receiving/introduction), [signature verification](https://resend.com/docs/webhooks/verify-webhooks-requests) and [received email API](https://resend.com/docs/api-reference/emails/retrieve-received-email). Configure only in the backend environment:

```dotenv
ALERTS_INBOUND_DOMAIN=alerts.example.com
RESEND_API_KEY=...
RESEND_WEBHOOK_SECRET=whsec_...
ALERTS_MAIL_PORT=3001
```

The isolated listener binds to `127.0.0.1:3001`, accepting only `POST /webhooks/resend`; it exposes no pairing, planner, MCP or browser actions. The ordinary API stays on loopback port 3000. No tunnel/public listener is created. Live delivery needs an approved HTTPS ingress to the isolated receiver and a receiving domain. Never expose the entire local development API. Hosted multi-student identity, deployment and self-service email onboarding remain later work.

Verify a consented actual alert and the provider's envelope-recipient fields before claiming mailbox compatibility. Gmail/Outlook forwarding-verification messages are deliberately not course alerts. The operator must complete this developer pilot's student-initiated verification through the receiving provider dashboard. Self-service forwarding-code handling is not implemented; managed USC accounts may restrict forwarding.

The adapter requests `html_format=cid`, bounds response bytes and fetches no images, attachments or email links. Svix **2.3.0** verifies raw bytes and returns void, so JSON is parsed afterward, unlike older return-value examples. Existing `linkedom` **0.18.13** moves from test-only to runtime for inert parsing. Versions are pinned. No Helper implementation was copied or rehosted.

## Contracts, limits and recovery

`POST /api/alerts/pair` creates a local pairing token. Private routes require `Authorization: Bearer <token>` and existing Host/Origin checks: `GET /inbox`; `POST /sync`, `/watches`, `/remove-watch`, `/confirm`, `/dismiss`, `/simulate`, `/revoke`, all relative to `/api/alerts`. Inputs and inbox outputs are schema-checked. `sync` carries semester, course/section sets and constraints; `confirm` binds event, watch and current plan with explicit source/semester confirmation. No alert can choose a tool name, URL or operation. Public MCP course tools do not expose private watches; the student explicitly sends a selected summary into chat.

Pairing uses a per-profile 256-bit token, stored in trusted extension storage (local storage for the local web preview); the DB stores only its SHA-256 hash. Routing addresses use separate opaque IDs and cannot authenticate API calls. Disconnect deletes the profile and related watches, events and jobs. No USC credentials/cookies enter this service. This is local pairing, not production OAuth.

Limits: 100 local profiles, 20 active sections/profile, 100 inbound jobs/day/profile, 500 retained events/profile, latest 50 returned. Events/jobs expire after seven days; active watches last until cancelled, and cancelled watch history expires after seven days. Alerts are actionable for 30 minutes, with at most three checks separated by a minute. General local request limits also apply.

Verified signed deliveries enter a durable DB queue before acknowledgment. Provider IDs deduplicate delivery; hashed Message-IDs deduplicate alerts when present. Expiring leases recover crashes. Fixed-endpoint retrieval has a 15-second timeout, byte bounds, at most five attempts and Retry-After handling. Unknown templates and unrecognized recipients are rejected without preserving message bodies. Source refreshes share the existing global budget, queue and program cooldown; never a catalog scrape per student. The student-confirmed refresh deliberately differs from the research's automatic-refresh proposal because sender authenticity has not yet been established.

## Evidence and remaining work

Fixtures cover signatures/tampering/stale signatures, parsing, profile isolation/revocation, plan invalidation, duplicate deliveries, concurrent refresh coalescing, source failures/staleness, provider retry guidance, crash recovery, body bounds and UI handoff. Observed: 100 duplicate deliveries produced one event without requesting a USC refresh; 20 confirmed alerts for one program produced one fixture upstream request. These are correctness observations, not hosted capacity measurements.

Live mail delivery/latency, forwarding confirmation and sender-authentication evidence remain untested. USC's current form posts to `/CheckoutResponse`, but checkout response semantics, partial failures and retry/reconciliation behavior remain unverified. The current companion cannot submit that endpoint. Do not describe this pilot as automatic registration.
