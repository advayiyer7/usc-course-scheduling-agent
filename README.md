# USC Course Scheduling Agent

A shared USC course-data service that students can use through an MCP-compatible AI assistant and a companion Chrome extension.

**Status: local pilot with user-tested Codex sign-in/chat, validated AI draft handoff, automatic planner review, official D-clearance guidance, REST/MCP course tools, and scheduled semester caching. Hosted deployment, consumer installers, and WebReg coursebin actions are not yet released.**

[Run locally and load the extension](docs/local-setup.md).

[Install the Codex companion and connect chat](docs/companion-setup.md). USC ChatGPT Edu does not automatically include Codex: ITS currently requires an access request and department approval.

## Specification

- [Architecture and boundaries](docs/architecture.md)
- [Tool contracts](docs/tool-contracts.md)
- [Runtime assistant system prompt](prompts/scheduling-assistant.system.md)
- [Implementation agent prompt](prompts/implementation-agent.md)
- [Phased delivery plan](docs/implementation-plan.md)

The runtime prompt describes how a scheduling assistant should behave. The implementation prompt instructs a coding agent how to build this repository. An external assistant may not let an MCP server install a system prompt; its host controls instructions. Enforce correctness and limits in the backend as well as documenting them for the model.

## Product scope

The primary workflow starts in extension chat: a student types a request such as “Fall 2026: CSCI 104, CSCI 270, EE 109, and one GE-D course.” The assistant finds the courses and section combinations and presents up to two schedule alternatives when enough suitable options exist. Manual course/section selection is optional editing, never a prerequisite for chatting. Open the chosen draft with **Edit in planner**, then use **Add to coursebin** on **My planner**: the extension operates in the student's logged-in WebReg session and reports the outcome, with checkout left to the student.

The companion accepts typed course requests and can display up to two AI-generated draft cards. Each card has **Edit in planner**. Both alternatives remain visible after opening either draft or switching tabs. **Add to coursebin** appears on **My planner**, with a separate exact-section confirmation for the current selection. **Refresh data and recheck** waits for fresh data while preserving the selected section IDs. Actual course, section, semester or preference edits invalidate old drafts. The bounded browser adapter and structured outcomes are implemented and fixture-tested. Fall 2026 EE109, CSCI426 and SSCI165 have [verified unlinked component profiles](docs/component-validation.md); other configurations remain unresolved. Empty-bin markup and live mutation outcomes remain unverified. The user has tested sign-in and chat. Source-backed GE-category discovery and deterministic schedule optimization remain later work. See the [coursebin implementation and release gates](docs/coursebin.md) and [acceptance workflow](docs/implementation-plan.md#chat-to-coursebin-acceptance-workflow).

The Chrome extension displays chat, preferences, saved course selections, and a weekly calendar. The local pilot calls the backend over loopback HTTP; a production deployment would require HTTPS and authentication. Native messaging connects only this extension to its locally installed companion. It does not automatically grant tools to arbitrary AI chat websites.

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

Schedule cards and the planner show separate compatibility, required-component, seat and eligibility results. Planner edits automatically revalidate with cancellation of obsolete requests. D-clearance sections expose official instruction links with audience and review dates. The [clearance directory audit](docs/d-clearance.md) covers every Fall 2026 source program pair: 3,422 courses have researched department guidance, 1,214 have semester-directory fallbacks and one remains unresolved. No clearance requests are submitted.

## Companion verification

`npm run smoke:companion` exercises pinned Codex 0.153.4 with a temporary signed-out profile, verifies restricted feature configuration and creates an ephemeral dynamic-tool thread. It makes no model request. After installation, `npm run smoke:native` checks the real launcher and Chrome message framing; for a signed-out companion it also starts and cancels the official login flow. It does not complete sign-in or consume model usage. Mock tests cover streaming, validation handoff, permission boundaries, cancellation and installer behavior; these are distinct from an authenticated end-to-end test.

Cached current/upcoming semesters now have daily full reconciliation while a worker runs. [Semester cache configuration](docs/semester-cache.md) explains durable retry behavior, configuration and shared source request limits. A cache refresh is not a seat reservation or a source-freshness guarantee.
