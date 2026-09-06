import { afterEach, describe, expect, it, vi } from "vitest";
import {
  planningContext,
  proposal,
} from "../packages/contracts/src/companion.js";
import { EXTENSION_ORIGIN } from "../packages/contracts/src/extension.js";
import {
  COURSEBIN_CHANNEL,
  contentCommand,
  type BinSnapshot,
  type CoursebinPreview,
  type CoursebinReport,
  type Finding,
} from "../packages/contracts/src/coursebin.js";

const journalKey = "usc-coursebin-session";
const snapshot = "11111111-1111-4111-8111-111111111111";
const proposalId = "22222222-2222-4222-8222-222222222222";
const firstDocument = "33333333-3333-4333-8333-333333333333";
const secondDocument = "44444444-4444-4444-8444-444444444444";
const fakeTicket = "55555555-5555-4555-8555-555555555555";
const extensionId = EXTENSION_ORIGIN.split("://")[1]!;
const sender: chrome.runtime.MessageSender = {
  id: extensionId,
  url: `${EXTENSION_ORIGIN}/index.html`,
};
const context = planningContext.parse({
  term_code: 20263,
  course_codes: [],
  constraints: {},
});
const draft = proposal.parse({
  id: proposalId,
  selection: {
    title: "Synthetic schedule",
    term_code: 20263,
    snapshot_version: snapshot,
    requested_courses: ["TEST100", "TEST200"],
    section_ids: ["10001", "10002"],
    constraints: {},
  },
  validation: {
    data: { status: "feasible" },
    meta: {
      snapshot_version: snapshot,
      checked_at: "2026-09-06T20:00:00.000Z",
      stale: false,
      warnings: [],
    },
  },
});
function initialBin(): BinSnapshot {
  return {
    term_code: 20263,
    entries: [
      {
        section_id: "10001",
        course_code: "TEST100",
        scheduled: false,
        registered: false,
      },
      {
        section_id: "90001",
        course_code: "OTHER900",
        scheduled: true,
        registered: true,
      },
    ],
  };
}
function checked() {
  return {
    selection: structuredClone(draft.selection),
    data: {
      sections: [
        {
          id: "10001",
          course_key: "TEST100",
          type: "Lec",
          meetings: [{ days: ["Mon"], start: "10:00", end: "11:00" }],
        },
        {
          id: "10002",
          course_key: "TEST200",
          type: "Lec",
          meetings: [{ days: ["Tue"], start: "12:00", end: "13:00" }],
        },
      ],
    },
    blockers: [] as Finding[],
    warnings: [
      {
        code: "eligibility",
        message: "Synthetic personal eligibility warning",
      },
    ],
  };
}
type Reply = {
  ok: boolean;
  code?: string;
  preview?: CoursebinPreview;
  report?: CoursebinReport;
  active?: boolean;
};
type Listener = (
  raw: unknown,
  sender: chrome.runtime.MessageSender,
  respond: (value: Reply) => void,
) => boolean | void;
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
async function setup(persisted: Record<string, unknown> = {}) {
  vi.resetModules();
  const h = {
    bin: initialBin(),
    documentId: firstDocument,
    tab: { id: 7, url: "https://webreg.usc.edu/CourseBin", status: "complete" },
    storage: structuredClone(persisted),
    checked: checked(),
  };
  let listener!: Listener;
  const validate = vi.fn(async () => structuredClone(h.checked));
  vi.doMock("../apps/extension/src/coursebin/preflight.js", () => ({
    preflight: validate,
  }));
  const api = {
    runtime: {
      id: extensionId,
      getURL: (path: string) => `${EXTENSION_ORIGIN}/${path}`,
      onMessage: {
        addListener: vi.fn((fn: Listener) => {
          listener = fn;
        }),
      },
    },
    tabs: {
      query: vi.fn(async (_query: unknown) => [structuredClone(h.tab)]),
      get: vi.fn(async (_id: number) => structuredClone(h.tab)),
      update: vi.fn(async (_id: number, changes: { url: string }) => {
        h.tab.url = changes.url;
        h.documentId = secondDocument;
        return structuredClone(h.tab);
      }),
      sendMessage: vi.fn(
        async (
          _id: number,
          raw: unknown,
          _options: unknown,
        ): Promise<unknown> => {
          const command = contentCommand.parse(raw);
          if (command.method === "inspect")
            return {
              ok: true,
              document_id: h.documentId,
              bin: structuredClone(h.bin),
            };
          expect(command.document_id).toBe(h.documentId);
          expect(command.expected_bin).toEqual(h.bin);
          h.bin.entries.push({
            section_id: command.section_id,
            course_code: "TEST200",
            scheduled: false,
            registered: false,
          });
          return { ok: true };
        },
      ),
    },
    storage: {
      session: {
        get: vi.fn(async (key: string) => ({
          [key]: structuredClone(h.storage[key]),
        })),
        set: vi.fn(async (value: Record<string, unknown>) => {
          Object.assign(h.storage, structuredClone(value));
        }),
      },
    },
  };
  vi.stubGlobal("chrome", api);
  const { installCoursebinHandler } =
    await import("../apps/extension/src/coursebin/background.js");
  installCoursebinHandler();
  const request = (body: Record<string, unknown>) =>
    new Promise<Reply>((resolve) => {
      listener({ channel: COURSEBIN_CHANNEL, ...body }, sender, resolve);
    });
  const prepare = async () => {
    const reply = await request({
      method: "prepare",
      proposal: draft,
      context,
    });
    expect(reply.ok).toBe(true);
    expect(reply.preview).toBeDefined();
    return reply.preview!;
  };
  const additions = () =>
    api.tabs.sendMessage.mock.calls.filter(
      ([, raw]) => (raw as { method: string }).method === "add",
    );
  return {
    h,
    api,
    validate,
    request,
    prepare,
    additions,
    dispatch: (raw: unknown, from = sender, respond = vi.fn()) => ({
      keepAlive: listener(raw, from, respond),
      respond,
    }),
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.doUnmock("../apps/extension/src/coursebin/preflight.js");
  vi.resetModules();
});

