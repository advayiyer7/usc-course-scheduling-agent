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

## Later decisions

- Deterministic top-k schedule generation after validation is trustworthy.
- Student-authorized account sync if needed, with a separate data-access design.
- In-extension chat using provider APIs, including explicit key and billing design.
- Professor information beyond names only with appropriate sources and provenance.
- Campus travel constraints only with reliable locations and travel-time inputs.
