# Codex companion pilot

Authorized September 6, 2026: chat inside the Chrome extension using a student's own Codex access. This pilot adds a local native companion; it does not deploy a service, publish an extension, or implement coursebin/enrollment mutations.

## Components

Chrome's side panel sends a small validated command vocabulary to a single background native port. Chrome launches `edu.usc.course_planner`, restricted to the extension's fixed origin. The companion starts pinned, unmodified `@openai/codex` 0.153.4 using app-server over stdio. Chrome native frames and app-server JSON lines are distinct transports; neither endpoint exposes raw RPC forwarding to the extension or web pages.

Codex owns the ChatGPT OAuth flow and token storage in `~/.usc-course-planner/codex`. The application does not read tokens, import existing Codex credentials/configuration, accept API keys, or change a user's normal Codex profile. The UI sees only signed-in status and plan type; neither email nor provider diagnostics are forwarded. Login URLs are restricted to HTTPS on auth.openai.com. The official sign-in flow can still require account/workspace selection and approval by the account administrator.

The model runs at OpenAI. The companion runs locally, using the student's supported Codex access and usage limits. A ChatGPT subscription or workspace membership alone does not establish Codex entitlement. USC ITS currently says active affiliates have ChatGPT Edu, while Codex requires a ServiceNow request and department approval. This must appear in onboarding; do not promise free Codex for all students.

## Tool boundary

The companion uses the official MCP client to connect to the existing loopback course backend. It exposes the six allowlisted tools as Codex dynamic tools, plus `present_schedule`. The latter validates an exact, snapshot-pinned selection before sending a draft to the UI. It preserves the planner's required courses and hard constraints. Model output cannot directly change the student's planner. The student explicitly loads a draft, and the planner retrieves that snapshot and validates again. No new scheduling semantics are duplicated in the companion.

Dynamic tools are experimental app-server APIs. Pinning the runtime and running a real startup/thread smoke test is required when updating. We choose this narrow proxy instead of importing the user's global MCP servers: unknown tool names, other thread/turn IDs, and any runtime approval or browser/filesystem request are rejected in code. The runtime uses an empty workspace, no environment roots, disabled shell/edit/browser/plugin/memory/multi-agent features, and read-only sandboxing. Its approved scope is course data and conversation only. Unknown course semantics continue to produce indeterminate validation.

## Limits and lifecycle

- Native requests at most 64 KiB; responses at most 512 KiB; bounded output queue.
- Strict action schemas, at most eight concurrent native requests, bounded RPC queue and 20-second RPC timeout.
- One response at a time, at most 30 tool calls and three proposals per turn, 180-second turn limit.
- Official MCP requests have 15-second timeouts. Course calls retain existing backend schemas, quotas, immutable snapshots, and shared refresh budget. No user prompt causes a full catalog fetch.
- No raw provider errors or diagnostics in Chrome. Failed requests never automatically retry inference.
- Stop, disconnect, logout, and new-chat invalidate pending proposal publication. Native host disconnect terminates the runtime. The pilot has ephemeral chat threads; closing its connection ends that conversation.
- One companion process holds a per-profile lock. Stale locks are recovered only when the recorded process no longer exists.
- Preferences remain local. Sending a chat shares the message, major, selected course codes and planning constraints with OpenAI; no USC login/session or protected student records are needed. Course queries go to the course service.

## Release boundary and next steps

This is a developer pilot requiring Node.js, npm dependencies, a locally running course backend, an unpacked extension, and native-host registration. A signed consumer installer, hosted public backend, Windows support, Claude integration, deterministic optimization, and WebReg coursebin automation remain separate work. Authenticated account/inference tests must be reported separately from mock workflow tests and real signed-out app-server smoke tests.

## Verified references

- [OpenAI app-server authentication, dynamic tools, and transports](https://developers.openai.com/codex/app-server)
- [Official Codex source](https://github.com/openai/codex)
- [Chrome native messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging)
- [Chrome side panel](https://developer.chrome.com/docs/extensions/reference/api/sidePanel)
- [USC ChatGPT Edu and Codex access](https://itservices.usc.edu/ai/chatgpt-edu-at-usc/)
- [USC enterprise AI FAQs](https://itservices.usc.edu/ai/ai-faqs/)

Configuration deviation found during verification: although generated protocol types still include `untrusted`, Codex 0.153.4 rejects that approval policy at startup. Use `on-request` and reject unsupported approval requests in the companion. The real smoke test verifies the effective disabled-feature configuration and accepts a restricted dynamic-tool thread without authenticating or calling a model.
