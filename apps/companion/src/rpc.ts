import { EventEmitter } from "node:events";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { z } from "zod";

const packet = z.object({
  id: z.union([z.string(), z.number()]).optional(),
  method: z.string().optional(),
  params: z.unknown().optional(),
  result: z.unknown().optional(),
  error: z.unknown().optional(),
});
export interface Rpc {
  request(method: string, params: unknown): Promise<unknown>;
  reply(id: string | number, result: unknown): void;
  reject(id: string | number): void;
  on(
    event: "notification" | "request" | "closed",
    handler: (...args: any[]) => void,
  ): this;
  close(): void;
}
export class AppServerRpc extends EventEmitter implements Rpc {
  private next = 0;
  private pending = new Map<
    number,
    {
      resolve: (v: unknown) => void;
      reject: (e: Error) => void;
      timer: NodeJS.Timeout;
    }
  >();
  private buffer = "";
  private closed = false;
  constructor(
    private child: ChildProcessWithoutNullStreams,
    private timeoutMs = 20000,
  ) {
    super();
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      try {
        this.buffer += chunk;
        if (Buffer.byteLength(this.buffer) > 2 * 1024 * 1024)
          throw new Error("Runtime output too large");
        let index: number;
        while ((index = this.buffer.indexOf("\n")) >= 0) {
          const line = this.buffer.slice(0, index);
          this.buffer = this.buffer.slice(index + 1);
          if (line.trim()) this.receive(packet.parse(JSON.parse(line)));
        }
      } catch {
        this.close();
      }
    });
    // Runtime diagnostics can contain private data; drain without forwarding/logging.
    child.stderr.resume();
    child.on("error", () => this.finish());
    child.on("exit", () => this.finish());
    child.stdin.on("error", () => this.finish());
  }
  private receive(value: z.infer<typeof packet>) {
    if (value.method) {
      this.emit(value.id === undefined ? "notification" : "request", value);
      return;
    }
    if (typeof value.id !== "number") return;
    const waiting = this.pending.get(value.id);
    if (!waiting) return;
    this.pending.delete(value.id);
    clearTimeout(waiting.timer);
    // Never return raw provider errors, tokens, or debug output to Chrome.
    if (value.error)
      waiting.reject(
        new Error(
          "Codex could not complete the request. Check account access or reconnect.",
        ),
      );
    else waiting.resolve(value.result);
  }
  private send(value: unknown) {
    if (this.closed)
      throw new Error("Codex connection is closed. Reconnect the companion.");
    const line = JSON.stringify(value) + "\n";
    if (
      this.child.stdin.writableLength + Buffer.byteLength(line) >
      2 * 1024 * 1024
    ) {
      this.close();
      throw new Error("Codex request queue is full");
    }
    this.child.stdin.write(line);
  }
  async initialize() {
    await this.request("initialize", {
      clientInfo: {
        name: "usc_course_planner",
        version: "0.2.0",
        title: "USC Course Planner",
      },
      capabilities: { experimentalApi: true },
    });
    this.send({ method: "initialized" });
  }
  request(method: string, params: unknown): Promise<unknown> {
    if (this.pending.size >= 16)
      return Promise.reject(new Error("Too many runtime requests"));
    const id = ++this.next;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new Error("Codex request timed out. Reconnect before retrying."),
        );
        this.close();
      }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.send({ id, method, params });
      } catch (e) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(e);
      }
    });
  }
  reply(id: string | number, result: unknown) {
    this.send({ id, result });
  }
  reject(id: string | number) {
    this.send({
      id,
      error: {
        code: -32601,
        message: "This pilot does not allow that capability",
      },
    });
  }
  private finish() {
    if (this.closed) return;
    this.closed = true;
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(new Error("Codex disconnected. Reconnect the companion."));
    }
    this.pending.clear();
    this.emit("closed");
  }
  close() {
    this.finish();
    this.child.kill();
  }
}
