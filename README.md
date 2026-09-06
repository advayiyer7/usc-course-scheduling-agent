# USC Course Scheduling Agent

A shared USC course-data service that students can use through an MCP-compatible AI assistant and a companion Chrome extension.

**Status: ingestion implemented and tested. Assistant interfaces and extension are under construction.**

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
