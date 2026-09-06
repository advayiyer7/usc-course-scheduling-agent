import { describe, expect, it, vi } from "vitest";
import {
  executeCoursebin,
  interruptReport,
} from "../apps/extension/src/coursebin/controller.js";
import {
  CoursebinError,
  type BinSnapshot,
  type CoursebinReport,
  type FailureCode,
} from "../packages/contracts/src/coursebin.js";

// Synthetic records only. No student identities or actual schedules are fixtures.
const entry = (section_id: string, registered = false) => ({
  section_id,
  course_code: "TEST100",
  scheduled: registered,
  registered,
});
const bin = (...entries: BinSnapshot["entries"]): BinSnapshot => ({
  term_code: 20263,
  entries,
});
function report(ids = ["10001", "10002"]): CoursebinReport {
  return {
    run_id: "11111111-1111-4111-8111-111111111111",
    proposal_id: "22222222-2222-4222-8222-222222222222",
    term_code: 20263,
    snapshot_version: "33333333-3333-4333-8333-333333333333",
    phase: "running",
    sections: ids.map((section_id) => ({
      section_id,
      status: "failed",
      code: "STOPPED",
    })),
  };
}
function harness(initial = bin()) {
  const h = {
    state: structuredClone(initial),
    cancelled: false,
    events: [] as string[],
    journals: [] as { report: CoursebinReport; attempting?: string }[],
  };
  const io = {
    read: vi.fn(async () => {
      h.events.push("read");
      return structuredClone(h.state);
    }),
    add: vi.fn(
      async (
        id: string,
        expected: BinSnapshot,
      ): Promise<FailureCode | undefined> => {
        h.events.push(`add:${id}`);
        expect(expected).toEqual(h.state);
        h.state.entries.push(entry(id));
        return undefined;
      },
    ),
    cancelled: () => h.cancelled,
    save: vi.fn(async (result: CoursebinReport, attempting?: string) => {
      h.events.push(attempting ? `journal:${attempting}` : "journal");
      h.journals.push({ report: structuredClone(result), attempting });
    }),
  };
  return { h, io };
}

