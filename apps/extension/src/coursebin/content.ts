import {
  COURSEBIN_CHANNEL,
  WEBREG_ORIGIN,
  binKey,
  codeOf,
  contentCommand,
  CoursebinError,
  type FailureCode,
} from "../../../../packages/contracts/src/coursebin.js";
import { allowedPage, assertSemester, findAdd, readBin } from "./dom.js";

const documentId = crypto.randomUUID();
const initialUrl = location.href;
let adding = false;
let left = false;
addEventListener("pagehide", () => {
  left = true;
});
function guard(term: number) {
  if (left || location.href !== initialUrl)
    throw new CoursebinError("STATE_CHANGED");
  if (!allowedPage(location.href)) throw new CoursebinError("LOGIN_REQUIRED");
  assertSemester(document, term);
}
async function snapshot(term: number) {
  guard(term);
  // This is the only authenticated fetch: fixed, read-only, same origin, never forwarded.
  const response = await fetch(`${WEBREG_ORIGIN}/CourseBin`, {
    credentials: "same-origin",
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(10000),
  }).catch(() => {
    throw new CoursebinError("LOGIN_REQUIRED");
  });
  if (!response.ok)
    throw new CoursebinError(
      response.status === 401 || response.status === 403
        ? "LOGIN_REQUIRED"
        : "UI_CHANGED",
    );
  const doc = new DOMParser().parseFromString(
    await response.text(),
    "text/html",
  );
  const bin = readBin(doc, term);
  guard(term);
  return bin;
}
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
function visible(element: HTMLElement) {
  return (
    !!element.getClientRects().length &&
    getComputedStyle(element).visibility === "visible"
  );
}
async function add(
  command: Extract<ReturnType<typeof contentCommand.parse>, { method: "add" }>,
) {
  if (adding) throw new CoursebinError("BUSY");
  adding = true;
  try {
    guard(command.term_code);
    if (command.document_id !== documentId || Date.now() > command.expires_at)
      throw new CoursebinError("STATE_CHANGED");
    const url = new URL(location.href);
    if (
      url.pathname !== "/Courses" ||
      url.search !== `?Section=${command.section_id}` ||
      url.hash
    )
      throw new CoursebinError("STATE_CHANGED");
    let controls = findAdd(
      document,
      command.term_code,
      command.section_id,
      command.requested_courses,
    );
    if (!visible(controls.button)) {
      // Only the observed course expansion anchor; never a coursebin action.
      controls.expand.click();
      await pause(450);
      controls = findAdd(
        document,
        command.term_code,
        command.section_id,
        command.requested_courses,
      );
    }
    const before = await snapshot(command.term_code);
    if (binKey(before) !== binKey(command.expected_bin))
      throw new CoursebinError("STATE_CHANGED");
    if (before.entries.some((e) => e.section_id === command.section_id))
      throw new CoursebinError("STATE_CHANGED");
    guard(command.term_code);
    if (Date.now() > command.expires_at)
      throw new CoursebinError("STATE_CHANGED");
    const latest = findAdd(
      document,
      command.term_code,
      command.section_id,
      command.requested_courses,
    );
    if (
      latest.button !== controls.button ||
      latest.signature !== controls.signature ||
      !visible(latest.button) ||
      document.querySelector(".modal.in")
    )
      throw new CoursebinError("UI_CHANGED");
    // The sole mutation site. WebReg retains and submits its own security fields.
    latest.button.click();
    const deadline = Date.now() + 12000;
    while (Date.now() < deadline) {
      guard(command.term_code);
      const message =
        document
          .getElementById(`result-${command.section_id}`)
          ?.textContent?.trim() ?? "";
      // Never relay arbitrary page text (or records) into chat.
      if (/d[ -]?clearance/i.test(message))
        return "D_CLEARANCE" satisfies FailureCode;
      if (/\b(full|closed)\b/i.test(message))
        return "FULL" satisfies FailureCode;
      if (message === "Error Adding to Course Bin")
        return "WEBREG_REJECTED" satisfies FailureCode;
      if (message) return "UNCONFIRMED" satisfies FailureCode;
      if (latest.button.textContent?.trim() === "Added to Course Bin")
        return undefined;
      await pause(250);
    }
    return "UNCONFIRMED" satisfies FailureCode;
  } finally {
    adding = false;
  }
}

chrome.runtime.onMessage.addListener((raw: unknown, sender, respond) => {
  if (
    sender.id !== chrome.runtime.id ||
    sender.tab ||
    (sender.frameId !== undefined && sender.frameId !== 0) ||
    typeof raw !== "object" ||
    raw === null ||
    !("channel" in raw) ||
    raw.channel !== COURSEBIN_CHANNEL
  )
    return;
  const parsed = contentCommand.safeParse(raw);
  if (!parsed.success) {
    respond({ ok: false, code: "UI_CHANGED" });
    return;
  }
  void (async () => {
    try {
      if (parsed.data.method === "inspect")
        respond({
          ok: true,
          document_id: documentId,
          bin: await snapshot(parsed.data.term_code),
        });
      else {
        // Pre-click guard failures are definitive; post-click uncertainty is reconciled by the controller.
        let code: FailureCode | undefined;
        try {
          code = await add(parsed.data);
        } catch (e) {
          code = codeOf(e);
        }
        respond({ ok: true, code });
      }
    } catch (e) {
      respond({ ok: false, code: codeOf(e) });
    }
  })();
  return true;
});
