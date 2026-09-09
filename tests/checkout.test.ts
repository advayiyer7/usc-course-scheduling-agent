import { afterEach, describe, expect, it, vi } from "vitest";
import { DOMParser } from "linkedom";
import { readCheckout } from "../apps/extension/src/checkout/dom.js";
import { assessCheckout } from "../apps/extension/src/checkout/assess.js";
import {
  CHECKOUT_CHANNEL,
  checkoutContentRequest,
  checkoutUiRequest,
} from "../packages/contracts/src/checkout.js";
import { EXTENSION_ORIGIN } from "../packages/contracts/src/extension.js";
import {
  checkoutBin,
  checkoutBinHtml,
  checkoutContext,
  checkoutDoc,
  checkoutDraft,
  checkoutRow,
} from "./fixtures/checkout.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.resetModules();
});
describe("checkout inspection", () => {
  it("reads the explicit registration fields without touching hidden values or instructor records", () => {
    const doc = checkoutDoc();
    for (const input of doc.querySelectorAll('input[type="hidden"]')) {
      const original = input.getAttribute.bind(input);
      vi.spyOn(input, "getAttribute").mockImplementation((name) => {
        if (name === "value") throw new Error("Secret read");
        return original(name);
      });
      Object.defineProperty(input, "value", {
        get() {
          throw new Error("Secret read");
        },
      });
    }
    const instructor = [...doc.querySelectorAll(".section_row")][7]!;
    Object.defineProperty(instructor, "textContent", {
      get() {
        throw new Error("Unneeded record read");
      },
    });
    expect(readCheckout(doc, 20263)).toEqual({
      term_code: 20263,
      kind: "register",
      sections: [
        {
          section_id: "10001",
          course_code: "TEST100",
          session: "001",
          type: "Lecture",
          units: 4,
          grade_option: "Letter Grade",
        },
      ],
    });
  });
  it.each([
    "drop heading",
    "unknown heading",
    "extra heading",
    "outside row",
    "duplicate",
    "unknown units",
    "missing grade",
    "changed action",
    "external control",
    "extra hidden field",
    "submit override",
    "missing csrf",
  ])("fails closed for %s", (kind) => {
    const doc = checkoutDoc();
    if (kind === "drop heading")
      doc.querySelector("h5")!.textContent =
        "You are about to DROP the following sections:";
    if (kind === "unknown heading")
      doc.querySelector("h5")!.textContent = "Confirm grade changes";
    if (kind === "extra heading")
      doc
        .querySelector(".content-wrapper-regconfirm")!
        .insertAdjacentHTML("beforeend", "<h5>Grade changes</h5>");
    if (kind === "outside row")
      doc.body.insertAdjacentHTML("beforeend", checkoutRow("10002"));
    if (kind === "duplicate")
      doc
        .querySelector(".content-wrapper-regconfirm")!
        .insertAdjacentHTML("beforeend", checkoutRow());
    if (kind === "unknown units")
      [...doc.querySelectorAll(".section_row")][3]!.lastChild!.textContent =
        " unknown";
    if (kind === "missing grade")
      [...doc.querySelectorAll(".section_row")][9]!.remove();
    if (kind === "changed action")
      doc
        .querySelector("form")!
        .setAttribute("action", "https://example.com/CheckoutResponse");
    if (kind === "external control")
      doc.body.insertAdjacentHTML(
        "beforeend",
        '<input form="MainForm" name="unexpected">',
      );
    if (kind === "extra hidden field")
      doc
        .querySelector("form")!
        .insertAdjacentHTML(
          "beforeend",
          '<input type="hidden" name="unknown_action">',
        );
    if (kind === "submit override")
      doc.querySelector("#SubmitButton")!.setAttribute("formaction", "/Other");
    if (kind === "missing csrf")
      doc.querySelector('[name="__RequestVerificationToken"]')!.remove();
    expect(() => readCheckout(doc, 20263)).toThrow();
  });
  it("rejects wrong terms and expired login pages", () => {
    expect(() => readCheckout(checkoutDoc(), 20261)).toThrow();
    const doc = checkoutDoc();
    doc.querySelector('a[href="/auth/logout"]')!.remove();
    expect(() => readCheckout(doc, 20263)).toThrow();
  });
  it("includes every recognized row, then reports extras and missing plan sections", () => {
    const doc = checkoutDoc();
    doc
      .querySelector(".content-wrapper-regconfirm")!
      .insertAdjacentHTML("beforeend", checkoutRow("10002", "TEST-200"));
    const tx = readCheckout(doc, 20263);
    expect(tx.sections).toHaveLength(2);
    expect(
      assessCheckout(tx, checkoutBin, ["10001", "10003"]).map((b) => b.code),
    ).toEqual(["pending_changed", "extra_section", "missing_section"]);
  });
  it("detects pending drops and existing registrations absent from schedule validation", () => {
    const bin = structuredClone(checkoutBin);
    bin.entries.push({
      section_id: "10002",
      course_code: "TEST200",
      scheduled: false,
      registered: true,
    });
    expect(
      assessCheckout(readCheckout(checkoutDoc(), 20263), bin, ["10001"]).map(
        (b) => b.code,
      ),
    ).toEqual(["pending_drop", "existing_schedule"]);
  });
  it("allows plan sections already marked registered and scheduled without asking to register them twice", () => {
    const bin = structuredClone(checkoutBin);
    bin.entries.push({
      section_id: "10002",
      course_code: "TEST200",
      scheduled: true,
      registered: true,
    });
    expect(
      assessCheckout(readCheckout(checkoutDoc(), 20263), bin, [
        "10001",
        "10002",
      ]),
    ).toEqual([]);
  });
  it("has no submit or arbitrary endpoint command", () => {
    expect(
      checkoutContentRequest.safeParse({
        channel: CHECKOUT_CHANNEL,
        method: "submit",
        term_code: 20263,
      }).success,
    ).toBe(false);
    expect(
      checkoutContentRequest.safeParse({
        channel: CHECKOUT_CHANNEL,
        method: "inspect",
        term_code: 20263,
        endpoint: "/CheckoutResponse",
      }).success,
    ).toBe(false);
    expect(
      checkoutUiRequest.safeParse({
        channel: CHECKOUT_CHANNEL,
        method: "execute",
        proposal: checkoutDraft,
        context: checkoutContext,
      }).success,
    ).toBe(false);
  });
});

