# Initial tool contracts

These are design contracts, not implemented tools. MCP and REST call the same domain functions. Validate inputs in code. Tool descriptions must explain unknown fields and freshness limitations.

## Shared response envelope

Every successful result includes `data` and `meta` with `term_code`, `snapshot_version`, `checked_at`, `fetch_interval`, `stale`, `coverage_status` and `warnings`. Use nullable term fields for term-list results. If records have different ages, include record-level timestamps and the oldest checked-at value in the envelope. `checked_at` describes retrieval time, not a guarantee of when USC last updated its source.

Use structured errors: `INVALID_INPUT`, `TERM_UNAVAILABLE`, `SNAPSHOT_UNAVAILABLE`, `SNAPSHOT_EXPIRED`, `NOT_FOUND`, `RATE_LIMITED`, `SOURCE_UNAVAILABLE`, `VALIDATION_INDETERMINATE`. Include actionable messages and `retry_after_seconds` when appropriate. Never fabricate an empty success on failure.

## Tools

| Tool | Input | Output and bounds |
|---|---|---|
| `list_terms` | Optional `include_archived` | Available ingested terms and coverage; no inferred future offerings |
| `search_courses` | `term_code`, `query`, optional program/units filters, cursor, limit | Summaries and next cursor; default 20, maximum 50 results; no full section dump |
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
- `preferences`: transparent score components or matched/unmatched preferences; no invented teaching-quality scores.

A missing lab rule, unknown meeting time, or incomplete relevant dataset prevents an unqualified feasible result. `feasible` never means registered or guaranteed eligible. Validation does not mutate a course bin or enrollment.

## Future tool, not in the initial contract

`generate_schedules` accepts selected courses and explicit constraints, uses deterministic search/optimization, and returns a small set of validated alternatives. Add it only after component semantics and validator tests are established. Return solver completion/timeout state, scoring criteria and whether optimality was proven. Use jobs for work that exceeds the interactive runtime budget.
