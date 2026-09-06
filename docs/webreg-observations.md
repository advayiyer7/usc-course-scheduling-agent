# WebReg adapter evidence — September 6, 2026

Read-only inspection in the student's already authenticated Chrome session, through the native browser UI and DevTools DOM inspection. No add, schedule, remove, grade-option, registration, checkout, logout or semester-change action was invoked. No student records, page dumps, hidden-field values or tokens were saved.

## Verified workflow

| Surface | Observed behavior / boundary |
| --- | --- |
| Current semester | Navigation anchor `a[href="/Departments"]` reads `Fall 2026 Classes`. Semester menu links include `/terms?handler=TermSelect&term=20263`, Summer `20262`, Spring `20261`. The adapter checks the displayed semester; the student changes it themselves. |
| Signed-in navigation | `/auth/logout` and `/CourseBin` anchors are present. The adapter only checks their presence, never follows logout or reads account identity. |
| Course lookup | `/Search` exposes CourseID and Section# fields. Searching CSCI-104 navigated to `/Courses?Course=CSCI-104`; searching public section 29903 navigated to `/Courses?Section=29903` and returned that one section. |
| Course expansion | Anchor fragment `#courseBin_CSCI-104` opens `div#courseBin_CSCI-104`. It contains `.section_crsbin` rows. Direct `.section_row` children have labels including `Section:`, `Type:`, `Registered:`. |
| Exact addition | `button.add-to-course-bin#submit-add-29903`, text `Add to myCourseBin`, type submit. Its form has `method="post"`, `action="/api/Section/Add"`, `data-ajax="true"`, `data-ajax-method="Post"`, `data-ajax-url="/api/section/20263/29903/add"`. The adapter must verify the corresponding term and section before clicking the actual button. It does not call this endpoint directly. |
| Form security | Form elements include the submit button and a hidden request-verification field. Its value was not inspected. WebReg's own handler submits the original form; the extension never reads hidden-field values or constructs authenticated request bodies. |
| Add feedback | Page handler `disableAddCourseBin` disables the button and applies `processing`. `handleAddCourseBin` uses `#result-{id}` and `#submit-add-{id}`. HTTP 200 changes button text to `Added to Course Bin`; otherwise it shows `Error Adding to Course Bin` and re-enables the button. This code was inspected, **not executed in a live addition**. A message/HTTP status alone does not verify a coursebin change. |
| Coursebin | `/CourseBin`, heading `myCourseBin` (h3), `.section_crsbin` rows under `div[id^="courseBin_"]`. Rows include unrelated registered courses. Four `.dvSRtxt` nodes encode `sched{Y\|N}_reg{Y\|N}_status_{id}`. Exactly one has inline `display: block`; others have `display: none`. Preserve each existing section and both status flags. |
| Dangerous controls | Bin rows also contain hidden Schedule, Remove, Register, Drop and Update controls. Never select an action by row position, generic button class, or first text match. The adapter may click only the verified listing's exact add button and the course expansion anchor. |
| Capacity / clearance | Rows display numeric `registered of total` or `Closed`; section label ends in R or D. The adapter can block a missing/full section and report D as a warning. The flag does not establish individual clearance or eligibility. |

## Unknowns and fail-closed behavior

A subsequent read-only same-origin GET verified that `/CourseBin` returns the same h3 and inline `display` status flags in server-rendered HTML; no scripts need executing to parse its minimal bin state. A GET of the already-observed `/Courses?Section=29903` verified the fragment `#courseBin_CSCI-104` and exact `disableAddCourseBin('29903')` / `handleAddCourseBin(xhr, status, '29903')` form callbacks. Only these public structural attributes were inspected, not hidden values.

- Listing a multi-component course exposes separate lecture/lab/quiz add buttons, but no authoritative required-component or linking rule. This is **not** proof that an arbitrary combination is valid. The main validation task owns these rules; unresolved `component_rules` and failed/unknown `time_conflict` block execution.
- Live success, actual new-row scheduled status, rejection bodies, D-clearance dialogs, partial completion, session expiry and an empty coursebin were not exercised. Synthetic fixtures test handling, not claims about unseen WebReg states. An unrecognized layout, status, form, error or response is reported as changed UI / unconfirmed and stops the run.
- No use of registration or checkout is implemented. No automatic replacement schedule, removal, section substitution, grade change or semester switch is permitted.
- A live mutation check requires the student to choose a concrete schedule and explicitly trigger/authorize that addition. Inspection authorization is not mutation authorization.

## Ownership and integration

Agreed with **Plan USC course scheduling agent**: this feature owns new coursebin contracts, adapter/controller/UI/tests/docs, extension background/manifest/build integration. The main task owns validator, additive review/clearance schemas and its `ScheduleReview` component. ChatPanel integration is a separate per-card block; review rendering belongs to the main task. Work starts at `a656fb4` on isolated branch `feature/student-coursebin`.
