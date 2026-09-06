import { describe, expect, it } from "vitest";
import { parseHTML } from "linkedom";
import {
  allowedPage,
  findAdd,
  readBin,
  readSemester,
} from "../apps/extension/src/coursebin/dom.js";

// Handwritten structural fixtures; fictional courses/IDs, never a student page dump.
const nav =
  '<a href="/Departments">Fall 2026 Classes</a><a href="/CourseBin">myCourseBin</a><a href="/auth/logout">Logout</a>';
const states = (section: string, scheduled = "Y", registered = "Y") =>
  ["YN", "NN", "NY", "YY"]
    .map(
      (s) =>
        `<div class="dvSRtxt" id="sched${s[0]}_reg${s[1]}_status_${section}" style="display: ${s === scheduled + registered ? "block" : "none"};">Synthetic state</div>`,
    )
    .join("");
const binRow = (
  section = "11111",
) => `<div class="section_crsbin"><span class="section_row">Section: ${section} R</span>${states(section)}
  <a class="btn btn-default" href="/Checkout" role="button">Register</a><a role="button">Drop</a><a role="button">Remove</a></div>`;
const bin = () =>
  parseHTML(
    `<html><body>${nav}<h3>myCourseBin</h3><div id="courseBin_TEST-101">${binRow()}</div></body></html>`,
  ).document as unknown as Document;
const listing = () =>
  parseHTML(`<html><body>${nav}<a href="#courseBin_TEST-101">TEST-101</a><div id="courseBin_TEST-101"><div class="section_crsbin">
  <span class="section_row">Section: 22222 D</span><span class="section_row">Registered: 5 of 10</span>
  <form action="/api/Section/Add" method="post" data-ajax="true" data-ajax-method="Post" data-ajax-url="/api/section/20263/22222/add"
    data-ajax-begin="disableAddCourseBin('22222')" data-ajax-complete="handleAddCourseBin(xhr, status, '22222')">
    <button type="submit" class="add-to-course-bin" id="submit-add-22222">Add to myCourseBin</button>
    <input type="hidden" name="__RequestVerificationToken" value="FICTIONAL-NOT-A-SECRET">
  </form><div id="result-22222"></div>
  <a class="btn btn-default" href="/Checkout" role="button">Register</a>
  </div></div></body></html>`).document as unknown as Document;

