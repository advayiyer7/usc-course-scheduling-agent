# USC Course Scheduling Agent

A shared USC course-data service that students can use through an MCP-compatible AI assistant and a companion Chrome extension.

**Status: working local prototype with ingestion, REST/MCP assistant tools, conservative validation, and a companion Chrome extension build. Production deployment and provider-host onboarding are not complete.**

[Run locally and load the extension](docs/local-setup.md).

## Specification

- [Architecture and boundaries](docs/architecture.md)
- [Tool contracts](docs/tool-contracts.md)
- [Runtime assistant system prompt](prompts/scheduling-assistant.system.md)
- [Implementation agent prompt](prompts/implementation-agent.md)
- [Phased delivery plan](docs/implementation-plan.md)

The runtime prompt describes how a scheduling assistant should behave. The implementation prompt instructs a coding agent how to build this repository. An external assistant may not let an MCP server install a system prompt; its host controls instructions. Enforce correctness and limits in the backend as well as documenting them for the model.

## Product scope

Students choose courses and preferences, inspect section alternatives, and validate proposed schedules. Their chosen assistant performs the conversation and initial planning. The backend provides authoritative data and deterministic validation. Full schedule generation is a later phase.

The Chrome extension displays preferences, saved course selections, and a weekly calendar. It calls the same backend over HTTPS. It does not automatically grant tools to arbitrary AI chat websites.

No automatic enrollment, degree certification, professor ratings, or collection of USC credentials in the initial scope.

This is an independent project, not an official USC service. Successful public access does not establish a supported integration or permission for ongoing bulk reuse.

## Development foundation

Use Node.js 24 LTS or Node.js 26 and npm. Dependencies are pinned in package-lock.json.

```sh
npm ci
npm run typecheck
npm test
npm run ingest -- 20263
```

By default, development uses PGlite (embedded PostgreSQL) in ignored `data/local`; only one process may open it. For the PostgreSQL service, run `docker compose up -d` and set `DATABASE_URL=postgres://usc:usc@127.0.0.1:5432/usc`. Embedded tests exercise actual PostgreSQL SQL through PGlite; multi-process PostgreSQL verification is separate.

`npm run import:snapshot -- /path/to/extracted-archive 20263` imports the earlier public-data archive without refetching USC. It requires `programs.json` and `programs/*.json` and uses preserved file timestamps as approximate observation times. Keep originals' timestamps when extracting. This is a historical import, not a fresh availability check.

Ingestion is sequential and globally paced by a database request budget. It stages/validates a whole term, rejects missing pairs or unexpected coverage loss, and atomically publishes an immutable version. Unknown source dates and locations remain null. Course counts normalize scheduled identities across aliases and may differ from published-code counts.

## Assistant tools

```sh
npm run dev
# In another terminal:
npm run smoke
```

The REST route is `POST http://127.0.0.1:3000/api/tools/<tool_name>`; the MCP endpoint is `http://127.0.0.1:3000/mcp`. Six tools share the same domain service. The MCP server advertises assistant instructions, an `usc://assistant/instructions` resource and a `plan-semester` prompt. Host instructions retain precedence.

The local prototype binds only to loopback and checks Host/Origin. Do not expose it through a tunnel as a production service. OAuth, distributed client identity and production host onboarding remain outstanding. A hosted assistant cannot reach this loopback URL directly.

To use a local stdio-capable assistant, configure a command equivalent to `npm --silent --prefix /absolute/path/to/repository run mcp:stdio`. It must use PostgreSQL if the HTTP service runs simultaneously; embedded development files support one process only. The stdio process serves tools but does not run refresh jobs: run the separate PostgreSQL worker for queued refreshes.

`npm run smoke` uses the official MCP client to discover tools, retrieve CSCI104 and validate a section against the imported Fall 2026 snapshot. This verifies the protocol, not onboarding in ChatGPT, Claude or DeepSeek.

Validation detects known weekly overlaps and hard time-block violations, but deliberately returns `indeterminate` for missing date ranges or unverified component/linking rules. It never certifies enrollment eligibility.
