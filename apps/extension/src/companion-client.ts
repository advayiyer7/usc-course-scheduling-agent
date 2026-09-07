import {
  companionEvent,
  type CompanionEvent,
  type CompanionRequest,
} from "../../../packages/contracts/src/companion.js";
import {
  LEGACY_INVALID_PLANNER_MESSAGE,
  LEGACY_INVALID_COMPANION_MESSAGE,
  PLANNER_RELOAD_REQUIRED,
} from "./companion-errors.js";

export class CompanionClient {
  private port: chrome.runtime.Port;
  private pending = new Map<
    string,
    {
      resolve: () => void;
      reject: (e: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private connected = true;
  constructor(
    private onEvent: (event: CompanionEvent) => void,
    private onDisconnect: () => void,
  ) {
    this.port = chrome.runtime.connect({ name: "usc-companion-ui" });
    this.port.onMessage.addListener((raw: unknown) => {
      const parsed = companionEvent.safeParse(raw);
      if (!parsed.success) {
        this.close();
        return;
      }
      const event = parsed.data;
      if (
        event.type === "error" &&
        [
          LEGACY_INVALID_PLANNER_MESSAGE,
          LEGACY_INVALID_COMPANION_MESSAGE,
        ].includes(event.message)
      ) {
        // Older workers do not include the request ID. Fail outstanding calls
        // immediately without dropping the authenticated native connection.
        this.rejectPending(new Error(PLANNER_RELOAD_REQUIRED));
        this.onEvent({ ...event, message: PLANNER_RELOAD_REQUIRED });
        return;
      }
      if (event.type === "reply") {
        const p = this.pending.get(event.id);
        if (p) {
          clearTimeout(p.timer);
          this.pending.delete(event.id);
          if (event.ok) p.resolve();
          else p.reject(new Error(event.error ?? "Companion action failed"));
        }
      }
      this.onEvent(event);
    });
    this.port.onDisconnect.addListener(() => {
      void chrome.runtime.lastError;
      this.finish();
    });
  }
  request(
    request:
      | Omit<Extract<CompanionRequest, { method: "chat" }>, "id">
      | { method: Exclude<CompanionRequest["method"], "chat"> },
  ): Promise<void> {
    if (!this.connected)
      return Promise.reject(new Error("Reconnect the companion first"));
    const id = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new Error("Companion action timed out. Reconnect before retrying."),
        );
        this.close();
      }, 60000);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.port.postMessage({ ...request, id });
      } catch {
        this.finish();
      }
    });
  }
  private finish() {
    if (!this.connected) return;
    this.connected = false;
    this.rejectPending(new Error("Companion disconnected"));
    this.onDisconnect();
  }
  private rejectPending(error: Error) {
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(error);
    }
    this.pending.clear();
  }
  close() {
    this.finish();
    this.port.disconnect();
  }
}
