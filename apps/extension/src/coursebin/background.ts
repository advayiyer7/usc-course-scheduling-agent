import { z } from "zod";
import type {
  Proposal,
  planningContext,
} from "../../../../packages/contracts/src/companion.js";
import {
  COURSEBIN_CHANNEL,
  WEBREG_ORIGIN,
  binKey,
  binSnapshot,
  codeOf,
  coursebinReport,
  coursebinUiRequest,
  CoursebinError,
  failureCode,
  type BinSnapshot,
  type CoursebinPreview,
  type CoursebinReport,
} from "../../../../packages/contracts/src/coursebin.js";
import { executeCoursebin, interruptReport } from "./controller.js";
import { allowedPage } from "./dom.js";
import { preflight } from "./preflight.js";

const journalKey = "usc-coursebin-session";
const journal = z.object({
  report: coursebinReport,
  attempting: z.string().optional(),
});
const inspection = z.object({
  ok: z.literal(true),
  document_id: z.string().uuid(),
  bin: binSnapshot,
});
interface Prepared {
  draft: Proposal;
  context: z.infer<typeof planningContext>;
  preview: CoursebinPreview;
  tabId: number;
  url: string;
  documentId: string;
  bin: BinSnapshot;
}
let prepared: Prepared | undefined;
let active = false;
let preparing = false;
let cancelled = false;
let generation = 0;
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function lastReport() {
  const stored = journal.safeParse(
    (await chrome.storage.session.get(journalKey))[journalKey],
  );
  if (!stored.success) return undefined;
  if (!active && stored.data.report.phase === "running") {
    const report = interruptReport(stored.data.report, stored.data.attempting);
    await chrome.storage.session.set({ [journalKey]: { report } });
    return report;
  }
  return stored.data.report;
}
async function checkTab(id: number, expectedUrl: string) {
  const tab = await chrome.tabs.get(id).catch(() => {
    throw new CoursebinError("STATE_CHANGED");
  });
  if (!tab.url || !allowedPage(tab.url))
    throw new CoursebinError("LOGIN_REQUIRED");
  if (
    tab.url !== expectedUrl ||
    (tab.pendingUrl && tab.pendingUrl !== expectedUrl)
  )
    throw new CoursebinError("STATE_CHANGED");
  return tab;
}
async function inspect(
  id: number,
  url: string,
  term: number,
  expectedDocument?: string,
) {
  await checkTab(id, url);
  const raw = await chrome.tabs
    .sendMessage(
      id,
      { channel: COURSEBIN_CHANNEL, method: "inspect", term_code: term },
      { frameId: 0 },
    )
    .catch(() => {
      throw new CoursebinError("UI_CHANGED");
    });
  if (raw?.ok === false) throw new CoursebinError(failureCode.parse(raw.code));
  const value = inspection.parse(raw);
  if (expectedDocument && value.document_id !== expectedDocument)
    throw new CoursebinError("STATE_CHANGED");
  await checkTab(id, url);
  return value;
}
async function prepare(
  draft: Proposal,
  context: z.infer<typeof planningContext>,
) {
  if (active || preparing) throw new CoursebinError("BUSY");
  preparing = true;
  const preparingGeneration = ++generation;
  prepared = undefined;
  try {
    const checked = await preflight(draft, context);
    const tabs = await chrome.tabs.query({
      active: true,
      lastFocusedWindow: true,
    });
    const tab = tabs[0];
    if (
      tabs.length !== 1 ||
      tab?.id === undefined ||
      !tab.url ||
      !allowedPage(tab.url)
    )
      throw new CoursebinError("LOGIN_REQUIRED");
    const live = await inspect(tab.id, tab.url, checked.selection.term_code);
    if (generation !== preparingGeneration)
      throw new CoursebinError("INTERRUPTED");
    const preview: CoursebinPreview = {
      ticket: crypto.randomUUID(),
      expires_at: Date.now() + 90000,
      selection: checked.selection,
      blockers: checked.blockers,
      warnings: checked.warnings,
      sections: checked.data.sections.map((s) => ({
        section_id: s.id,
        course_code: s.course_key,
        type: s.type,
        meetings: s.meetings.map(
          (m) => `${m.days.join("/")} ${m.start ?? "TBA"}–${m.end ?? "TBA"}`,
        ),
      })),
      already_present: checked.selection.section_ids.filter((id) =>
        live.bin.entries.some((e) => e.section_id === id),
      ),
    };
    prepared = {
      draft,
      context,
      preview,
      tabId: tab.id,
      url: tab.url,
      documentId: live.document_id,
      bin: live.bin,
    };
    return preview;
  } finally {
    preparing = false;
  }
}

