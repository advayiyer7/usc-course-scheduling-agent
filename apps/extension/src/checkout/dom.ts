import { checkoutTransaction } from "../../../../packages/contracts/src/checkout.js";
import { CoursebinError } from "../../../../packages/contracts/src/coursebin.js";
import { assertSemester } from "../coursebin/dom.js";

const text = (value: string | null) =>
  (value ?? "").replace(/\s+/g, " ").trim();
function one<T extends Element>(items: ArrayLike<T>): T {
  if (items.length !== 1) throw new CoursebinError("UI_CHANGED");
  return items[0]!;
}
const labels = [
  "Section",
  "Session",
  "Type",
  "Units",
  "Registered",
  "Time",
  "Days",
  "Instructor",
  "Location",
  "Grade Option",
];

/** Observed registration-only structure. No token values, student identity or scripts are read. */
export function readCheckout(doc: Document, term: number) {
  assertSemester(doc, term);
  const wrapper = one(doc.querySelectorAll(".content-wrapper-regconfirm"));
  const title = one(wrapper.querySelectorAll("h3"));
  if (text(title.textContent) !== "Registration Confirmation")
    throw new CoursebinError("UI_CHANGED");
  const heading = one(wrapper.querySelectorAll("h5"));
  if (
    !heading.classList.contains("RegAdDrpTitl") ||
    text(heading.textContent) !==
      "You are about to REGISTER for the following sections:"
  )
    throw new CoursebinError("UI_CHANGED");
  if (doc.querySelectorAll(".RegAdDrpTitl").length !== 1)
    throw new CoursebinError("UI_CHANGED");
  const form = one(
    doc.querySelectorAll<HTMLFormElement>('form[id="MainForm"]'),
  );
  if (
    !wrapper.contains(form) ||
    form.getAttribute("action") !== "/CheckoutResponse" ||
    form.getAttribute("method")?.toLowerCase() !== "post" ||
    form.hasAttribute("target") ||
    form.hasAttribute("onsubmit") ||
    form.hasAttribute("data-ajax")
  )
    throw new CoursebinError("UI_CHANGED");
  const controls = [...form.querySelectorAll("input,button,select,textarea")];
  if (controls.length !== 3 || doc.querySelector('[form="MainForm"]'))
    throw new CoursebinError("UI_CHANGED");
  for (const name of ["activeTerm", "__RequestVerificationToken"]) {
    const hidden = one(form.querySelectorAll(`input[name="${name}"]`));
    if (
      hidden.getAttribute("type") !== "hidden" ||
      hidden.hasAttribute("disabled")
    )
      throw new CoursebinError("UI_CHANGED");
    // These remain entirely in WebReg. Even a read-only review must not serialize them.
  }
  const button = one(form.querySelectorAll('input[id="SubmitButton"]'));
  if (
    button.getAttribute("type") !== "button" ||
    button.getAttribute("name") !== "btnSubmit" ||
    button.getAttribute("value") !== "Submit" ||
    button.getAttribute("onclick") !== "procRegSubmt()" ||
    button.hasAttribute("disabled")
  )
    throw new CoursebinError("UI_CHANGED");
  if (
    ["form", "formaction", "formmethod", "formtarget"].some((a) =>
      button.hasAttribute(a),
    )
  )
    throw new CoursebinError("UI_CHANGED");
  const rows = [...doc.querySelectorAll(".section_crsbin")];
  const sections = rows.map((row) => {
    if (
      !wrapper.contains(row) ||
      form.contains(row) ||
      !(heading.compareDocumentPosition(row) & 4)
    )
      throw new CoursebinError("UI_CHANGED");
    const group = row.closest('div[id^="courseBin_"]');
    const course = group?.id.match(
      /^courseBin_([A-Z]{2,8})-(\d{3}[A-Z]{0,3})$/,
    );
    if (!course || row.querySelector("input,button,select,textarea"))
      throw new CoursebinError("UI_CHANGED");
    const cells = [...row.children].filter((c) =>
      c.classList.contains("section_row"),
    );
    if (cells.length !== labels.length) throw new CoursebinError("UI_CHANGED");
    // Read labels for all columns, but only the five registration fields below.
    for (const [i, label] of labels.entries()) {
      const name = one(cells[i]!.querySelectorAll(".table-headers-xsmall"));
      if (text(name.textContent) !== `${label}:`)
        throw new CoursebinError("UI_CHANGED");
    }
    const field = (name: string) => {
      const value = text(cells[labels.indexOf(name)]!.textContent);
      if (!value.startsWith(`${name}:`)) throw new CoursebinError("UI_CHANGED");
      return value.slice(name.length + 1).trim();
    };
    const section = field("Section").match(/^(\d{5})\s*[RD]$/);
    const units = field("Units");
    if (
      !section ||
      row.closest('div[id^="section_"]')?.id !== `section_${section[1]}` ||
      !/^\d{1,2}(?:\.\d{1,2})?$/.test(units)
    )
      throw new CoursebinError("UI_CHANGED");
    return {
      section_id: section[1]!,
      course_code: `${course[1]}${course[2]}`,
      session: field("Session"),
      type: field("Type"),
      units: Number(units),
      grade_option: field("Grade Option"),
    };
  });
  const result = checkoutTransaction.safeParse({
    term_code: term,
    kind: "register",
    sections,
  });
  if (!result.success) throw new CoursebinError("UI_CHANGED");
  return result.data;
}
