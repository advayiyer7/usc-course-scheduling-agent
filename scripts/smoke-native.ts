import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { EXTENSION_ORIGIN } from "../packages/contracts/src/extension.js";
import { trustedLoginUrl } from "../packages/contracts/src/companion.js";
import { NativeDecoder, encodeNative } from "../apps/companion/src/framing.js";

const child = spawn(
  join(homedir(), ".usc-course-planner/bin/native-host.sh"),
  [EXTENSION_ORIGIN + "/"],
  { stdio: ["pipe", "pipe", "pipe"] },
);
const decoder = new NativeDecoder();
const pending = new Map<
  string,
  { resolve: () => void; reject: (e: Error) => void }
>();
let signedIn = false,
  sawStatus = false,
  sawLogin = false;
const deadline = setTimeout(() => child.kill(), 60000);
const exited = new Promise<void>((resolve, reject) => {
  child.on("error", reject);
  child.on("exit", (code) => {
    for (const p of pending.values())
      p.reject(new Error("Native host exited before replying"));
    if (code === 0) resolve();
    else reject(new Error("Native host exited unsuccessfully"));
  });
});
// Attach immediately so a startup failure cannot become an unhandled rejection.
void exited.catch(() => {});
child.stderr.resume();
child.stdout.on("data", (chunk: Buffer) => {
  for (const raw of decoder.push(chunk)) {
    const value = raw as {
      type: string;
      id?: string;
      ok?: boolean;
      error?: string;
      url?: string;
      status?: { authenticated: boolean };
    };
    if (value.type === "status") {
      signedIn = value.status!.authenticated;
      sawStatus = true;
    }
    if (value.type === "login") {
      assert.ok(trustedLoginUrl(value.url!));
      sawLogin = true;
    }
    if (value.type === "reply" && value.id) {
      const p = pending.get(value.id);
      pending.delete(value.id);
      if (value.ok) p?.resolve();
      else p?.reject(new Error(value.error ?? "Native request failed"));
    }
  }
});
const request = (method: string) =>
  new Promise<void>((resolve, reject) => {
    const id = randomUUID();
    pending.set(id, { resolve, reject });
    child.stdin.write(encodeNative({ id, method }));
  });
try {
  await request("status");
  assert.ok(sawStatus);
  if (!signedIn) {
    await request("login");
    assert.ok(sawLogin);
    await request("cancel_login");
    console.log(
      "PASS: installed native launcher, Chrome framing, account status, official sign-in URL and cancellation. No authentication completed or inference performed.",
    );
  } else
    console.log(
      "PASS: installed native launcher and account status. Existing signed-in profile left unchanged; no inference performed.",
    );
} finally {
  child.stdin.end();
  await exited;
  clearTimeout(deadline);
}
