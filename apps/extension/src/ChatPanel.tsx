import React, { useEffect, useRef, useState } from "react";
import { ScheduleReview } from "./ScheduleReview.js";
import { z } from "zod";
import {
  accountStatus,
  planningContext,
  trustedLoginUrl,
  type CompanionEvent,
  type Proposal,
} from "../../../packages/contracts/src/companion.js";
import { CompanionClient } from "./companion-client.js";
import { DraftShelf } from "./draft-shelf.js";
import {
  CoursebinAction,
  CoursebinLog,
  CoursebinResult,
  stopCoursebinRun,
} from "./coursebin/CoursebinAction.js";
import type { CoursebinReport } from "../../../packages/contracts/src/coursebin.js";
import "./chat.css";

type Message = {
  id: string;
  role: "student" | "assistant";
  text: string;
  report?: CoursebinReport;
};
interface Props {
  context: z.infer<typeof planningContext>;
  onLoad: (proposal: Proposal) => Promise<void>;
  plannerBusy: boolean;
  onUndoRemoval?: (code: string) => void;
}
const nativeAvailable = () =>
  typeof chrome !== "undefined" && !!chrome.runtime?.id;
const setupUrl =
  "https://github.com/advayiyer7/usc-course-scheduling-agent/blob/main/docs/companion-setup.md";
