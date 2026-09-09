import {
  CHECKOUT_CHANNEL,
  checkoutInspection,
  checkoutReview,
  checkoutUiRequest,
} from "../../../../packages/contracts/src/checkout.js";
import {
  codeOf,
  CoursebinError,
  WEBREG_ORIGIN,
} from "../../../../packages/contracts/src/coursebin.js";
import { withWebregReview } from "../coursebin/background.js";
import { preflight } from "../coursebin/preflight.js";
import { assessCheckout } from "./assess.js";

export function installCheckoutReviewHandler() {
  chrome.runtime.onMessage.addListener((raw: unknown, sender, respond) => {
    if (
      sender.id !== chrome.runtime.id ||
      sender.tab ||
      sender.url !== chrome.runtime.getURL("index.html") ||
      typeof raw !== "object" ||
      raw === null ||
      !("channel" in raw) ||
      raw.channel !== CHECKOUT_CHANNEL
    )
      return;
    const request = checkoutUiRequest.safeParse(raw);
    if (!request.success) {
      respond({ ok: false, code: "VALIDATION_BLOCKED" });
      return;
    }
    void withWebregReview(async () => {
      const { proposal, context } = request.data;
      const tabs = await chrome.tabs.query({
        active: true,
        lastFocusedWindow: true,
      });
      const tab = tabs[0];
      const url = `${WEBREG_ORIGIN}/Checkout`;
      if (
        tabs.length !== 1 ||
        tab?.id === undefined ||
        tab.url !== url ||
        tab.pendingUrl
      )
        throw new CoursebinError("LOGIN_REQUIRED");
      const checked = await preflight(proposal, context);
      let timeout: ReturnType<typeof setTimeout> | undefined;
      const rawInspection = await Promise.race([
        chrome.tabs.sendMessage(
          tab.id,
          {
            channel: CHECKOUT_CHANNEL,
            method: "inspect",
            term_code: checked.selection.term_code,
          },
          { frameId: 0 },
        ),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(
            () => reject(new CoursebinError("UI_CHANGED")),
            15000,
          );
        }),
      ]).finally(() => clearTimeout(timeout));
      if (rawInspection?.ok === false)
        throw new CoursebinError(
          rawInspection.code === "WRONG_SEMESTER"
            ? "WRONG_SEMESTER"
            : rawInspection.code === "LOGIN_REQUIRED"
              ? "LOGIN_REQUIRED"
              : "UI_CHANGED",
        );
      const live = checkoutInspection.parse(rawInspection);
      const after = await chrome.tabs.get(tab.id);
      if (
        after.url !== url ||
        after.pendingUrl ||
        live.transaction.term_code !== checked.selection.term_code
      )
        throw new CoursebinError("STATE_CHANGED");
      return checkoutReview.parse({
        mode: "read_only",
        checked_at: new Date().toISOString(),
        expires_at: Date.now() + 60000,
        transaction: live.transaction,
        blockers: [
          ...checked.blockers,
          ...assessCheckout(
            live.transaction,
            live.bin,
            checked.selection.section_ids,
          ),
        ],
        warnings: [
          ...checked.warnings.filter((w) => w.code !== "eligibility"),
          {
            code: "eligibility",
            message:
              "Public course data cannot verify your individual clearance, prerequisites, holds or registration appointment.",
          },
          {
            code: "review_only",
            message:
              "This is a read-only inspection of the recognized registration list. Units and grade options are shown as WebReg displays them. It does not authorize or submit checkout; changes in another tab or an unverified pending operation can invalidate this review.",
          },
        ],
      });
    }).then(
      (review) => respond({ ok: true, review }),
      (error) => respond({ ok: false, code: codeOf(error) }),
    );
    return true;
  });
}
