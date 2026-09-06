import { afterEach, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { EXTENSION_ORIGIN } from "../packages/contracts/src/extension.js";
class Event<T extends unknown[]> {
  listeners: ((...args: T) => void)[] = [];
  addListener = (listener: (...args: T) => void) =>
    this.listeners.push(listener);
  emit(...args: T) {
    for (const listener of this.listeners) listener(...args);
  }
}
function port() {
  const result = {
    name: "usc-companion-ui",
    sender: {
      id: EXTENSION_ORIGIN.split("://")[1],
      url: `${EXTENSION_ORIGIN}/index.html`,
    },
    onMessage: new Event<[unknown]>(),
    onDisconnect: new Event<[]>(),
    postMessage: vi.fn(),
    disconnect: vi.fn(),
  };
  return result;
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});
it("accepts only our extension page, relays validated actions and terminates the native port on close", async () => {
  const connection = new Event<[ReturnType<typeof port>]>(),
    native = port();
  const connectNative = vi.fn(() => native);
  vi.stubGlobal("chrome", {
    sidePanel: { setPanelBehavior: vi.fn(async () => {}) },
    runtime: {
      id: EXTENSION_ORIGIN.split("://")[1],
      getURL: (path: string) => `${EXTENSION_ORIGIN}/${path}`,
      onConnect: connection,
      onMessage: { addListener: vi.fn() },
      connectNative,
    },
  });
  await import("../apps/extension/src/background.js");
  const attacker = port();
  attacker.sender.url = "https://evil.test";
  connection.emit(attacker);
  expect(attacker.disconnect).toHaveBeenCalled();
  expect(connectNative).not.toHaveBeenCalled();
  const ui = port();
  connection.emit(ui);
  expect(connectNative).toHaveBeenCalledWith("edu.usc.course_planner");
  ui.onMessage.emit({ id: randomUUID(), method: "exec", command: "unsafe" });
  expect(native.postMessage).not.toHaveBeenCalled();
  const request = { id: randomUUID(), method: "status" };
  ui.onMessage.emit(request);
  expect(native.postMessage).toHaveBeenCalledWith(request);
  native.onMessage.emit({ type: "login", url: "https://evil.test" });
  expect(ui.postMessage).not.toHaveBeenCalledWith({
    type: "login",
    url: "https://evil.test",
  });
  const second = port();
  connection.emit(second);
  expect(second.disconnect).toHaveBeenCalled();
  ui.onDisconnect.emit();
  expect(native.disconnect).toHaveBeenCalled();
});
it("correlates native replies, surfaces failure and rejects pending messages on disconnect", async () => {
  const native = port();
  vi.stubGlobal("chrome", { runtime: { connect: () => native } });
  const { CompanionClient } =
    await import("../apps/extension/src/companion-client.js");
  const events = vi.fn(),
    disconnected = vi.fn();
  const client = new CompanionClient(events, disconnected);
  const pending = client.request({ method: "login" });
  const request = native.postMessage.mock.calls[0]![0];
  native.onMessage.emit({ type: "reply", id: request.id, ok: true });
  await expect(pending).resolves.toBeUndefined();
  const next = client.request({ method: "status" });
  native.onDisconnect.emit();
  await expect(next).rejects.toThrow("disconnected");
  expect(disconnected).toHaveBeenCalledOnce();
});