export function ChatPanel({
  context,
  onLoad,
  plannerBusy,
  onUndoRemoval,
}: Props) {
  const client = useRef<CompanionClient | null>(null);
  const [status, setStatus] = useState<z.infer<typeof accountStatus>>();
  const [connected, setConnected] = useState(false),
    [busy, setBusy] = useState(false),
    [actionBusy, setActionBusy] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]),
    [drafts, setDrafts] = useState<Proposal[]>([]);
  const [text, setText] = useState(""),
    [major, setMajor] = useState(""),
    [majorReady, setMajorReady] = useState(false);
  const [error, setError] = useState(""),
    [activity, setActivity] = useState(""),
    [loginUrl, setLoginUrl] = useState("");
  const [loadingId, setLoadingId] = useState("");
  const [coursebinBusy, setCoursebinBusy] = useState(false);
  const [coursebinRunning, setCoursebinRunning] = useState(false);
  const [coursebinReviewOwner, setCoursebinReviewOwner] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  const [draftContext, setDraftContext] = useState("");
  const shelf = useRef(new DraftShelf());
  const currentTurn = useRef<
    { id: string; key: string; valid: boolean; running: boolean } | undefined
  >(undefined);
  const contextKey = JSON.stringify({ ...context, major });
  const currentContextKey = useRef(contextKey);
  currentContextKey.current = contextKey;
  const visibleDrafts = draftContext === contextKey ? drafts : [];
  const latestStudent = Math.max(
    0,
    messages.findLastIndex((m) => m.role === "student"),
  );
  const earlierCount = messages
    .slice(0, latestStudent)
    .filter((m) => !m.report).length;
  const end = useRef<HTMLDivElement>(null);
  const mounted = useRef(true);
  useEffect(() => {
    shelf.current.setContext(contextKey);
    setDrafts([]);
    setCoursebinReviewOwner("");
    if (currentTurn.current && currentTurn.current.key !== contextKey) {
      currentTurn.current.valid = false;
      if (currentTurn.current.running)
        void client.current
          ?.request({ method: "stop" })
          .catch(() =>
            setError(
              "Your planner changed. Stop or reconnect before requesting updated plans.",
            ),
          );
    }
  }, [contextKey]);
  useEffect(() => {
    mounted.current = true;
    void (async () => {
      try {
        const value = nativeAvailable()
          ? (await chrome.storage.local.get("usc-planner-major"))[
              "usc-planner-major"
            ]
          : localStorage.getItem("usc-planner-major");
        if (mounted.current)
          setMajor(
            z.string().max(120).safeParse(value).success
              ? (value as string)
              : "",
          );
      } finally {
        if (mounted.current) setMajorReady(true);
      }
    })().catch(() => setError("Could not restore your major preference."));
    return () => {
      mounted.current = false;
      client.current?.close();
      client.current = null;
    };
  }, []);
  useEffect(() => {
    if (!majorReady) return;
    if (nativeAvailable())
      void chrome.storage.local
        .set({ "usc-planner-major": major })
        .catch(() => setError("Could not save your major locally."));
    else localStorage.setItem("usc-planner-major", major);
  }, [major, majorReady]);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "nearest" });
  }, [messages, activity]);
  function event(e: CompanionEvent) {
    if (!mounted.current) return;
    switch (e.type) {
      case "status":
        setStatus(e.status);
        setConnected(true);
        setBusy(e.status.busy);
        break;
      case "login":
        setLoginUrl(e.url);
        setActivity("Finish signing in through OpenAI, then return here.");
        break;
      case "login_complete":
        setLoginUrl("");
        setActivity(
          e.success
            ? "Signed in. You can start planning."
            : "Sign-in was cancelled or did not complete.",
        );
        setMessages([]);
        setDrafts([]);
        shelf.current.clear();
        currentTurn.current = undefined;
        break;
      case "message":
        if (
          !currentTurn.current?.valid ||
          currentTurn.current.key !== currentContextKey.current
        )
          return;
        setActivity("");
        setMessages((old) => {
          const next: Message = { id: e.id, role: "assistant", text: e.text };
          const updated = old.some((m) => m.id === e.id)
            ? old.map((m) => (m.id === e.id ? next : m))
            : [...old, next];
          return updated.slice(-50);
        });
        break;
      case "tool":
        if (!currentTurn.current?.valid) return;
        setActivity(`Checking ${e.name.replaceAll("_", " ")}…`);
        break;
      case "proposal":
        if (
          !currentTurn.current?.valid ||
          currentTurn.current.key !== currentContextKey.current
        )
          return;
        {
          const accepted = shelf.current.accept(e.generation_id, e.proposal);
          if (accepted) {
            setDrafts(accepted);
            setDraftContext(currentTurn.current.key);
          } else if (!e.generation_id)
            setError(
              "Update and reconnect the companion to show current schedule cards.",
            );
        }
        break;
      case "turn_complete":
        if (e.generation_id && e.generation_id !== currentTurn.current?.id)
          return;
        shelf.current.finish(e.generation_id);
        if (currentTurn.current) currentTurn.current.running = false;
        setBusy(false);
        setActivity(e.status === "interrupted" ? "Response stopped." : "");
        break;
      case "error":
        setError(e.message);
        break;
      case "reply":
        break;
    }
  }
  async function connect() {
    if (!nativeAvailable() || actionBusy) return;
    setActionBusy(true);
    client.current?.close();
    setError("");
    setActivity("Connecting to your companion…");
    setMessages([]);
    setDrafts([]);
    shelf.current.clear();
    currentTurn.current = undefined;
    setLoginUrl("");
    const c = new CompanionClient(event, () => {
      if (!mounted.current) return;
      setConnected(false);
      setStatus(undefined);
      setBusy(false);
      setActionBusy(false);
      setLoginUrl("");
      shelf.current.clear();
      currentTurn.current = undefined;
      setDrafts([]);
      setActivity("Connection closed. Reconnect to start a new conversation.");
    });
    client.current = c;
    try {
      await c.request({ method: "status" });
      setActivity("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not connect");
    } finally {
      setActionBusy(false);
    }
  }
  async function action(
    method: "login" | "cancel_login" | "logout" | "reset" | "stop",
  ) {
    if (!client.current || actionBusy) return;
    setActionBusy(true);
    setError("");
    try {
      await client.current.request({ method });
      if (method === "logout" || method === "reset") {
        setMessages([]);
        setDrafts([]);
        shelf.current.clear();
        currentTurn.current = undefined;
        setActivity("");
      }
      if (method === "cancel_login" || method === "logout") setLoginUrl("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed");
    } finally {
      setActionBusy(false);
    }
  }
  function showCoursebinReport(report: CoursebinReport) {
    setMessages((old) => {
      const message: Message = {
        id: `coursebin-${report.run_id}`,
        role: "assistant",
        text: "",
        report,
      };
      const found = old.find((m) => m.id === message.id);
      if (found && JSON.stringify(found.report) === JSON.stringify(report))
        return old;
      return (
        found
          ? old.map((m) => (m.id === message.id ? message : m))
          : [...old, message]
      ).slice(-50);
    });
  }
  async function send(suggestion = false, explicitPrompt?: string) {
    const c = client.current;
    if (
      !c ||
      busy ||
      actionBusy ||
      plannerBusy ||
      coursebinBusy ||
      coursebinRunning ||
      loadingId ||
      !status?.authenticated
    )
      return;
    const prompt =
      explicitPrompt ??
      (suggestion
        ? text.trim() ||
          "Use my current planner courses and preferences to suggest up to two new schedules. Respect removed courses. Ask for missing information first. Use present_schedule to show validated drafts."
        : text.trim());
    if (!prompt) return;
    const parsed = planningContext.safeParse({ ...context, major });
    if (!parsed.success) {
      setError("Fix your planner preferences before sending.");
      return;
    }
    setError("");
    const generationId = crypto.randomUUID();
    currentTurn.current = {
      id: generationId,
      key: contextKey,
      valid: true,
      running: true,
    };
    shelf.current.begin(generationId, contextKey);
    setDrafts([]);
    setDraftContext(contextKey);
    setCoursebinReviewOwner("");
    setShowHistory(false);
    setBusy(true);
    setText("");
    setActivity("Thinking with Codex…");
    setMessages((old) =>
      [
        ...old,
        { id: crypto.randomUUID(), role: "student" as const, text: prompt },
      ].slice(-50),
    );
    try {
      await c.request({
        method: "chat",
        text: prompt,
        context: parsed.data,
        generation_id: generationId,
      });
    } catch (e) {
      if (currentTurn.current?.id !== generationId) return;
      shelf.current.clear();
      currentTurn.current = undefined;
      setDrafts([]);
      setText(prompt);
      setBusy(false);
      setActivity("");
      setError(e instanceof Error ? e.message : "Could not send message");
    }
  }
  async function load(draft: Proposal) {
    if (
      loadingId ||
      plannerBusy ||
      busy ||
      coursebinBusy ||
      coursebinRunning ||
      !visibleDrafts.some((d) => d.id === draft.id)
    )
      return;
    setLoadingId(draft.id);
    setError("");
    try {
      await onLoad(draft);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load this proposal");
    } finally {
      setLoadingId("");
    }
  }
  return (
    <section className="chat-panel" aria-label="Codex scheduling assistant">
      <CoursebinLog
        onReport={showCoursebinReport}
        onBusy={setCoursebinRunning}
      />
      <div className="chat-heading">
        <div>
          <p className="eyebrow">YOUR CODEX · YOUR COURSES</p>
          <h2>Let's plan your semester.</h2>
        </div>
        <span
          className={`connection-pill ${status?.authenticated ? "online" : ""}`}
        >
          {status?.authenticated
            ? `Connected · ${status.plan}`
            : connected
              ? "Sign in to chat"
              : "Companion offline"}
        </span>
      </div>
      <p className="chat-explainer">
        Tell me what you need. Compare two plans, then review your choice for
        WebReg.
      </p>
      <details className="companion-settings" open={!status?.authenticated}>
        <summary>Connection and major</summary>
        <label className="major-field">
          Your major{" "}
          <input
            maxLength={120}
            value={major}
            placeholder="e.g. Computer Science"
            disabled={!majorReady || busy}
            onChange={(e) => setMajor(e.target.value)}
          />
        </label>
        <div className="chat-controls">
          {!connected ? (
            <button
              onClick={() => void connect()}
              disabled={!nativeAvailable() || actionBusy}
            >
              Connect companion
            </button>
          ) : !status?.authenticated ? (
            <button disabled={actionBusy} onClick={() => void action("login")}>
              Sign in with ChatGPT
            </button>
          ) : (
            <>
              <button
                className="outline"
                disabled={
                  busy || actionBusy || coursebinBusy || coursebinRunning
                }
                onClick={() => void action("reset")}
              >
                New chat
              </button>
              <button
                className="outline"
                disabled={
                  busy || actionBusy || coursebinBusy || coursebinRunning
                }
                onClick={() => void action("logout")}
              >
                Sign out
              </button>
            </>
          )}
          <a href={setupUrl} target="_blank" rel="noreferrer">
            Setup guide ↗
          </a>
        </div>
        {!nativeAvailable() && (
          <p className="chat-note">
            This web preview cannot connect to native applications. Load the
            Chrome extension and install its companion to use chat.
          </p>
        )}
        {!status?.authenticated && (
          <p className="chat-note">
            USC provides ChatGPT Edu, but Codex requires an ITS access request
            and department approval.{" "}
            <a
              href="https://itservices.usc.edu/ai/chatgpt-edu-at-usc/"
              target="_blank"
              rel="noreferrer"
            >
              Check USC access ↗
            </a>
          </p>
        )}
        {loginUrl && trustedLoginUrl(loginUrl) && (
          <div className="login-card">
            <a
              className="button-link"
              href={loginUrl}
              target="_blank"
              rel="noreferrer"
            >
              Continue to OpenAI sign-in ↗
            </a>
            <button
              className="outline"
              disabled={actionBusy}
              onClick={() => void action("cancel_login")}
            >
              Cancel sign-in
            </button>
            <p>
              Choose the account or workspace with Codex access. Return here
              when sign-in finishes.
            </p>
          </div>
        )}
      </details>
      {coursebinRunning && (
        <div className="active-coursebin" role="status">
          <span>Adding your confirmed schedule to WebReg…</span>
          <button
            className="outline"
            onClick={() =>
              void stopCoursebinRun().catch(() =>
                setError(
                  "Could not stop the coursebin run. Inspect WebReg before continuing.",
                ),
              )
            }
          >
            Stop after current section
          </button>
        </div>
      )}
      {(context.course_codes.length > 0 ||
        !!context.removed_courses?.length) && (
        <div className="planner-context" aria-label="Current planner context">
          <strong>Your current planner</strong>
          <p>
            {context.course_codes.length
              ? context.course_codes.join(" · ")
              : "No courses selected"}
          </p>
          {!!context.removed_courses?.length && (
            <div className="removed-courses">
              <span>Removed from new plans:</span>
              {context.removed_courses.map((c) => (
                <span className="removed-course" key={c.course_code}>
                  {c.course_code}
                  {onUndoRemoval && (
                    <button
                      type="button"
                      disabled={
                        busy || plannerBusy || coursebinBusy || coursebinRunning
                      }
                      onClick={() => onUndoRemoval(c.course_code)}
                      aria-label={`Undo removal of ${c.course_code}`}
                    >
                      Undo
                    </button>
                  )}
                </span>
              ))}
            </div>
          )}
          <small>
            New requests use these choices. Editing the planner clears old plan
            cards.
          </small>
        </div>
      )}
      {error && (
        <div role="alert" className="chat-error">
          {error}
        </div>
      )}
      <div
        className="conversation"
        aria-label="Conversation"
        aria-live="polite"
        aria-relevant="additions"
      >
        {!messages.length && (
          <div className="chat-empty">
            <span aria-hidden="true">✦</span>
            <h3>Make room for what matters.</h3>
            <p>
              Try “I need CSCI 104 and MATH 225. Keep mornings free and compare
              my options.”
            </p>
          </div>
        )}
        {earlierCount > 0 && (
          <button
            className="history-toggle"
            type="button"
            aria-expanded={showHistory}
            onClick={() => setShowHistory((value) => !value)}
          >
            {showHistory
              ? "Hide earlier messages"
              : `Show earlier messages (${earlierCount})`}
          </button>
        )}
        {messages
          .filter((m, i) => m.report || showHistory || i >= latestStudent)
          .map((m) => (
            <div key={m.id} className={`chat-message ${m.role}`}>
              <b>
                {m.report
                  ? "WebReg coursebin result"
                  : m.role === "student"
                    ? "You"
                    : "Course assistant"}
              </b>
              {m.report ? (
                <>
                  <CoursebinResult report={m.report} />
                  {m.report.phase !== "running" &&
                    m.report.sections.some(
                      (s) =>
                        s.status === "failed" || s.status === "unconfirmed",
                    ) && (
                      <button
                        type="button"
                        className="outline"
                        disabled={
                          !status?.authenticated ||
                          busy ||
                          actionBusy ||
                          plannerBusy ||
                          coursebinBusy ||
                          coursebinRunning
                        }
                        onClick={() =>
                          void send(
                            false,
                            `Review these structured coursebin results. Each section tuple is [id, status, failure_code]. For unconfirmed sections, ask me to inspect WebReg first. Propose alternatives for failed sections using present_schedule; do not apply replacements. Browser result: ${JSON.stringify({ term_code: m.report?.term_code, proposal_id: m.report?.proposal_id, sections: m.report?.sections.map((s) => [s.section_id, s.status, s.code ?? null]) })}`,
                          )
                        }
                      >
                        Ask companion for alternatives
                      </button>
                    )}
                </>
              ) : (
                <p>{m.text}</p>
              )}
            </div>
          ))}
        {activity && (
          <p className="chat-activity" role="status">
            {activity}
          </p>
        )}
        <div ref={end} />
      </div>
      <form
        className="chat-composer"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <label className="sr-only" htmlFor="chat-message">
          Message the course assistant
        </label>
        <textarea
          id="chat-message"
          value={text}
          maxLength={6000}
          disabled={
            !status?.authenticated || busy || coursebinBusy || coursebinRunning
          }
          placeholder={
            status?.authenticated
              ? "Tell me which classes you need…"
              : "Connect and sign in to start chatting"
          }
          onChange={(e) => setText(e.target.value)}
          rows={3}
        />
        <div className="composer-actions">
          <button
            className="outline"
            type="button"
            disabled={
              !status?.authenticated ||
              busy ||
              actionBusy ||
              plannerBusy ||
              coursebinBusy ||
              coursebinRunning ||
              !!loadingId
            }
            onClick={() => void send(true)}
          >
            Generate plans
          </button>
          {busy ? (
            <button
              type="button"
              disabled={actionBusy}
              onClick={() => void action("stop")}
            >
              Stop response
            </button>
          ) : (
            <button
              disabled={
                !status?.authenticated ||
                !text.trim() ||
                actionBusy ||
                plannerBusy ||
                coursebinBusy ||
                coursebinRunning ||
                !!loadingId
              }
            >
              Send
            </button>
          )}
        </div>
      </form>
      {visibleDrafts.length > 0 && (
        <div className="proposal-list" aria-label="Schedule drafts">
          <div className="proposal-list-heading">
            <h3>Your latest plans</h3>
            <span>{visibleDrafts.length} of 2 options</span>
          </div>
          {visibleDrafts.map((d, index) => (
            <article className="proposal-card" key={d.id}>
              <div>
                <span className="plan-number">{index + 1}</span>
                <h3>{d.selection.title}</h3>
                <span className={`draft-status ${d.validation.data.status}`}>
                  {d.validation.data.status === "indeterminate"
                    ? "Needs review"
                    : d.validation.data.status === "infeasible"
                      ? "Conflicts found"
                      : "Modeled checks passed"}
                </span>
              </div>
              <div className="plan-courses">
                {d.selection.requested_courses.map((code) => (
                  <span key={code}>{code}</span>
                ))}
              </div>
              <p className="chat-note">
                Sections {d.selection.section_ids.join(", ")}
              </p>
              <p className="chat-note">
                Data checked{" "}
                {new Date(d.validation.meta.checked_at).toLocaleString()}
                {d.validation.meta.stale ? " · stale snapshot" : ""}.
                Eligibility is not established.
              </p>
              <details className="proposal-details">
                <summary>Validation and D-clearance</summary>
                <ScheduleReview value={d.validation.data} />
              </details>
              <div className="plan-actions">
                <button
                  className="outline"
                  disabled={
                    coursebinBusy ||
                    coursebinRunning ||
                    !!loadingId ||
                    plannerBusy ||
                    busy ||
                    d.validation.data.status === "infeasible"
                  }
                  onClick={() => void load(d)}
                >
                  {loadingId === d.id ? "Loading…" : "Edit in planner"}
                </button>
                <CoursebinAction
                  draft={d}
                  context={{ ...context, major }}
                  disabled={
                    busy ||
                    plannerBusy ||
                    !!loadingId ||
                    coursebinBusy ||
                    coursebinRunning
                  }
                  onBusy={setCoursebinBusy}
                  onReport={showCoursebinReport}
                  reviewOwner={coursebinReviewOwner}
                  onReview={setCoursebinReviewOwner}
                />
              </div>
            </article>
          ))}
        </div>
      )}

      <p className="chat-privacy">
        Sending shares your message, major, selected courses, and planning
        preferences with OpenAI. Chat lasts while this companion connection
        stays open. Keep USC passwords and student records out of chat.
      </p>
      <p className="chat-note">
        Coursebin additions require a draft-specific review and confirmation.
        Unresolved component rules block addition. Complete registration
        yourself in WebReg.
      </p>
    </section>
  );
}
