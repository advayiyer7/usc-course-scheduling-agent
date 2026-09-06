import React from "react";
import {
  validationReview,
  type ValidationReview,
} from "../../../packages/contracts/src/review.js";

const labels = {
  pass: "Passed",
  fail: "Needs changes",
  unknown: "Needs verification",
};
export function ScheduleReview({ value }: { value: unknown }) {
  const parsed = validationReview.safeParse(value);
  if (!parsed.success)
    return (
      <p className="review-warning" role="status">
        Detailed validation is unavailable. Update the local service and
        generate or check this schedule again.
      </p>
    );
  const review = parsed.data;
  const grouped = new Map<string, ValidationReview["availability"]>();
  for (const section of review.availability) {
    const code = section.clearance.guidance.course_code;
    grouped.set(code, [...(grouped.get(code) ?? []), section]);
  }
  return (
    <div className="schedule-review" aria-label="Schedule validation details">
      <p className={`status ${review.status}`}>
        {review.status === "infeasible"
          ? "Changes required"
          : review.status === "indeterminate"
            ? "Some checks need verification"
            : "Modeled scheduling checks passed"}
        {review.units === null
          ? " · Units unresolved"
          : ` · ${review.units} units`}
      </p>
      <dl className="review-summary">
        <div>
          <dt>Schedule compatibility</dt>
          <dd className={review.summary.compatibility}>
            {labels[review.summary.compatibility]}
          </dd>
        </div>
        <div>
          <dt>Required components</dt>
          <dd className={review.summary.components}>
            {labels[review.summary.components]}
          </dd>
        </div>
        <div>
          <dt>Seats at last check</dt>
          <dd>
            {review.summary.availability === "full"
              ? "At least one section full"
              : review.summary.availability === "unknown"
                ? "Availability incomplete"
                : "Seats reported; not reserved"}
          </dd>
        </div>
        <div>
          <dt>Your enrollment eligibility</dt>
          <dd>Unknown</dd>
        </div>
      </dl>
      <details className="review-checks">
        <summary>View {review.checks.length} validation findings</summary>
        <ul className="checks">
          {review.checks.slice(0, 50).map((check, i) => (
            <li key={i}>
              <span className={check.status}>
                {check.status === "pass"
                  ? "✓"
                  : check.status === "fail"
                    ? "!"
                    : "?"}
              </span>
              <div>
                <b className="sr-only">{labels[check.status]}: </b>
                {check.message}
              </div>
            </li>
          ))}
        </ul>
        {review.checks.length > 50 && (
          <p>
            Showing the first 50 findings. Review fewer courses at a time for
            the remaining details.
          </p>
        )}
      </details>
      <div className="clearance-groups">
        {[...grouped].map(([code, sections]) => {
          const guidance = sections[0]!.clearance.guidance;
          const needsHelp = sections.some(
            (s) => s.clearance.requirement !== "not_indicated",
          );
          return (
            <div className="clearance-course" key={code}>
              <strong>{code}</strong>
              <ul className="section-availability">
                {sections.map((s) => (
                  <li key={s.section_id}>
                    <span>
                      {s.section_id} ·{" "}
                      {s.available_seats === null
                        ? "Seats unknown"
                        : `${s.available_seats} seats at last check`}
                    </span>
                    <span>
                      {s.clearance.requirement === "required"
                        ? "D-clearance required · approval unknown"
                        : s.clearance.requirement === "unknown"
                          ? "Clearance requirement unknown"
                          : "D-clearance not indicated in snapshot"}
                    </span>
                    <small>
                      Checked {new Date(s.checked_at).toLocaleString()}
                    </small>
                  </li>
                ))}
              </ul>
              {needsHelp && (
                <details className="clearance-links">
                  <summary>
                    {guidance.coverage_status === "department_instructions"
                      ? "D-clearance instructions ↗"
                      : "Find department guidance ↗"}
                  </summary>
                  {guidance.routes.length ? (
                    <ul>
                      {guidance.routes.map((r) => (
                        <li key={r.id}>
                          <a
                            href={r.url}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            {r.title} ↗
                          </a>
                          <p>{r.audience}</p>
                          <p>{r.note}</p>
                          <small>
                            {r.kind === "catalog_directory"
                              ? "Directory route"
                              : "Instructions reviewed"}{" "}
                            · {r.verified_at.slice(0, 10)}
                            {r.stale ? " · Due for re-verification" : ""}
                          </small>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p>
                      The teaching department could not be resolved. Ask your
                      advisor to identify the correct clearance office.
                    </p>
                  )}
                  {guidance.warnings.map((warning, i) => (
                    <p className="review-warning" key={i}>
                      {warning}
                    </p>
                  ))}
                </details>
              )}
            </div>
          );
        })}
      </div>
      <p className="footnote">
        Clearance links open USC instructions. No request has been submitted and
        no seat is reserved.
      </p>
    </div>
  );
}
