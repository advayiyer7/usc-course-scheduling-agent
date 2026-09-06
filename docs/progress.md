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
- Assistant applications have not been configured; tested integrations are official MCP clients over HTTP and stdio.
- Full-semester timed refresh scheduling and snapshot retention are operational follow-ups; user-requested refresh jobs work now.
- PGlite is single-process development storage. Use PostgreSQL for simultaneous HTTP, worker and stdio processes.
