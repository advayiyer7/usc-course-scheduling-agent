# D-clearance guidance and evidence

Reviewed September 6, 2026 for Fall 2026 (`20263`). This is an editorial directory of official instructions, not an approval service or an exhaustive crawl of every USC webpage. Routing runs locally against a versioned registry. A student's major alone cannot establish which application, cohort, deadline, or clearance applies.

## Meaning of the data

USC's [registration guidance](https://arr.usc.edu/registration-services/) distinguishes R and D sections and warns that their designations can change. The ingested section flag determines `required`, `not_indicated`, or `unknown`; a directory match never sets that flag. Personal approval is always `unknown`. Open seats, departmental permission, prerequisites, holds, registration appointments, and registration itself remain separate facts.

USC's [Academic Exploration and Advising navigation guide](https://academicprograms.usc.edu/wp-content/uploads/2025/08/AEA-Navigation-Guides-D-Clearance.pdf) directs students to their semester's program header for department-specific clearance information. That supports a catalog-directory fallback, not a claim that each header has a working application. The public index retrieved for Fall 2026 had null clearance metadata, so it cannot supply a verified form URL.

The scheduled course identity determines its teaching department. An alias under a different school does not override it. One observed source exception is SOWK, grouped under SWDP/SWKC (campus) and SWDP/SWKO (online) in Fall 2026. The resolver preserves both directory routes and labels the student audience. KSI399 appears under EALC/EASC without a matching scheduled-prefix association; it remains unresolved.

## Coverage audit

The offline audit examined all **245 published school/program pairs across 26 schools**, using the existing public archive and making **zero upstream requests**. It normalized 4,637 scheduled courses:

| Route coverage | Courses |
|---|---:|
| Researched department instructions or advising hub | 3,422 |
| Official semester directory only | 1,214 |
| Unresolved teaching department | 1 |

Of 6,035 distinct sections whose archived flag indicates D-clearance, 4,463 have a department-instruction route. These counts include cancelled sections and are historical source observations. A department-instruction route may be an advising hub, or instructions restricted to a particular student group; coverage does not mean every course has a direct request form.

Reproduce without opening the running development database:

```sh
node --import=tsx scripts/clearance-coverage.ts /path/to/public-archive /path/to/coverage.json 20263
```

The command rejects missing, duplicate, unexpected, and wrong-term program responses. Its output includes every normalized course and per-school counts; keep that bulk artifact outside git. Per-school counts can overlap for cross-listings.

## Updating the directory

The registry contains 27 audience-specific routing entries. Instruction URLs and evidence URLs must use HTTPS on `usc.edu` or a true subdomain, without credentials, query strings, or alternate ports. Link to the official instructions even if that page leads to a third-party form, login, advisor email, or a form requiring a password. Do not copy form passwords or session tokens.

Guidance has its own registry version, verification time and 30-day review date, independent of course snapshot freshness. Overdue entries remain visible with a warning; 30 days is a maintenance target, not a guarantee that deadlines remain open. Researched routes apply only to Fall 2026. Other terms receive the official program directory fallback until researched separately. Research changes are reviewed and released; student requests do not scrape department sites.

Important audience/date distinctions found in the research:

- CSCI/DSCI instructions differ for undergraduate majors, partners/pre-engineering, graduate cohorts and DEN. A historical page list never overrides the actual section flag.
- The EE undergraduate route is specifically for pre-engineering students. The general Viterbi request-manager page explains the service; it is not evidence that a course or request window is open.
- Dornsife's undergraduate directory contains Fall 2026 course/section instructions; graduate students are directed to their program advisor. GE-D is a curriculum category, not a D-clearance designation.
- Roski and Marshall publish deadline-dependent procedures. Students opening a link after the form deadline must follow the later-period instructions on that page.
- Cinema and Thornton have separate rules for majors, nonmajors, electives and graduate/individual instruction. Several options are intentionally shown with explicit audiences.
- Social Work's published automatic-clearance process applies to designated required courses/student groups; it does not establish that a particular student is cleared.

Additional official pages examined but not generalized into automatic course routes:

