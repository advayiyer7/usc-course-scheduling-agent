import type { CheckoutTransaction } from "../../../../packages/contracts/src/checkout.js";
import type {
  BinSnapshot,
  Finding,
} from "../../../../packages/contracts/src/coursebin.js";

/** Cross-check the recognized registration list against every bin status and the chosen plan. */
export function assessCheckout(
  transaction: CheckoutTransaction,
  bin: BinSnapshot,
  selectedIds: string[],
): Finding[] {
  const blockers: Finding[] = [];
  if (transaction.term_code !== bin.term_code)
    return [
      {
        code: "wrong_semester",
        message: "The coursebin and checkout semesters differ.",
      },
    ];
  const pending = bin.entries.filter((e) => e.scheduled && !e.registered);
  if (
    pending.length !== transaction.sections.length ||
    !pending.every((e) =>
      transaction.sections.some(
        (s) => s.section_id === e.section_id && s.course_code === e.course_code,
      ),
    )
  )
    blockers.push({
      code: "pending_changed",
      message:
        "Checkout does not match all scheduled, unregistered sections in your coursebin. Review WebReg again.",
    });
  if (bin.entries.some((e) => e.registered && !e.scheduled))
    blockers.push({
      code: "pending_drop",
      message:
        "Your coursebin includes a registered section marked unscheduled. Resolve any pending drops directly in WebReg.",
    });
  for (const section of transaction.sections) {
    if (!selectedIds.includes(section.section_id))
      blockers.push({
        code: "extra_section",
        message: `Checkout includes section ${section.section_id}, which is outside your chosen plan.`,
      });
  }
  for (const id of selectedIds) {
    if (
      !transaction.sections.some((s) => s.section_id === id) &&
      !bin.entries.some(
        (e) => e.section_id === id && e.registered && e.scheduled,
      )
    )
      blockers.push({
        code: "missing_section",
        message: `Plan section ${id} is neither pending registration nor marked scheduled and registered in WebReg.`,
      });
  }
  if (
    bin.entries.some((e) => e.registered && !selectedIds.includes(e.section_id))
  )
    blockers.push({
      code: "existing_schedule",
      message:
        "Your existing registrations include sections outside this plan. Include them in a complete schedule validation before registering.",
    });
  return blockers;
}
