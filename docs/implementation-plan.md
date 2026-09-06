# Phased delivery plan

This is a backlog. Implementation progress is recorded in README.md and docs/progress.md. Each phase can span several coherent commits; commit after relevant checks pass.

## Phase 1 — contracts and public-data ingestion

Scaffold the workspace, shared schemas, source adapter, database migrations and worker. Implement term/program enumeration and a complete Fall 2026 import. Add versioned snapshots, coverage checks, cross-list preservation, retry/backoff and an upstream budget. Keep bulk data out of git.

Acceptance: ingest a term without student credentials; report exact coverage; a partial failure cannot replace a good snapshot; repeated ingestion does not duplicate identities. Test missing fields, empty programs, malformed payloads and source timeouts using representative fixtures.

## Phase 2 — retrieval over REST and MCP

Implement list_terms, search_courses, get_courses, get_sections and request_refresh through shared domain services. Add result metadata, limits, pagination, refresh coalescing and structured errors. Establish the service authentication and host compatibility strategy before exposing it publicly.

Acceptance: equivalent MCP and REST requests return equivalent domain data; pagination pins a version; rate limits work; many requests for the same stale course cause at most one concurrent refresh; no secrets are exposed. Verify one supported host end to end, then a second independently. Report untested hosts honestly.

## Phase 3 — deterministic validation

Research USC's required component/linking semantics. Implement validate_schedule with explicit unknown results until each necessary rule is established. Keep enrollment eligibility separate.

Acceptance: tests cover overlaps, exact boundary times, date ranges, unknown times, required labs/discussions/quizzes, cross-listed duplication, cancellation, units and hard constraints. No schedule with unresolved required facts receives an unqualified feasible status.

## Phase 4 — companion Chrome extension

Build course selection, local preference storage and a weekly calendar. Use REST rather than running a server in the extension. Add supported-host setup guidance and compact manual export for unsupported hosts. Revalidate after changing a schedule.

Acceptance: install an unpacked extension locally, choose courses, block times and render a validated proposal; show stale/unknown states; retain preferences locally; use minimal permissions. No USC login capture, automatic enrollment or provider-site chat injection.

## Phase 5 — reliability and pilot

Add metrics, operating documentation, load tests and a deployment proposal. Validate source reuse/polling expectations and define an operating budget. Test retries, worker crashes, upstream outages and registration-like bursts. Deployment and extension-store publication are separate authorized actions.

Acceptance: publish measured throughput and latency, database/resource use, upstream request volume and failure behavior. Document recovery, snapshot rollback, source schema changes and the tested assistant-host matrix.

## Authorized Codex companion pilot — September 6, 2026

Build a local companion using official Codex app-server, with student-managed ChatGPT sign-in, extension side-panel chat, bounded course tools and validated proposal handoff to the calendar. Commit transport/runtime and tested UI/install milestones separately. See [companion architecture](companion-architecture.md). Test signed-out real runtime startup separately from authenticated inference. USC Edu membership is not proof of Codex entitlement. Coursebin interaction follows a separate authenticated WebReg investigation; no registration automation in this milestone.

## Remaining later decisions

- Deterministic top-k schedule generation after validation is trustworthy.
- Student-authorized account sync if needed, with a separate data-access design.
- In-extension chat using provider APIs, including explicit key and billing design.
- Professor information beyond names only with appropriate sources and provenance.
- Campus travel constraints only with reliable locations and travel-time inputs.

## Chat-to-coursebin acceptance workflow

The user clarified the primary product flow on September 6, 2026. Manual planner selection is an optional editor, not required onboarding. The acceptance scenario is an empty planner followed by “I want CSCI 104, CSCI 270, EE 109, and a GE-D course for Fall 2026.”

1. The assistant resolves named courses and interprets GE-D as one requirement slot with alternative eligible courses, not a literal course code or a request to take every matching course. GE membership requires authoritative source evidence; never infer it from a title or department.
2. It retrieves the relevant sections, accounts for required components and stated preferences, and presents two or three validated alternatives in chat when available. If fewer exist or facts are unresolved, explain that rather than inventing alternatives or relaxing hard constraints silently.
3. Each eventual coursebin action is attached to a specific reviewed schedule. The student clicks **Add to coursebin** directly from that schedule; loading it into the manual editor must not be a prerequisite.
4. A bounded extension adapter uses the student's existing logged-in WebReg session to add the exact approved sections. Inspect actual WebReg behavior before implementing mutations. Verify the semester and current bin, preserve unrelated contents, avoid duplicate additions, and report confirmed successes and partial failures. Full/unavailable sections return to chat for alternatives; do not silently substitute or automatically register.
5. The student reviews the bin and completes checkout in WebReg. AI inference uses the student's own companion account; coursebin execution is application code and requires no project-funded model call.

Remaining dependencies are authenticated chat verification, source-backed GE-category discovery, verified component semantics, and the WebReg adapter/action UI. The current **Load into planner** button is implemented; **Add to coursebin** is not. This acceptance target does not claim those dependencies are complete or authorize changes to a real student's bin without their selection of a specific schedule.
