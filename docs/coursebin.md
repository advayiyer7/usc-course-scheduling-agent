# Student-triggered Add to coursebin

This branch implements draft-specific confirmation and a bounded WebReg adapter. **Live addition is not yet verified or release-ready:** the current validator cannot verify required component/linking rules, so current proposals remain blocked. Empty-coursebin markup is also unverified and fails closed. No live add or registration action was performed during development.

## Student flow

1. Open WebReg in Chrome, sign in yourself, and select the intended semester.
2. Open the extension side panel, connect your companion, and describe desired courses in chat.
3. Click **Add to coursebin** on one draft. There is no prerequisite to manually select courses or load the planner.
4. Review that draft's semester, exact course/section IDs, meeting details, already-present sections, and blocking/advisory findings. A review expires after 90 seconds. Reviewing another draft invalidates the older review.
5. When all blocking findings are resolved, click **Confirm add to [semester] coursebin**. This consumes a single-use ticket, revalidates the pinned proposal, and verifies the same WebReg document and coursebin before dispatch.
6. Follow section results in chat: **added**, **already present**, **failed**, or **unconfirmed**. Review myCourseBin and complete checkout yourself. **Ask companion for alternatives** sends only the selected sections' structured results; any replacement requires its own draft confirmation.

The adapter navigates the selected WebReg tab through exact-section lookups. Leave that tab and its semester unchanged while a run is active. **Stop after current section** prevents further sections; an already-dispatched action is checked before reporting its result.

## Browser boundary

- Existing loopback permission plus only `https://webreg.usc.edu/*`. Static content script runs in the top frame on the observed coursebin, course, department, search and calendar paths. No `cookies`, `webRequest`, `scripting`, `<all_urls>` or broader USC-origin permission.
- Only the actual extension side panel can prepare/execute/cancel a coursebin run. The native companion, generic chat messages, REST and MCP have no mutation command. Requests are strict schemas with no script, URL, selector or endpoint argument.
- The background validates the proposal using the existing backend. That request contains the proposal and constraints, **not** the student's coursebin contents or authenticated page state.
- The content script performs a fixed, read-only same-origin GET of `/CourseBin`. Minimal bin entries stay in browser memory. It navigates to the observed `/Courses?Section={id}` lookup through the background and clicks only the original, verified section add button.
- Form target, exact semester/section URL, callbacks, course identity, visible button, capacity and page/document identity must match the observed contract. Button submission overrides and changed row fields are rejected. It never reads hidden input values, cookies, USC passwords or session tokens. WebReg's own original form handles its security fields.
- No arbitrary browser execution interface exists. No Schedule, Remove, Drop, Register, Checkout, grade-option or semester-change control is invoked.

## Validation policy agreed with the main task

Preparation and execution both call `validate_schedule` using `protectConstraints`. Stale/mismatched snapshot metadata, missing/duplicate section identities, cancelled sections, known validation failures, and unresolved component rules block execution. Failed **or unknown** time conflicts block it; matching session IDs are not proof of date overlap.

Unknown dates with otherwise non-overlapping known times, personal eligibility, and D-clearance approval remain visible warnings, not claims of approval. Unknown future check codes block by default. Snapshot capacity is advisory until the exact WebReg row is inspected; `Closed` or an exhausted numeric capacity blocks that section. An R/D flag never establishes individual clearance.

The main task owns validator changes and official clearance guidance. This adapter does not infer component/link-code semantics, solve a new schedule, request clearance, or silently substitute sections. Existing coursebin entries are preserved; their compatibility with the new draft is not certified by the public-data validator.

## Deterministic execution and recovery

One global background run and one content-script add lock prevent concurrent extension runs. Tickets are consumed before asynchronous work. Runs stop after at most three minutes. The executor journals before dispatch, performs no automatic mutation retry, and verifies the bin after each attempt. Existing entries must retain both registered and scheduled flags, and an unexpected extra entry or changed status stops the run.

The session-only journal contains the selected proposal's outcome IDs and pending section, not unrelated bin entries or raw page data. It is not sent to the backend. Closing/reopening the side panel restores it through chat. A restarted service worker marks pending work interrupted/unconfirmed and never resumes automatically. An unfamiliar response or timeout remains unconfirmed; a bounded read can reconcile late presence. A new student-triggered review re-reads the bin before another attempt.

This is not an atomic server transaction. The extension detects observed state changes and stops; it cannot roll back or exclude a simultaneous manual change in another WebReg session. It never removes courses to repair a partial result.

## Verification and remaining evidence

See [the read-only observation record](webreg-observations.md) for exact UI evidence. The browser inspection also verified that the fixed GET returns server-rendered inline status flags and the listing's actual fragment/callback attributes. No security-field values were inspected.

Sanitized tests cover the DOM parser, original-button click path, sender boundary, strict commands, one-time tickets, duplicate concurrency, preservation, wrong semesters, full/clearance/rejection feedback, partial completion, lost acknowledgements, late presence, interrupted workers, cancellation races, stale proposals, and direct-draft UI confirmation. The real React action was also reviewed in a local browser fixture at a 400-pixel card width; confirmation produced mock partial/unconfirmed results. Fixtures have no WebReg connection or student records.

Still unverified live: actual addition and its new-row scheduled flag, empty bins, required-component rules, D-clearance/server rejection dialogs, session-expiry behavior and partial mutation outcomes. Unknown UI states stop safely. The current validator reports `component_rules: unknown` for all source courses; this is a real gate, not a tested successful-add claim. A live test requires both authoritative component evidence and the student choosing and explicitly authorizing a concrete schedule. Never disable the gate or register a student to complete a test.

## Integration

The feature is on `feature/student-coursebin`. Coordinate with **Plan USC course scheduling agent** before merging into main. The adapter milestone owns new coursebin files, background registration, manifest, a standalone IIFE content build, and a dev-only `linkedom` fixture dependency. The UI milestone adds a separate per-card block and structured chat results; retain the main task's `ScheduleReview` rendering and automatic planner revalidation.

After integration, run `npm ci` and `npm run check`. Reload the unpacked extension from `apps/extension/build` and reload the WebReg page so the static content script is installed. Chrome may require acknowledging the new WebReg-origin permission. No infrastructure deployment or extension publication is needed or performed. The companion and backend startup remain unchanged.

The content build must remain a standalone classic `coursebin.js` (the second Vite build), while the background is an ES module. Do not add a web-accessible module loader or model-accessible scripting tool as an integration shortcut.
