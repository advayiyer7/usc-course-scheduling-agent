# WebReg authentication feasibility

Investigated September 6, 2026 (Pacific). This is a read-only investigation, not an implemented registration service or an endorsement of an unofficial integration by USC.

## Result

Authenticated HTTP reads work in an existing browser session. WebReg uses a federated interactive sign-in followed by an application authentication cookie. A lightweight worker that reuses a valid WebReg session is technically plausible, but **standalone HTTP-client reuse, cloud portability, session lifetime and registration submissions remain unverified**.

Do not budget on the assumption that storing a student's password creates permanent API access. Public course search already uses our central source adapter without student authentication.

## Observed authentication flow

```mermaid
sequenceDiagram
    participant B as Student browser
    participant W as WebReg
    participant M as Microsoft identity platform
    participant U as USC Shibboleth / sign-in
    B->>W: GET /auth/login
    W-->>B: Redirect with OIDC state and correlation cookies
    B->>M: Authorization-code request
    M-->>B: Federated SAML sign-in handoff
    B->>U: Interactive USC sign-in
    Note over B,U: Student completes authentication; agent reads no password
    U-->>B: Identity-provider response
    B->>M: Complete federated authentication
    B->>W: POST /signin-oidc
    W-->>B: WebReg authentication cookies
    B->>W: Authenticated HTTP reads
```

The diagram summarizes observed browser navigation and public protocol parameters; it does not describe USC's private server-to-server token exchange. The agent did not submit credentials, answer MFA, intercept authentication codes for reuse or invoke an enrollment operation.

### Evidence

| Check                                                               | Observed result                                                                                                                                                   | Meaning and limits                                                                                                                                                     |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Standalone Python HTTP client, no student session: `GET /CourseBin` | HTTP 302 to Microsoft's tenant authorization endpoint                                                                                                             | The page requires authentication. Following redirects blindly could end on a login page with HTTP 200.                                                                 |
| Standalone client: `GET /Login`                                     | HTTP 200; sign-in link goes to `/auth/login`                                                                                                                      | The login landing page itself does not establish authenticated access.                                                                                                 |
| Fresh login challenge                                               | `response_type=code`, `response_mode=form_post`, `scope=openid profile`, callback `https://webreg.usc.edu/signin-oidc`                                            | This is WebReg's own OIDC login, not a documented delegated registration API for our app. No `offline_access` scope was present in this observed request.              |
| Fresh login correlation cookies                                     | `.AspNetCore.OpenIdConnect.Nonce.<dynamic>` and `.AspNetCore.Correlation.<dynamic>`; Secure, HttpOnly, SameSite=None, path `/signin-oidc`                         | Login depends on correlated state, not just a username/password sent to a course endpoint. These temporary cookies are not the authenticated application session.      |
| Browser sign-in navigation                                          | Microsoft authorization → USC Shibboleth → `login.usc.edu/login/login`; password form targets `/login/authuserpassword`                                           | Interactive federated authentication. Password fields were identified by name/type only; their values were not read.                                                   |
| Sign-in completion                                                  | `POST /signin-oidc` returned 302; `/CourseBin` initially redirected to `/Terms`                                                                                   | Successful identity authentication and semester selection are separate steps.                                                                                          |
| Application cookies set by callback                                 | `course-registration-auth-local`, plus chunks `course-registration-auth-localC1` and `course-registration-auth-localC2`; Secure, HttpOnly, SameSite=Lax, path `/` | WebReg issued chunked application authentication cookies. Cookie values were excluded from research output and files.                                                  |
| Cookie persistence attributes                                       | No Expires or Max-Age on those application cookies                                                                                                                | Does **not** establish the server-side ticket's lifetime, sliding renewal behavior, or survival after browser restart. Do not infer a timeout from framework defaults. |
| Browser HTTP `GET /Terms`, with session                             | HTTP 200, expected term page and authenticated navigation                                                                                                         | Read succeeded without a page navigation.                                                                                                                              |
| Same request with `credentials: omit`                               | Browser reported an opaque redirect                                                                                                                               | Authentication mattered; the standalone signed-out request established the actual redirect destination separately.                                                     |
| Normal observed Fall 2026 term-selection link                       | `/Terms?term=20263&handler=TermSelect` led to `/Departments`                                                                                                      | A fresh session needs semester context before term-specific pages. Only the test session's view context was selected.                                                  |
| Browser HTTP `GET /CourseBin`, with session                         | HTTP 200, expected authenticated Fall 2026 page                                                                                                                   | An ordinary HTTP read can retrieve the coursebin without rendering it. No private bin contents were saved in this report.                                              |
| Same coursebin request with credentials omitted                     | Opaque redirect                                                                                                                                                   | Public clients cannot retrieve the coursebin using its URL alone.                                                                                                      |
| Coursebin form structure                                            | POST forms include `__RequestVerificationToken`                                                                                                                   | A client must understand current form/security state. Actual server-side token enforcement was not tested with mutation requests.                                      |
| Browser HTTP section lookup at `/Courses?Section=…`                 | HTTP 200, authenticated page with anti-forgery fields                                                                                                             | Authenticated section-page retrieval works; this was not an add or registration test.                                                                                  |

