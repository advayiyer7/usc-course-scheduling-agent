import { setTimeout as sleep } from "node:timers/promises";
import { AppError } from "../../contracts/src/index.js";
import { programsSchema, responseSchema, termsSchema } from "./schema.js";
import type { Store } from "../../db/src/index.js";
const BASE = "https://classes.usc.edu";
export class UscClient {
  requestCount = 0;
  constructor(
    private store: Store,
    private fetcher: typeof fetch = fetch,
    private interval = 1000,
    private timeout = 45000,
    private attempts = 3,
  ) {}
  async get(path: string, query: Record<string, string | number> = {}) {
    const url = new URL(path, BASE);
    url.search = new URLSearchParams(
      Object.entries(query).map(([k, v]) => [k, String(v)]),
    ).toString();
    for (let attempt = 0; attempt < this.attempts; attempt++) {
      const at = await this.store.permit(this.interval);
      await sleep(Math.max(0, at - Date.now()));
      try {
        this.requestCount++;
        const res = await this.fetcher(url, {
          signal: AbortSignal.timeout(this.timeout),
          redirect: "error",
          headers: { Accept: "application/json" },
        });
        if ([401, 403].includes(res.status)) {
          await this.store.pauseSource(Date.now() + 3600000);
          throw new AppError(
            "SOURCE_ACCESS_DENIED",
            "USC denied public access. Refreshes paused for one hour.",
          );
        }
        if (!res.ok) {
          if (res.status === 429 || res.status >= 500) {
            const retry = res.headers.get("retry-after");
            const ms = retry
              ? /^\d+$/.test(retry)
                ? Number(retry) * 1000
                : Math.max(0, Date.parse(retry) - Date.now())
              : 0;
            if (ms > 0 && Number.isFinite(ms))
              await this.store.pauseSource(Date.now() + ms);
            if (ms > 60000)
              throw new AppError(
                "SOURCE_UNAVAILABLE",
                "USC requested a longer pause.",
                Math.ceil(ms / 1000),
              );
            await sleep(
              Math.max(
                Number.isFinite(ms) ? ms : 0,
                500 * 2 ** attempt + Math.random() * 250,
              ),
            );
            continue;
          }
          throw new AppError(
            "SOURCE_UNAVAILABLE",
            `USC returned HTTP ${res.status}.`,
          );
        }
        const declared = Number(res.headers.get("content-length"));
        if (declared > 20_000_000)
          throw new AppError(
            "SOURCE_UNAVAILABLE",
            "Source response too large.",
          );
        // Consume under the same fetch abort deadline, with a streaming size limit.
        const reader = res.body?.getReader();
        if (!reader)
          throw new AppError("SOURCE_UNAVAILABLE", "Empty source body");
        const chunks: Uint8Array[] = [];
        let length = 0;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          length += value.length;
          if (length > 20_000_000) {
            await reader.cancel();
            throw new AppError(
              "SOURCE_UNAVAILABLE",
              "Source response too large.",
            );
          }
          chunks.push(value);
        }
        const payload: unknown = JSON.parse(
          Buffer.concat(chunks).toString("utf8"),
        );
        return { payload, url: url.href, checked_at: new Date().toISOString() };
      } catch (e) {
        if (e instanceof AppError) throw e;
        if (attempt === this.attempts - 1)
          throw new AppError(
            "SOURCE_UNAVAILABLE",
            "USC request timed out or returned invalid data.",
          );
        await sleep(500 * 2 ** attempt);
      }
    }
    throw new AppError("SOURCE_UNAVAILABLE", "USC retry budget exhausted.");
  }
  async terms() {
    return termsSchema.parse((await this.get("/api/Terms/Active")).payload);
  }
  async programs(term: number) {
    const r = await this.get("/api/Programs/TermCode", { termCode: term });
    return programsSchema.parse(r.payload);
  }
  async program(term: number, school: string, program: string) {
    const r = await this.get("/api/Courses/CoursesByTermSchoolProgram", {
      termCode: term,
      school,
      program,
    });
    responseSchema.parse(r.payload);
    return { ...r, school, program };
  }
}
