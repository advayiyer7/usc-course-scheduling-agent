# Run the local AI companion pilot

The Chrome side panel talks to a small companion process on your computer. The companion uses the pinned Codex runtime (`@openai/codex` 0.153.4) and the local course backend to help propose schedules. This pilot requires a source checkout, Node.js 24 or 26, npm, and Google Chrome on macOS or Linux. Windows, signed consumer installers, and extension-store distribution are not supported by this installer.

Use a ChatGPT account with Codex access. USC ChatGPT Edu membership does **not** automatically enable Codex: USC ITS says to request access through a ServiceNow ticket, with department approval. See [USC's ChatGPT Edu access guidance](https://itservices.usc.edu/ai/chatgpt-edu-at-usc/) and [ITS's Codex eligibility FAQ](https://itservices.usc.edu/ai/ai-faqs/). Signing in successfully does not guarantee the account has the needed entitlement or available usage.

## Build and connect Chrome

Run these commands from the repository root, using your normal user account:

```sh
npm ci
npm run build
npm run companion:install
```

The installer checks for the built companion and the pinned runtime. It registers the native host `edu.usc.course_planner` for your user account. It does not sign you in or open a browser. Keep this checkout and the Node executable at their installed locations; the launcher uses absolute paths. After moving the checkout or replacing Node, rebuild and run the installer again.

1. Open Chrome's Extensions page (`chrome://extensions`) and enable **Developer mode**.
2. Select **Load unpacked**, then select `apps/extension/build` inside this checkout.
3. Confirm the extension ID is `hcihcmbmpmfdihdgejlclbaegnhgjhdk`. Only this extension is allowed to connect to the companion.
4. Open the extension's side panel using its toolbar action.

The Chrome host locations and allowed-origin format follow [Chrome's native messaging documentation](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging). The installer creates only the registration and launcher; uninstall keeps the account profile.

| File | Location |
|---|---|
| Launcher | `~/.usc-course-planner/bin/native-host.sh` |
| macOS Chrome registration | `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/edu.usc.course_planner.json` |
| Linux Chrome registration | `${XDG_CONFIG_HOME:-~/.config}/google-chrome/NativeMessagingHosts/edu.usc.course_planner.json` |
| Separate companion account profile | `~/.usc-course-planner/codex` |

For Chrome for Testing or a custom Chrome user data directory, specify the browser's **user data root**, not its `Default` or `Profile 1` subdirectory:

```sh
npm run companion:install -- --chrome-user-data-dir "/absolute/path/to/Chrome user data"
```

The default registration targets stable Google Chrome. Custom roots are supported as an installer option; they do not establish that every browser/channel has been tested. Use the same custom root when uninstalling. Each custom root gets its own launcher with a path-derived suffix in `~/.usc-course-planner/bin`, so removing it preserves the default Chrome connection.

## Start the course service and sign in

Prepare a semester using the ingestion or historical-import steps in [local setup](local-setup.md), then keep the course backend running in a terminal:

```sh
npm run dev
```

The backend serves public course data at `http://127.0.0.1:3000`. The companion does not replace it. If using the default embedded database, stop the backend before importing data; do not open the same embedded database from multiple processes.

In the extension side panel, choose the sign-in action and complete the official OpenAI sign-in flow opened in the browser. Return to the panel after completion. Authentication stays in the companion's separate local profile. Never paste a password, token, browser cookie, or USC registration credential into the planner chat.

Choose the term, courses and time preferences, then ask the companion to propose a schedule. Review section IDs, times and validation findings before applying a proposal. Missing USC component/linking rules or meeting dates still leave registration validity unresolved; a proposal does not enroll you or reserve a seat.

Use **Stop** to interrupt a running response, **Reset** to start a new conversation, and **Sign out** to end the companion account session. Reset is not account sign-out or secure deletion of local history. See the panel's actual labels if they differ in your build.

## Account data and removal

The companion uses `~/.usc-course-planner/codex`, separately from any existing Codex app/CLI profile. Treat it as private: it may contain account credentials and conversation records. Do not commit, upload, or attach that directory to bug reports. Messages and selected planning context are sent to the account's AI service when you use the companion; they are not confined to your computer.

To remove the Chrome connection, close the side panel and run:

```sh
npm run companion:install -- --uninstall
```

For a custom browser root, add the same `--chrome-user-data-dir` argument used during installation. Uninstall removes only an owned host manifest and launcher, and leaves the companion profile, account data, course database, and extension preferences in place. Sign out in the panel first if you also want to end the account session. Remove the unpacked extension from Chrome separately. Uninstall can run without a built companion or installed Codex runtime, provided Node and the installer command itself remain available.

The installer refuses to overwrite or delete an unrelated, modified, or linked registration/launcher. If it reports a conflict, inspect the named file and preserve any unrelated configuration before resolving the collision. A file that merely includes the planner's name is not sufficient proof of ownership.

## Troubleshooting

| Symptom | Check |
|---|---|
| Native host not found | Run the installer as the same OS user running Chrome; confirm the correct browser user data root and extension ID, then reload the extension. |
| Native host cannot start | Run `npm ci`, `npm run build`, and the installer again. Check whether the repository or Node installation moved. |
| Course service unavailable | Start `npm run dev` and confirm semester data was imported. |
| Signed in but AI requests fail | Check Codex entitlement, organization approval, network connectivity and account usage limits. |
| Reinstall/uninstall reports a collision | Review the exact path in the error; the installer will preserve files it cannot identify as its own. |

The installer tests use temporary directories and a synthetic host to check macOS/Linux path selection, shell argument forwarding, ownership and uninstall behavior. Real Chrome native-host operation and account sign-in must be verified with the complete companion build; passing installer tests alone does not establish end-to-end compatibility.
