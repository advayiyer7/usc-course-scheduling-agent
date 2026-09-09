# Implementation evidence

## Opening-alert receiver and private watches — September 9, 2026

- Added local per-profile pairing, exact plan/section watches, invalidation, bounded inboxes and structured confirmation/recheck state. Private APIs require a separate bearer token; only its hash is stored. Revocation removes all associated data. The public MCP course tools remain unchanged.
- Added an isolated Resend-compatible raw-signature receiver, durable deduplicated jobs, bounded inert HTML extraction, fixed-origin retrieval, Retry-After handling, expiring leases and retention. Provider keys remain server-side; raw email, Helper account links and USC credentials are not stored or passed to chat. A signed delivery still requires the student's confirmation of its original source and semester.
- Backend milestone: TypeScript and 18 focused parser/service/transport tests passed. 100 duplicate deliveries produced one event and no refresh request; 20 confirmed openings shared one fixture upstream request. Source failures, stale records, changed plans, cross-profile access, signature/replay failures, response bounds and crashed workers are covered. No real email or enrollment was submitted. Extension UI integration follows this commit; [operation and remaining dependencies](opening-alert-pilot.md) document the complete pilot.

## Opening-alert extension handoff — September 9, 2026

- Added Opening alerts setup, watch controls, synthetic tests, source/semester confirmation, delivery status, source-result cards and a bounded prompt handoff into the existing Codex composer. Changed plans hide old actions immediately; serialized writes prevent late requests from restoring old intent. Revoked pairings recover to setup. Disconnect removes server watch data. A local inbox badge uses Chrome alarms; no email-site access, cookie permissions, provider secrets, LLM polling or browser mutation capability was added.
- Updated both assistant instruction sources to distinguish reported openings from live seats, eligibility and enrollment permission, and to guide normal USC authentication and coursebin review. Real checkout automation remains unimplemented: a signed-in read-only investigation identified `POST /CheckoutResponse` and its original anti-forgery form, but transaction submission, mixed pending changes, response loss and post-submit verification were not tested.
- Combined `npm run check` passed 291 tests across 27 files, TypeScript and both extension bundles. Five new mounted UI/client tests cover the term-confirmation/prompt flow, stale-plan rejection, coursebin activity, request serialization and revoked pairing recovery. The backend commit `030ef26` also passed GitHub CI `34323586877`, including PostgreSQL and signed-out companion smoke.
- In an isolated browser preview, saved a Fall 2026 CSCI426/30242 watch, generated a synthetic message, confirmed its semester and obtained a live public check at September 9, 00:25:55 Pacific reporting 12 seats. This is a timestamped observation, not a current seat promise. Review with Codex switched to chat and prepared the matching summary without a Helper URL/token or model call. The rendered 500-pixel viewport had no horizontal overflow. Deleted the test alert pairing and its data through the UI afterward. The local API was restarted with synthetic alerts enabled. No real mailbox or registration action was used.

## Milestone 1: ingestion and persistence

- TypeScript, npm, Zod input/source schemas, immutable snapshots, raw response provenance, aliases, sections, meetings and job queue.
- Shared request pacing, bounded retries, fenced worker lease and atomic publication.
- PostgreSQL adapter and Compose setup; embedded PostgreSQL via PGlite for single-process local development and tests. This additional dev dependency avoids requiring Docker to run the prototype. It is not a multi-user production database deployment.
- Imported the September 6 Fall 2026 archive: 245 program pairs, 4,637 normalized scheduled course identities, 9,537 sections. The earlier 4,653 count refers to published codes; aliases are retained.
- Six initial tests passed: incomplete/invalid coverage, immutable snapshots and compare-and-swap, alias preservation, 100 concurrent enqueue requests coalescing into one job, lease exclusion, retry and access-denial handling.
- No production service, external assistant-host onboarding or extension published.

## Milestone 2: assistant interfaces and conservative validation