- [Thornton individual instruction](https://music.usc.edu/students/individual-instruction-d-clearance-request-forms/): applies to designated lessons; course numbers alone are not a safe universal lesson classifier.
- [Thornton minor advising](https://music.usc.edu/students/advising-process-minors/): minor and registration-period-specific steps.
- [Rossier OCL FAQ](https://students.rossier.usc.edu/ocl/faq/): program-specific advisor process, not all EDUC courses.
- [Rossier Education and Society minor](https://rossier.usc.edu/programs/undergraduate/education-and-society-minor/): minor-specific advising process.
- [Annenberg Fall 2026 instructions](https://annenberg.usc.edu/sites/default/files/2026/03/13/d-clearance-fall-26.pdf): dated cohort windows; use the maintained academic forms hub in the UI.

Architecture's candidate D-clearance page could not be retrieved during this check. Architecture, Bovard, Dentistry, Law, most Keck/Mann programs, Rossier, Graduate/Undergraduate Studies and uncovered engineering programs retain directory fallbacks where a specific verified instruction route is absent. These are research gaps, not evidence that clearance is unnecessary.

## Schedule validation boundaries

Every candidate is checked by deterministic code before the companion emits its card. The review separates modeled compatibility, required components, snapshot seats and personal eligibility. Missing/invalid dates, missing meeting times, unresolved identities and variable units remain unknown. A matching USC session code is not proof that meetings share actual dates. Confirmed conflicts require an overlapping date range containing an actual shared meeting weekday; potential weekly overlaps with unknown dates remain unresolved conflicts.

Required lecture/lab/discussion/quiz linking semantics remain unverified and keep component checks indeterminate. Do not bypass those checks based on a plausible-looking selection. Clearance links help the student follow USC's process; they do not submit requests or establish coursebin/registration readiness.

## Routed official sources

Each row was reviewed on September 6, 2026. These are instruction pages, not student approval records.

| Scope | Official source | Audience |
|---|---|---|
| CSCI, DSCI | [Computer Science D-clearance instructions](https://www.cs.usc.edu/students/d-clearance/) | CSCI/DSCI students and students requesting their courses |
| EE ≤499 | [EE pre-engineering registration guidance](https://viterbiundergrad.usc.edu/pre-engineering/registration-d-clearance/) | Pre-engineering students seeking EE courses |
| AME, BME, CE, CSCI, EE, ISE | [Viterbi D-clearance request system information](https://viterbiit.usc.edu/services/information-services/d-clearance-request-manager/) | Students directed to myViterbi by these departments |
| ISE | [Industrial and Systems Engineering clearance guidance](https://ise.usc.edu/current-students/) | ISE and non-ISE undergraduate, master's and doctoral students |
| TAC, ITP | [Technology and Applied Computing registration instructions](https://tac.usc.edu/advisement-original/registration-instructions/) | Students requesting Technology and Applied Computing courses |
| SAE | [Systems Architecting and Engineering student resources](https://sae.usc.edu/graduate-student-resources/) | SAE graduate students |
| DRNS ≤499 | [Dornsife Fall 2026 course clearance directory](https://dornsife.usc.edu/dash/d-clearance-info/) | Students seeking Dornsife undergraduate courses |
| DRNS ≥500 | [Dornsife graduate clearance guidance](https://dornsife.usc.edu/dash/d-clearance-info/) | Students seeking Dornsife graduate courses |
| GESM, FESM, MDA, INDS | [GE office registration and clearance guidance](https://dornsife.usc.edu/ge/registration/) | Students seeking courses administered by the GE office |
| HBIO | [Human Biology student advisement and clearance](https://dornsife.usc.edu/heb/student-advisement/) | Human Biology students seeking advising and upper-division clearance |
| PHYS, ASTR ≤499 | [Physics undergraduate clearance instructions](https://dornsife.usc.edu/physics/undergraduate-office/) | Students seeking Physics and Astronomy undergraduate clearance |
| CNTV, CTAN, CTCS, CTIN, CTPR, CTWR, IML | [Cinematic Arts departmental clearance contacts](https://cinema.usc.edu/degrees/minor/dclearanceContacts.cfm) | Students seeking SCA courses; contact depends on the course prefix and level |
| CNMA | [Cinematic Arts major clearance procedures](https://cinema.usc.edu/studentaffairs/dclearance.cfm) | Cinematic Arts majors |
| CTAN | [CTAN Fall 2026 elective registration update](https://cinema.usc.edu/studentaffairs/animation.cfm) | Students seeking CTAN electives |
| FINE | [Roski Fall 2026 D-clearance instructions](https://roski.usc.edu/d-clearance-for-fall-2026/) | Roski majors, minors, graduate students and non-Roski students |
| PPDP ≤499 | [Price undergraduate D-clearance requests](https://priceschool.usc.edu/students/registration-d-clearance/undergraduate/) | Students requesting undergraduate Price courses |
| PPDP ≥500 | [Price graduate D-clearance requests](https://priceschool.usc.edu/students/registration-d-clearance/graduate/) | Students requesting graduate Price courses |
| BUS, ACTN ≤499 | [Marshall undergraduate registration and clearance](https://students.marshall.usc.edu/current-students/academic-advising/forms-and-other-resources/registration-information-interest-lists) | Students requesting undergraduate business or accounting courses |
| BUS, ACTN ≥500 ≤599 | [Non-Marshall graduate course clearance guidance](https://students.marshall.usc.edu/graduate-students/registration-information/non-marshall-graduate-student-resources/frequently-asked-questions) | Non-Marshall graduate students only |
| ANSC | [Annenberg academic forms and clearance instructions](https://annenberg.usc.edu/current-students/academic-forms) | Annenberg students and students seeking Annenberg courses |
| MUS | [Thornton student affairs and clearance routes](https://music.usc.edu/students/) | Thornton majors, minors and non-Thornton students |
| DANC | [Kaufman student affairs D-clearance forms](https://kaufman.usc.edu/student-affairs/) | Students seeking Dance courses |
| THTR | [Dramatic Arts student services clearance guidance](https://dramaticarts.usc.edu/aso/) | Students seeking Dramatic Arts clearance |
| ACAD ≤499 | [Iovine and Young non-major course guidance](https://iovine-young.usc.edu/learn/undergraduate/academy-non-major-course-offerings) | Non-Academy students seeking undergraduate Academy courses |
| GERO | [Gerontology D-clearance and registration FAQ](https://gero.usc.edu/academics/academic-advisement/advisement-faqs/) | Students seeking Gerontology courses |
| SWDP, NURS | [Social Work and Nursing registration guidance](https://dworakpeck.usc.edu/student-life/enrollment-services/registration-information) | Dworak-Peck students and USC students seeking its courses |
| OCST | [Chan student services and departmental clearance](https://chan.usc.edu/students/student-services) | Students seeking Chan Occupational Science/Therapy courses |
