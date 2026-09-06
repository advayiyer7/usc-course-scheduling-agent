import {
  binKey,
  codeOf,
  CoursebinError,
  type BinSnapshot,
  type CoursebinReport,
  type FailureCode,
} from "../../../../packages/contracts/src/coursebin.js";

export interface RunIO {
  read(): Promise<BinSnapshot>;
  // Implementations must check the exact page + bin immediately before clicking.
  add(
    sectionId: string,
    expected: BinSnapshot,
  ): Promise<FailureCode | undefined>;
  cancelled(): boolean;
  save(report: CoursebinReport, attempting?: string): Promise<void>;
}

function preserved(before: BinSnapshot, after: BinSnapshot, target: string) {
  return (
    before.term_code === after.term_code &&
    before.entries.every((a) =>
      after.entries.some((b) => JSON.stringify(a) === JSON.stringify(b)),
    ) &&
    after.entries.every(
      (b) =>
        b.section_id === target ||
        before.entries.some((a) => a.section_id === b.section_id),
    ) &&
    !after.entries.some(
      (b) =>
        b.section_id === target &&
        b.registered &&
        !before.entries.some((a) => a.section_id === target && a.registered),
    )
  );
}

/** No retry loop around mutations. Journal before dispatch so lost replies stay uncertain. */
export async function executeCoursebin(
  report: CoursebinReport,
  initial: BinSnapshot,
  io: RunIO,
) {
  let current = initial;
  const result = structuredClone(report);
  const finished = new Set<string>();
  for (const s of result.sections) {
    if (initial.entries.some((e) => e.section_id === s.section_id)) {
      s.status = "already_present";
      delete s.code;
      finished.add(s.section_id);
    }
  }
  for (const item of result.sections) {
    if (finished.has(item.section_id)) continue;
    let dispatched = false;
    try {
      if (io.cancelled()) throw new CoursebinError("INTERRUPTED");
      const before = await io.read();
      if (before.term_code !== initial.term_code)
        throw new CoursebinError("WRONG_SEMESTER");
      if (binKey(before) !== binKey(current))
        throw new CoursebinError("STATE_CHANGED");
      if (io.cancelled()) throw new CoursebinError("INTERRUPTED");
      item.status = "unconfirmed";
      item.code = "UNCONFIRMED";
      await io.save(result, item.section_id);
      if (io.cancelled()) throw new CoursebinError("INTERRUPTED");
      dispatched = true;
      const rejection = await io.add(item.section_id, before);
      const after = await io.read();
      if (!preserved(before, after, item.section_id))
        throw new CoursebinError("STATE_CHANGED");
      if (!after.entries.some((e) => e.section_id === item.section_id)) {
        const definitive =
          rejection &&
          [
            "FULL",
            "D_CLEARANCE",
            "WEBREG_REJECTED",
            "SECTION_MISSING",
          ].includes(rejection);
        item.status = definitive ? "failed" : "unconfirmed";
        item.code = rejection ?? "UNCONFIRMED";
        throw new CoursebinError(item.code);
      }
      item.status = "added";
      delete item.code;
      finished.add(item.section_id);
      current = after;
      await io.save(result);
    } catch (error) {
      const code = codeOf(error);
      // A lost reply can still have committed. Reconcile once, never click again.
      if (dispatched && item.status !== "failed") {
        item.status = "unconfirmed";
        item.code = code;
        try {
          const after = await io.read();
          if (
            preserved(current, after, item.section_id) &&
            after.entries.some((e) => e.section_id === item.section_id)
          ) {
            item.status = "added";
            delete item.code;
          }
        } catch {
          /* Auth/page loss leaves the section unconfirmed. */
        }
      } else if (!dispatched) {
        item.status = "failed";
        item.code = code;
      }
      finished.add(item.section_id);
      result.code = code;
      result.phase = "stopped";
      break;
    }
  }
  for (const s of result.sections) {
    if (!finished.has(s.section_id)) {
      s.status = "failed";
      s.code = "STOPPED";
    }
  }
  if (result.phase !== "stopped") result.phase = "complete";
  await io.save(result);
  return result;
}

/** Service-worker restart/closed panel recovery never resumes a mutation. */
export function interruptReport(
  report: CoursebinReport,
  attempting?: string,
): CoursebinReport {
  return {
    ...report,
    phase: "stopped",
    code: "INTERRUPTED",
    sections: report.sections.map((s) =>
      s.section_id === attempting
        ? { ...s, status: "unconfirmed", code: "INTERRUPTED" }
        : s.status === "failed" && s.code === "STOPPED"
          ? s
          : { ...s },
    ),
  };
}