- Six shared REST/MCP tools, bounded batches, signed snapshot-pinned cursors, two-version dataset cache and local request limits.
- Streamable HTTP and stdio transports using official MCP SDK 1.30.0. Assistant instructions, resource and planning prompt are exposed.
- Deterministic weekly time conflicts, unavailable blocks, course coverage, cancellation and unit checks. Missing component/date facts are reported as indeterminate.
- 18 tests passed, including actual HTTP MCP discovery/calls, REST/MCP equality, prompt/resource retrieval, version-pinned pagination, input limits, hostile origins and rate limiting.
- 100 concurrent lookups shared one dataset load; 99 cache hits. This is a fixture-backed concurrency test, not production throughput measurement.
- Official MCP client smoke-tested against the imported Fall 2026 dataset: CSCI104 returned eight components; lecture 29903 validated as indeterminate for documented missing rules/date evidence.
- External provider applications have not been configured or tested; no universal compatibility claim. Production OAuth, public hosting and complete section-linking rules remain outstanding.

## Milestone 3: companion planner UI and extension build

- Manifest V3 extension with only local storage and loopback-backend permissions; stable extension origin is explicitly allowed by the backend.
- Shared React calendar also served at `/app/` for local preview. Search, paginated section retrieval, local preferences, unavailable blocks, free-day preferences, validation, targeted refresh requests and JSON export.
- Browser verified against the real imported Fall 2026 dataset: search CSCI104; select lecture 29903, lab 30119 and quiz 30025; display meetings; validate; reload and restore selections; set 18:00 latest finish and observe the quiz time-window violation.
- Browser testing caught and fixed time-input event handling before release. Preferences are not overwritten when the initial backend connection fails.
- Extension bundles build successfully. The React UI was exercised in the browser preview; installation into a user's Chrome profile and store publication were not performed.

## Milestone 4: reliability and measured local load

- Source Retry-After now pauses the shared budget across callers; access denials pause source requests for one hour. An expired worker cannot publish or overwrite another worker's job completion.
- Added dedicated PostgreSQL test schemas and a GitHub Actions job running on Node.js 24 against both PGlite and PostgreSQL 18.3. Hosted test results are tracked separately below.
- Restricted test discovery to source tests to avoid counting compiled copies twice.
- Local REST benchmark on the imported 4,637-course / 9,537-section dataset: 500 requests, concurrency 20, zero failures, 0.42 seconds, 1,198 requests/second observed, p50 12 ms, p95 58 ms. One dataset load and 499 cache hits; the upstream budget did not change. Local request limits were raised only in the benchmark instance. This is not an internet-facing production capacity claim.
- Both Streamable HTTP and actual child-process stdio were smoke-tested with the official MCP client against the historical dataset. No provider application has been onboarded.

