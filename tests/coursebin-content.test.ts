import { afterEach, describe, expect, it, vi } from "vitest";
import { DOMParser, parseHTML } from "linkedom";
import { EXTENSION_ORIGIN } from "../packages/contracts/src/extension.js";
import {
  COURSEBIN_CHANNEL,
  type BinSnapshot,
} from "../packages/contracts/src/coursebin.js";

// Handwritten fictional DOM. No copied student account, coursebin or security data.
const nav =
  '<a href="/Departments">Fall 2026 Classes</a><a href="/CourseBin">myCourseBin</a><a href="/auth/logout">Logout</a>';
const states = (id: string, active: string) =>
  ["YN", "NN", "NY", "YY"]
    .map(
      (s) =>
        `<div class="dvSRtxt" id="sched${s[0]}_reg${s[1]}_status_${id}" style="display:${s === active ? "block" : "none"}">Synthetic state</div>`,
    )
    .join("");
const protectedControls =
  '<a id="register" href="/Checkout">Register</a><a id="drop">Drop</a><a id="remove">Remove</a><a id="unschedule">Unschedule</a>';
function initialBin(): BinSnapshot {
  return {
    term_code: 20263,
    entries: [
      {
        section_id: "11111",
        course_code: "OTHER101",
        scheduled: true,
        registered: true,
      },
    ],
  };
}
function binHtml(bin: BinSnapshot) {
  return `<html><body>${nav}<h3>myCourseBin</h3>${bin.entries
    .map((e) => {
      const course = e.course_code.replace(/^(\D+)(\d)/, "$1-$2");
      return `<div id="courseBin_${course}"><div class="section_crsbin"><span class="section_row">Section: ${e.section_id} R</span>${states(e.section_id, `${e.scheduled ? "Y" : "N"}${e.registered ? "Y" : "N"}`)}${protectedControls}</div></div>`;
    })
    .join("")}</body></html>`;
}
function listing() {
  return parseHTML(`<html><body>${nav}<a id="expand" href="#courseBin_TEST-101">TEST-101</a><div id="courseBin_TEST-101"><div class="section_crsbin">
  <span class="section_row">Section: 22222 D</span><span id="capacity" class="section_row">Registered: 5 of 10</span>
  <form action="/api/Section/Add" method="post" data-ajax="true" data-ajax-method="Post" data-ajax-url="/api/section/20263/22222/add"
    data-ajax-begin="disableAddCourseBin('22222')" data-ajax-complete="handleAddCourseBin(xhr, status, '22222')">
    <button type="submit" class="add-to-course-bin" id="submit-add-22222">Add to myCourseBin</button>
    <input type="hidden" name="__RequestVerificationToken" value="FICTIONAL-NOT-A-SECRET">
  </form><div id="result-22222"></div>${protectedControls}</div></div></body></html>`)
    .document as unknown as Document;
}
interface Reply {
  ok: boolean;
  code?: string;
  document_id?: string;
  bin?: BinSnapshot;
}
type Listener = (
  raw: unknown,
  sender: chrome.runtime.MessageSender,
  respond: (reply: Reply) => void,
) => boolean | void;
const sender: chrome.runtime.MessageSender = {
  id: EXTENSION_ORIGIN.split("://")[1]!,
  url: `${EXTENSION_ORIGIN}/background.js`,
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
async function setup(url = "https://webreg.usc.edu/Courses?Section=22222") {
  vi.resetModules();
  const doc = listing();
  const button = doc.getElementById("submit-add-22222")! as HTMLButtonElement;
  const result = doc.getElementById("result-22222")!;
  const h = {
    bin: initialBin(),
    visible: true,
    location: { href: url },
    clicked: [] as string[],
    onAdd: () => {
      h.bin.entries.push({
        section_id: "22222",
        course_code: "TEST101",
        scheduled: false,
        registered: false,
      });
      button.textContent = "Added to Course Bin";
    },
  };
  const secretReads = vi.fn(() => {
    throw new Error("The adapter must not read a security field");
  });
  const input = doc.querySelector("input")!;
  Object.defineProperty(input, "value", { get: secretReads });
  const getAttribute = input.getAttribute.bind(input);
  vi.spyOn(input, "getAttribute").mockImplementation((name) =>
    name === "value" ? secretReads() : getAttribute(name),
  );
  Object.defineProperty(doc, "cookie", { get: secretReads });
  button.getClientRects = () => ({ length: h.visible ? 1 : 0 }) as DOMRectList;
  const addClick = vi.fn(() => {
    h.clicked.push("22222");
    h.onAdd();
  });
  button.click = addClick;
  const expandClick = vi.fn(() => {
    h.clicked.push("expand");
    h.visible = true;
  });
  (doc.getElementById("expand")! as HTMLElement).click = expandClick;
  const forbidden = ["register", "drop", "remove", "unschedule"].map((id) => {
    const click = vi.fn(() => {
      throw new Error(`Forbidden ${id} click`);
    });
    (doc.getElementById(id)! as HTMLElement).click = click;
    return click;
  });
  const fetchMock = vi.fn(
    async (_url: RequestInfo | URL, _options?: RequestInit) =>
      new Response(binHtml(h.bin), { status: 200 }),
  );
  const events = new Map<string, EventListener>();
  let listener!: Listener;
  vi.stubGlobal("document", doc);
  vi.stubGlobal("location", h.location);
  vi.stubGlobal("DOMParser", DOMParser);
  vi.stubGlobal("getComputedStyle", () => ({ visibility: "visible" }));
  vi.stubGlobal("addEventListener", (name: string, fn: EventListener) => {
    events.set(name, fn);
  });
  vi.stubGlobal("fetch", fetchMock);
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
  await import("../apps/extension/src/coursebin/content.js");
  const request = (command: Record<string, unknown>) =>
    new Promise<Reply>((resolve) => {
      listener({ channel: COURSEBIN_CHANNEL, ...command }, sender, resolve);
    });
  const inspection = () => request({ method: "inspect", term_code: 20263 });
  const command = (nonce: string) => ({
    method: "add",
    term_code: 20263,
    section_id: "22222",
    requested_courses: ["TEST101"],
    document_id: nonce,
    expected_bin: initialBin(),
    expires_at: Date.now() + 15000,
  });
  const authorize = async () => {
    const inspected = await inspection();
    expect(inspected.ok).toBe(true);
    return command(inspected.document_id!);
  };
  return {
    h,
    doc,
    button,
    result,
    secretReads,
    forbidden,
    addClick,
    expandClick,
    fetchMock,
    request,
    inspection,
    command,
    authorize,
    pagehide: () => events.get("pagehide")!(new Event("pagehide")),
    dispatch: (raw: unknown, from = sender, respond = vi.fn()) => ({
      keepAlive: listener(raw, from, respond),
      respond,
    }),
  };
}
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("bounded WebReg content script", () => {
  it("clicks only the exact WebReg add control and leaves tokens, unrelated courses and registration controls untouched", async () => {
    const t = await setup();
    const selection = await t.authorize();
    await expect(t.request(selection)).resolves.toEqual({
      ok: true,
      code: undefined,
    });
    expect(t.h.clicked).toEqual(["22222"]);
    expect(t.addClick).toHaveBeenCalledOnce();
    expect(t.secretReads).not.toHaveBeenCalled();
    t.forbidden.forEach((click) => expect(click).not.toHaveBeenCalled());
    expect(t.h.bin.entries[0]).toEqual(initialBin().entries[0]);
    expect(t.h.bin.entries).toHaveLength(2);
    const after = await t.inspection();
    expect(after.bin?.entries.map((e) => e.section_id)).toEqual([
      "11111",
      "22222",
    ]);
    for (const [url, options] of t.fetchMock.mock.calls) {
      expect(url).toBe("https://webreg.usc.edu/CourseBin");
      expect(options).toMatchObject({
        credentials: "same-origin",
        cache: "no-store",
        redirect: "error",
      });
      expect(options?.method ?? "GET").toBe("GET");
      expect(options?.body).toBeUndefined();
      expect(options?.headers).toBeUndefined();
    }
    expect(JSON.stringify(after)).not.toContain("FICTIONAL-NOT-A-SECRET");
  });

  it("ignores foreign, tab and non-top-frame senders", async () => {
    const t = await setup();
    for (const from of [
      { id: "other-extension" },
      { nativeApplication: "edu.usc.course_planner" },
      { ...sender, tab: { id: 7 } as chrome.tabs.Tab },
      { ...sender, frameId: 1 },
    ]) {
      const attempted = t.dispatch(
        { channel: COURSEBIN_CHANNEL, method: "inspect", term_code: 20263 },
        from,
      );
      expect(attempted.keepAlive).toBeUndefined();
      expect(attempted.respond).not.toHaveBeenCalled();
    }
    expect(t.fetchMock).not.toHaveBeenCalled();
    expect(t.addClick).not.toHaveBeenCalled();
  });

  it("ignores unrelated channels and rejects arbitrary scripts, endpoints and unknown actions", async () => {
    const t = await setup();
    for (const raw of [
      null,
      "add",
      { method: "add" },
      { channel: "other", method: "inspect" },
    ]) {
      expect(t.dispatch(raw).respond).not.toHaveBeenCalled();
    }
    for (const command of [
      { method: "script", script: "arbitrary" },
      { method: "register", section_id: "22222" },
      { method: "inspect", term_code: 20263, endpoint: "/Checkout" },
      { method: "add", term_code: 20263, section_id: "22222" },
    ]) {
      await expect(t.request(command)).resolves.toEqual({
        ok: false,
        code: "UI_CHANGED",
      });
    }
    expect(t.fetchMock).not.toHaveBeenCalled();
    expect(t.addClick).not.toHaveBeenCalled();
  });

  it("rejects wrong document, semester, section lookup, forbidden pages and expired authorizations before clicking", async () => {
    for (const issue of [
      "nonce",
      "semester",
      "lookup",
      "page",
      "expired",
    ] as const) {
      const url =
        issue === "lookup"
          ? "https://webreg.usc.edu/Courses?Section=99999"
          : "https://webreg.usc.edu/Courses?Section=22222";
      const t = await setup(url);
      const selection = await t.authorize();
      if (issue === "nonce")
        selection.document_id = "99999999-9999-4999-8999-999999999999";
      if (issue === "semester") selection.term_code = 20271;
      if (issue === "page")
        t.h.location.href = "https://webreg.usc.edu/Checkout";
      if (issue === "expired") selection.expires_at = Date.now() - 1;
      await expect(t.request(selection)).resolves.toMatchObject({
        ok: true,
        code: issue === "semester" ? "WRONG_SEMESTER" : "STATE_CHANGED",
      });
      expect(t.addClick).not.toHaveBeenCalled();
      t.forbidden.forEach((click) => expect(click).not.toHaveBeenCalled());
    }
    const forbidden = await setup("https://webreg.usc.edu/Checkout");
    await expect(forbidden.inspection()).resolves.toEqual({
      ok: false,
      code: "LOGIN_REQUIRED",
    });
    expect(forbidden.fetchMock).not.toHaveBeenCalled();
  });

  it("refuses changed form endpoints, registration labels and duplicate add controls", async () => {
    for (const issue of ["endpoint", "label", "duplicate"] as const) {
      const t = await setup();
      const selection = await t.authorize();
      if (issue === "endpoint")
        t.doc.querySelector("form")!.setAttribute("data-ajax-url", "/Checkout");
      if (issue === "label") t.button.textContent = "Register";
      if (issue === "duplicate")
        t.button.parentElement!.appendChild(t.button.cloneNode(true));
      await expect(t.request(selection)).resolves.toEqual({
        ok: true,
        code: "UI_CHANGED",
      });
      expect(t.addClick).not.toHaveBeenCalled();
      expect(t.fetchMock).toHaveBeenCalledTimes(1);
    }
  });

  it("re-reads the bin before clicking and aborts if unrelated entries or selected membership changed", async () => {
    for (const issue of ["registered", "already-present"] as const) {
      const t = await setup();
      const selection = await t.authorize();
      if (issue === "registered") t.h.bin.entries[0]!.registered = false;
      else
        t.h.bin.entries.push({
          section_id: "22222",
          course_code: "TEST101",
          scheduled: false,
          registered: false,
        });
      await expect(t.request(selection)).resolves.toEqual({
        ok: true,
        code: "STATE_CHANGED",
      });
      expect(t.fetchMock).toHaveBeenCalledTimes(2);
      expect(t.addClick).not.toHaveBeenCalled();
    }
  });

  it("expands only the selected course before clicking its previously hidden add control", async () => {
    vi.useFakeTimers();
    const t = await setup();
    const selection = await t.authorize();
    t.h.visible = false;
    const pending = t.request(selection);
    expect(t.expandClick).toHaveBeenCalledOnce();
    expect(t.addClick).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(450);
    await expect(pending).resolves.toEqual({ ok: true, code: undefined });
    expect(t.h.clicked).toEqual(["expand", "22222"]);
    t.forbidden.forEach((click) => expect(click).not.toHaveBeenCalled());
  });

  it("locks concurrent add commands while the pre-click bin request is pending", async () => {
    const t = await setup();
    const selection = await t.authorize();
    const entered = deferred<void>(),
      gate = deferred<Response>();
    t.fetchMock.mockImplementationOnce(async () => {
      entered.resolve();
      return gate.promise;
    });
    const first = t.request(selection);
    await entered.promise;
    await expect(t.request(selection)).resolves.toEqual({
      ok: true,
      code: "BUSY",
    });
    expect(t.addClick).not.toHaveBeenCalled();
    gate.resolve(new Response(binHtml(t.h.bin)));
    await expect(first).resolves.toEqual({ ok: true, code: undefined });
    expect(t.addClick).toHaveBeenCalledOnce();
  });

  it("rejects a full section before dispatching its add control", async () => {
    const t = await setup();
    const selection = await t.authorize();
    t.doc.getElementById("capacity")!.textContent = "Registered: Closed";
    await expect(t.request(selection)).resolves.toEqual({
      ok: true,
      code: "FULL",
    });
    expect(t.addClick).not.toHaveBeenCalled();
    expect(t.fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns bounded clearance, full, rejected and unconfirmed codes without forwarding page text", async () => {
    for (const [message, code] of [
      ["D-clearance required: fictional private detail", "D_CLEARANCE"],
      ["Section is full", "FULL"],
      ["Error Adding to Course Bin", "WEBREG_REJECTED"],
      ["Unfamiliar response: fictional private detail", "UNCONFIRMED"],
      ["Successfully processed unfamiliar response", "UNCONFIRMED"],
    ]) {
      const t = await setup();
      const selection = await t.authorize();
      t.h.onAdd = () => {
        t.result.textContent = message!;
      };
      const reply = await t.request(selection);
      expect(reply).toEqual({ ok: true, code });
      expect(JSON.stringify(reply)).not.toContain(message);
      expect(t.addClick).toHaveBeenCalledOnce();
      t.forbidden.forEach((click) => expect(click).not.toHaveBeenCalled());
    }
  });

  it("stops on session expiry without attempting a login or authenticated POST", async () => {
    const t = await setup();
    const selection = await t.authorize();
    t.fetchMock.mockResolvedValueOnce(
      new Response("Unauthorized", { status: 401 }),
    );
    await expect(t.request(selection)).resolves.toEqual({
      ok: true,
      code: "LOGIN_REQUIRED",
    });
    expect(t.addClick).not.toHaveBeenCalled();
    expect(
      t.fetchMock.mock.calls.every(
        ([url]) => url === "https://webreg.usc.edu/CourseBin",
      ),
    ).toBe(true);
  });

  it("stops if pagehide occurs while the final pre-click bin read is pending", async () => {
    const t = await setup();
    const selection = await t.authorize();
    const entered = deferred<void>(),
      gate = deferred<Response>();
    t.fetchMock.mockImplementationOnce(async () => {
      entered.resolve();
      return gate.promise;
    });
    const pending = t.request(selection);
    await entered.promise;
    t.pagehide();
    gate.resolve(new Response(binHtml(t.h.bin)));
    await expect(pending).resolves.toEqual({ ok: true, code: "STATE_CHANGED" });
    expect(t.addClick).not.toHaveBeenCalled();
  });

  it("stops on a URL change after the single click and never follows registration controls", async () => {
    const t = await setup();
    const selection = await t.authorize();
    t.h.onAdd = () => {
      t.h.location.href = "https://webreg.usc.edu/Checkout";
    };
    await expect(t.request(selection)).resolves.toEqual({
      ok: true,
      code: "STATE_CHANGED",
    });
    expect(t.addClick).toHaveBeenCalledOnce();
    t.forbidden.forEach((click) => expect(click).not.toHaveBeenCalled());
  });

  it("rechecks controls and modal state after awaiting the bin read", async () => {
    for (const issue of ["modal", "replacement"] as const) {
      const t = await setup();
      const selection = await t.authorize();
      t.fetchMock.mockImplementationOnce(async () => {
        if (issue === "modal")
          t.doc.body.insertAdjacentHTML(
            "beforeend",
            '<div class="modal in">Unverified dialog</div>',
          );
        else t.button.replaceWith(t.button.cloneNode(true));
        return new Response(binHtml(t.h.bin));
      });
      await expect(t.request(selection)).resolves.toEqual({
        ok: true,
        code: "UI_CHANGED",
      });
      expect(t.addClick).not.toHaveBeenCalled();
    }
  });

  it("times out an unacknowledged click as unconfirmed and never retries", async () => {
    vi.useFakeTimers();
    const t = await setup();
    const selection = await t.authorize();
    t.h.onAdd = () => {};
    const pending = t.request(selection);
    await vi.advanceTimersByTimeAsync(12000);
    await expect(pending).resolves.toEqual({ ok: true, code: "UNCONFIRMED" });
    expect(t.addClick).toHaveBeenCalledOnce();
    expect(t.fetchMock).toHaveBeenCalledTimes(2);
    t.forbidden.forEach((click) => expect(click).not.toHaveBeenCalled());
  });
});