async function execute(ticket: string) {
  if (active || preparing) throw new CoursebinError("BUSY");
  const p = prepared;
  if (!p || p.preview.ticket !== ticket || p.preview.expires_at < Date.now())
    throw new CoursebinError("STALE_PROPOSAL");
  if (p.preview.blockers.length) throw new CoursebinError("VALIDATION_BLOCKED");
  // Consume authorization synchronously, before any await. It cannot be replayed.
  active = true;
  cancelled = false;
  prepared = undefined;
  const report: CoursebinReport = {
    run_id: crypto.randomUUID(),
    proposal_id: p.draft.id,
    term_code: p.preview.selection.term_code,
    snapshot_version: p.preview.selection.snapshot_version,
    phase: "running",
    sections: p.preview.selection.section_ids.map((section_id) => ({
      section_id,
      status: "failed",
      code: "STOPPED",
    })),
  };
  let latest = report;
  let pending: string | undefined;
  const save = async (value: CoursebinReport, attempting?: string) => {
    latest = structuredClone(value);
    pending = attempting;
    // Browser-session-only journal contains selected outcomes, never unrelated bin contents.
    await chrome.storage.session.set({
      [journalKey]: { report: value, ...(attempting ? { attempting } : {}) },
    });
  };
  let url = p.url;
  let documentId = p.documentId;
  const deadline = Date.now() + 180000;
  const stopped = () => cancelled || Date.now() >= deadline;
  const read = async () =>
    (await inspect(p.tabId, url, report.term_code, documentId)).bin;
  try {
    await save(report);
    const fresh = await preflight(p.draft, p.context);
    if (fresh.blockers.length) throw new CoursebinError("VALIDATION_BLOCKED");
    if (JSON.stringify(fresh.selection) !== JSON.stringify(p.preview.selection))
      throw new CoursebinError("STALE_PROPOSAL");
    if (binKey(await read()) !== binKey(p.bin))
      throw new CoursebinError("STATE_CHANGED");
    return await executeCoursebin(report, p.bin, {
      read,
      cancelled: stopped,
      save,
      add: async (section, expected) => {
        if (stopped()) throw new CoursebinError("INTERRUPTED");
        await checkTab(p.tabId, url);
        const oldDocument = documentId;
        url = `${WEBREG_ORIGIN}/Courses?Section=${section}`;
        await chrome.tabs.update(p.tabId, { url });
        const readyBy = Date.now() + 15000;
        let loaded = false;
        while (Date.now() < readyBy && !stopped()) {
          const tab = await chrome.tabs.get(p.tabId);
          if (tab.pendingUrl && tab.pendingUrl !== url)
            throw new CoursebinError("STATE_CHANGED");
          if (tab.status === "complete") {
            if (tab.url !== url) throw new CoursebinError("STATE_CHANGED");
            const page = await inspect(p.tabId, url, report.term_code);
            if (page.document_id !== oldDocument) {
              documentId = page.document_id;
              loaded = true;
              break;
            }
          }
          await pause(200);
        }
        if (stopped()) throw new CoursebinError("INTERRUPTED");
        if (!loaded) throw new CoursebinError("UI_CHANGED");
        const selected = fresh.data.sections.find((s) => s.id === section)!;
        // Exactly one dispatch; timeouts are reconciled by reading the bin, never retried here.
        const reply = await chrome.tabs.sendMessage(
          p.tabId,
          {
            channel: COURSEBIN_CHANNEL,
            method: "add",
            term_code: report.term_code,
            section_id: section,
            requested_courses: [selected.course_key],
            document_id: documentId,
            expected_bin: expected,
            expires_at: Date.now() + 15000,
          },
          { frameId: 0 },
        );
        await checkTab(p.tabId, url);
        if (reply?.ok !== true) throw new CoursebinError("UNCONFIRMED");
        return reply.code === undefined
          ? undefined
          : failureCode.parse(reply.code);
      },
    });
  } catch (e) {
    const stoppedReport = interruptReport(latest, pending);
    stoppedReport.code = codeOf(e);
    await save(stoppedReport);
    return stoppedReport;
  } finally {
    active = false;
  }
}

export function installCoursebinHandler() {
  chrome.runtime.onMessage.addListener((raw: unknown, sender, respond) => {
    // Only the extension's real side panel. Native/model events and page messages cannot enter.
    if (
      sender.id !== chrome.runtime.id ||
      sender.tab ||
      sender.url !== chrome.runtime.getURL("index.html")
    )
      return;
    if (
      typeof raw !== "object" ||
      raw === null ||
      !("channel" in raw) ||
      raw.channel !== COURSEBIN_CHANNEL
    )
      return;
    const request = coursebinUiRequest.safeParse(raw);
    if (!request.success) {
      respond({ ok: false, code: "VALIDATION_BLOCKED" });
      return;
    }
    void (async () => {
      try {
        const r = request.data;
        if (r.method === "prepare")
          respond({ ok: true, preview: await prepare(r.proposal, r.context) });
        else if (r.method === "execute")
          respond({ ok: true, report: await execute(r.ticket) });
        else if (r.method === "cancel") {
          cancelled = true;
          generation++;
          prepared = undefined;
          respond({ ok: true });
        } else respond({ ok: true, report: await lastReport(), active });
      } catch (e) {
        respond({ ok: false, code: codeOf(e) });
      }
    })();
    return true;
  });
}
