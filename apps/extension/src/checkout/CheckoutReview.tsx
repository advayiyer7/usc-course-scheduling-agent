import React, { useEffect, useRef, useState } from "react";
import type { z } from "zod";
import type {
  Proposal,
  planningContext,
} from "../../../../packages/contracts/src/companion.js";
import {
  CHECKOUT_CHANNEL,
  checkoutReview,
  type CheckoutReview as Review,
} from "../../../../packages/contracts/src/checkout.js";
import { semester } from "../coursebin/CoursebinAction.js";

export function CheckoutReview({
  draft,
  context,
  disabled,
  onBusy,
}: {
  draft: Proposal;
  context: z.infer<typeof planningContext>;
  disabled: boolean;
  onBusy: (busy: boolean) => void;
}) {
  const [review, setReview] = useState<Review>();
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState("");
  const [now, setNow] = useState(Date.now());
  const revision = useRef(0);
  const owner = JSON.stringify([draft.id, context]);
  useEffect(() => {
    revision.current++;
    setReview(undefined);
    setError("");
    return () => {
      revision.current++;
    };
  }, [owner]);
  useEffect(() => {
    if (!review) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [review]);
  const available = typeof chrome !== "undefined" && !!chrome.runtime?.id;
  async function inspect() {
    const version = revision.current;
    setChecking(true);
    onBusy(true);
    setError("");
    setReview(undefined);
    try {
      const response = await chrome.runtime.sendMessage({
        channel: CHECKOUT_CHANNEL,
        method: "review",
        proposal: draft,
        context,
      });
      if (response?.ok !== true) {
        const messages: Record<string, string> = {
          LOGIN_REQUIRED:
            "Sign in to WebReg, select this semester, and open its Checkout page in the active tab. Then read it again.",
          WRONG_SEMESTER:
            "The WebReg semester differs from your plan. Select the correct semester before reading checkout.",
          BUSY: "Wait for the current WebReg operation to finish.",
          STALE_PROPOSAL:
            "Use Refresh data and recheck, then read checkout again.",
          STATE_CHANGED:
            "WebReg changed during the read. Check the page and try a fresh review.",
        };
        throw new Error(
          messages[response?.code] ??
            "WebReg's checkout structure could not be verified. Review the page directly. Nothing was submitted.",
        );
      }
      const value = checkoutReview.parse(response.review);
      if (version === revision.current) {
        setReview(value);
        setNow(Date.now());
      }
    } catch (e) {
      if (version === revision.current)
        setError(
          e instanceof Error
            ? e.message
            : "Could not read checkout. Nothing was submitted.",
        );
    } finally {
      setChecking(false);
      onBusy(false);
    }
  }
  return (
    <section
      className="coursebin-action"
      aria-label="Review pending registration"
    >
      <h3>Review pending registration</h3>
      <p>
        In WebReg, open{" "}
        <a
          href="https://webreg.usc.edu/Checkout"
          target="_blank"
          rel="noreferrer"
        >
          Checkout
        </a>
        , then read its pending registrations here. This step does not submit
        them.
      </p>
      <button
        type="button"
        disabled={!available || disabled || checking}
        onClick={() => void inspect()}
      >
        {checking ? "Reading checkout…" : "Read pending checkout"}
      </button>
      {!available && (
        <p>Use the Chrome extension on your signed-in WebReg tab.</p>
      )}
      {error && (
        <p role="alert" className="chat-error">
          {error}
        </p>
      )}
      {review && (
        <div className="coursebin-review">
          <h4>
            {semester(review.transaction.term_code)} · recognized registrations
          </h4>
          <p>
            Read at {new Date(review.checked_at).toLocaleTimeString()}. This is
            a snapshot of the page.
          </p>
          <ul>
            {review.transaction.sections.map((s) => (
              <li key={s.section_id}>
                <strong>
                  {s.course_code} · {s.section_id} · {s.type}
                </strong>
                <span>
                  Session {s.session} · {s.units} units · Grade option:{" "}
                  {s.grade_option}
                </span>
              </li>
            ))}
          </ul>
          {!!review.blockers.length && (
            <div role="alert">
              <h4>Resolve before registration</h4>
              <ul>
                {review.blockers.map((f, i) => (
                  <li key={i}>{f.message}</li>
                ))}
              </ul>
            </div>
          )}
          <ul>
            {review.warnings.map((f, i) => (
              <li key={i}>{f.message}</li>
            ))}
          </ul>
          {now >= review.expires_at && (
            <p role="status">
              This review expired. Read checkout again for current details.
            </p>
          )}
        </div>
      )}
      <p className="chat-note">
        Extension submission is awaiting live verification of WebReg's
        transaction and result handling. Continue to review and submit
        registration directly in WebReg.
      </p>
    </section>
  );
}