type Reply = { ok: boolean; code?: string; transaction?: unknown };
type Listener = (
  raw: unknown,
  sender: chrome.runtime.MessageSender,
  respond: (value: Reply) => void,
) => boolean | void;
async function setupContent() {
  const doc = checkoutDoc();
  const sender = {
    id: EXTENSION_ORIGIN.split("://")[1]!,
    url: `${EXTENSION_ORIGIN}/background.js`,
  };
  let listener!: Listener;
  const clicks = vi.fn(() => {
    throw new Error("Review cannot click controls");
  });
  for (const e of doc.querySelectorAll<HTMLElement>("input,a"))
    e.click = clicks;
  const fetcher = vi.fn(async () => new Response(checkoutBinHtml()));
  vi.stubGlobal("chrome", {
    runtime: {
      id: sender.id,
      onMessage: {
        addListener: (fn: Listener) => {
          listener = fn;
        },
      },
    },
  });
  vi.stubGlobal("document", doc);
  vi.stubGlobal("DOMParser", DOMParser);
  vi.stubGlobal("location", { href: "https://webreg.usc.edu/Checkout" });
  vi.stubGlobal("addEventListener", vi.fn());
  vi.stubGlobal("fetch", fetcher);
  await import("../apps/extension/src/coursebin/content.js");
  const request = (extra: Record<string, unknown> = {}) =>
    new Promise<Reply>((resolve) =>
      listener(
        {
          channel: CHECKOUT_CHANNEL,
          method: "inspect",
          term_code: 20263,
          ...extra,
        },
        sender,
        resolve,
      ),
    );
  return { doc, clicks, fetcher, request, listener, sender };
}
describe("checkout content transport", () => {
  it("performs one fixed authenticated GET, returning no security fields and never clicking", async () => {
    const t = await setupContent();
    const result = await t.request();
    expect(result.ok).toBe(true);
    expect(JSON.stringify(result)).not.toContain("FICTIONAL");
    expect(t.fetcher).toHaveBeenCalledExactlyOnceWith(
      "https://webreg.usc.edu/CourseBin",
      expect.objectContaining({
        credentials: "same-origin",
        redirect: "error",
      }),
    );
    expect(t.clicks).not.toHaveBeenCalled();
  });
  it("does not fetch or click for a forged endpoint/submit command", async () => {
    const t = await setupContent();
    expect((await t.request({ method: "submit" })).ok).toBe(false);
    expect((await t.request({ endpoint: "/CheckoutResponse" })).ok).toBe(false);
    expect(t.fetcher).not.toHaveBeenCalled();
    expect(t.clicks).not.toHaveBeenCalled();
  });
  it("rejects a changed grade option while reading the coursebin", async () => {
    const t = await setupContent();
    t.fetcher.mockImplementation(async () => {
      [...t.doc.querySelectorAll(".section_row")][9]!.lastChild!.textContent =
        " Pass/No Pass";
      return new Response(checkoutBinHtml());
    });
    expect(await t.request()).toMatchObject({
      ok: false,
      code: "STATE_CHANGED",
    });
  });
  it("reports authentication failure without retrying a request or submitting", async () => {
    const t = await setupContent();
    t.fetcher.mockRejectedValue(new Error("Redirected to sign in"));
    expect(await t.request()).toMatchObject({
      ok: false,
      code: "LOGIN_REQUIRED",
    });
    expect(t.fetcher).toHaveBeenCalledTimes(1);
    expect(t.clicks).not.toHaveBeenCalled();
  });
  it("ignores messages from page and other extension senders", async () => {
    const t = await setupContent();
    const respond = vi.fn();
    for (const sender of [
      { ...t.sender, tab: { id: 1 } as chrome.tabs.Tab },
      { id: "other-extension" },
    ])
      expect(
        t.listener(
          { channel: CHECKOUT_CHANNEL, method: "inspect", term_code: 20263 },
          sender,
          respond,
        ),
      ).toBeUndefined();
    expect(respond).not.toHaveBeenCalled();
    expect(t.fetcher).not.toHaveBeenCalled();
  });
});
