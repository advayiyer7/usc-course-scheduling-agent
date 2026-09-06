# Implementation evidence

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
