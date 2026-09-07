import React, { useEffect, useRef, useState } from "react";
import type { z } from "zod";
import type {
  Proposal,
  planningContext,
} from "../../../../packages/contracts/src/companion.js";
import {
  COURSEBIN_CHANNEL,
  coursebinReport,
  CoursebinError,
  failureCode,
  failureMessage,
  type CoursebinPreview,
  type CoursebinReport,
  type CoursebinUiRequest,
} from "../../../../packages/contracts/src/coursebin.js";
import "./coursebin.css";

const available = () => typeof chrome !== "undefined" && !!chrome.runtime?.id;
async function request(
  value:
    | Omit<Extract<CoursebinUiRequest, { method: "prepare" }>, "channel">
    | Omit<Extract<CoursebinUiRequest, { method: "execute" }>, "channel">
    | { method: "cancel" | "status" },
) {
  const response = await chrome.runtime.sendMessage({
    channel: COURSEBIN_CHANNEL,
    ...value,
  });
  if (!response) throw new Error("Coursebin background did not reply.");
  if (!response.ok)
    throw new CoursebinError(
      failureCode.safeParse(response.code).data ?? "UI_CHANGED",
    );
  return response as {
    ok: true;
    preview?: CoursebinPreview;
    report?: CoursebinReport;
    active?: boolean;
  };
}
export function semester(term: number) {
  return `${["", "Spring", "Summer", "Fall"][term % 10]} ${Math.floor(term / 10)}`;
}
export async function stopCoursebinRun() {
  await request({ method: "cancel" });
}
interface Props {
  draft: Proposal;
  context: z.infer<typeof planningContext>;
  disabled: boolean;
  onBusy: (busy: boolean) => void;
  onReport: (report: CoursebinReport) => void;
  reviewOwner?: string;
  onReview?: (id: string) => void;
}
export function CoursebinAction({
  draft,
  context,
  disabled,
  onBusy,
  onReport,
  reviewOwner,
  onReview,
}: Props) {
  const [preview, setPreview] = useState<CoursebinPreview>();
  const [phase, setPhase] = useState<"idle" | "checking" | "adding">("idle");
  const [error, setError] = useState("");
  const [now, setNow] = useState(Date.now());
  const contextKey = JSON.stringify(context);
  const revision = useRef(0);
  useEffect(() => {
    revision.current++;
    setPreview(undefined);
  }, [contextKey, draft.id]);
  useEffect(() => {
    if (reviewOwner && reviewOwner !== draft.id) {
      revision.current++;
      setPreview(undefined);
    }
  }, [reviewOwner, draft.id]);
  useEffect(() => {
    if (!preview) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [preview]);
  async function reviewDraft() {
    onReview?.(draft.id);
    setPhase("checking");
    onBusy(true);
    setError("");
    setPreview(undefined);
    const currentRevision = revision.current;
    try {
      const value = await request({
        method: "prepare",
        proposal: draft,
        context,
      });
      if (currentRevision === revision.current) {
        setNow(Date.now());
        setPreview(value.preview);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not inspect WebReg.");
    } finally {
      setPhase("idle");
      onBusy(false);
    }
  }
  async function add() {
    if (!preview || preview.blockers.length || Date.now() >= preview.expires_at)
      return;
    const ticket = preview.ticket;
    setPhase("adding");
    onBusy(true);
    setError("");
    setPreview(undefined);
    try {
      const result = await request({ method: "execute", ticket });
      if (result.report) onReport(coursebinReport.parse(result.report));
    } catch (e) {
      setError(
        e instanceof CoursebinError
          ? e.message
          : "The run's reply was interrupted. Check the coursebin result in chat and inspect WebReg before starting again.",
      );
    } finally {
      setPhase("idle");
      onBusy(false);
    }
  }
  async function stop() {
    try {
      await request({ method: "cancel" });
      setError(
        "Stopping after any section already being processed. Its result will be checked.",
      );
    } catch {
      setError(
        "Could not request a stop. Inspect WebReg and the result before continuing.",
      );
    }
  }
  return (
    <div className="coursebin-action">
      <button
        type="button"
        disabled={!available() || disabled || phase !== "idle"}
        onClick={() => void reviewDraft()}
      >
        {phase === "checking"
          ? "Checking WebReg…"
          : phase === "adding"
            ? "Adding exact sections…"
            : "Add to coursebin"}
      </button>
      {phase === "adding" && (
        <button type="button" className="outline" onClick={() => void stop()}>
          Stop after current section
        </button>
      )}
      {!available() && (
        <p className="chat-note">
          Open this draft in the Chrome extension on your signed-in WebReg tab.
        </p>
      )}
      {error && (
        <p role="alert" className="chat-error">
          {error}
        </p>
      )}
      {preview && (
        <section
          className="coursebin-review"
          aria-label={`Review ${draft.selection.title} for coursebin`}
        >
          <h4>Confirm {semester(preview.selection.term_code)}</h4>
          <p>{preview.selection.title}</p>
          <ul>
            {preview.sections.map((s) => (
              <li key={s.section_id}>
                <strong>
                  {s.course_code} · {s.section_id} · {s.type}
                </strong>
                {s.meetings.map((m, i) => (
                  <span key={i}>{m} (Los Angeles)</span>
                ))}
                {preview.already_present.includes(s.section_id) && (
                  <span>Already in your coursebin — will be skipped.</span>
                )}
              </li>
            ))}
          </ul>
          {!!preview.blockers.length && (
            <div role="alert">
              <h4>Resolve before adding</h4>
              <ul>
                {preview.blockers.map((f, i) => (
                  <li key={i}>{f.message}</li>
                ))}
              </ul>
            </div>
          )}
          <h4>Review these findings</h4>
          <ul>
            {preview.warnings.map((f, i) => (
              <li key={i}>{f.message}</li>
            ))}
          </ul>
          <p>
            Confirming adds only the listed sections. Existing courses stay in
            place. Review the result in WebReg and complete checkout yourself.
          </p>
          <button
            type="button"
            disabled={
              disabled || !!preview.blockers.length || now >= preview.expires_at
            }
            onClick={() => void add()}
          >
            Confirm add to {semester(preview.selection.term_code)} coursebin
          </button>
          <button
            type="button"
            className="outline"
            onClick={() => setPreview(undefined)}
          >
            Cancel review
          </button>
          {now >= preview.expires_at && (
            <p role="status">
              This review expired. Click Add to coursebin to check it again.
            </p>
          )}
        </section>
      )}
    </div>
  );
}

/** Restore a lost run without requiring the old proposal card or a companion login. */
export function CoursebinLog({
  onReport,
  onBusy,
}: {
  onReport: (report: CoursebinReport) => void;
  onBusy: (active: boolean) => void;
}) {
  const reportRef = useRef(onReport),
    busyRef = useRef(onBusy);
  reportRef.current = onReport;
  busyRef.current = onBusy;
  useEffect(() => {
    if (!available()) return;
    let mounted = true;
    const refresh = async () => {
      try {
        const value = await request({ method: "status" });
        if (mounted) {
          busyRef.current(value.active ?? false);
          if (value.report)
            reportRef.current(coursebinReport.parse(value.report));
        }
      } catch {
        /* Explicit actions show connection errors; background recovery is read-only. */
      }
    };
    const changed = (
      _changes: Record<string, chrome.storage.StorageChange>,
      area: string,
    ) => {
      if (area === "session") void refresh();
    };
    chrome.storage.onChanged.addListener(changed);
    void refresh();
    const timer = setInterval(() => void refresh(), 2500);
    return () => {
      mounted = false;
      clearInterval(timer);
      chrome.storage.onChanged.removeListener(changed);
    };
  }, []);
  return null;
}
export function CoursebinResult({ report }: { report: CoursebinReport }) {
  return (
    <div className="coursebin-result">
      <p>
        {semester(report.term_code)} ·{" "}
        {report.phase === "running"
          ? "Addition in progress"
          : report.phase === "complete"
            ? "Coursebin checked"
            : "Run stopped"}
      </p>
      {report.code && <p>{failureMessage(report.code)}</p>}
      <ul>
        {report.sections.map((s) => (
          <li key={s.section_id}>
            <strong>
              {s.section_id}: {s.status.replaceAll("_", " ")}
            </strong>
            {s.code && <span>{failureMessage(s.code)}</span>}
          </li>
        ))}
      </ul>
      <p>
        Review{" "}
        <a
          href="https://webreg.usc.edu/CourseBin"
          target="_blank"
          rel="noreferrer"
        >
          myCourseBin
        </a>{" "}
        before completing checkout yourself.
      </p>
      <details>
        <summary>Structured section results</summary>
        <pre>{JSON.stringify(report, null, 2)}</pre>
      </details>
    </div>
  );
}