describe("observed WebReg DOM contract", () => {
  it.each([
    "form",
    "formaction",
    "formmethod",
    "formtarget",
    "formenctype",
    "formnovalidate",
  ])("rejects the unobserved submit override %s", (attribute) => {
    const doc = listing();
    doc.querySelector("button")!.setAttribute(attribute, "/Checkout");
    expect(() => findAdd(doc, 20263, "22222", ["TEST101"])).toThrow();
  });
  it("extracts semester only from current navigation, ignoring other semester menu options", () => {
    const doc = bin();
    doc.body.insertAdjacentHTML(
      "beforeend",
      '<a href="/terms?handler=TermSelect&term=20261">Spring 2026 Classes</a>',
    );
    expect(readSemester(doc)).toBe(20263);
  });
  it("preserves registered and scheduled flags instead of reading hidden action labels", () => {
    expect(readBin(bin(), 20263).entries).toEqual([
      {
        section_id: "11111",
        course_code: "TEST101",
        scheduled: true,
        registered: true,
      },
    ]);
  });
  it.each(["YN", "NN", "NY", "YY"])(
    "recognizes only the displayed %s status",
    (state) => {
      const doc = bin();
      const row = doc.querySelector(".section_crsbin")!;
      row.querySelectorAll(".dvSRtxt").forEach((n) => n.remove());
      row.insertAdjacentHTML("beforeend", states("11111", state[0], state[1]));
      const entry = readBin(doc, 20263).entries[0]!;
      expect(entry.scheduled).toBe(state[0] === "Y");
      expect(entry.registered).toBe(state[1] === "Y");
    },
  );
  it("does not read hidden fields or account text", () => {
    const doc = listing();
    const input = doc.querySelector("input")!;
    Object.defineProperty(input, "value", {
      get() {
        throw new Error("Token read forbidden");
      },
    });
    expect(findAdd(doc, 20263, "22222", ["TEST101"]).button.id).toBe(
      "submit-add-22222",
    );
  });
  it("binds the sole add control to the exact section, canonical course and term", () => {
    const controls = findAdd(listing(), 20263, "22222", ["TEST101"]);
    expect(controls.button.textContent).toBe("Add to myCourseBin");
    expect(controls.clearance).toBe(true);
    expect(controls.expand.getAttribute("href")).toBe("#courseBin_TEST-101");
  });
  it.each([
    "/Checkout",
    "/api/section/20263/99999/add",
    "/api/section/20261/22222/add",
    "https://example.com/steal",
    "/api/section/20263/22222/drop",
  ])("rejects altered add target %s", (target) => {
    const doc = listing();
    doc.querySelector("form")!.setAttribute("data-ajax-url", target);
    expect(() => findAdd(doc, 20263, "22222", ["TEST101"])).toThrow(/controls/);
  });
  it.each(["method", "action", "data-ajax-begin", "data-ajax-complete"])(
    "requires verified form attribute %s",
    (attribute) => {
      const doc = listing();
      doc.querySelector("form")!.removeAttribute(attribute);
      expect(() => findAdd(doc, 20263, "22222", ["TEST101"])).toThrow();
    },
  );
  it.each(["Closed", "10 of 10", "11 of 10"])("blocks capacity %s", (seats) => {
    const doc = listing();
    doc.querySelectorAll(".section_row")[1]!.textContent =
      `Registered: ${seats}`;
    expect(() => findAdd(doc, 20263, "22222", ["TEST101"])).toThrow(
      /full or closed/,
    );
  });
  it("fails closed on wrong semester, login loss, ambiguous sections and unknown capacity", () => {
    expect(() => readBin(bin(), 20261)).toThrow(/semester/);
    const signedOut = bin();
    signedOut.querySelector('a[href="/auth/logout"]')!.remove();
    expect(() => readBin(signedOut, 20263)).toThrow(/sign in/);
    const duplicated = bin();
    duplicated
      .querySelector('div[id^="courseBin_"]')!
      .insertAdjacentHTML("beforeend", binRow());
    expect(() => readBin(duplicated, 20263)).toThrow();
    const unknown = listing();
    unknown.querySelectorAll(".section_row")[1]!.textContent =
      "Registered: unknown";
    expect(() => findAdd(unknown, 20263, "22222", ["TEST101"])).toThrow();
  });
  it("rejects multiple displayed statuses and a section/status mismatch", () => {
    const doc = bin();
    (doc.querySelector(".dvSRtxt") as HTMLElement).style.display = "block";
    expect(() => readBin(doc, 20263)).toThrow();
    const mismatch = bin();
    mismatch.querySelector('[id="schedY_regY_status_11111"]')!.id =
      "schedY_regY_status_99999";
    expect(() => readBin(mismatch, 20263)).toThrow();
  });
  it("does not interpret an unverified empty/incomplete bin as an empty baseline", () => {
    const doc = bin();
    doc.querySelector(".section_crsbin")!.remove();
    expect(() => readBin(doc, 20263)).toThrow();
  });
  it("does not accept a disabled, renamed, duplicate or mismatched course add control", () => {
    const disabled = listing();
    disabled.querySelector("button")!.setAttribute("disabled", "");
    expect(() => findAdd(disabled, 20263, "22222", ["TEST101"])).toThrow();
    const renamed = listing();
    renamed.querySelector("button")!.textContent = "Register";
    expect(() => findAdd(renamed, 20263, "22222", ["TEST101"])).toThrow();
    const duplicate = listing();
    duplicate
      .querySelector("form")!
      .insertAdjacentHTML(
        "beforeend",
        duplicate.querySelector("button")!.outerHTML,
      );
    expect(() => findAdd(duplicate, 20263, "22222", ["TEST101"])).toThrow();
    expect(() => findAdd(listing(), 20263, "22222", ["ELSE101"])).toThrow(
      /exact section/,
    );
  });
  it.each([
    "https://webreg.usc.edu/Checkout",
    "https://webreg.usc.edu/auth/logout",
    "https://webreg.usc.edu/terms?handler=TermSelect&term=20261",
    "https://webreg.usc.edu.evil.test/Courses",
    "http://webreg.usc.edu/CourseBin",
  ])("never operates on %s", (url) => {
    expect(allowedPage(url)).toBe(false);
  });
});
