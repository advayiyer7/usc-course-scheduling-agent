import {
  companionEvent,
  companionRequest,
  NATIVE_HOST,
  trustedLoginUrl,
} from "../../../packages/contracts/src/companion.js";
import { installCoursebinHandler } from "./coursebin/background.js";
import { installAlertBadge } from "./alerts/background.js";
import { installCheckoutReviewHandler } from "./checkout/background.js";
import { z } from "zod";
import {
  LEGACY_INVALID_PLANNER_MESSAGE,
  PLANNER_RELOAD_REQUIRED,
} from "./companion-errors.js";

const requestIdentity = z.object({ id: z.string().uuid() });

installCoursebinHandler();
installCheckoutReviewHandler();
installAlertBadge();
void chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });

void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
let current: chrome.runtime.Port | undefined;
chrome.runtime.onConnect.addListener((ui) => {
  if (
    ui.name !== "usc-companion-ui" ||
    ui.sender?.id !== chrome.runtime.id ||
    ui.sender.url !== chrome.runtime.getURL("index.html")
  ) {
    ui.disconnect();
    return;
  }
  if (current) {
    ui.postMessage({
      type: "error",
      message:
        "A planner chat is already open. Close its window before connecting here.",
    });
    ui.disconnect();
    return;
  }
  current = ui;
  let native: chrome.runtime.Port;
  let disconnected = false;
  const send = (value: unknown) => {
    if (!disconnected) {
      try {
        ui.postMessage(value);
      } catch {
        /* UI closed. */
      }
    }
  };
  try {
    native = chrome.runtime.connectNative(NATIVE_HOST);
  } catch {
    current = undefined;
    send({ type: "error", message: "Install the companion, then reconnect." });
    ui.disconnect();
    return;
  }
  native.onMessage.addListener((raw: unknown) => {
    const parsed = companionEvent.safeParse(raw);
    if (!parsed.success) {
      send({
        type: "error",
        message: "Companion version mismatch. Rebuild and reconnect.",
      });
      native.disconnect();
      return;
    }
    if (parsed.data.type === "login" && !trustedLoginUrl(parsed.data.url)) {
      send({ type: "error", message: "Unexpected sign-in address rejected." });
      return;
    }
    send(parsed.data);
  });
  native.onDisconnect.addListener(() => {
    const failed = Boolean(chrome.runtime.lastError);
    send({
      type: "error",
      message: failed
        ? "Could not connect to the installed companion. Check setup, close other planner sessions, then reconnect."
        : "Companion disconnected. Reconnect to start a new chat.",
    });
    if (current === ui) current = undefined;
    ui.disconnect();
    disconnected = true;
  });
  ui.onMessage.addListener((raw: unknown) => {
    const parsed = companionRequest.safeParse(raw);
    if (!parsed.success) {
      const identity = requestIdentity.safeParse(raw);
      if (identity.success) {
        // Settle the exact caller now. A bare error leaves its timeout armed.
        send({
          type: "reply",
          id: identity.data.id,
          ok: false,
          error: PLANNER_RELOAD_REQUIRED,
        });
      } else {
        // No usable correlation ID; clients can still recognize this legacy diagnostic.
        send({ type: "error", message: LEGACY_INVALID_PLANNER_MESSAGE });
      }
      return;
    }
    try {
      native.postMessage(parsed.data);
    } catch {
      send({
        type: "reply",
        id: parsed.data.id,
        ok: false,
        error: "Companion disconnected. Reconnect to continue.",
      });
    }
  });
  ui.onDisconnect.addListener(() => {
    disconnected = true;
    if (current === ui) current = undefined;
    native.disconnect();
  });
});