describe("coursebin background authorization boundary", () => {
  it("accepts only this extension's side-panel sender, excluding native, page, tab and other extension senders", async () => {
    const t = await setup();
    for (const from of [
      { nativeApplication: "edu.usc.course_planner" },
      { id: extensionId, url: "https://webreg.usc.edu/CourseBin" },
      { ...sender, tab: { id: 7 } as chrome.tabs.Tab },
      { ...sender, id: "other-extension" },
      { ...sender, url: `${EXTENSION_ORIGIN}/index.html?from=page` },
      { ...sender, url: `${EXTENSION_ORIGIN}/background.js` },
    ]) {
      const attempt = t.dispatch(
        {
          channel: COURSEBIN_CHANNEL,
          method: "prepare",
          proposal: draft,
          context,
        },
        from,
      );
      expect(attempt.keepAlive).toBeUndefined();
      expect(attempt.respond).not.toHaveBeenCalled();
    }
    expect(t.validate).not.toHaveBeenCalled();
    expect(t.api.tabs.query).not.toHaveBeenCalled();
    expect(t.api.storage.session.set).not.toHaveBeenCalled();
    await expect(t.request({ method: "status" })).resolves.toMatchObject({
      ok: true,
      active: false,
    });
  });

  it("ignores unrelated messages and rejects scripts, endpoints and arbitrary additions even from the panel", async () => {
    const t = await setup();
    for (const raw of [
      null,
      "execute",
      { method: "status" },
      { channel: "native-channel", method: "execute" },
    ]) {
      expect(t.dispatch(raw).respond).not.toHaveBeenCalled();
    }
    for (const body of [
      { method: "script", script: "document.querySelector('button').click()" },
      { method: "add", section_id: "10002" },
      { method: "execute", ticket: fakeTicket, endpoint: "/Checkout" },
      { method: "execute", ticket: fakeTicket, section_ids: ["10009"] },
      { method: "execute", ticket: "not-a-ticket" },
      { method: "prepare", proposal: draft, context, script: "arbitrary code" },
    ]) {
      await expect(t.request(body)).resolves.toEqual({
        ok: false,
        code: "VALIDATION_BLOCKED",
      });
    }
    expect(t.validate).not.toHaveBeenCalled();
    expect(t.api.tabs.sendMessage).not.toHaveBeenCalled();
    expect(t.api.tabs.update).not.toHaveBeenCalled();
  });

  it("requires an exact prepared ticket, consumes it once and performs only the selected missing section", async () => {
    const t = await setup();
    const originalBin = structuredClone(t.h.bin);
    await expect(
      t.request({ method: "execute", ticket: fakeTicket }),
    ).resolves.toEqual({ ok: false, code: "STALE_PROPOSAL" });
    const preview = await t.prepare();
    expect(preview.already_present).toEqual(["10001"]);
    expect(preview.selection).toEqual(draft.selection);
    expect(t.additions()).toEqual([]);
    expect(t.api.tabs.update).not.toHaveBeenCalled();
    await expect(
      t.request({ method: "execute", ticket: fakeTicket }),
    ).resolves.toEqual({ ok: false, code: "STALE_PROPOSAL" });

    const result = await t.request({
      method: "execute",
      ticket: preview.ticket,
    });

    expect(result).toMatchObject({
      ok: true,
      report: {
        phase: "complete",
        proposal_id: proposalId,
        sections: [
          { section_id: "10001", status: "already_present" },
          { section_id: "10002", status: "added" },
        ],
      },
    });
    expect(t.validate).toHaveBeenCalledTimes(2);
    expect(t.api.tabs.update).toHaveBeenCalledExactlyOnceWith(7, {
      url: "https://webreg.usc.edu/Courses?Section=10002",
    });
    const calls = t.additions();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual([
      7,
      {
        channel: COURSEBIN_CHANNEL,
        method: "add",
        term_code: 20263,
        section_id: "10002",
        requested_courses: ["TEST200"],
        document_id: secondDocument,
        expected_bin: originalBin,
        expires_at: expect.any(Number),
      },
      { frameId: 0 },
    ]);
    expect(t.h.bin.entries.slice(0, 2)).toEqual(originalBin.entries);
    expect(t.h.bin.entries.map((e) => e.section_id)).toEqual([
      "10001",
      "90001",
      "10002",
    ]);
    await expect(
      t.request({ method: "execute", ticket: preview.ticket }),
    ).resolves.toEqual({ ok: false, code: "STALE_PROPOSAL" });
    expect(t.additions()).toHaveLength(1);

    const status = await t.request({ method: "status" });
    expect(status).toMatchObject({
      ok: true,
      active: false,
      report: result.report,
    });
    for (const exposed of [
      preview,
      result,
      status,
      t.h.storage,
      t.api.storage.session.set.mock.calls,
    ]) {
      const serialized = JSON.stringify(exposed);
      expect(serialized).not.toContain("90001");
      expect(serialized).not.toContain("OTHER900");
      expect(serialized).not.toContain("expected_bin");
    }
  });

  it("rejects a ticket containing validation blockers before mutation or execution revalidation", async () => {
    const t = await setup();
    t.h.checked.blockers.push({
      code: "component_rules",
      message: "Unverified synthetic components",
    });
    const preview = await t.prepare();
    expect(preview.blockers).toHaveLength(1);
    await expect(
      t.request({ method: "execute", ticket: preview.ticket }),
    ).resolves.toEqual({ ok: false, code: "VALIDATION_BLOCKED" });
    expect(t.validate).toHaveBeenCalledTimes(1);
    expect(t.api.tabs.update).not.toHaveBeenCalled();
    expect(t.additions()).toEqual([]);
  });

  it("expires the prepared authorization without starting another validation or browser action", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-06T20:00:00Z"));
    const t = await setup();
    const preview = await t.prepare();
    vi.setSystemTime(preview.expires_at + 1);
    await expect(
      t.request({ method: "execute", ticket: preview.ticket }),
    ).resolves.toEqual({ ok: false, code: "STALE_PROPOSAL" });
    expect(t.validate).toHaveBeenCalledTimes(1);
    expect(t.additions()).toEqual([]);
  });

  it("invalidates prepared authorization when cancelled", async () => {
    const t = await setup();
    const preview = await t.prepare();
    await expect(t.request({ method: "cancel" })).resolves.toEqual({
      ok: true,
    });
    await expect(
      t.request({ method: "execute", ticket: preview.ticket }),
    ).resolves.toEqual({ ok: false, code: "STALE_PROPOSAL" });
    expect(t.api.tabs.update).not.toHaveBeenCalled();
    expect(t.additions()).toEqual([]);
  });

  it("rejects duplicate execute and prepare requests while an approved run is active, and honors cancellation", async () => {
    const t = await setup();
    const preview = await t.prepare();
    const entered = deferred<void>(),
      gate = deferred<ReturnType<typeof checked>>();
    t.validate.mockImplementationOnce(async () => {
      entered.resolve();
      return gate.promise;
    });
    const running = t.request({ method: "execute", ticket: preview.ticket });
    await entered.promise;
    await expect(
      t.request({ method: "execute", ticket: preview.ticket }),
    ).resolves.toEqual({ ok: false, code: "BUSY" });
    await expect(
      t.request({ method: "prepare", proposal: draft, context }),
    ).resolves.toEqual({ ok: false, code: "BUSY" });
    await expect(t.request({ method: "status" })).resolves.toMatchObject({
      ok: true,
      active: true,
      report: { phase: "running" },
    });
    await t.request({ method: "cancel" });
    gate.resolve(checked());
    await expect(running).resolves.toMatchObject({
      ok: true,
      report: { phase: "stopped", code: "INTERRUPTED" },
    });
    expect(t.api.tabs.update).not.toHaveBeenCalled();
    expect(t.additions()).toEqual([]);
  });

  it("stops if execution revalidation introduces a blocker instead of applying the preview", async () => {
    const t = await setup();
    const preview = await t.prepare();
    t.h.checked.blockers.push({
      code: "time_conflict",
      message: "Synthetic unresolved time conflict",
    });
    await expect(
      t.request({ method: "execute", ticket: preview.ticket }),
    ).resolves.toMatchObject({
      ok: true,
      report: { phase: "stopped", code: "VALIDATION_BLOCKED" },
    });
    expect(t.api.tabs.update).not.toHaveBeenCalled();
    expect(t.additions()).toEqual([]);
  });

  it("stops if a revalidation silently changes a section or constraint", async () => {
    const t = await setup();
    const preview = await t.prepare();
    t.h.checked.selection.section_ids = ["10001", "10009"];
    await expect(
      t.request({ method: "execute", ticket: preview.ticket }),
    ).resolves.toMatchObject({
      ok: true,
      report: { phase: "stopped", code: "STALE_PROPOSAL" },
    });
    expect(t.api.tabs.update).not.toHaveBeenCalled();
    expect(t.additions()).toEqual([]);
  });

  it.each(["bin", "document"] as const)(
    "stops on a changed %s after preparation",
    async (changed) => {
      const t = await setup();
      const preview = await t.prepare();
      if (changed === "document") t.h.documentId = secondDocument;
      else t.h.bin.entries[1]!.registered = false;
      await expect(
        t.request({ method: "execute", ticket: preview.ticket }),
      ).resolves.toMatchObject({
        ok: true,
        report: { phase: "stopped", code: "STATE_CHANGED" },
      });
      expect(t.api.tabs.update).not.toHaveBeenCalled();
      expect(t.additions()).toEqual([]);
    },
  );

  it("recovers an interrupted worker journal on status without resuming any browser action", async () => {
    const previous: CoursebinReport = {
      run_id: fakeTicket,
      proposal_id: proposalId,
      term_code: 20263,
      snapshot_version: snapshot,
      phase: "running",
      sections: [
        { section_id: "10001", status: "already_present" },
        { section_id: "10002", status: "unconfirmed", code: "UNCONFIRMED" },
      ],
    };
    const t = await setup({
      [journalKey]: { report: previous, attempting: "10002" },
    });
    const result = await t.request({ method: "status" });
    expect(result).toMatchObject({
      ok: true,
      active: false,
      report: {
        phase: "stopped",
        code: "INTERRUPTED",
        sections: [
          { section_id: "10001", status: "already_present" },
          { section_id: "10002", status: "unconfirmed", code: "INTERRUPTED" },
        ],
      },
    });
    expect(t.api.storage.session.set).toHaveBeenCalledOnce();
    expect(t.validate).not.toHaveBeenCalled();
    expect(t.api.tabs.query).not.toHaveBeenCalled();
    expect(t.api.tabs.get).not.toHaveBeenCalled();
    expect(t.api.tabs.update).not.toHaveBeenCalled();
    expect(t.api.tabs.sendMessage).not.toHaveBeenCalled();
    await expect(
      t.request({ method: "execute", ticket: fakeTicket }),
    ).resolves.toEqual({ ok: false, code: "STALE_PROPOSAL" });
    expect((await t.request({ method: "status" })).report).toEqual(
      result.report,
    );
    expect(t.api.storage.session.set).toHaveBeenCalledOnce();
  });

  it("does not publish executable authorization from a prepare operation cancelled while validation was pending", async () => {
    const t = await setup();
    const entered = deferred<void>(),
      gate = deferred<ReturnType<typeof checked>>();
    t.validate.mockImplementationOnce(async () => {
      entered.resolve();
      return gate.promise;
    });
    const pending = t.request({ method: "prepare", proposal: draft, context });
    await entered.promise;
    await t.request({ method: "cancel" });
    gate.resolve(checked());
    const reply = await pending;
    if (reply.preview) {
      await expect(
        t.request({ method: "execute", ticket: reply.preview.ticket }),
      ).resolves.toEqual({ ok: false, code: "STALE_PROPOSAL" });
    } else {
      expect(reply).toEqual({ ok: false, code: "INTERRUPTED" });
    }
    expect(t.api.tabs.update).not.toHaveBeenCalled();
    expect(t.additions()).toEqual([]);
  });
});
