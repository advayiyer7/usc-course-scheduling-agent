import { afterEach, expect, it, vi } from "vitest";
import { CHECKOUT_CHANNEL } from "../packages/contracts/src/checkout.js";
import { EXTENSION_ORIGIN } from "../packages/contracts/src/extension.js";
import { readCheckout } from "../apps/extension/src/checkout/dom.js";
import {
  checkoutBin,
  checkoutContext,
  checkoutDoc,
  checkoutDraft,
} from "./fixtures/checkout.js";

const sender = {
  id: EXTENSION_ORIGIN.split("://")[1]!,
  url: `${EXTENSION_ORIGIN}/index.html`,
};
type Reply = {
  ok: boolean;
  code?: string;
  review?: { mode: string; blockers: { code: string }[] };
};
type Listener = (
  raw: unknown,
  sender: chrome.runtime.MessageSender,
  respond: (value: Reply) => void,
) => boolean | void;
const command = {
  channel: CHECKOUT_CHANNEL,
  method: "review",
  proposal: checkoutDraft,
  context: checkoutContext,
};
async function setup() {
  vi.resetModules();
  let listener!: Listener;
  const tab = { id: 7, url: "https://webreg.usc.edu/Checkout" };
  const validate = vi.fn(async () => ({
    selection: checkoutDraft.selection,
    blockers: [],
    warnings: [],
  }));
  vi.doMock("../apps/extension/src/coursebin/preflight.js", () => ({
    preflight: validate,
  }));
  const sendMessage = vi.fn(async () => ({
    ok: true,
    document_id: "33333333-3333-4333-8333-333333333333",
    transaction: readCheckout(checkoutDoc(), 20263),
    bin: checkoutBin,
  }));
  const get = vi.fn(async () => ({ ...tab }));
  vi.stubGlobal("chrome", {
    runtime: {
      id: sender.id,
      getURL: (path: string) => `${EXTENSION_ORIGIN}/${path}`,
      onMessage: {
        addListener: (fn: Listener) => {
          listener = fn;
        },
      },
    },
    tabs: { query: vi.fn(async () => [{ ...tab }]), get, sendMessage },
  });
  const { installCheckoutReviewHandler } =
    await import("../apps/extension/src/checkout/background.js");
  const { withWebregReview } =
    await import("../apps/extension/src/coursebin/background.js");
  installCheckoutReviewHandler();
  const request = (raw: unknown = command) =>
    new Promise<Reply>((resolve) => listener(raw, sender, resolve));
  return {
    request,
    listener,
    sendMessage,
    tab,
    validate,
    get,
    withWebregReview,
  };
}
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.doUnmock("../apps/extension/src/coursebin/preflight.js");
  vi.resetModules();
});
it("returns a read-only review through the precise top-frame inspection command", async () => {
  const t = await setup();
  expect(await t.request()).toMatchObject({
    ok: true,
    review: { mode: "read_only", blockers: [] },
  });
  expect(t.sendMessage).toHaveBeenCalledExactlyOnceWith(
    7,
    { channel: CHECKOUT_CHANNEL, method: "inspect", term_code: 20263 },
    { frameId: 0 },
  );
});
it("does not allow native, web page or foreign extension callers", async () => {
  const t = await setup();
  const respond = vi.fn();
  for (const from of [
    { nativeApplication: "edu.usc.course_planner" },
    { ...sender, url: "https://webreg.usc.edu/Checkout" },
    { ...sender, tab: { id: 7 } as chrome.tabs.Tab },
    { ...sender, id: "foreign" },
  ])
    expect(t.listener(command, from, respond)).toBeUndefined();
  expect(respond).not.toHaveBeenCalled();
  expect(t.validate).not.toHaveBeenCalled();
});
it("rejects submit commands and an inactive checkout page without source requests", async () => {
  const t = await setup();
  expect(await t.request({ ...command, method: "submit" })).toMatchObject({
    ok: false,
  });
  t.tab.url = "https://webreg.usc.edu/Terms";
  expect(await t.request()).toMatchObject({
    ok: false,
    code: "LOGIN_REQUIRED",
  });
  expect(t.validate).not.toHaveBeenCalled();
  expect(t.sendMessage).not.toHaveBeenCalled();
});
it("rejects navigation away after reading", async () => {
  const t = await setup();
  t.get.mockResolvedValue({ id: 7, url: "https://webreg.usc.edu/Terms" });
  expect(await t.request()).toMatchObject({ ok: false, code: "STATE_CHANGED" });
});
it("shares the coursebin operation lock and releases it after a failed review", async () => {
  const t = await setup();
  await t.withWebregReview(async () => {
    expect(await t.request()).toMatchObject({ ok: false, code: "BUSY" });
  });
  t.sendMessage.mockRejectedValueOnce(new Error("Page closed"));
  expect(await t.request()).toMatchObject({ ok: false });
  expect(await t.request()).toMatchObject({ ok: true });
});
it("times out an unresponsive content script and releases the operation lock", async () => {
  vi.useFakeTimers();
  const t = await setup();
  t.sendMessage.mockImplementationOnce(() => new Promise(() => {}));
  const result = t.request();
  await vi.advanceTimersByTimeAsync(15001);
  expect(await result).toMatchObject({ ok: false, code: "UI_CHANGED" });
  expect(await t.request()).toMatchObject({ ok: true });
});
