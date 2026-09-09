import { parseHTML } from "linkedom";
import {
  planningContext,
  proposal,
} from "../../packages/contracts/src/companion.js";
import type { BinSnapshot } from "../../packages/contracts/src/coursebin.js";

// Handwritten structural fixture. All section/course/security values are fictional.
export const checkoutNav =
  '<a href="/Departments">Fall 2026 Classes</a><a href="/CourseBin">myCourseBin</a><a href="/auth/logout">Logout</a>';
export function checkoutRow(id = "10001", course = "TEST-100") {
  const values = {
    Section: `${id} R`,
    Session: "001",
    Type: "Lecture",
    Units: "4.0",
    Registered: "5 of 10",
    Time: "10:00-11:00",
    Days: "Tuesday",
    Instructor: "Fictional instructor",
    Location: "TEST",
    "Grade Option": "Letter Grade",
  };
  return `<div id="courseBin_${course}"><div id="section_${id}"><div class="section-row"><div class="section_crsbin">${Object.entries(
    values,
  )
    .map(
      ([label, value]) =>
        `<span class="section_row"><span class="table-headers-xsmall">${label}:</span> ${value}</span>`,
    )
    .join("")}</div></div></div></div>`;
}
export function checkoutDoc() {
  return parseHTML(
    `<html><body>${checkoutNav}<div class="content-wrapper-regconfirm"><h3>Registration Confirmation</h3><div class="Register"><form id="MainForm" method="post" action="/CheckoutResponse"><input type="hidden" name="activeTerm" value="20263"><input type="hidden" name="__RequestVerificationToken" value="FICTIONAL"><input type="button" name="btnSubmit" id="SubmitButton" value="Submit" onclick="procRegSubmt()"></form></div><h5 class="RegAdDrpTitl">You are about to REGISTER for the following sections:</h5>${checkoutRow()}</div></body></html>`,
  ).document as unknown as Document;
}
export const checkoutBin: BinSnapshot = {
  term_code: 20263,
  entries: [
    {
      section_id: "10001",
      course_code: "TEST100",
      scheduled: true,
      registered: false,
    },
  ],
};
export function checkoutBinHtml() {
  return `<html><body>${checkoutNav}<h3>myCourseBin</h3><div id="courseBin_TEST-100"><div class="section_crsbin"><span class="section_row">Section: 10001 R</span>${["YN", "YY", "NN", "NY"].map((s) => `<div class="dvSRtxt" id="sched${s[0]}_reg${s[1]}_status_10001" style="display:${s === "YN" ? "block" : "none"}"></div>`).join("")}</div></div></body></html>`;
}
export const checkoutContext = planningContext.parse({
  term_code: 20263,
  course_codes: ["TEST100"],
  selected_section_ids: ["10001"],
  constraints: {},
});
export const checkoutDraft = proposal.parse({
  id: "11111111-1111-4111-8111-111111111111",
  selection: {
    title: "Fictional plan",
    term_code: 20263,
    snapshot_version: "22222222-2222-4222-8222-222222222222",
    section_ids: ["10001"],
    requested_courses: ["TEST100"],
    constraints: {},
  },
  validation: {
    data: { status: "feasible" },
    meta: {
      snapshot_version: "22222222-2222-4222-8222-222222222222",
      checked_at: new Date().toISOString(),
      stale: false,
      warnings: [],
    },
  },
});
