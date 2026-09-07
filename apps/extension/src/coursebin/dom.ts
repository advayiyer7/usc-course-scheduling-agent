import {
  binSnapshot,
  CoursebinError,
  WEBREG_ORIGIN,
  type BinSnapshot,
} from "../../../../packages/contracts/src/coursebin.js";

const normalized = (text: string | null) =>
  (text ?? "").replace(/\s+/g, " ").trim();
function one<T extends Element>(items: ArrayLike<T>): T {
  if (items.length !== 1) throw new CoursebinError("UI_CHANGED");
  return items[0]!;
}
export function readSemester(doc: Document): number {
  if (
    !doc.querySelector('a[href="/auth/logout"]') ||
    !doc.querySelector('a[href="/CourseBin"]')
  )
    throw new CoursebinError("LOGIN_REQUIRED");
  const anchor = one(doc.querySelectorAll('a[href="/Departments"]'));
  const match = normalized(anchor.textContent).match(
    /^(Spring|Summer|Fall) (20\d{2}) Classes$/,
  );
  if (!match) throw new CoursebinError("UI_CHANGED");
  return (
    Number(match[2]) * 10 + ["Spring", "Summer", "Fall"].indexOf(match[1]!) + 1
  );
}
export function assertSemester(doc: Document, term: number) {
  if (readSemester(doc) !== term) throw new CoursebinError("WRONG_SEMESTER");
}
function field(row: Element, label: string): string {
  const candidates = [...row.children].filter(
    (x) =>
      x.classList.contains("section_row") &&
      normalized(x.textContent).startsWith(`${label}:`),
  );
  return normalized(one(candidates).textContent)
    .slice(label.length + 1)
    .trim();
}
function identity(row: Element) {
  const id = field(row, "Section").match(/^(\d{5})\s*([RD])$/);
  const group = row.closest('div[id^="courseBin_"]');
  const course = group?.id.match(/^courseBin_([A-Z]{2,8})-(\d{3}[A-Z]{0,3})$/);
  if (!id || !course) throw new CoursebinError("UI_CHANGED");
  return {
    section_id: id[1]!,
    course_code: `${course[1]}${course[2]}`,
    clearance: id[2] === "D",
  };
}
export function readBin(doc: Document, term: number): BinSnapshot {
  assertSemester(doc, term);
  one(
    [...doc.querySelectorAll("h3")].filter(
      (x) => normalized(x.textContent) === "myCourseBin",
    ),
  );
  const entries = [...doc.querySelectorAll(".section_crsbin")].map((row) => {
    const { section_id, course_code } = identity(row);
    // WebReg also uses this styling class on unlabelled annotation containers.
    // Only identified nodes encode scheduled/registered state; never read the
    // annotation text. Require all four states for this exact section.
    const states = [...row.querySelectorAll<HTMLElement>(".dvSRtxt")].filter(
      (node) => node.id !== "",
    );
    const identities = states.map((node) =>
      node.id.match(/^sched([YN])_reg([YN])_status_(\d{5})$/),
    );
    if (
      states.length !== 4 ||
      states.some((s) => !["block", "none"].includes(s.style.display)) ||
      identities.some((match) => !match || match[3] !== section_id) ||
      new Set(identities.map((match) => match?.slice(1, 3).join(""))).size !== 4
    )
      throw new CoursebinError("UI_CHANGED");
    const state = one(states.filter((s) => s.style.display === "block"));
    const match = state.id.match(/^sched([YN])_reg([YN])_status_(\d{5})$/)!;
    return {
      section_id,
      course_code,
      scheduled: match[1] === "Y",
      registered: match[2] === "Y",
    };
  });
  // Empty-bin markup was not observed. Do not mistake an incomplete response for an empty bin.
  if (!entries.length) throw new CoursebinError("UI_CHANGED");
  const parsed = binSnapshot.safeParse({ term_code: term, entries });
  if (!parsed.success) throw new CoursebinError("UI_CHANGED");
  return parsed.data;
}

/** Inspect only the observed public fields; never read form values/hidden inputs. */
export function findAdd(
  doc: Document,
  term: number,
  section: string,
  courses: string[],
) {
  assertSemester(doc, term);
  const button = one(
    doc.querySelectorAll<HTMLButtonElement>(
      `button.add-to-course-bin[id="submit-add-${section}"]`,
    ),
  );
  const row = button.closest(".section_crsbin");
  if (!row) throw new CoursebinError("UI_CHANGED");
  const id = identity(row);
  if (id.section_id !== section || !courses.includes(id.course_code))
    throw new CoursebinError("SECTION_MISSING");
  if (
    normalized(button.textContent) !== "Add to myCourseBin" ||
    button.type !== "submit" ||
    button.disabled
  )
    throw new CoursebinError("UI_CHANGED");
  const form = button.closest("form");
  if (
    [
      "form",
      "formaction",
      "formmethod",
      "formtarget",
      "formenctype",
      "formnovalidate",
    ].some((name) => button.hasAttribute(name)) ||
    ("form" in button && button.form !== form)
  )
    throw new CoursebinError("UI_CHANGED");
  if (
    !form ||
    form.getAttribute("action") !== "/api/Section/Add" ||
    form.getAttribute("method")?.toLowerCase() !== "post" ||
    form.getAttribute("data-ajax") !== "true" ||
    form.getAttribute("data-ajax-method")?.toLowerCase() !== "post" ||
    form.getAttribute("data-ajax-url") !==
      `/api/section/${term}/${section}/add` ||
    form.getAttribute("data-ajax-begin") !==
      `disableAddCourseBin('${section}')` ||
    form.getAttribute("data-ajax-complete") !==
      `handleAddCourseBin(xhr, status, '${section}')`
  )
    throw new CoursebinError("UI_CHANGED");
  one(row.querySelectorAll(`[id="result-${section}"]`));
  const capacity = field(row, "Registered");
  if (capacity === "Closed") throw new CoursebinError("FULL");
  const seats = capacity.match(/^(\d+) of (\d+)$/);
  if (!seats) throw new CoursebinError("UI_CHANGED");
  if (Number(seats[1]) >= Number(seats[2])) throw new CoursebinError("FULL");
  const group = row.closest('div[id^="courseBin_"]')!;
  const expand = one(
    doc.querySelectorAll<HTMLAnchorElement>(`a[href="#${group.id}"]`),
  );
  const signature = JSON.stringify(
    [...row.children]
      .filter((x) => x.classList.contains("section_row"))
      .map((x) => normalized(x.textContent)),
  );
  return { button, row, expand, clearance: id.clearance, signature };
}
export function allowedPage(url: string): boolean {
  const u = new URL(url);
  return (
    u.origin === WEBREG_ORIGIN &&
    ["/CourseBin", "/Courses", "/Departments", "/Search", "/Calendar"].includes(
      u.pathname,
    )
  );
}
