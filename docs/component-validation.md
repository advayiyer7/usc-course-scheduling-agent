# Required component validation

The first verified profiles cover Fall 2026 (`20263`):

| Scheduled course | Required selection |
| --- | --- |
| EE109 | One Lecture, one Lab, one Quiz |
| CSCI426 | One Lecture |
| SSCI165 | One Lecture, one Lab |

USC's Office of Academic Programs [course-type navigation guide](https://academicprograms.usc.edu/wp-content/uploads/2025/08/AEA-Navigation-Guides-Course-Types.pdf), pages 1–2, instructs students to select one of every listed component type and to respect lecture-specific bundles. Its current [resources page](https://academicprograms.usc.edu/offices-and-units/academic-exploration-advising/tools-and-resources/) links to this guide. The public Fall 2026 records for these three courses list the types above, session `001`, no link codes, and empty course/term/section notes. These observations are separate from a student's bin or enrollment.

The official [SIS scheduling manual](https://itservices.usc.edu/files/2013/11/3.RNR_.U.SCHEDULE_2011JULY.pdf), pages 11–12, distinguishes mode requirements from link groups and explains that a blank LINK field does not pair a particular lecture with a particular lab. **This manual is dated July 2011**; it corroborates the narrowly reviewed unlinked profiles, not a blanket claim that all current API link combinations have been verified. Linked, combined-mode and unusual session configurations remain unresolved. The manual also explains that actual enrollment enforcement depends on the system catalog; this public-data check does not replace USC's registration checks.

## Enforced scope and evidence

`component-policies.ts` records the three profiles and their official sources as policy `usc-unlinked-components-20263-v1`, reviewed September 6, 2026. `checkComponents` requires the same term and sole teaching program, a complete normalized section inventory, all expected types, session `001`, explicit null link codes, and explicitly empty course, term and section registration notes. Any missing provenance, additional teaching program, nonempty instruction, unexpected type/session/link, or incomplete inventory returns `component_rules: unknown`.

Within that scope, missing or duplicate components fail: a lecture alone cannot satisfy EE109, and two labs cannot satisfy one required lab. Cancelled sections remain rejected by the separate cancellation check. Course aliases resolve through the scheduled identity; unrelated courses and semesters remain unknown. The helper uses the complete stored course inventory, not merely the selected sections or one result page.

Normalization preserves `registration_notes` and the full course `section_ids` inventory. Missing notes remain missing, rather than becoming null. Conflicting course/term notes across aliases become unresolved. Previously published snapshots lack this evidence and remain unknown until a new atomic refresh normalizes their raw source records. Old versions are immutable. Nonempty source notes are retained as untrusted text and are not interpreted as executable instructions or silently converted into rules.

Every supported component finding carries its policy version, review date and official source links. REST, MCP, companion cards and browser preflight use the same validator. A passed component finding does not clear time conflicts, stale data, cancelled sections, unknown times, seat availability or personal eligibility. The adapter's existing confirmation and revalidation gates are unchanged.

## Test the local pilot

1. Load the chosen plan into My planner.
2. Use **Refresh data and recheck** after updating the service. It preserves the exact selected IDs while obtaining a newly normalized snapshot.
3. Review Required components and the individual findings. A complete supported combination should pass; removing a required lab or quiz should fail.
4. **Add to coursebin** performs read-only preparation. Review every remaining finding. Do not equate component success with enrollment or a reserved seat.

Fixture tests cover all three profiles, missing and duplicate modes, valid alternative labs, incomplete inventories, missing/nonempty notes, additional programs, new types, linked/mixed-link sections, other sessions/terms/courses, aliases, cancellation, unresolved time conflicts, full seats, source failure rollback, persisted evidence and actual preflight behavior. Source links are schema-validated before rendering.

Installed pilot verification on September 6, 2026 passed with build `d6b4ff3`: after refresh, the unchanged six-section selection showed Required components as Passed and opened the coursebin preview with confirmation enabled. The preview retained date, capacity and clearance warnings. This verified read-only preparation, not a live addition or registration.