describe("bounded coursebin controller", () => {
  it("preserves unrelated and registered entries and adds only the exact approved IDs in order", async () => {
    const initial = bin(entry("90001"), entry("90002", true));
    const original = structuredClone(initial);
    const request = report(["10002", "10001"]);
    const requestCopy = structuredClone(request);
    const { h, io } = harness(initial);

    const result = await executeCoursebin(request, initial, io);

    expect(result.phase).toBe("complete");
    expect(result.sections).toEqual([
      { section_id: "10002", status: "added" },
      { section_id: "10001", status: "added" },
    ]);
    expect(io.add.mock.calls.map(([id]) => id)).toEqual(["10002", "10001"]);
    expect(h.state.entries).toEqual([
      ...original.entries,
      entry("10002"),
      entry("10001"),
    ]);
    expect(initial).toEqual(original);
    expect(request).toEqual(requestCopy);
    expect(h.events.indexOf("journal:10002")).toBeLessThan(
      h.events.indexOf("add:10002"),
    );
    expect(h.events.indexOf("journal:10001")).toBeLessThan(
      h.events.indexOf("add:10001"),
    );
    expect(io.add.mock.calls[1]?.[1].entries).toEqual([
      ...original.entries,
      entry("10002"),
    ]);
    expect(h.journals.at(-1)).toEqual({
      report: result,
      attempting: undefined,
    });
  });

  it("skips already present and registered targets without changing their state", async () => {
    const initial = bin(entry("10001"), entry("10002", true), entry("90001"));
    const { h, io } = harness(initial);
    const result = await executeCoursebin(
      report(["10001", "10002", "10003"]),
      initial,
      io,
    );
    expect(io.add.mock.calls.map(([id]) => id)).toEqual(["10003"]);
    expect(result.sections).toEqual([
      { section_id: "10001", status: "already_present" },
      { section_id: "10002", status: "already_present" },
      { section_id: "10003", status: "added" },
    ]);
    expect(h.state.entries.slice(0, 3)).toEqual(initial.entries);
  });

  it("tolerates harmless bin ordering changes", async () => {
    const initial = bin(entry("90001"), entry("90002", true));
    const { h, io } = harness(initial);
    h.state.entries.reverse();
    const result = await executeCoursebin(report(["10001"]), initial, io);
    expect(result.phase).toBe("complete");
    expect(io.add).toHaveBeenCalledTimes(1);
  });

  it.each(["removed", "added", "registration_changed"] as const)(
    "stops before mutation when an unrelated entry was %s",
    async (change) => {
      const initial = bin(entry("90001", true));
      const { h, io } = harness(initial);
      if (change === "removed") h.state.entries = [];
      if (change === "added") h.state.entries.push(entry("90002"));
      if (change === "registration_changed")
        h.state.entries[0]!.registered = false;
      const result = await executeCoursebin(report(), initial, io);
      expect(io.add).not.toHaveBeenCalled();
      expect(result).toMatchObject({ phase: "stopped", code: "STATE_CHANGED" });
      expect(result.sections).toEqual([
        { section_id: "10001", status: "failed", code: "STATE_CHANGED" },
        { section_id: "10002", status: "failed", code: "STOPPED" },
      ]);
    },
  );

  it("rejects a different semester before dispatch", async () => {
    const initial = bin();
    const { h, io } = harness(initial);
    h.state.term_code = 20271;
    const result = await executeCoursebin(report(), initial, io);
    expect(io.add).not.toHaveBeenCalled();
    expect(result).toMatchObject({ phase: "stopped", code: "WRONG_SEMESTER" });
  });

  it.each(["removed", "substituted", "registered", "semester"] as const)(
    "leaves the attempted section unconfirmed and stops after an unexpected %s change",
    async (change) => {
      const initial = bin(entry("90001", true));
      const { h, io } = harness(initial);
      io.add.mockImplementation(async (id) => {
        h.state.entries.push(
          entry(
            change === "substituted" ? "10009" : id,
            change === "registered",
          ),
        );
        if (change === "removed") h.state.entries.shift();
        if (change === "semester") h.state.term_code = 20271;
        return undefined;
      });
      const result = await executeCoursebin(report(), initial, io);
      expect(io.add).toHaveBeenCalledTimes(1);
      expect(result).toMatchObject({ phase: "stopped", code: "STATE_CHANGED" });
      expect(result.sections).toEqual([
        { section_id: "10001", status: "unconfirmed", code: "STATE_CHANGED" },
        { section_id: "10002", status: "failed", code: "STOPPED" },
      ]);
    },
  );

  it.each(["FULL", "D_CLEARANCE", "WEBREG_REJECTED"] as const)(
    "preserves partial completion and stops on an explicit %s rejection",
    async (code) => {
      const initial = bin(entry("90001", true));
      const { h, io } = harness(initial);
      io.add.mockImplementation(async (id) => {
        if (id === "10002") return code;
        h.state.entries.push(entry(id));
        return undefined;
      });
      const result = await executeCoursebin(
        report(["10001", "10002", "10003"]),
        initial,
        io,
      );
      expect(io.add.mock.calls.map(([id]) => id)).toEqual(["10001", "10002"]);
      expect(result).toMatchObject({ phase: "stopped", code });
      expect(result.sections).toEqual([
        { section_id: "10001", status: "added" },
        { section_id: "10002", status: "failed", code },
        { section_id: "10003", status: "failed", code: "STOPPED" },
      ]);
      expect(h.state.entries).toEqual([entry("90001", true), entry("10001")]);
    },
  );

  it.each([true, false])(
    "re-reads after a lost acknowledgement (committed=%s) and never retries",
    async (committed) => {
      const initial = bin(entry("90001", true));
      const { h, io } = harness(initial);
      io.add.mockImplementation(async (id) => {
        if (committed) h.state.entries.push(entry(id));
        throw new Error("Connection closed after dispatch");
      });
      const result = await executeCoursebin(report(), initial, io);
      expect(io.add).toHaveBeenCalledTimes(1);
      expect(io.read).toHaveBeenCalledTimes(2);
      expect(result.phase).toBe("stopped");
      expect(result.sections[0]).toEqual(
        committed
          ? { section_id: "10001", status: "added" }
          : { section_id: "10001", status: "unconfirmed", code: "UNCONFIRMED" },
      );
      expect(result.sections[1]).toEqual({
        section_id: "10002",
        status: "failed",
        code: "STOPPED",
      });
    },
  );

  it("reports an unconfirmed addition if the session expires during verification", async () => {
    const initial = bin();
    const { io } = harness(initial);
    io.read
      .mockResolvedValueOnce(initial)
      .mockRejectedValue(new CoursebinError("LOGIN_REQUIRED"));
    const result = await executeCoursebin(report(), initial, io);
    expect(io.add).toHaveBeenCalledTimes(1);
    expect(io.read).toHaveBeenCalledTimes(3);
    expect(result.sections).toEqual([
      { section_id: "10001", status: "unconfirmed", code: "LOGIN_REQUIRED" },
      { section_id: "10002", status: "failed", code: "STOPPED" },
    ]);
  });

  it.each([true, false])(
    "reconciles a returned uncertain result without calling it failed (late presence=%s)",
    async (presentOnReconciliation) => {
      const initial = bin(entry("90001", true));
      const { io } = harness(initial);
      io.add.mockResolvedValue("UNCONFIRMED");
      io.read
        .mockResolvedValueOnce(initial)
        .mockResolvedValueOnce(initial)
        .mockResolvedValueOnce(
          presentOnReconciliation
            ? bin(...initial.entries, entry("10001"))
            : initial,
        );
      const result = await executeCoursebin(report(), initial, io);
      expect(io.add).toHaveBeenCalledTimes(1);
      expect(io.read).toHaveBeenCalledTimes(3);
      expect(result.sections[0]).toEqual(
        presentOnReconciliation
          ? { section_id: "10001", status: "added" }
          : { section_id: "10001", status: "unconfirmed", code: "UNCONFIRMED" },
      );
      expect(result.sections[1]).toEqual({
        section_id: "10002",
        status: "failed",
        code: "STOPPED",
      });
      expect(result.phase).toBe("stopped");
    },
  );

  it("does not dispatch when authentication is already lost", async () => {
    const initial = bin();
    const { io } = harness(initial);
    io.read.mockRejectedValue(new CoursebinError("LOGIN_REQUIRED"));
    const result = await executeCoursebin(report(), initial, io);
    expect(io.add).not.toHaveBeenCalled();
    expect(result.sections[0]).toEqual({
      section_id: "10001",
      status: "failed",
      code: "LOGIN_REQUIRED",
    });
  });

  it("honors cancellation while the last pre-mutation read is pending", async () => {
    const initial = bin();
    const { h, io } = harness(initial);
    io.read.mockImplementation(async () => {
      h.cancelled = true;
      return initial;
    });
    const result = await executeCoursebin(report(), initial, io);
    expect(io.add).not.toHaveBeenCalled();
    expect(result).toMatchObject({ phase: "stopped", code: "INTERRUPTED" });
  });

  it("does not dispatch if the pending-attempt journal cannot be saved", async () => {
    const initial = bin();
    const { io } = harness(initial);
    io.save.mockRejectedValueOnce(new Error("Storage unavailable"));
    const result = await executeCoursebin(report(), initial, io);
    expect(io.add).not.toHaveBeenCalled();
    expect(result.phase).toBe("stopped");
  });

  it("honors cancellation while the durable journal write is pending", async () => {
    const initial = bin();
    const { h, io } = harness(initial);
    io.save.mockImplementation(async (_result, attempting) => {
      if (attempting) h.cancelled = true;
    });
    const result = await executeCoursebin(report(), initial, io);
    expect(io.add).not.toHaveBeenCalled();
    expect(result).toMatchObject({ phase: "stopped", code: "INTERRUPTED" });
    expect(result.sections[0]).toEqual({
      section_id: "10001",
      status: "failed",
      code: "INTERRUPTED",
    });
  });

  it("recovers interrupted journals without restarting or claiming the pending section failed", () => {
    const active = report(["10001", "10002", "10003", "10004"]);
    active.sections[0] = { section_id: "10001", status: "already_present" };
    active.sections[1] = { section_id: "10002", status: "added" };
    const copy = structuredClone(active);
    const recovered = interruptReport(active, "10003");
    expect(recovered).toMatchObject({ phase: "stopped", code: "INTERRUPTED" });
    expect(recovered.sections).toEqual([
      { section_id: "10001", status: "already_present" },
      { section_id: "10002", status: "added" },
      { section_id: "10003", status: "unconfirmed", code: "INTERRUPTED" },
      { section_id: "10004", status: "failed", code: "STOPPED" },
    ]);
    expect(active).toEqual(copy);
    expect(interruptReport(active).sections).toEqual(active.sections);
  });
});
