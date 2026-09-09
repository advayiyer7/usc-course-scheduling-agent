import React, { useEffect, useRef, useState } from "react";
import {
  AlertClient,
  AlertHttpError,
  alertRequest,
  readAlertToken,
  saveAlertToken,
} from "./client.js";
import {
  openingPrompt,
  planIdentity,
  type AlertEvent,
  type AlertInbox,
  type AlertPlan,
  type AlertWatch,
} from "../../../../packages/contracts/src/alerts.js";
import { semester } from "../coursebin/CoursebinAction.js";
import "./alerts.css";

interface Props {
  plan: AlertPlan;
  sections: { id: string; course_code: string; type: string }[];
  ready: boolean;
  disabled: boolean;
  onPrompt: (text: string) => void;
  onPlanner: () => void;
}
export function AlertsPanel({
  plan,
  sections,
  ready,
  disabled,
  onPrompt,
  onPlanner,
}: Props) {
  const [client, setClient] = useState<AlertClient>();
  const [loaded, setLoaded] = useState(false),
    [busy, setBusy] = useState(false);
  const [inbox, setInbox] = useState<AlertInbox>(),
    [error, setError] = useState("");
  const [synced, setSynced] = useState("");
  const identity = planIdentity(plan),
    latest = useRef(identity);
  latest.current = identity;
  useEffect(() => {
    let live = true;
    void readAlertToken()
      .then((t) => {
        if (live && t) setClient(new AlertClient(t));
      })
      .catch(() => {
        if (live) setError("Could not read alert settings.");
      })
      .finally(() => {
        if (live) setLoaded(true);
      });
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => {
    if (!ready || !client) return;
    let live = true,
      polling = false;
    setSynced("");
    setError("");
    const failed = async (e: unknown) => {
      if (!live) return;
      if (e instanceof AlertHttpError && e.status === 401) {
        await saveAlertToken();
        if (!live) return;
        setClient(undefined);
        setInbox(undefined);
      }
      if (live)
        setError(e instanceof Error ? e.message : "Alert service unavailable.");
    };
    const update = async () => {
      if (polling) return;
      polling = true;
      try {
        const value = await client.inbox();
        if (live) {
          setInbox(value);
          setError("");
        }
      } catch (e) {
        await failed(e);
      } finally {
        polling = false;
      }
    };
    void client
      .write("sync", plan)
      .then(async () => {
        if (live) {
          setSynced(identity);
          await update();
        }
      })
      .catch(failed);
    const timer = setInterval(() => {
      if (live) void update();
    }, 15000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [client, ready, identity]);
  const locked = disabled || busy || !ready || synced !== identity;
  async function connect() {
    setBusy(true);
    setError("");
    try {
      const p = await alertRequest<{ token: string }>("pair", undefined, {});
      await saveAlertToken(p.token);
      setClient(new AlertClient(p.token));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not connect alerts.");
    } finally {
      setBusy(false);
    }
  }
  async function action(path: string, body: unknown) {
    if (!client || locked) return;
    const key = identity;
    setBusy(true);
    setError("");
    try {
      await client.write(path, body);
      const value = await client.inbox();
      if (key === latest.current) setInbox(value);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Alert action failed.");
    } finally {
      setBusy(false);
    }
  }
  async function disconnect() {
    if (!client || busy) return;
    setBusy(true);
    setError("");
    try {
      await client.write("revoke", {});
      await saveAlertToken();
      setClient(undefined);
      setInbox(undefined);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete alert data.");
    } finally {
      setBusy(false);
    }
  }
  const currentWatches =
    inbox?.watches.filter((w) => planIdentity(w.plan) === identity) ?? [];
  function discuss(e: AlertEvent, w: AlertWatch) {
    if (!locked && planIdentity(w.plan) === identity)
      onPrompt(openingPrompt(e, w));
  }
  return (
    <section className="panel alerts-panel" aria-label="Course opening alerts">
      <p className="eyebrow">SCHEDULE HELPER · FORWARDING PILOT</p>
      <h2>Be ready when a seat opens.</h2>
      <p>
        Save the sections from your decided plan, then forward their Schedule
        Helper emails here. Review an opening with Codex and continue in WebReg.
      </p>
      {!client ? (
        <>
          <button disabled={!loaded || busy} onClick={() => void connect()}>
            Set up opening alerts
          </button>
          <p className="chat-note">
            This stores a minimal copy of your watched plan in your local
            backend. It does not connect your mailbox or your USC account.
          </p>
        </>
      ) : (
        <>
          <details className="alert-setup" open>
            <summary>Forwarding setup and saved watches</summary>
            <ol>
              <li>
                Load your chosen draft into My planner. Save each section you
                want to watch below.
              </li>
              <li>
                <a href="https://usc.jonlu.ca" target="_blank" rel="noreferrer">
                  Open USC Schedule Helper ↗
                </a>{" "}
                and enable its email notifications for the same semester and
                sections.
              </li>
              <li>
                {inbox?.address ? (
                  <>
                    Forward only mail from <code>schedule-helper@jonlu.ca</code>{" "}
                    to <code className="inbound-address">{inbox.address}</code>.
                    Finish any forwarding-address verification in your mail
                    provider.
                  </>
                ) : (
                  "The live receiving address is not configured yet. The synthetic test below exercises alert matching and review locally."
                )}
              </li>
            </ol>
            <p className="chat-note">
              Opening this website does not link the extensions automatically.
              Keep the original email for confirming its source and re-enabling
              Helper alerts. No mailbox password or USC password belongs here.
            </p>
            {inbox?.delivery.last_received_at && (
              <p className="chat-note">
                Email delivery: {inbox.delivery.queued} waiting,{" "}
                {inbox.delivery.processed} processed, {inbox.delivery.rejected}{" "}
                unrecognized and {inbox.delivery.failed} failed. Forwarding
                verification messages need operator review in the receiving
                provider dashboard.
              </p>
            )}
            {!sections.length && (
              <p>
                Choose a plan in chat, then use Edit in planner to select the
                sections to watch.
              </p>
            )}
            <div className="watch-list">
              {sections.map((s) => {
                const w = currentWatches.find(
                  (w) =>
                    w.section_id === s.id && w.course_code === s.course_code,
                );
                return (
                  <div className="watch-row" key={s.id}>
                    <span>
                      <strong>{s.course_code}</strong> · {s.id} · {s.type}
                    </span>
                    <button
                      className="outline"
                      disabled={locked}
                      onClick={() =>
                        void action(
                          w ? "remove-watch" : "watches",
                          w
                            ? { id: w.id }
                            : {
                                plan,
                                course_code: s.course_code,
                                section_id: s.id,
                              },
                        )
                      }
                    >
                      {w ? "Stop watching" : "Watch section"}
                    </button>
                    {w && inbox?.pilot_enabled && (
                      <button
                        className="outline"
                        disabled={locked}
                        onClick={() =>
                          void action("simulate", { watch_id: w.id })
                        }
                      >
                        Test alert
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
            <p className="chat-note">
              Changing your plan cancels watches for the old plan when the
              service reconnects. Test alerts are synthetic; their claimed seat
              count is replaced by the USC check.
            </p>
            <button
              className="outline"
              disabled={busy || disabled}
              onClick={() => void disconnect()}
            >
              Disconnect alerts and delete data
            </button>
          </details>
          <div className="alerts-toolbar">
            <h3>Reported openings</h3>
            <span>{currentWatches.length} watched sections</span>
          </div>
          {inbox && !inbox.events.length && (
            <p className="chat-note">
              No matching alerts yet. Save a watch and use Test alert to try the
              flow.
            </p>
          )}
          <div aria-live="polite">
            {inbox?.events.map((e) => {
              const candidates = currentWatches.filter((w) =>
                e.watch_ids.includes(w.id),
              );
              const selected = candidates.find(
                (w) => w.id === e.selected_watch_id,
              );
              const active =
                candidates.length > 0 &&
                !["expired", "invalidated", "dismissed"].includes(e.status);
              return (
                <article className="opening-card" key={e.id}>
                  <div className="opening-heading">
                    <strong>
                      {e.opening.course_code} · {e.opening.section_id}
                    </strong>
                    <span>
                      {e.source === "pilot"
                        ? "Synthetic test"
                        : "Forwarded email"}
                    </span>
                  </div>
                  <p>
                    {new Date(e.received_at).toLocaleString()} ·{" "}
                    {active
                      ? e.status.replaceAll("_", " ")
                      : e.status === "dismissed"
                        ? "Dismissed"
                        : "Expired or previous plan"}
                  </p>
                  <p>
                    {e.checked_at
                      ? `USC checked ${new Date(e.checked_at).toLocaleString()}: ${e.current_seats === null ? "availability unknown" : `${Math.max(0, e.current_seats)} reported seats`}.`
                      : `Email reports ${e.opening.reported_seats} seat(s). Availability has not been checked.`}
                  </p>
                  <p className="chat-note">{e.warning}</p>
                  {active && (
                    <>
                      {candidates.map((w) => (
                        <button
                          key={w.id}
                          className="outline"
                          disabled={locked || e.status === "checking"}
                          onClick={() =>
                            void action("confirm", {
                              event_id: e.id,
                              watch_id: w.id,
                              plan,
                              confirm_term_and_source: true,
                            })
                          }
                        >
                          {e.selected_watch_id
                            ? "Recheck"
                            : `Confirm ${semester(w.plan.term_code)} alert and recheck`}
                        </button>
                      ))}
                      {selected && e.status !== "checking" && (
                        <button
                          disabled={locked}
                          onClick={() => discuss(e, selected)}
                        >
                          Review with Codex
                        </button>
                      )}
                      {selected && e.status === "open" && (
                        <div className="opening-next">
                          <a
                            className="button-link"
                            href="https://webreg.usc.edu/CourseBin"
                            target="_blank"
                            rel="noreferrer"
                          >
                            Open WebReg / sign in ↗
                          </a>
                          <button
                            className="outline"
                            disabled={locked}
                            onClick={onPlanner}
                          >
                            Review planner and coursebin
                          </button>
                          <p className="chat-note">
                            Sign in through USC, select{" "}
                            {semester(selected.plan.term_code)}, then refresh
                            your planner before Add to coursebin. Review every
                            pending change on WebReg’s checkout page and submit
                            there. This pilot does not submit registration.
                          </p>
                        </div>
                      )}
                      <button
                        className="outline"
                        disabled={locked}
                        onClick={() => void action("dismiss", { id: e.id })}
                      >
                        Dismiss
                      </button>
                    </>
                  )}
                </article>
              );
            })}
          </div>
          {inbox?.has_more && (
            <p>
              Showing the latest 50 events. Older events are retained for seven
              days.
            </p>
          )}
        </>
      )}
      {error && (
        <p role="alert" className="chat-error">
          {error}
        </p>
      )}
    </section>
  );
}