Existing adapter code also recognizes the original coursebin add form and its `/api/section/{term}/{section}/add` AJAX target. This investigation did not invoke it. Form metadata is evidence of a request contract, not a claim that an endpoint is a supported third-party API.

## What this means for the proposed architecture

1. **Public course data:** keep the existing centrally cached source adapter. No USC account is needed for our current catalog queries.
2. **Interactive sign-in:** the student completes USC's normal authentication. Our service cannot use WebReg's client registration as if it owned it or assume a token issued for another application authorizes registration.
3. **Session execution:** a future HTTP worker would need the correct application session, semester context, current anti-forgery state and an exact approved operation. Normal page JavaScript cannot read HttpOnly authentication cookies. Copying a session out of the browser would be a deliberate change to today's browser-only credential boundary, not something already implemented by the extension.
4. **Refresh and expiry:** session expiry must yield a sign-in-required result. An identity-provider SSO session might enable reauthentication, but its availability and portability must be tested; it is not a permanent refresh credential for our application.
5. **Enrollment:** validate the entire pending transaction and verify actual enrollment afterward. USC's guide states that checkout includes all classes marked Scheduled but Not Registered. Do not interpret a generic HTTP success or an add-to-bin response as enrollment success.

A reusable password or session credential cannot be recovered from a one-way hash. Hashing is appropriate when our own service verifies a supplied password; recoverable third-party secrets would require encryption and managed key access. Avoid collecting USC passwords. Session material still grants account access and would require isolation, narrow executor access, deletion/revocation controls and exclusion from logs, recordings, fixtures and LLM context.

## Remaining feasibility tests

| Test                                                                           | Status / required evidence                                                                                                |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| Use one authenticated session for a standalone HTTP client's read-only request | **Not performed.** Browser cookies were not exported to a separate client. Browser `fetch` success is not this proof.     |
| Reuse from an actual hosting region / different network                        | **Not performed.** No cloud infrastructure was provisioned and no student session was sent to a cloud service.            |
| Observe idle expiry, renewal, restart and logout/revocation                    | **Not measured.** The student session was not deliberately expired or logged out.                                         |
| Identify the minimum authentication and semester state needed                  | **Incomplete.** Cookie attributes and page behavior were observed, but cookies were not removed individually or replayed. |
| Confirm permitted delegated access with USC                                    | **Unresolved.** No documented public registration delegation was established.                                             |
| Validate mutation, checkout, partial failure and response-loss handling        | **Not performed.** Separate implementation and an exact student-authorized enrollment test are required.                  |
| Measure cost and concurrency                                                   | **Not performed.** No throughput or monthly cost claim follows from these read-only checks.                               |

The next technical experiment would be a bounded, read-only session-client portability test with an explicit session-handling design. Keep its secrets out of model/tool arguments and files, return only status and page-shape checks, allow only observed USC read routes, and discard the session at completion. Until that test succeeds, retain the existing browser-only coursebin execution boundary.

## Research boundaries and sources

The user's ordinary Chrome session was observed through its UI. Its Apple Events JavaScript setting was disabled and was not changed. A separate diagnostic browser session was used for HTTP comparisons after student sign-in. Captured response headers were reduced in memory to cookie names and attributes; raw cookie values and authentication response bodies were not retained in repository artifacts. No student course list, password, security-token value, HAR, browser profile or credential file was committed. No add, drop, grade update, registration or checkout submission was issued by the investigation.

- [USC WebReg login](https://webreg.usc.edu/Login) and live read-only behavior described above.
- [USC registration guide](https://arr.usc.edu/web-registration/): coursebin versus enrollment and checkout scope.
- [Microsoft authorization-code flow](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow): application-specific redirect URIs, authorization and token exchange.
- [Microsoft password grant limitations](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth-ropc): password-only ROPC is incompatible with MFA, and federation introduces further restrictions. This does not establish USC's private tenant configuration; no password-grant request was attempted.
- [ASP.NET Core cookie authentication](https://learn.microsoft.com/en-us/aspnet/core/security/authentication/cookie): cookie persistence and authentication-ticket lifetime are different concerns. Framework examples do not establish USC settings.
- [OWASP password storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html): hashing versus recoverable encryption.
- [OWASP CSRF prevention](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html): session-bound and per-request security tokens.
