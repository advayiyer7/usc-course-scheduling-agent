import React, { useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";
import {
  constraints as constraintsSchema,
  inputs,
  type Course,
  type Section,
} from "../../../packages/contracts/src/index.js";
import { readPreferences, savePreferences } from "./storage.js";
import { ChatPanel } from "./ChatPanel.js";
import { ScheduleReview } from "./ScheduleReview.js";
import { observeValidation, type ReviewState } from "./validation-request.js";
import {
  validationReview,
  type ValidationReview,
} from "../../../packages/contracts/src/review.js";
import {
  protectConstraints,
  proposal,
  removedCourses as removedCoursesSchema,
  type Proposal,
} from "../../../packages/contracts/src/companion.js";
import {
  CoursebinAction,
  CoursebinLog,
  CoursebinResult,
  stopCoursebinRun,
} from "./coursebin/CoursebinAction.js";
import type { CoursebinReport } from "../../../packages/contracts/src/coursebin.js";
import { refreshExactSelection } from "./planner-refresh.js";
import "./style.css";

const API = "http://127.0.0.1:3000";
const weekdays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
interface Meta {
  snapshot_version: string;
  checked_at: string;
  stale: boolean;
  warnings?: string[];
}
interface Envelope<T> {
  data: T;
  meta: Meta;
}
async function tool<T>(
  name: string,
  args: unknown,
  signal?: AbortSignal,
): Promise<Envelope<T>> {
  const r = await fetch(`${API}/api/tools/${name}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(args),
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(15000)])
      : AbortSignal.timeout(15000),
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
  removed_courses: removedCoursesSchema.optional(),
});
type Constraints = z.infer<typeof constraintsSchema>;
type Validation = ValidationReview;
const minute = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
const labelTime = (t: string) => {
  const h = Number(t.slice(0, 2));
  return `${h % 12 || 12}:${t.slice(3)}${h < 12 ? "a" : "p"}`;
};
const colors = ["#8f272b", "#28595d", "#715a31", "#515c89", "#775b78"];
export function App() {
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState("");
  const refreshController = useRef<AbortController | null>(null);
  useEffect(() => () => refreshController.current?.abort(), []);
  const [plannerRevision, setPlannerRevision] = useState(0);
  const [coursebinBusy, setCoursebinBusy] = useState(false);
  const [coursebinRunning, setCoursebinRunning] = useState(false);
  const [coursebinReport, setCoursebinReport] = useState<CoursebinReport>();
  const invalidateDrafts = () => setPlannerRevision((value) => value + 1);
  const [view, setView] = useState<"chat" | "planner">("chat");
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
  const [removedCourses, setRemovedCourses] = useState<
    z.infer<typeof removedCoursesSchema>
  >([]);
  const [constraints, setConstraints] = useState<Constraints>({
    unavailable: [],
    preferences: { instructors: [], free_days: [] },
  });
  const [meta, setMeta] = useState<Meta>(),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [ready, setReady] = useState(false);
  const [review, setReview] = useState<{
    key: string;
    state: ReviewState<Envelope<Validation>>;
  }>();
  const [validationAttempt, setValidationAttempt] = useState(0);
  const validationInput = JSON.stringify({
    term_code: term,
    snapshot_version: version,
    requested_courses: courses.map((c) => c.code),
    section_ids: ids,
    constraints,
  });
  const validationKey = `${validationAttempt}:${validationInput}`;
  // Never render a previous selection's result, including the render before effect cleanup.
  const reviewState =
    !busy && review?.key === validationKey ? review.state : undefined;
  const validation =
    reviewState?.status === "ready" ? reviewState.value.data : undefined;
  const [blockDay, setBlockDay] = useState("Mon"),
    [blockStart, setBlockStart] = useState("09:00"),
    [blockEnd, setBlockEnd] = useState("10:00");
  const generation = useRef(0);
  const canSave = useRef(false);
  async function retrieve(
    codes: string[],
    selectedTerm: number,
    pinned?: string,
    signal?: AbortSignal,
  ) {
    const allCourses: Course[] = [],
      allSections: Section[] = [];
    let m: Meta | undefined;
    if (codes.length) {
      const c = await tool<{ courses: Course[] }[]>(
        "get_courses",
        {
          term_code: selectedTerm,
          course_codes: codes,
          snapshot_version: pinned,
        },
        signal,
      );
      m = c.meta;
      allCourses.push(...c.data.flatMap((c) => c.courses));
      let cursor: string | null = null;
      do {
        const s: Envelope<{ items: Section[]; next_cursor: string | null }> =
          await tool(
            "get_sections",
            {
              term_code: selectedTerm,
              course_codes: codes,
              snapshot_version: c.meta.snapshot_version,
              ...(cursor ? { cursor } : {}),
            },
            signal,
          );
        allSections.push(...s.data.items);
        cursor = s.data.next_cursor;
      } while (cursor);
    }
    return { courses: allCourses, sections: allSections, meta: m };
  }
  async function loadProposal(draft: Proposal) {
    if (busy || !ready)
      throw new Error("Wait for the planner to finish loading");
    setBusy(true);
    const g = generation.current;
    try {
      if (draft.selection.term_code !== term)
        throw new Error(
          "This draft is for another semester. Switch semesters deliberately before loading it.",
        );
      const s = protectConstraints(draft.selection, {
        major: "",
        term_code: term,
        course_codes: courses.map((c) => c.code),
        removed_courses: removedCourses,
        constraints,
      });
      const data = await retrieve(
        s.requested_courses,
        s.term_code,
        s.snapshot_version,
      );
      const checked = await tool<Validation>("validate_schedule", {
        term_code: s.term_code,
        snapshot_version: s.snapshot_version,
        requested_courses: s.requested_courses,
        section_ids: s.section_ids,
        constraints: s.constraints,
      });
      validationReview.parse(checked.data);
      if (checked.data.status === "infeasible")
        throw new Error(
          "This draft has conflicts. Ask the assistant to revise it.",
        );
      if (g !== generation.current)
        throw new Error(
          "Planner changed while the draft was loading. Review and load it again.",
        );
      if (
        s.section_ids.some(
          (id) => !data.sections.some((section) => section.id === id),
        )
      )
        throw new Error(
          "Some proposed sections could not be found in the selected courses.",
        );
      generation.current++;
      canSave.current = true;
      setTerm(s.term_code);
      setVersion(s.snapshot_version);
      setCourses(data.courses);
      setSections(data.sections);
      setIds(s.section_ids);
      setConstraints(s.constraints);
      setMeta(checked.meta);
      setResults([]);
      setError("");
      setNotice(
        "Assistant draft loaded and checked. Review any unknowns below. Your USC coursebin has not changed.",
      );
      setView("planner");
    } finally {
      setBusy(false);
    }
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
          setRemovedCourses(restored.data.removed_courses ?? []);
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
      removed_courses: removedCourses,
    }).catch(() => setError("Preferences could not be saved locally."));
  }, [ready, term, courses, ids, constraints, version, removedCourses]);
  useEffect(() => {
    if (!ready || busy || !courses.length || !ids.length || !version) {
      setReview(undefined);
      return;
    }
    const parsed = inputs.validate_schedule.safeParse(
      JSON.parse(validationInput),
    );
    if (!parsed.success) {
      setReview({
        key: validationKey,
        state: {
          status: "error",
          message: "Fix the schedule preferences before validation can run.",
        },
      });
      return;
    }
    return observeValidation(
      async (signal) => {
        const result = await tool<unknown>(
          "validate_schedule",
          parsed.data,
          signal,
        );
        const data = validationReview.safeParse(result.data);
        if (!data.success)
          throw new Error(
            "Detailed validation is unavailable. Update the local service and try again.",
          );
        if (result.meta.snapshot_version !== parsed.data.snapshot_version)
          throw new Error(
            "Validation used a different snapshot. Load the latest course data and try again.",
          );
        return { ...result, data: data.data };
      },
      (state) => setReview({ key: validationKey, state }),
    );
  }, [
    ready,
    busy,
    validationInput,
    validationKey,
    courses.length,
    ids.length,
    version,
  ]);
  const selected = sections.filter((s) => ids.includes(s.id));
  const plannerContext = {
    major: "",
    term_code: term,
    course_codes: courses.map((c) => c.code),
    selected_section_ids: ids,
    snapshot_version: version,
    removed_courses: removedCourses,
    constraints,
  };
  const plannerProposal = useMemo(() => {
    if (reviewState?.status !== "ready" || !version || !ids.length)
      return undefined;
    return proposal.parse({
      id: crypto.randomUUID(),
      selection: {
        ...JSON.parse(validationInput),
        title: "My planner schedule",
      },
      validation: {
        ...reviewState.value,
        meta: {
          ...reviewState.value.meta,
          warnings: reviewState.value.meta.warnings ?? [],
        },
      },
    });
  }, [reviewState, validationInput, version, ids.length]);
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
      invalidateDrafts();
      setCourses(d.courses);
      setRemovedCourses((old) =>
        old.filter(
          (removed) =>
            !d.courses.some((c) => c.aliases.includes(removed.course_code)),
        ),
      );
      setSections(d.sections);
      setMeta(d.meta);
      setVersion(d.meta?.snapshot_version);
      setResults([]);
      setQuery("");
    });
  }
  function remove(code: string) {
    const course = courses.find((c) => c.code === code);
    if (!course) return;
    const removals = removedCoursesSchema.safeParse([
      ...removedCourses.filter((c) => c.course_code !== code),
      { course_code: course.code, aliases: course.aliases },
    ]);
    if (!removals.success) {
      setError("Undo an older course removal before removing another course.");
      return;
    }
    generation.current++;
    invalidateDrafts();
    setRemovedCourses(removals.data);
    const rest = courses.filter((c) => c.code !== code);
    setCourses(rest);
    setSections((prev) => prev.filter((s) => s.course_key !== course.key));
    setIds((prev) =>
      prev.filter(
        (id) => sections.find((s) => s.id === id)?.course_key !== course.key,
      ),
    );
  }
  function choose(id: string) {
    generation.current++;
    invalidateDrafts();
    setIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }
  function changeConstraints(c: Constraints) {
    generation.current++;
    invalidateDrafts();
    setConstraints(c);
  }
  function check() {
    setValidationAttempt((attempt) => attempt + 1);
  }
  async function latest() {
    await act(async () => {
      const d = await retrieve(
        courses.map((c) => c.code),
        term,
      );
      invalidateDrafts();
      setCourses(d.courses);
      setSections(d.sections);
      setVersion(d.meta?.snapshot_version);
      setMeta(d.meta);
      setIds((prev) =>
        prev.filter((id) => d.sections.some((s) => s.id === id)),
      );
      setNotice(
        "Loaded the latest stored snapshot. Your selections will be checked automatically.",
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
  async function refreshForCoursebin() {
    if (busy || refreshing || coursebinBusy || coursebinRunning || !ids.length)
      return;
    const controller = new AbortController();
    refreshController.current = controller;
    const signal = AbortSignal.any([
      controller.signal,
      AbortSignal.timeout(65000),
    ]);
    const g = generation.current;
    setRefreshing(true);
    setRefreshError("");
    try {
      const codes = courses.map((c) => c.code);
      const data = await refreshExactSelection({
        sectionIds: [...ids],
        signal,
        requestRefresh: (signal) =>
          tool(
            "request_refresh",
            { term_code: term, course_codes: codes },
            signal,
          ),
        readLatest: (signal) => retrieve(codes, term, undefined, signal),
      });
      if (g !== generation.current)
        throw new Error(
          "Your planner changed during refresh. Review the current selection and try again.",
        );
      invalidateDrafts();
      setCourses(data.courses);
      setSections(data.sections);
      setVersion(data.meta!.snapshot_version);
      setMeta(data.meta);
      setValidationAttempt((value) => value + 1);
      setNotice(
        "Fresh data loaded for your exact sections. Rechecking before coursebin review.",
      );
    } catch (e) {
      setRefreshError(
        signal.aborted
          ? "Refresh stopped. Your sections are unchanged; the queued server refresh may still complete."
          : e instanceof Error
            ? e.message
            : "Could not refresh course data.",
      );
    } finally {
      setRefreshing(false);
      refreshController.current = null;
    }
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
          <span className="local-dot">Companion pilot</span>
          <label className="sr-only" htmlFor="term">
            Semester
          </label>
          <select
            id="term"
            disabled={busy || refreshing || coursebinBusy || coursebinRunning}
            value={term}
            onChange={(e) => {
              const t = Number(e.target.value);
              generation.current++;
              invalidateDrafts();
              setTerm(t);
              setVersion(
                terms.find((x) => x.term_code === t)?.snapshot_version,
              );
              setCourses([]);
              setRemovedCourses([]);
              setSections([]);
              setIds([]);
              setResults([]);
              setMeta(undefined);
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
        <CoursebinLog
          onReport={setCoursebinReport}
          onBusy={setCoursebinRunning}
        />
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
        <nav className="workspace-nav" aria-label="Planner workspace">
          <button
            className={view === "chat" ? "" : "outline"}
            aria-pressed={view === "chat"}
            onClick={() => setView("chat")}
          >
            Chat with Codex
          </button>
          <button
            className={view === "planner" ? "" : "outline"}
            aria-pressed={view === "planner"}
            onClick={() => setView("planner")}
          >
            My planner{ids.length ? ` · ${ids.length} sections` : ""}
          </button>
        </nav>
        <div hidden={view !== "chat"}>
          <ChatPanel
            context={plannerContext}
            plannerRevision={plannerRevision}
            coursebinBusy={coursebinBusy}
            coursebinRunning={coursebinRunning}
            coursebinReport={coursebinReport}
            plannerBusy={busy || refreshing || !ready}
            onLoad={loadProposal}
            onUndoRemoval={(code) => {
              generation.current++;
              invalidateDrafts();
              setRemovedCourses((old) =>
                old.filter((c) => c.course_code !== code),
              );
            }}
          />
        </div>
        <div hidden={view !== "planner"}>
          <section
            className="panel planner-coursebin"
            aria-label="Add planner to coursebin"
          >
            <h2>Add this schedule to coursebin</h2>
            <p>
              Review the semester and exact sections in your planner before
              confirming.
            </p>
            {plannerProposal ? (
              <CoursebinAction
                key={plannerProposal.id}
                draft={plannerProposal}
                context={plannerContext}
                disabled={
                  busy || refreshing || coursebinBusy || coursebinRunning
                }
                onBusy={setCoursebinBusy}
                onReport={setCoursebinReport}
              />
            ) : (
              <>
                <button disabled>Add to coursebin</button>
                <p role="status">
                  {ids.length
                    ? "Waiting for this selection’s validation."
                    : "Open a draft with Edit in planner, or select sections below."}
                </p>
              </>
            )}
            <button
              className="outline"
              disabled={
                busy ||
                refreshing ||
                coursebinBusy ||
                coursebinRunning ||
                !ids.length
              }
              onClick={() => void refreshForCoursebin()}
            >
              Refresh data and recheck
            </button>
            {refreshing && (
              <div role="status">
                <p>
                  Refresh requested. Waiting for fresh course data; your exact
                  sections stay selected.
                </p>
                <button
                  className="outline"
                  onClick={() => refreshController.current?.abort()}
                >
                  Stop waiting
                </button>
              </div>
            )}
            {refreshError && (
              <p className="chat-error" role="alert">
                {refreshError}
              </p>
            )}
            {coursebinReport && <CoursebinResult report={coursebinReport} />}
          </section>
          <fieldset
            className="planner-editor"
            disabled={refreshing || coursebinBusy || coursebinRunning}
          >
            <div className="intro">
              <div>
                <p className="eyebrow">MAKE ROOM FOR YOUR SEMESTER</p>
                <h1>A schedule that fits your life.</h1>
                <p>
                  Choose your courses. Compare sections. Bring the details to
                  your AI assistant.
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
                            busy ||
                            courses.some((x) => x.aliases.includes(c.code))
                          }
                          onClick={() => void add(c.code)}
                        >
                          <strong>{c.code}</strong>
                          <span>{c.title}</span>
                          <b>＋</b>
                        </button>
                      ))}
                      {searchCursor && (
                        <button
                          disabled={busy}
                          onClick={() => void search(true)}
                        >
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
                        Try CSCI 104, MATH 225, or a course title. Your choices
                        stay on this device.
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
                            {
                              selected.filter((s) => s.course_key === c.key)
                                .length
                            }{" "}
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
                                  ids.includes(s.id)
                                    ? "section chosen"
                                    : "section"
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
                              free_days:
                                constraints.preferences.free_days.includes(
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
                            setError(
                              "Unavailable time must end after it starts.",
                            );
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
                          {Array.from(
                            { length: lastHour - firstHour },
                            (_, i) => (
                              <span key={i} style={{ top: i * 60 }}>
                                {(i + firstHour) % 12 || 12}
                                {i + firstHour < 12 ? "a" : "p"}
                              </span>
                            ),
                          )}
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
                                  (m) =>
                                    m.days.includes(day) && m.start && m.end,
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
                      disabled={
                        busy || !ids.length || !courses.length || !version
                      }
                      onClick={() => void check()}
                    >
                      {reviewState?.status === "pending"
                        ? "Checking…"
                        : "Check again"}
                    </button>
                  </div>
                  {validation ? (
                    <ScheduleReview value={validation} />
                  ) : reviewState?.status === "error" ? (
                    <p role="alert" className="review-warning">
                      {reviewState.message}
                    </p>
                  ) : (
                    <p className="muted" role="status">
                      {reviewState?.status === "pending"
                        ? "Checking this selection…"
                        : "Choose sections to check your schedule automatically."}
                    </p>
                  )}
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
                    Local MCP endpoint: <code>http://127.0.0.1:3000/mcp</code>.
                    Use a local MCP client, or the repository’s stdio command.
                    Hosted ChatGPT and Claude cannot reach this local address
                    directly; hosted deployment and onboarding are pending.
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
          </fieldset>
        </div>
      </main>
      <footer>
        Independent USC Course Planner · Public catalog data · Preferences saved
        on this device
      </footer>
    </>
  );
}
