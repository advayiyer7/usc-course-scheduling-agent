# Run the local prototype

For chat inside the extension using your own Codex account, follow [companion setup](companion-setup.md). The steps below configure the shared course backend and manual planner. The browser preview cannot run a native companion.

## Requirements

Node.js 24 LTS or 26, npm, and a cloned repository. Run commands from the repository root. npm scripts load `.env` when present. No AI provider key is needed.

```sh
npm ci
npm run build
npm run ingest -- 20263
npm run dev
```

Ingestion reads the public USC JSON API centrally and can take several minutes. To reuse the earlier downloaded archive instead, extract it preserving member timestamps and run:

```sh
npm run import:snapshot -- /path/to/extracted-archive 20263
```

Then open `http://127.0.0.1:3000/app/`. This is the same React planner UI packaged in the extension, with localStorage used in browser-preview mode. The extension uses chrome.storage.local instead. Neither stores USC credentials.

## Load the Chrome extension

1. Run `npm run build` and start the backend with `npm run dev`.
2. Open Chrome's Extensions page (`chrome://extensions`) and enable Developer mode.
3. Select Load unpacked and choose `apps/extension/build` inside this repository.
4. Click the extension's toolbar action to open the planner.

The development manifest has a fixed public key, so its ID is `hcihcmbmpmfdihdgejlclbaegnhgjhdk`. The backend allows that exact extension origin. Its permissions are local storage and access to `http://127.0.0.1:3000/*`; no access to USC login pages or other AI websites is requested. The public manifest key is not a server secret or private signing key.

## Assistant connection

- Streamable HTTP: `http://127.0.0.1:3000/mcp` for a local MCP client.
- Stdio: command `npm`, arguments `--silent --prefix /absolute/path/to/usc-course-scheduling-agent run mcp:stdio`.
- Planning prompt: `plan-semester`, with semester, courses and optional preferences.
- Instructions resource: `usc://assistant/instructions`.

Hosted ChatGPT/Claude connections cannot reach this loopback service directly. Public hosting and OAuth are not implemented. Do not use a tunnel to bypass the local-only release boundary. DeepSeek consumer-web custom connector support has not been verified. Exported JSON can be attached manually to an assistant, but cannot execute tools or refresh itself.

## PostgreSQL and worker

For multiple processes, use PostgreSQL:

```sh
docker compose up -d
cp .env.example .env
```

Set `DATABASE_URL=postgres://usc:usc@127.0.0.1:5432/usc` in `.env`, ingest/import data into that database, then run `npm run dev` and `npm run worker` in separate terminals. The default PGlite database is single-process: the HTTP application runs its refresh worker internally. Do not simultaneously open `data/local` from another API, ingest or stdio process. Stop the API before a CLI import in embedded mode.

The worker drains user-requested, coalesced refresh jobs. Automatic calendar-based full refresh scheduling is not enabled; run the ingest command explicitly. Archived-term classification, retention/pruning, and production refresh scheduling remain follow-up work.

## Verification

```sh
npm run check
npm run smoke
```

`smoke` requires the backend and an imported Fall 2026 semester. The UI supports search, course selection, section selection, hard time limits, unavailable blocks, soft free-day preferences, deterministic validation, local persistence, JSON export and refresh requests. The prototype does not generate optimal schedules automatically; the connected assistant proposes combinations and the validator checks them.

All schedules remain indeterminate for complete registration validity until required component/linking rules and date ranges are verified. Known conflicts are still reported. Full sections and personal eligibility are separate from time compatibility.

## Reliability and benchmark commands

`npm run benchmark` launches its own loopback server against the stored Fall 2026 data, performs 500 requests at concurrency 20, and reports measured latency, cache loads and upstream-budget changes. Stop the development API first if using embedded storage. It deliberately raises the local request quota only for that benchmark instance.

`npm run smoke:stdio` starts an actual stdio child process and tests tool discovery plus a course lookup. Stop other embedded-database processes first. These protocol checks do not substitute for testing provider-specific connector onboarding.

CI runs fixture-backed tests against both PGlite and a dedicated PostgreSQL `usc_test` database. To repeat PostgreSQL tests locally, set `TEST_DATABASE_URL` to that dedicated test database; tests use isolated temporary schemas and remove only those schemas.

The current cache holds two immutable dataset versions in one process. Cursors are signed with a process-local key, so restart or a future different replica requires restarting pagination. Replica-shared cursors and distributed client quotas must be designed before horizontal deployment.
