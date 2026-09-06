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
- Codex companion startup and official sign-in initiation/cancellation are verified; account-authenticated chat still requires an interactive check.
- Full-semester timed refresh scheduling is implemented below. Snapshot retention remains an operational follow-up.
- PGlite is single-process development storage. Use PostgreSQL for simultaneous HTTP, worker and stdio processes.

## Codex companion pilot — September 6, 2026

- `3eff7f9`: pinned Codex 0.153.4, isolated account profile, native frame/RPC boundaries, constrained scheduling tool bridge and validated proposal events. Initial milestone passed 35 tests and a real signed-out runtime/config/thread smoke test.
- `958af67`: integrated per-user macOS/Linux installer from the parallel task; 18 installer tests cover ownership, symlinks, quoting, reinstall and uninstall. Installed the real stable-Chrome registration and launcher on this macOS machine.
- `312e649`: integrated durable daily semester refresh scheduling; six fixture-backed tests cover instructor updates, partial source failures, multiple schedulers and targeted-refresh races. No live bulk USC fetch was needed for tests.
- `c67e160`: side-panel Codex chat, official sign-in link, account state, Stop/New chat/Sign out, local major preference and validated draft loading. Browser preview verified at desktop and 420-pixel widths; existing CSCI104 selections and conservative validation survive switching between chat and planner.
- `8603c16`: seven independently reproduced cancellation-race regressions. Late cancelled tool calls/messages/completions cannot affect the next response; old Stop completion cannot clear a newer response's busy state. Draft loading revalidates against current required courses, hard constraints and preferences, and rejects another semester.
- Combined local verification: `npm run check` passed 72 tests across 11 files, TypeScript and the production extension build. `npm run smoke:companion` passed against the actual pinned executable. `npm run smoke:native` passed using the installed launcher: Chrome framing, account/read, official sign-in URL and cancellation. No authentication completed or model inference was performed during these tests.
- The native-host registration is installed. The Chrome file chooser did not complete loading the unpacked extension during automation; interactive extension/account onboarding remains to be finished by the user. This is separate from the successful native-launcher protocol checks.
- USC ITS sources state ChatGPT Edu is available to active affiliates, while Codex requires an access request and department approval. Onboarding reports this; no free/universal Codex entitlement claim.
- Still outside this pilot: WebReg account access and coursebin/enrollment mutations, a deterministic optimizer, Claude support, hosted production service, signed consumer installers, Windows and extension-store publication.
