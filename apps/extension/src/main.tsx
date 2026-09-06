import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { z } from "zod";
import {
  constraints as constraintsSchema,
  type Course,
  type Section,
} from "../../../packages/contracts/src/index.js";
import { readPreferences, savePreferences } from "./storage.js";
import "./style.css";

const API = "http://127.0.0.1:3000";
const weekdays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
interface Meta {
  snapshot_version: string;
  checked_at: string;
  stale: boolean;
}
interface Envelope<T> {
  data: T;
  meta: Meta;
}
async function tool<T>(name: string, args: unknown): Promise<Envelope<T>> {
  const r = await fetch(`${API}/api/tools/${name}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(args),
    signal: AbortSignal.timeout(15000),
  });
  const value = await r.json();
  if (value.error) throw new Error(value.error.message);
  if (!r.ok) throw new Error("Course service request failed");
  return value;
}
const savedSchema = z.object({
  term: z.number().int(),
  codes: z.array(z.string()).max(20),
  ids: z.array(z.string()).max(100),
  constraints: constraintsSchema,
  version: z.string().uuid().optional(),
});
type Constraints = z.infer<typeof constraintsSchema>;
interface Validation {
  status: string;
  units: number | null;
  checks: { code: string; status: string; message: string }[];
  eligibility: { status: string };
}
const minute = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
const labelTime = (t: string) => {
  const h = Number(t.slice(0, 2));
  return `${h % 12 || 12}:${t.slice(3)}${h < 12 ? "a" : "p"}`;
};
const colors = ["#8f272b", "#28595d", "#715a31", "#515c89", "#775b78"];
function App() {
  const [terms, setTerms] = useState<
      { term_code: number; snapshot_version: string }[]
    >([]),
    [term, setTerm] = useState(20263),
    [version, setVersion] = useState<string>();
  const [query, setQuery] = useState(""),
    [results, setResults] = useState<{ code: string; title: string }[]>([]),
    [searchCursor, setSearchCursor] = useState<string | null>(null),
    [searchTerm, setSearchTerm] = useState("");
  const [courses, setCourses] = useState<Course[]>([]),
    [sections, setSections] = useState<Section[]>([]),
    [ids, setIds] = useState<string[]>([]);
  const [constraints, setConstraints] = useState<Constraints>({
    unavailable: [],
    preferences: { instructors: [], free_days: [] },
  });
  const [meta, setMeta] = useState<Meta>(),
    [validation, setValidation] = useState<Validation>(),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [ready, setReady] = useState(false);
  const [blockDay, setBlockDay] = useState("Mon"),
    [blockStart, setBlockStart] = useState("09:00"),
    [blockEnd, setBlockEnd] = useState("10:00");
  const generation = useRef(0);
  const canSave = useRef(false);
  async function retrieve(
    codes: string[],
    selectedTerm: number,
    pinned?: string,
  ) {
    const allCourses: Course[] = [],
      allSections: Section[] = [];
    let m: Meta | undefined;
    if (codes.length) {
      const c = await tool<{ courses: Course[] }[]>("get_courses", {
        term_code: selectedTerm,
        course_codes: codes,
        snapshot_version: pinned,
      });
      m = c.meta;
      allCourses.push(...c.data.flatMap((c) => c.courses));
      let cursor: string | null = null;
      do {
        const s: Envelope<{ items: Section[]; next_cursor: string | null }> =
          await tool("get_sections", {
            term_code: selectedTerm,
            course_codes: codes,
            snapshot_version: c.meta.snapshot_version,
            ...(cursor ? { cursor } : {}),
          });
        allSections.push(...s.data.items);
        cursor = s.data.next_cursor;
      } while (cursor);
    }
    return { courses: allCourses, sections: allSections, meta: m };
  }
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const list = await tool<
          { term_code: number; snapshot_version: string }[]
        >("list_terms", {});
        const restored = savedSchema.safeParse(await readPreferences());
        const chosen = restored.success
          ? restored.data.term
          : (list.data[0]?.term_code ?? 20263);
        const pinned = restored.success
          ? restored.data.version
          : list.data.find((t) => t.term_code === chosen)?.snapshot_version;
        const data = await retrieve(
          restored.success ? restored.data.codes : [],
          chosen,
          pinned,
        );
        if (!active) return;
        canSave.current = true;
        setTerms(list.data);
        setTerm(chosen);
        setVersion(data.meta?.snapshot_version ?? pinned);
        setCourses(data.courses);
        setSections(data.sections);
        setMeta(data.meta);
        if (restored.success) {
          setIds(
            restored.data.ids.filter((id) =>
              data.sections.some((s) => s.id === id),
            ),
          );
          setConstraints(restored.data.constraints);
        }
      } catch (e) {
        if (active)
          setError(
            `Cannot load course data. Start the local backend with npm run dev. ${e instanceof Error ? e.message : ""}`,
          );
      } finally {
        if (active) setReady(true);
      }
    })();
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    if (
      !ready ||
      !canSave.current ||
      !constraintsSchema.safeParse(constraints).success
    )
      return;
    void savePreferences({
      term,
      codes: courses.map((c) => c.code),
      ids,
      constraints,
      version,
    }).catch(() => setError("Preferences could not be saved locally."));
  }, [ready, term, courses, ids, constraints, version]);
  const selected = sections.filter((s) => ids.includes(s.id));
  async function act(fn: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
    } finally {
      setBusy(false);
    }
  }
  async function search(more = false) {
    await act(async () => {
      const q = more ? searchTerm : query;
      const r = await tool<{
        items: { code: string; title: string }[];
        next_cursor: string | null;
      }>("search_courses", {
        term_code: term,
        query: q,
        snapshot_version: version,
        ...(more && searchCursor ? { cursor: searchCursor } : {}),
      });
      setResults((prev) => (more ? [...prev, ...r.data.items] : r.data.items));
      setSearchCursor(r.data.next_cursor);
      setSearchTerm(q);
      if (!r.data.items.length) setNotice(`No courses found for “${q}”.`);
      setMeta(r.meta);
      setVersion(r.meta.snapshot_version);
    });
  }
  async function add(code: string) {
    if (courses.length >= 20) {
      setError("Select at most 20 courses.");
      return;
    }
    await act(async () => {
      const d = await retrieve(
        [...courses.map((c) => c.code), code],
        term,
        version,
      );
      setCourses(d.courses);
      setSections(d.sections);
      setMeta(d.meta);
      setVersion(d.meta?.snapshot_version);
      setValidation(undefined);
      setResults([]);
      setQuery("");
    });
  }
  function remove(code: string) {
    generation.current++;
    const rest = courses.filter((c) => c.code !== code);
    setCourses(rest);
    setSections((prev) => prev.filter((s) => s.course_key !== code));
    setIds((prev) =>
      prev.filter(
        (id) => sections.find((s) => s.id === id)?.course_key !== code,
      ),
    );
    setValidation(undefined);
  }
  function choose(id: string) {
    generation.current++;
    setIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
    setValidation(undefined);
  }
  function changeConstraints(c: Constraints) {
    generation.current++;
    setConstraints(c);
    setValidation(undefined);
  }
  async function check() {
    await act(async () => {
      const g = generation.current;
      const r = await tool<Validation>("validate_schedule", {
        term_code: term,
        snapshot_version: version,
        requested_courses: courses.map((c) => c.code),
        section_ids: ids,
        constraints,
      });
      if (g === generation.current) {
        setValidation(r.data);
        setMeta(r.meta);
      }
    });
  }
  async function latest() {
    await act(async () => {
      const d = await retrieve(
        courses.map((c) => c.code),
        term,
      );
      setCourses(d.courses);
      setSections(d.sections);
      setVersion(d.meta?.snapshot_version);
      setMeta(d.meta);
      setIds((prev) =>
        prev.filter((id) => d.sections.some((s) => s.id === id)),
      );
      setValidation(undefined);
      setNotice(
        "Loaded the latest stored snapshot. Validate your selections again.",
      );
    });
  }
  async function refresh() {
    await act(async () => {
      const r = await tool<{ message: string }>("request_refresh", {
        term_code: term,
        course_codes: courses.map((c) => c.code),
      });
      setNotice(
        r.data.message + " Use “Load latest” after the worker completes.",
      );
    });
  }
  function exportPlan() {
    const data = {
      purpose: "USC course planning context; not enrollment",
      term,
      snapshot_version: version,
      checked_at: meta?.checked_at,
      courses,
      available_sections: sections,
      selected_section_ids: ids,
      constraints,
      validation: validation ?? { status: "unvalidated" },
      instructions:
        "Use exact section IDs. Missing component rules and dates remain unresolved. This exported file cannot call tools or refresh itself.",
    };
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `usc-plan-${term}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }
  const earliest = Math.min(
      8 * 60,
      ...constraints.unavailable.map((b) => minute(b.start)),
      ...selected.flatMap((s) =>
        s.meetings.flatMap((m) => (m.start ? [minute(m.start)] : [])),
      ),
    ),
    latestMinute = Math.max(
      20 * 60,
      ...constraints.unavailable.map((b) => minute(b.end)),
      ...selected.flatMap((s) =>
        s.meetings.flatMap((m) => (m.end ? [minute(m.end)] : [])),
      ),
    );
  const firstHour = Math.floor(earliest / 60),
    lastHour = Math.ceil(latestMinute / 60),
    height = (lastHour - firstHour) * 60;
  return (
    <>
      <header>
        <div className="brand">
          <span className="seal">SC</span>
          <div>
            <b>COURSE PLANNER</b>
            <span>Independent USC student project</span>
          </div>
        </div>
        <div className="header-actions">
          <span className="local-dot">Local preview</span>
          <label className="sr-only" htmlFor="term">
            Semester
          </label>
          <select
            id="term"
            disabled={busy}
            value={term}
            onChange={(e) => {
              const t = Number(e.target.value);
              generation.current++;
              setTerm(t);
              setVersion(
                terms.find((x) => x.term_code === t)?.snapshot_version,
              );
              setCourses([]);
              setSections([]);
              setIds([]);
              setResults([]);
              setMeta(undefined);
              setValidation(undefined);
            }}
          >
            {terms.length ? (
              terms.map((t) => (
                <option key={t.term_code} value={t.term_code}>
                  {["", "Spring", "Summer", "Fall"][t.term_code % 10]}{" "}
                  {Math.floor(t.term_code / 10)}
                </option>
              ))
            ) : (
              <option value={20263}>Fall 2026</option>
            )}
          </select>
        </div>
      </header>
      <main>
        <div className="intro">
          <div>
            <p className="eyebrow">MAKE ROOM FOR YOUR SEMESTER</p>
            <h1>A schedule that fits your life.</h1>
            <p>
              Choose your courses. Compare sections. Bring the details to your
              AI assistant.
            </p>
          </div>
          <button
            className="outline"
            disabled={!courses.length || busy}
            onClick={exportPlan}
          >
            Export for my assistant ↗
          </button>
        </div>
        {error && (
          <div role="alert" className="alert error">
            {error}
          </div>
        )}
        {notice && (
          <div role="status" className="alert">
            {notice}
          </div>
        )}
        <div className="workspace">
          <aside>
            <section className="panel">
              <div className="panel-title">
                <h2>Your courses</h2>
                <span>{courses.length}/20</span>
              </div>
              <form
                className="search"
                onSubmit={(e) => {
                  e.preventDefault();
                  void search();
                }}
              >
                <label className="sr-only" htmlFor="query">
                  Search course code or title
                </label>
                <input
                  id="query"
                  placeholder="Search code or title"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  maxLength={120}
                />
                <button
                  disabled={busy || !ready || !query.trim()}
                  type="submit"
                >
                  Find
                </button>
              </form>
              {results.length > 0 && (
                <div className="results">
                  {results.map((c) => (
                    <button
                      key={c.code}
                      disabled={
                        busy || courses.some((x) => x.aliases.includes(c.code))
                      }
                      onClick={() => void add(c.code)}
                    >
                      <strong>{c.code}</strong>
                      <span>{c.title}</span>
                      <b>＋</b>
                    </button>
                  ))}
                  {searchCursor && (
                    <button disabled={busy} onClick={() => void search(true)}>
                      More results
                    </button>
                  )}
                </div>
              )}
              {!courses.length && (
                <div className="empty">
                  <span>01</span>
                  <h3>Start with a course</h3>
                  <p>
                    Try CSCI 104, MATH 225, or a course title. Your choices stay
                    on this device.
                  </p>
                </div>
              )}
              {courses.map((c, i) => (
                <article className="course" key={c.key}>
                  <div className="course-title">
                    <span
                      className="course-dot"
                      style={{ background: colors[i % colors.length] }}
                    />
                    <div>
                      <h3>{c.code}</h3>
                      <p>{c.title}</p>
                    </div>
                    <button
                      className="icon"
                      disabled={busy}
                      aria-label={`Remove ${c.code}`}
                      onClick={() => remove(c.code)}
                    >
                      ×
                    </button>
                  </div>
                  <details>
                    <summary>
                      Choose sections{" "}
                      <span>
                        {selected.filter((s) => s.course_key === c.key).length}{" "}
                        selected
                      </span>
                    </summary>
                    <div className="section-list">
                      {sections
                        .filter((s) => s.course_key === c.key)
                        .map((s) => (
                          <label
                            key={s.id}
                            className={
                              ids.includes(s.id) ? "section chosen" : "section"
                            }
                          >
                            <input
                              type="checkbox"
                              checked={ids.includes(s.id)}
                              disabled={busy || s.cancelled}
                              onChange={() => choose(s.id)}
                            />
                            <div>
                              <strong>
                                {s.type} · {s.id}
                              </strong>
                              <span>
                                {s.meetings
                                  .map(
                                    (m) =>
                                      `${m.days.join(", ") || "Days unknown"} ${m.start && m.end ? `${labelTime(m.start)}–${labelTime(m.end)}` : "Time unknown"}`,
                                  )
                                  .join(" / ")}
                              </span>
                              <span>
                                {s.instructors.join(", ") ||
                                  "Instructor unassigned"}
                              </span>
                              <small>
                                {s.cancelled
                                  ? "Cancelled"
                                  : s.total_seats !== null &&
                                      s.registered_seats !== null
                                    ? `${Math.max(0, s.total_seats - s.registered_seats)} seats at last check`
                                    : "Seats unknown"}
                                {s.d_clearance ? " · D-clearance" : ""}
                              </small>
                            </div>
                          </label>
                        ))}
                    </div>
                  </details>
                </article>
              ))}
            </section>
            <section className="panel preferences">
              <h2>Protect your time</h2>
              <p className="muted">
                Hard limits apply to every proposed schedule.
              </p>
              <div className="time-pair">
                <label>
                  Earliest class
                  <input
                    type="time"
                    value={constraints.earliest ?? ""}
                    onInput={(e) =>
                      changeConstraints({
                        ...constraints,
                        earliest: e.currentTarget.value || undefined,
                      })
                    }
                  />
                </label>
                <label>
                  Latest finish
                  <input
                    type="time"
                    value={constraints.latest ?? ""}
                    onInput={(e) =>
                      changeConstraints({
                        ...constraints,
                        latest: e.currentTarget.value || undefined,
                      })
                    }
                  />
                </label>
              </div>
              <label className="small-label">Prefer these days free</label>
              <div className="days">
                {weekdays.slice(0, 5).map((d) => (
                  <button
                    key={d}
                    aria-pressed={constraints.preferences.free_days.includes(
                      d as never,
                    )}
                    className={
                      constraints.preferences.free_days.includes(d as never)
                        ? "active"
                        : ""
                    }
                    onClick={() =>
                      changeConstraints({
                        ...constraints,
                        preferences: {
                          ...constraints.preferences,
                          free_days: constraints.preferences.free_days.includes(
                            d as never,
                          )
                            ? constraints.preferences.free_days.filter(
                                (x) => x !== d,
                              )
                            : [
                                ...constraints.preferences.free_days,
                                d as never,
                              ],
                        },
                      })
                    }
                  >
                    {d}
                  </button>
                ))}
              </div>
              <details>
                <summary>Add unavailable time</summary>
                <div className="block-input">
                  <label>
                    Day
                    <select
                      value={blockDay}
                      onChange={(e) => setBlockDay(e.target.value)}
                    >
                      {weekdays.map((d) => (
                        <option key={d}>{d}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Start
                    <input
                      type="time"
                      value={blockStart}
                      onInput={(e) => setBlockStart(e.currentTarget.value)}
                    />
                  </label>
                  <label>
                    End
                    <input
                      type="time"
                      value={blockEnd}
                      onInput={(e) => setBlockEnd(e.currentTarget.value)}
                    />
                  </label>
                  <button
                    onClick={() => {
                      if (constraints.unavailable.length >= 50) {
                        setError("Use at most 50 unavailable time blocks.");
                        return;
                      }
                      if (blockStart >= blockEnd) {
                        setError("Unavailable time must end after it starts.");
                        return;
                      }
                      changeConstraints({
                        ...constraints,
                        unavailable: [
                          ...constraints.unavailable,
                          {
                            days: [blockDay as never],
                            start: blockStart,
                            end: blockEnd,
                          },
                        ],
                      });
                    }}
                  >
                    Add
                  </button>
                </div>
              </details>
              {constraints.unavailable.map((b, i) => (
                <div className="block-chip" key={i}>
                  {b.days.join(", ")} {b.start}–{b.end}
                  <button
                    aria-label={`Remove unavailable block ${i + 1}`}
                    onClick={() =>
                      changeConstraints({
                        ...constraints,
                        unavailable: constraints.unavailable.filter(
                          (_, j) => j !== i,
                        ),
                      })
                    }
                  >
                    ×
                  </button>
                </div>
              ))}
            </section>
          </aside>
          <div className="right">
            <section className="panel calendar-panel">
              <div className="calendar-heading">
                <div>
                  <p className="eyebrow">YOUR WEEK AT A GLANCE</p>
                  <h2>
                    {ids.length
                      ? `${ids.length} selected sections`
                      : "Build your week"}
                  </h2>
                </div>
                <span className="timezone">Los Angeles time</span>
              </div>
              <div className="calendar-scroll">
                <div className="calendar">
                  <div className="day-head">
                    <span />
                    {weekdays.map((d) => (
                      <b key={d}>{d}</b>
                    ))}
                  </div>
                  <div className="calendar-body" style={{ height }}>
                    <div className="time-axis">
                      {Array.from({ length: lastHour - firstHour }, (_, i) => (
                        <span key={i} style={{ top: i * 60 }}>
                          {(i + firstHour) % 12 || 12}
                          {i + firstHour < 12 ? "a" : "p"}
                        </span>
                      ))}
                    </div>
                    {weekdays.map((day) => (
                      <div className="day-column" key={day}>
                        {constraints.unavailable
                          .filter((b) => b.days.includes(day as never))
                          .map((b, i) => (
                            <div
                              className="calendar-block unavailable"
                              key={`blocked${i}`}
                              style={{
                                top: minute(b.start) - firstHour * 60,
                                height: minute(b.end) - minute(b.start),
                              }}
                            >
                              Unavailable
                            </div>
                          ))}
                        {selected.flatMap((s) =>
                          s.meetings
                            .filter(
                              (m) => m.days.includes(day) && m.start && m.end,
                            )
                            .map((m, i) => (
                              <button
                                className="calendar-block"
                                key={s.id + i}
                                title={`${s.course_key} ${s.type} ${s.id}: ${m.start}–${m.end}`}
                                onClick={() => {
                                  setNotice(
                                    `${s.course_key} · ${s.type} ${s.id} · ${s.instructors.join(", ") || "Instructor unassigned"}`,
                                  );
                                }}
                                style={{
                                  top: minute(m.start!) - firstHour * 60,
                                  height: Math.max(
                                    24,
                                    minute(m.end!) - minute(m.start!),
                                  ),
                                  background:
                                    colors[
                                      Math.max(
                                        0,
                                        courses.findIndex(
                                          (c) => c.key === s.course_key,
                                        ),
                                      ) % colors.length
                                    ],
                                }}
                              >
                                <b>{s.course_key}</b>
                                <span>
                                  {labelTime(m.start!)}–{labelTime(m.end!)}
                                </span>
                                <small>
                                  {s.type} · {s.id}
                                </small>
                              </button>
                            )),
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              {!ids.length && (
                <div className="calendar-note">
                  Select lecture, lab, discussion and quiz sections to place
                  them on your calendar.
                </div>
              )}
            </section>
            <section className="panel review">
              <div className="panel-title">
                <div>
                  <p className="eyebrow">CHECK BEFORE YOU COMMIT</p>
                  <h2>Schedule review</h2>
                </div>
                <button
                  disabled={busy || !ids.length || !courses.length || !version}
                  onClick={() => void check()}
                >
                  {busy ? "Working…" : "Validate schedule"}
                </button>
              </div>
              {validation ? (
                <>
                  <p className={`status ${validation.status}`}>
                    {validation.status === "indeterminate"
                      ? "More information needed"
                      : validation.status === "infeasible"
                        ? "Conflicts to resolve"
                        : "Feasible for checked constraints"}
                    {validation.units !== null
                      ? ` · ${validation.units} units`
                      : ""}
                  </p>
                  <ul className="checks">
                    {validation.checks.map((c, i) => (
                      <li key={i}>
                        <span className={c.status}>
                          {c.status === "pass"
                            ? "✓"
                            : c.status === "fail"
                              ? "!"
                              : "?"}
                        </span>
                        {c.message}
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <p className="muted">
                  Your plan is unvalidated. Check selected sections against your
                  time constraints.
                </p>
              )}
              <p className="footnote">
                Personal enrollment eligibility is unknown. Required component
                rules and meeting dates still need verification.
              </p>
            </section>
            <div className="data-bar">
              <div>
                <strong>
                  {meta?.stale
                    ? "Stored snapshot · refresh recommended"
                    : "Public course snapshot"}
                </strong>
                <p>
                  {meta
                    ? `Checked ${new Date(meta.checked_at).toLocaleString()}`
                    : "Select a course to see its data timestamp."}{" "}
                  · Seats are not reserved.
                </p>
              </div>
              <div>
                <button
                  className="text-button"
                  disabled={busy || !courses.length}
                  onClick={() => void latest()}
                >
                  Load latest
                </button>
                <button
                  className="text-button"
                  disabled={busy || !courses.length}
                  onClick={() => void refresh()}
                >
                  Request refresh
                </button>
              </div>
            </div>
            <details className="assistant-guide">
              <summary>Connect your AI assistant</summary>
              <p>
                Local MCP endpoint: <code>http://127.0.0.1:3000/mcp</code>. Use
                a local MCP client, or the repository’s stdio command. Hosted
                ChatGPT and Claude cannot reach this local address directly;
                hosted deployment and onboarding are pending.
              </p>
              <p>
                For other assistants, export selected course data above and
                attach the file. Installing this extension does not
                automatically connect an AI account. No provider API key is
                needed for this planner.
              </p>
            </details>
          </div>
        </div>
      </main>
      <footer>
        Independent USC Course Planner · Public catalog data · Preferences saved
        on this device
      </footer>
    </>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
