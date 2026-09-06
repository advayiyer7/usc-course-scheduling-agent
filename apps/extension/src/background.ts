import {
  companionEvent,
  companionRequest,
  NATIVE_HOST,
  trustedLoginUrl,
} from "../../../packages/contracts/src/companion.js";
import { installCoursebinHandler } from "./coursebin/background.js";

installCoursebinHandler();

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
      send({ type: "error", message: "Invalid planner message" });
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
