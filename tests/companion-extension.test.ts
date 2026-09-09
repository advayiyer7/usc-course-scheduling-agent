import { afterEach, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { EXTENSION_ORIGIN } from "../packages/contracts/src/extension.js";
import { PLANNER_RELOAD_REQUIRED } from "../apps/extension/src/companion-errors.js";
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
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.resetModules();
});
it("accepts only our extension page, relays validated actions and terminates the native port on close", async () => {
  const connection = new Event<[ReturnType<typeof port>]>(),
    native = port();
  const connectNative = vi.fn(() => native);
  vi.stubGlobal("chrome", {
    storage: {
      local: {
        get: vi.fn(async () => ({})),
        setAccessLevel: vi.fn(async () => {}),
      },
    },
    action: {
      setBadgeText: vi.fn(async () => {}),
      setBadgeBackgroundColor: vi.fn(async () => {}),
      setTitle: vi.fn(async () => {}),
    },
    alarms: { create: vi.fn(), onAlarm: { addListener: vi.fn() } },
    sidePanel: { setPanelBehavior: vi.fn(async () => {}) },
    runtime: {
      id: EXTENSION_ORIGIN.split("://")[1],
      getURL: (path: string) => `${EXTENSION_ORIGIN}/${path}`,
      onConnect: connection,
      onMessage: { addListener: vi.fn() },
      onStartup: { addListener: vi.fn() },
      onInstalled: { addListener: vi.fn() },
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
  const invalidId = randomUUID();
  ui.onMessage.emit({ id: invalidId, method: "exec", command: "unsafe" });
  expect(native.postMessage).not.toHaveBeenCalled();
  expect(ui.postMessage).toHaveBeenCalledWith({
    type: "reply",
    id: invalidId,
    ok: false,
    error: PLANNER_RELOAD_REQUIRED,
  });
  expect(ui.disconnect).not.toHaveBeenCalled();
  const incompatibleId = randomUUID();
  ui.onMessage.emit({
    id: incompatibleId,
    method: "status",
    unsupported_new_field: true,
  });
  expect(ui.postMessage).toHaveBeenCalledWith({
    type: "reply",
    id: incompatibleId,
    ok: false,
    error: PLANNER_RELOAD_REQUIRED,
  });
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
it("rejects a correlated schema failure immediately without timing out or losing the native connection", async () => {
  vi.useFakeTimers();
  const native = port();
  vi.stubGlobal("chrome", { runtime: { connect: () => native } });
  const { CompanionClient } =
    await import("../apps/extension/src/companion-client.js");
  const disconnected = vi.fn();
  const client = new CompanionClient(vi.fn(), disconnected);
  const pending = client.request({ method: "status" });
  const rejection = expect(pending).rejects.toThrow(PLANNER_RELOAD_REQUIRED);
  const id = native.postMessage.mock.calls[0]![0].id;
  native.onMessage.emit({
    type: "reply",
    id,
    ok: false,
    error: PLANNER_RELOAD_REQUIRED,
  });
  await rejection;
  await vi.advanceTimersByTimeAsync(60001);
  expect(disconnected).not.toHaveBeenCalled();
  expect(native.disconnect).not.toHaveBeenCalled();
  const next = client.request({ method: "status" });
  native.onMessage.emit({
    type: "reply",
    id: native.postMessage.mock.calls[1]![0].id,
    ok: true,
  });
  await expect(next).resolves.toBeUndefined();
  client.close();
});
it.each(["Invalid planner message", "Invalid companion request"])(
  "recognizes the legacy uncorrelated %s and cancels pending timers without disconnecting",
  async (message) => {
    vi.useFakeTimers();
    const native = port();
    vi.stubGlobal("chrome", { runtime: { connect: () => native } });
    const { CompanionClient } =
      await import("../apps/extension/src/companion-client.js");
    const events = vi.fn(),
      disconnected = vi.fn();
    const client = new CompanionClient(events, disconnected);
    const first = client.request({ method: "status" });
    const second = client.request({ method: "stop" });
    const rejections = [
      expect(first).rejects.toThrow(PLANNER_RELOAD_REQUIRED),
      expect(second).rejects.toThrow(PLANNER_RELOAD_REQUIRED),
    ];
    native.onMessage.emit({ type: "error", message });
    await Promise.all(rejections);
    expect(events).toHaveBeenCalledWith({
      type: "error",
      message: PLANNER_RELOAD_REQUIRED,
    });
    await vi.advanceTimersByTimeAsync(60001);
    expect(disconnected).not.toHaveBeenCalled();
    expect(native.disconnect).not.toHaveBeenCalled();
    expect(native.postMessage).toHaveBeenCalledTimes(2); // No automatic resend/inference.
    client.close();
  },
);
it("does not confuse ordinary assistant errors with transport schema rejection", async () => {
  vi.useFakeTimers();
  const native = port();
  vi.stubGlobal("chrome", { runtime: { connect: () => native } });
  const { CompanionClient } =
    await import("../apps/extension/src/companion-client.js");
  const events = vi.fn(),
    disconnected = vi.fn();
  const client = new CompanionClient(events, disconnected);
  const pending = client.request({ method: "status" });
  native.onMessage.emit({
    type: "error",
    message: "Course source is temporarily unavailable.",
  });
  await vi.advanceTimersByTimeAsync(1000);
  expect(events).toHaveBeenCalledWith({
    type: "error",
    message: "Course source is temporarily unavailable.",
  });
  native.onMessage.emit({
    type: "reply",
    id: native.postMessage.mock.calls[0]![0].id,
    ok: true,
  });
  await expect(pending).resolves.toBeUndefined();
  expect(disconnected).not.toHaveBeenCalled();
  client.close();
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
