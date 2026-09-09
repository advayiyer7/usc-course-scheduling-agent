import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { parseHTML } from "linkedom";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { CheckoutReview } from "../apps/extension/src/checkout/CheckoutReview.js";
import { checkoutReview } from "../packages/contracts/src/checkout.js";
import { readCheckout } from "../apps/extension/src/checkout/dom.js";
import {
  checkoutContext,
  checkoutDoc,
  checkoutDraft,
} from "./fixtures/checkout.js";

let root: Root, container: HTMLElement;
const send = vi.fn();
const onBusy = vi.fn();
const review = () =>
  checkoutReview.parse({
    mode: "read_only",
    transaction: readCheckout(checkoutDoc(), 20263),
    checked_at: new Date().toISOString(),
    expires_at: Date.now() + 60000,
    blockers: [
      {
        code: "extra_section",
        message: "A fictional pending section is outside this plan.",
      },
    ],
    warnings: [],
  });
const render = async (draft = checkoutDraft) => {
  await act(async () =>
    root.render(
      React.createElement(CheckoutReview, {
        draft,
        context: checkoutContext,
        disabled: false,
        onBusy,
      }),
    ),
  );
};
const click = () => act(async () => container.querySelector("button")!.click());
beforeEach(() => {
  const { document, window } = parseHTML(
    '<html><body><div id="root"></div></body></html>',
  );
  vi.stubGlobal("window", window);
  vi.stubGlobal("document", document);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("chrome", { runtime: { id: "test", sendMessage: send } });
  container = document.getElementById("root")! as unknown as HTMLElement;
  root = createRoot(container);
  send.mockReset();
  onBusy.mockReset();
  send.mockResolvedValue({ ok: true, review: review() });
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});
it("displays units, grade option and blockers with no submit control", async () => {
  await render();
  await click();
  expect(container.textContent).toContain(
    "4 units · Grade option: Letter Grade",
  );
  expect(container.textContent).toContain("outside this plan");
  expect(
    [...container.querySelectorAll("button")].map((b) => b.textContent),
  ).toEqual(["Read pending checkout"]);
  expect(send).toHaveBeenCalledTimes(1);
  expect(onBusy.mock.calls).toEqual([[true], [false]]);
});
it("invalidates an old review and ignores a late result after a plan replacement", async () => {
  let resolve!: (value: unknown) => void;
  send.mockImplementationOnce(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  await render();
  await click();
  await render({
    ...checkoutDraft,
    id: "44444444-4444-4444-8444-444444444444",
  });
  await act(async () => resolve({ ok: true, review: review() }));
  expect(container.textContent).not.toContain("Grade option: Letter Grade");
});
it("turns an expired session into actionable sign-in guidance", async () => {
  send.mockResolvedValue({ ok: false, code: "LOGIN_REQUIRED" });
  await render();
  await click();
  expect(container.querySelector('[role="alert"]')?.textContent).toContain(
    "open its Checkout page",
  );
});
