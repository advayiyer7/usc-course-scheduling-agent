# Checkout review milestone

Implemented September 9, 2026 in extension 0.3.1. The user authorized the next email/registration stage and requested a pause when feedback is needed. This milestone implements the read-only checkout review. **A registration executor, submit button, enrollment-result parser and response-loss reconciliation are not implemented yet.**

## Test the review

1. Build the extension (`npm run build`), reload its unpacked installation at `chrome://extensions`, then reload the WebReg tab so the new content script is present.
2. Open a validated draft in **My planner**. Refresh the exact selection if the public data is stale. Add-to-coursebin remains its own existing reviewed action.
3. Sign in through USC, select Fall 2026, and open WebReg's **Checkout** page. Keep that page as the active tab with the extension side panel open. If redirected to Terms, select Fall 2026 again and reopen Checkout; this does not necessarily mean sign-in expired.
4. In My planner, select **Read pending checkout**. It lists every recognized registration row with course, section, session, component type, units and grade option. It compares the list with all coursebin status flags and the chosen plan, showing extra/missing sections, possible pending drops, and existing registrations omitted from validation. A review expires visually after 60 seconds; editing the plan invalidates it and rejects late responses.
5. This review is informational. The extension has no checkout submission control; registration is still submitted directly in WebReg by the student.

Opening alerts still prepare a Codex prompt. Codex can explain course facts and guide the student to this browser review, but does not receive the authenticated page, security fields or unrelated student records. No email event, native message, REST or MCP call can request checkout inspection or submission.

## Browser contract and source boundaries

`usc-checkout-review-v1` accepts only a strict `review` request with the current proposal and context from the extension's actual `index.html` sender. The top-frame content command accepts only `inspect` and a term. There is no arbitrary endpoint, selector, script or submit command. The background shares its operation lock with coursebin preparation/execution; starting a checkout read also invalidates an old coursebin confirmation ticket. The content reply and UI review are schema-checked. The background times out content inspection after 15 seconds and releases its lock even on failures.

Only the exact authenticated `/Checkout` URL is accepted. The content script reads the observed Registration Confirmation structure, checks the original `/CheckoutResponse` POST form's control names/types and reads its registration rows outside that form. It never reads `activeTerm` or anti-forgery values, cookies, account identity or instructor/meeting/location values. It makes one fixed same-origin, no-cache `GET /CourseBin`, rejects redirects, verifies the semester and re-reads the displayed checkout list to detect changes during that fetch. Existing coursebin mutation routes and guards are unchanged.

Unrecognized headings, mixed operation layouts, unknown units, missing grade fields, duplicate/out-of-scope rows and changed form structure are rejected. Known extra pending sections remain visible as blockers rather than being silently filtered out. The parser recognizes one observed registration-only layout; it cannot prove there are no unobserved server-side operations. Units and grade options are displayed verbatim within bounded fields, not independently certified against enrollment rules. These limitations are precisely why this result is `mode: read_only`, with no authorization ticket.

## Evidence and next inputs

- The compiled production parser successfully inspected the authenticated Fall 2026 Checkout page on September 9: registration layout recognized, section fields parsed, units and grade option present. Only structural pass/fail/count metadata left the page; no student records or token values were saved in fixtures.
- The built content adapter was then exercised in the same diagnostic page with an isolated test message handler: its exact `inspect` command returned `ok: true`, recognized Fall 2026 registrations and parsed the authenticated CourseBin status response. This is a live read test of the compiled adapter, not a claim that the ordinary Chrome extension was reloaded or that a registration executor exists.
- A direct checkout read initially failed. Fresh browser navigation reached authenticated `/Terms`; selecting the observed Fall 2026 link restored `/Checkout`. Sign-in was still active. Session expiry was not established and no expiry/renewal interval is claimed.
- Handwritten fictional fixtures cover mixed/unknown layouts, hidden/extra controls, wrong semester, missing login, duplicate/extra/missing sections, pending drops, changed grade choice, redirect failure, unauthorized senders, lock contention, inspection timeout, UI field rendering and stale-plan replies. A failed or timed-out read never clicks Submit.
- `npm run check`: **338 tests across 31 files**, TypeScript and both extension bundles passed. The 500-pixel local web preview showed the read-only review entry point without horizontal overflow and correctly disabled browser-only actions outside the extension.

Next input: the student must identify exact sections they actually intend to enroll in for a pilot case; an old pending course used during development is not an enrollment instruction. Build a concrete complete-transaction confirmation and single-use executor before requesting approval of its final live submission. Registration-only scope must reject unknown or mixed pending operations. Journal before dispatch, serialize against additions, retain USC's original browser form/security state, and reconcile authoritative enrollment state without retrying uncertain mutations. A generic HTTP 200 cannot establish successful enrollment. Live email activation separately needs the [Resend setup inputs](mail-setup.md).