Hosted verification completed successfully: [GitHub Actions run 34061412965](https://github.com/advayiyer7/usc-course-scheduling-agent/actions/runs/34061412965) passed installation, type checking, extension build, 23 PGlite-backed tests and the same 23 tests against PostgreSQL 18.3 on Node.js 24.

## Remaining release boundaries

- Local prototype only: no public deployment, OAuth onboarding or extension-store release.
- Required component/linking rules and actual meeting dates remain unknown; the validator reports this and does not certify a complete schedule.
- Codex companion startup and official sign-in initiation/cancellation are verified; the user subsequently tested account-authenticated chat successfully. Automated inference tests remain separate.
- Full-semester timed refresh scheduling is implemented below. Snapshot retention remains an operational follow-up.
- PGlite is single-process development storage. Use PostgreSQL for simultaneous HTTP, worker and stdio processes.

## Codex companion pilot — September 6, 2026

- `3eff7f9`: pinned Codex 0.153.4, isolated account profile, native frame/RPC boundaries, constrained scheduling tool bridge and validated proposal events. Initial milestone passed 35 tests and a real signed-out runtime/config/thread smoke test.
- `958af67`: integrated per-user macOS/Linux installer from the parallel task; 18 installer tests cover ownership, symlinks, quoting, reinstall and uninstall. Installed the real stable-Chrome registration and launcher on this macOS machine.
- `312e649`: integrated durable daily semester refresh scheduling; six fixture-backed tests cover instructor updates, partial source failures, multiple schedulers and targeted-refresh races. No live bulk USC fetch was needed for tests.
- `c67e160`: side-panel Codex chat, official sign-in link, account state, Stop/New chat/Sign out, local major preference and validated draft loading. Browser preview verified at desktop and 420-pixel widths; existing CSCI104 selections and conservative validation survive switching between chat and planner.
- `8603c16`: seven independently reproduced cancellation-race regressions. Late cancelled tool calls/messages/completions cannot affect the next response; old Stop completion cannot clear a newer response's busy state. Draft loading revalidates against current required courses, hard constraints and preferences, and rejects another semester.
- Combined local verification: `npm run check` passed 72 tests across 11 files, TypeScript and the production extension build. `npm run smoke:companion` passed against the actual pinned executable. `npm run smoke:native` passed using the installed launcher: Chrome framing, account/read, official sign-in URL and cancellation. No authentication completed or model inference was performed during these tests.
- The native-host registration is installed. After the initial file-chooser difficulty, the extension was loaded, enabled and pinned in Chrome. The user subsequently reported successful connection and chat. This is separate from the successful native-launcher protocol checks.
- USC ITS sources state ChatGPT Edu is available to active affiliates, while Codex requires an access request and department approval. Onboarding reports this; no free/universal Codex entitlement claim.
- Still outside this pilot: WebReg account access and coursebin/enrollment mutations, a deterministic optimizer, Claude support, hosted production service, signed consumer installers, Windows and extension-store publication.

## Validation and D-clearance — September 6, 2026

- `9d3627b`: deterministic date/recurrence checks, explicit unknown conflicts, non-partial unit totals, separate review summaries, official clearance registry and MCP/REST enrichment. Backend milestone passed 88 tests, including transport parity. Routine tests used fixtures.
- Added a shared card/planner review UI, official clearance links with audiences and review dates, and automatic debounced validation on planner changes. Pending/errors replace the previous selection's result; cancellation ignores late successes and failures. The companion receives matching guidance instructions.
- Offline audit of all 245 Fall 2026 school/program pairs across 26 schools: 4,637 courses; 3,422 with department instructions/advising hubs, 1,214 catalog-directory fallbacks, one unresolved (KSI399). Of 6,035 distinct archived D-flag sections, 4,463 have department instructions. Registry: 27 entries. Audit made zero upstream calls; this is not an exhaustive census of all USC clearance webpages.
- `npm run check` passed 94 tests across 14 files, TypeScript and production extension build. Six new UI/request tests cover missing/malformed reviews, safe links, escaped content, debounce, late results and errors. MCP smoke passed against the stored Fall 2026 data. No model usage was needed for these checks.
- Updated local REST benchmark with clearance-enriched section responses: 500 requests at concurrency 20, zero failures, 0.84 seconds, 595 requests/second observed, p50 27 ms, p95 123 ms. One dataset load, 499 cache hits, **zero observed USC fetches**, unchanged upstream budget. Local limits were raised only in this benchmark; these figures do not establish hosted capacity.
- Browser preview verified CSCI104 restoration, adding CSCI426 section 30242 to the local planner, automatic review, official CS/myViterbi instruction links, and a known evening-class violation after setting an 18:00 latest finish. Narrow-panel testing exposed calendar-driven page overflow and the layout was corrected.
- Still incomplete: verified required component/link semantics, actual meeting dates, source-backed GE category discovery, complete department-specific clearance coverage and an integrated coursebin adapter. Clearance remains a link-out feature, with approval unknown. No student bin or registration changed during this milestone.

## Student-triggered coursebin branch — September 6, 2026

- `52baaa3`: read-only investigation of the student's already signed-in WebReg. Verified semester markers, exact section search, component listings, original add form/button, raw coursebin status markup and hidden dangerous controls. No live add or registration action; no student records or security-field values stored in fixtures.
- `38d6430`: bounded browser-only adapter, strict sender/protocol boundaries, shared-validator preflight, single-use tickets, exact-section navigation and click, preservation and duplicate locks, journaled interruption/partial-outcome handling. Standalone MV3 content-script build and narrowly scoped WebReg permission; `linkedom` is test-only.
- `31e5160`: direct per-draft Add to coursebin review/confirmation without planner prerequisites; structured chat outcomes and explicit request-for-alternatives button. No replacement is automatically applied.
- `dc5b5b1`: integrated main's `4e569ef` validation/clearance review into the feature branch while retaining `ScheduleReview` and automatic planner revalidation. Combined `npm run check` passed **217 tests across 20 files**, TypeScript and both production extension builds. New coursebin coverage accounts for 123 tests; existing validation/companion/ingestion checks also pass.
- A real browser fixture exercised the actual React review at a 400-pixel card width and mock unconfirmed/already-present outcomes; it had no WebReg connection. This caught and fixed the nested-card flex layout. Review also fixed lost-reply classification, cancellation races, stale cross-card confirmations and unobserved form-submission overrides.
- Release gates remain: every current source course has unknown component rules; aggregate snapshot staleness may survive targeted refreshes; empty-bin markup and live mutation/error outcomes have not been verified. The adapter fails closed on these conditions. A student-selected, explicitly authorized live addition is still required after validation gates are resolved. Never register the student. Main and the installed extension were left unchanged by this feature task. See [coursebin integration instructions](coursebin.md).

## Current plans and chat cleanup — September 6, 2026

- Integrated the verified coursebin feature branch at `a4ce256` (217 tests and hosted CI passed there). Its mutation gates remain unchanged; this integration does not establish live readiness.
- The companion and extension now enforce at most two plans per request. A request replaces the old set; proposal events carry a generation ID. Old/late events cannot repopulate a cleared set, and planner edits invalidate cards and their coursebin confirmation controls.
- Persist explicit planner course removals, including aliases, and pass them with current selected section IDs/snapshot to chat. The companion rejects removed courses before validation. Undo allows a removed course to be considered again; adding it back through the optional editor also clears that removal. An initially empty planner still supports discovering named courses from chat.
- Fold earlier conversation messages behind a history toggle, retain coursebin recovery reports, move the composer above compact plan cards, group course labels, and collapse detailed validation/clearance. The current planner and removal/Undo chips remain visible in chat. A persistent Stop control remains available for an active coursebin run even if its original card disappears.
- Verified with `npm run check`: 225 tests across 21 files, TypeScript and both extension bundles. Mounted React tests cover replacement, the two-card limit, obsolete generations, removals/current context, failed regeneration, and a persistent coursebin Stop control. Browser preview verified adding/removing CSCI426, persisted removal across reload, Undo, and a 420-pixel layout without horizontal overflow or console errors. No model or WebReg mutation was used in these checks.

## Planner draft handoff and coursebin recovery — September 6, 2026

- Keep the two generated alternatives across tab navigation and loading either draft into the planner. Only actual planner edits, changed major, a new request or connection lifecycle reset retire the cards; delayed retired-generation events remain rejected.
- Move Add to coursebin to My planner. Build its proposal from snapshot-matching shared validation of the current exact section selection; editing or revalidation replaces any previous confirmation. Results remain available in planner and chat, and active-run Stop remains above both tabs.
- Add Refresh data and recheck with bounded polling, cancellation, explicit incomplete-refresh feedback, and unchanged exact section IDs. Missing sections stop the handoff instead of silently dropping or substituting them. Shared stale/component gates remain enforced.
- `npm run check`: 235 tests across 22 files, TypeScript and both production bundles passed. Mounted workspace regressions cover both draft handoffs, navigation, removal/late generations, planner-only action placement/current IDs, and global Stop. Four refresh regressions cover delayed freshness, missing sections, timeout and cancellation. No live coursebin mutation performed.

## Selected-record freshness correction — September 6, 2026

- `0a6d7f3`: bounded course/section lookups and validation use their relevant record timestamps, so a targeted refresh no longer inherits unrelated old catalog evidence. Missing records fall back to the whole catalog; mixed ages, cross-list evidence and old pinned versions stay conservative. No schema, worker budget or component-gate change.
- Integrated planner handoff/recovery as `50cb85f` and reverted-edit/timeout handling as `45b9e6c`. Combined `npm run check` passed **241 tests across 23 files**, TypeScript and both extension bundles. The 100-concurrent-refresh fixture still observes one upstream request, while only its refreshed program becomes current.
- Restarted the local API cleanly. Its earlier EE/CSCI/SSCI jobs were complete, establishing that this was a response-metadata issue rather than a stuck queue. A bounded new public refresh completed all three jobs and published snapshot `2f5d29be-6da5-439f-a4ae-134411b2a341`: EE109 at 17:21:31, CSCI426 at 17:21:34 and SSCI165 at 17:21:37 Pacific. Course lookup and sample-section validation reported `stale: false`; the prior pinned version and whole-catalog listing remained stale. These are observation times, not future freshness promises.
- Validation still reports unknown components/eligibility. No student coursebin or registration change was performed. Remaining live-addition gates in `docs/coursebin.md` continue to apply.

## Verified pilot component profiles — September 6, 2026

- Implemented reviewed Fall 2026 component profiles: EE109 requires one Lecture/Lab/Quiz; CSCI426 one Lecture; SSCI165 one Lecture/Lab. Official USC advising and SIS sources, date, policy version and limits are recorded in [component validation](component-validation.md). Only explicitly unlinked session001 offerings from the reviewed teaching program are supported.
- Normalize complete section inventories and preserve course/term/section registration notes. Missing legacy evidence, partial inventory, nonempty notes, new types/sessions/links or additional teaching programs remain unknown. Missing/duplicate required components fail. Old snapshots remain immutable; refresh is required to acquire the new normalized evidence.
- Validation findings carry official source links rendered safely in the review. REST/MCP and the existing coursebin preflight share the same checks. No adapter, confirmation, time-conflict, freshness, cancellation or eligibility gate was relaxed.
- `npm run check` passed **268 tests across 24 files**, TypeScript and both production bundles. New tests cover all three profiles, alternatives, missing/duplicate components, old/partial evidence, changed source configurations, aliases, publication rollback, real preflight and tampered evidence links. An offline normalization audit of the saved Fall2026 archive retained **4,637 courses / 9,537 sections** and matched all three profiles without additional USC requests. This is separate from a live addition test, which has not been performed.
- Implementation commit `d6b4ff3` passed GitHub CI `34071677839`, including PostgreSQL checks and signed-out companion smoke. A bounded live refresh populated the new inventory/notes evidence: all three pilot component findings passed, omission of an EE lab failed, and the prior immutable snapshot remained unknown. Installed Chrome verification retained the unchanged six-section selection, displayed Required components as Passed, and opened the exact-selection coursebin preview with confirmation enabled. No page-verification error or component blocker remained. Unknown meeting dates, full-seat and clearance warnings were retained. No confirmation, addition, registration or checkout was performed; private bin contents and account details were not recorded.

## WebReg authentication feasibility — September 6, 2026

- [Read-only investigation](webreg-auth-feasibility.md) observed WebReg's Microsoft authorization-code flow, USC federated sign-in, chunked Secure/HttpOnly application cookies and separate semester selection. Authenticated browser HTTP reads of term, coursebin and section pages succeeded; credentials-omitted comparisons redirected to sign-in. A standalone signed-out HTTP client independently observed the authentication redirect.
- Coursebin forms include anti-forgery fields. Cookie values, passwords, authentication codes, private course lists and raw network captures were excluded from repository artifacts. No enrollment or coursebin mutation was issued during this investigation.
- Standalone authenticated HTTP-client reuse, cloud portability, session lifetime/renewal, registration correctness and operational capacity remain unverified. No service, credential storage, browser permission or deployed infrastructure was added. Documentation was checked against observed results and reviewed for secrets; application code and tests were unchanged.

## Schedule Helper alert integration research — September 6, 2026

- Reviewed the active Helper repository at `6c605c27b27ccd2affe9177e080ba52c9a101578`, its notification scheduler/delivery/template/account flow, and official Gmail, Outlook and inbound-email documentation. [Findings and proposed workflow](schedule-helper-integration.md) record the five-minute source polling cycle, explicit watch re-enablement, HTML-only section detail, absent rendered semester and sensitive Helper account links.
- No documented partner webhook was found. Proposed a narrow forwarding pilot with authenticated event intake, term-specific watch matching, USC rechecks, student authentication/transaction review and a future verified registration executor. The current local companion has no email listener or registration tool; cloud authentication and checkout remain unverified.
- Documentation-only milestone. Reviewed the source-backed claims and checked formatting/diff hygiene. No email account, forwarding rule, service subscription, cron job, external outreach, browser operation or registration action was configured or performed.
