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
import "./chat.css";

type Message = { id: string; role: "student" | "assistant"; text: string };
interface Props {
  context: z.infer<typeof planningContext>;
  onLoad: (proposal: Proposal) => Promise<void>;
  plannerBusy: boolean;
}
const nativeAvailable = () =>
  typeof chrome !== "undefined" && !!chrome.runtime?.id;
const setupUrl =
  "https://github.com/advayiyer7/usc-course-scheduling-agent/blob/main/docs/companion-setup.md";
export function ChatPanel({ context, onLoad, plannerBusy }: Props) {
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
  const end = useRef<HTMLDivElement>(null);
  const mounted = useRef(true);
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
        break;
      case "message":
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
        setActivity(`Checking ${e.name.replaceAll("_", " ")}…`);
        break;
      case "proposal":
        setDrafts((old) => [...old, e.proposal].slice(-3));
        break;
      case "turn_complete":
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
    setLoginUrl("");
    const c = new CompanionClient(event, () => {
      if (!mounted.current) return;
      setConnected(false);
      setStatus(undefined);
      setBusy(false);
      setActionBusy(false);
      setLoginUrl("");
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
        setActivity("");
      }
      if (method === "cancel_login" || method === "logout") setLoginUrl("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed");
    } finally {
      setActionBusy(false);
    }
  }
  async function send(suggestion = false) {
    const c = client.current;
    if (!c || busy || actionBusy || !status?.authenticated) return;
    const prompt = suggestion
      ? text.trim() ||
        "Use my selected courses and preferences to suggest up to three schedules. Ask for missing information first. Use present_schedule to show validated drafts."
      : text.trim();
    if (!prompt) return;
    const parsed = planningContext.safeParse({ ...context, major });
    if (!parsed.success) {
      setError("Fix your planner preferences before sending.");
      return;
    }
    setError("");
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
      await c.request({ method: "chat", text: prompt, context: parsed.data });
    } catch (e) {
      setBusy(false);
      setActivity("");
      setError(e instanceof Error ? e.message : "Could not send message");
    }
  }
  async function load(draft: Proposal) {
    if (loadingId || plannerBusy || busy) return;
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
        Chat here with your own Codex access. Compare drafts, then load one into
        your calendar.
      </p>
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
              disabled={busy || actionBusy}
              onClick={() => void action("reset")}
            >
              New chat
            </button>
            <button
              className="outline"
              disabled={busy || actionBusy}
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
          USC provides ChatGPT Edu, but Codex requires an ITS access request and
          department approval.{" "}
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
            Choose the account or workspace with Codex access. Return here when
            sign-in finishes.
          </p>
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
        {messages.map((m) => (
          <div key={m.id} className={`chat-message ${m.role}`}>
            <b>{m.role === "student" ? "You" : "Course assistant"}</b>
            <p>{m.text}</p>
          </div>
        ))}
        {activity && (
          <p className="chat-activity" role="status">
            {activity}
          </p>
        )}
        <div ref={end} />
      </div>
      {drafts.length > 0 && (
        <div className="proposal-list" aria-label="Schedule drafts">
          {drafts.map((d) => (
            <article className="proposal-card" key={d.id}>
              <div>
                <h3>{d.selection.title}</h3>
                <span className={`draft-status ${d.validation.data.status}`}>
                  {d.validation.data.status === "indeterminate"
                    ? "Needs review"
                    : d.validation.data.status === "infeasible"
                      ? "Conflicts found"
                      : "Modeled checks passed"}
                </span>
              </div>
              <p>{d.selection.requested_courses.join(" · ")}</p>
              <p className="chat-note">
                Sections {d.selection.section_ids.join(", ")}
              </p>
              <p className="chat-note">
                Data checked{" "}
                {new Date(d.validation.meta.checked_at).toLocaleString()}
                {d.validation.meta.stale ? " · stale snapshot" : ""}.
                Eligibility is not established.
              </p>
              <ScheduleReview value={d.validation.data} />
              <button
                disabled={
                  !!loadingId ||
                  plannerBusy ||
                  busy ||
                  d.validation.data.status === "infeasible"
                }
                onClick={() => void load(d)}
              >
                {loadingId === d.id ? "Loading…" : "Load into planner"}
              </button>
            </article>
          ))}
        </div>
      )}
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
          disabled={!status?.authenticated || busy}
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
            disabled={!status?.authenticated || busy || actionBusy}
            onClick={() => void send(true)}
          >
            Suggest schedules
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
              disabled={!status?.authenticated || !text.trim() || actionBusy}
            >
              Send
            </button>
          )}
        </div>
      </form>
      <p className="chat-privacy">
        Sending shares your message, major, selected courses, and planning
        preferences with OpenAI. Chat lasts while this companion connection
        stays open. Keep USC passwords and student records out of chat.
      </p>
      <p className="chat-note">
        Pilot: AI proposals with deterministic validation. Coursebin additions
        and registration are not available yet.
      </p>
    </section>
  );
}
