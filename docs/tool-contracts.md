# Initial tool contracts

The six initial tools are implemented for local development; limits below describe that implementation. MCP and REST call the same domain functions. Validate inputs in code. Tool descriptions must explain unknown fields and freshness limitations.

## Shared response envelope

Every successful result includes `data` and `meta` with `term_code`, `snapshot_version`, `checked_at`, `fetch_interval`, `stale`, `coverage_status` and `warnings`. Use nullable term fields for term-list results. If records have different ages, include record-level timestamps and the oldest checked-at value in the envelope. `checked_at` describes retrieval time, not a guarantee of when USC last updated its source.

For bounded course/section lookups, refresh-request responses and schedule validation, freshness covers the records used by that result. Validation includes requested course records, selected sections and their owning courses. The envelope reports their oldest observation and the interval through the newest observation; a targeted update does not inherit unrelated old catalog timestamps. Mixed or cross-listed evidence retains its oldest relevant timestamp. If a requested course/section is missing, metadata conservatively falls back to whole-snapshot evidence rather than dating absence from a fresh partial hit. Term lists and broad searches retain whole-catalog freshness. Coverage status still describes snapshot completeness, independently of freshness. Old pinned versions remain old; queuing or failing a refresh never changes their evidence.

Use structured errors: `INVALID_INPUT`, `TERM_UNAVAILABLE`, `SNAPSHOT_UNAVAILABLE`, `SNAPSHOT_EXPIRED`, `NOT_FOUND`, `RATE_LIMITED`, `SOURCE_UNAVAILABLE`, `VALIDATION_INDETERMINATE`. Include actionable messages and `retry_after_seconds` when appropriate. Never fabricate an empty success on failure.

## Tools

| Tool | Input | Output and bounds |
|---|---|---|
| `list_terms` | Optional `include_archived` | Available ingested terms and coverage; active/archive classification is not yet applied |
| `search_courses` | `term_code`, `query`, optional program filter, cursor, limit | Summaries and next cursor; default 20, maximum 50 results; no full section dump |
| `get_courses` | `term_code`, `course_codes[]`, optional `snapshot_version` | Descriptions, units, requirement structures, aliases, per-code found/not-found results; maximum 20 codes |
| `get_sections` | `term_code`, `course_codes[]`, optional `snapshot_version`, cursor, limit | All section types, meetings, instructors, seat data, flags and raw link metadata; maximum 20 codes and 100 sections per page |
| `validate_schedule` | `term_code`, `snapshot_version`, `requested_courses[]`, `section_ids[]`, `constraints` | Feasibility findings, overlaps, component checks, missing facts and unit totals; maximum 20 courses and 100 sections |
| `request_refresh` | `term_code`, `course_codes[]` | Existing or queued job reference and current freshness; maximum 20 codes; globally budgeted and coalesced, never an immediate-freshness promise |

`constraints` contains hard unavailable time blocks, optional required earliest/latest times and unit limits, and separately named soft preferences such as preferred instructors or fewer campus days. Times use the term's local timezone. Validate day/time ranges. Do not turn a soft preference into a hard rule silently. Limits above are configurable initial design bounds.

For pagination, the cursor pins the snapshot. Do not silently switch versions between pages. Unknown/stale versions return an explicit error and instructions to refetch.

## Validation result semantics

- `status`: `feasible`, `infeasible`, or `indeterminate` **for modeled scheduling constraints only**.
- `checks`: time conflicts, required course coverage, required section components, units, cancellations, hard preferences and data completeness. Each check has pass/fail/unknown and supporting IDs.
- `eligibility`: independent status; generally `unknown` without student-specific authoritative data.
- `availability`: independent per-section snapshot, timestamp and warning. A full section may be time-compatible but not currently available.
- `summary`: separate `compatibility` and `components` pass/fail/unknown values, `availability` as `seats_reported`/`full`/`unknown`, and `eligibility: unknown`. Compatibility covers modeled constraints other than component rules; it is not enrollment eligibility.
- `preferences`: transparent score components or matched/unmatched preferences; no invented teaching-quality scores.

A missing lab rule, unknown meeting time, or incomplete relevant dataset prevents an unqualified feasible result. `feasible` never means registered or guaranteed eligible. Validation does not mutate a course bin or enrollment.

`get_courses` adds `clearance_guidance`; `get_sections` and validation availability rows add `clearance`. The latter separates the source's requirement flag from personal `approval_status: unknown`. Guidance carries bounded official instruction routes, audiences, source URLs, independent verification/review dates, registry version, coverage and warnings. No student-triggered scraping is needed. See [clearance evidence and coverage](d-clearance.md). An overdue guide or catalog-only route is explicitly labeled; no link is an assurance that an application is open.

Weekly overlaps with missing actual dates produce an unknown `time_conflict`, even when session codes match. A confirmed conflict requires valid overlapping dates with a shared actual weekday. Missing requested records prevent partial unit totals being presented as a complete total. Full seats and D-clearance do not by themselves create a modeled time conflict.

## Browser-only coursebin contract

`packages/contracts/src/coursebin.ts` defines strict extension messages: `prepare` accepts one proposal plus current planning constraints; `execute` accepts only the single-use review ticket; `cancel` and `status` contain no action payload. Only the actual extension side panel can send them. These messages are not REST, MCP or native-companion tools. No message accepts JavaScript, arbitrary URLs, selectors or endpoint names.

Per-section reports carry `added`, `already_present`, `failed` or `unconfirmed`, with bounded failure codes and the proposal/semester/snapshot identity. Only selected-section outcomes may be sent to chat. Authenticated page state and unrelated bin entries stay in the browser. See [coursebin execution policy and integration](coursebin.md), including current required-component, freshness and live-verification gates.

## Future tool, not in the initial contract

The authorized local Codex companion adds `present_schedule` as a client-side dynamic tool, not a new REST/MCP endpoint. It accepts `validate_schedule` inputs plus a bounded title, enforces the planner's current hard constraints, invokes the existing validator, and returns a draft card with the validation envelope. Loading a card requires a student click and another validation against current planner constraints. Neither operation touches WebReg.

`generate_schedules` accepts selected courses and explicit constraints, uses deterministic search/optimization, and returns a small set of validated alternatives. Add it only after component semantics and validator tests are established. Return solver completion/timeout state, scoring criteria and whether optimality was proven. Use jobs for work that exceeds the interactive runtime budget.
