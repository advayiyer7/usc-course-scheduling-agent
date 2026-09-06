import { homedir } from "node:os";
import { join } from "node:path";
import { mkdir, open, readFile, unlink } from "node:fs/promises";
import { EXTENSION_ORIGIN } from "../../../packages/contracts/src/extension.js";
import { companionEvent } from "../../../packages/contracts/src/companion.js";
import { NativeDecoder, encodeNative } from "./framing.js";
import { startRuntime } from "./runtime.js";
import { McpCourseTools } from "./course-tools.js";
import { CompanionSession } from "./session.js";

// Native hosts are executable only by the registered extension origin, never web pages.
if (process.argv[2] !== EXTENSION_ORIGIN + "/") process.exit(1);
const profile = join(homedir(), ".usc-course-planner");
const lockPath = join(profile, "companion.lock");
const lifetime = new AbortController();
let ownedLock = false,
  session: CompanionSession | undefined,
  ending = false;
function emit(value: unknown) {
  if (ending) return;
  const frame = encodeNative(companionEvent.parse(value));
  if (process.stdout.writableLength + frame.length > 1024 * 1024) {
    void shutdown();
    return;
  }
  process.stdout.write(frame);
}
async function shutdown() {
  if (ending) return;
  ending = true;
  lifetime.abort();
  session?.close();
  if (
    ownedLock &&
    (await readFile(lockPath, "utf8").catch(() => "")) === String(process.pid)
  )
    await unlink(lockPath).catch(() => {});
  process.exit(0);
}
process.stdin.on("end", () => void shutdown());
process.stdin.on("error", () => void shutdown());
process.stdout.on("error", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());
try {
  await mkdir(profile, { recursive: true, mode: 0o700 });
  try {
    const pid = Number(await readFile(lockPath, "utf8"));
    if (Number.isSafeInteger(pid) && pid > 0) {
      try {
        process.kill(pid, 0);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "ESRCH")
          await unlink(lockPath);
      }
    }
  } catch {
    /* No lock: acquire exclusively below. */
  }
  let lock;
  try {
    lock = await open(lockPath, "wx", 0o600);
  } catch {
    throw new Error(
      "Companion already running in another browser session. Close that planner connection first.",
    );
  }
  await lock.writeFile(String(process.pid));
  await lock.close();
  ownedLock = true;
  const { rpc, workspace } = await startRuntime(profile, lifetime.signal);
  if (ending) {
    rpc.close();
    process.exit(0);
  }
  session = new CompanionSession(rpc, new McpCourseTools(), emit, workspace);
  const decoder = new NativeDecoder();
  let inFlight = 0;
  process.stdin.on("data", (chunk: Buffer) => {
    try {
      for (const value of decoder.push(chunk)) {
        if (++inFlight > 8) throw new Error("Too many requests");
        void session!.handle(value).finally(() => {
          inFlight--;
        });
      }
    } catch {
      emit({
        type: "error",
        message:
          "Invalid or excessive companion messages. Reconnect to continue.",
      });
      void shutdown();
    }
  });
} catch (e) {
  emit({
    type: "error",
    message:
      e instanceof Error
        ? e.message.slice(0, 1000)
        : "Companion startup failed",
  });
  await new Promise<void>((resolve) =>
    process.stdout.write("", () => resolve()),
  );
  await shutdown();
}
