import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import {
  inputs,
  successEnvelope,
  AppError,
  errorResult,
  type ToolName,
  type Course,
  type Section,
  type Snapshot,
} from "../../contracts/src/index.js";
import type { Store } from "../../db/src/index.js";
import { digest } from "../../source-usc/src/schema.js";
import { validate } from "./validate.js";
export class CourseService {
  private cache = new Map<
    string,
    Promise<{ courses: Course[]; sections: Section[] }>
  >();
  private secret = randomBytes(32);
  metrics = { tool_calls: 0, dataset_loads: 0, cache_hits: 0 };
  constructor(public store: Store) {}
  private dataset(id: string) {
    const hit = this.cache.get(id);
    if (hit) {
      this.metrics.cache_hits++;
      return hit;
    }
    this.metrics.dataset_loads++;
    const promise = Promise.all([
      this.store.courses(id),
      this.store.db.query<{ data: Section }>(
        "SELECT data FROM sections WHERE snapshot_id=$1 ORDER BY id",
        [id],
      ),
    ]).then(([courses, rows]) => ({
      courses,
      sections: rows.map((r) => r.data),
    }));
    this.cache.set(id, promise);
    if (this.cache.size > 2) this.cache.delete(this.cache.keys().next().value!);
    void promise.catch(() => {
      this.cache.delete(id);
    });
    return promise;
  }
  private meta(s: Snapshot) {
    return {
      term_code: s.term,
      snapshot_version: s.id,
      checked_at: s.started_at,
      fetch_interval: { start: s.started_at, end: s.ended_at },
      stale: Date.now() - Date.parse(s.started_at) > 300000,
      coverage_status: s.coverage,
      warnings: [
        "Coverage is the public catalog, not personal eligibility.",
        "Locations, component rules and meeting date ranges are not verified.",
        "Syllabus URLs are not confirmed available documents.",
      ],
    };
  }
  private encode(value: unknown) {
    const body = Buffer.from(JSON.stringify(value)).toString("base64url");
    return (
      body +
      "." +
      createHmac("sha256", this.secret).update(body).digest("base64url")
    );
  }
  private decode(
    token: string,
    fingerprint: string,
  ): { version: string; offset: number } {
    try {
      const [body, signature] = token.split(".");
      if (!body || !signature) throw new Error();
      const actual = Buffer.from(signature, "base64url"),
        expected = createHmac("sha256", this.secret).update(body).digest();
      if (
        actual.length !== expected.length ||
        !timingSafeEqual(actual, expected)
      )
        throw new Error();
      const d = JSON.parse(Buffer.from(body, "base64url").toString());
      if (
        d.fingerprint !== fingerprint ||
        typeof d.version !== "string" ||
        !Number.isSafeInteger(d.offset) ||
        d.offset < 0
      )
        throw new Error();
      return d;
    } catch {
      throw new AppError(
        "INVALID_INPUT",
        "Cursor is invalid, from another query, or from a previous server process. Restart the search.",
      );
    }
  }
  async call(name: ToolName, raw: unknown): Promise<Record<string, unknown>> {
    this.metrics.tool_calls++;
    try {
      const result = successEnvelope.parse(await this.execute(name, raw));
      if (Buffer.byteLength(JSON.stringify(result)) > 2_000_000)
        throw new AppError(
          "RESPONSE_TOO_LARGE",
          "Reduce the batch or page size.",
        );
      return result;
    } catch (e) {
      return errorResult(e);
    }
  }
  private async execute(
    name: ToolName,
    raw: unknown,
  ): Promise<Record<string, unknown>> {
    if (!(name in inputs)) throw new AppError("INVALID_INPUT", "Unknown tool");
    if (name === "list_terms") {
      inputs.list_terms.parse(raw);
      const rows = await this.store.db.query<Snapshot>(
        "SELECT s.* FROM snapshots s JOIN terms t ON s.id=t.snapshot_id ORDER BY s.term DESC",
      );
      return {
        data: rows.map((s) => ({
          term_code: s.term,
          snapshot_version: s.id,
          coverage: s.coverage,
          checked_at: s.started_at,
          courses: s.course_count,
          sections: s.section_count,
        })),
        meta: {
          term_code: null,
          snapshot_version: null,
          checked_at: rows.map((r) => r.started_at).sort()[0] ?? null,
          fetch_interval: null,
          stale: rows.some(
            (r) => Date.now() - Date.parse(r.started_at) > 300000,
          ),
          coverage_status: "ingested_terms_only",
          warnings: [
            "Lists locally ingested terms; source active/archive classification is not yet persisted.",
          ],
        },
      };
    }
    const request = inputs[name].parse(raw);
    const fingerprint = digest({
      name,
      ...request,
      ...("cursor" in request ? { cursor: undefined } : {}),
      snapshot_version: undefined,
    });
    const cursor =
      "cursor" in request && request.cursor
        ? this.decode(request.cursor, fingerprint)
        : undefined;
    if (
      cursor &&
      "snapshot_version" in request &&
      request.snapshot_version &&
      cursor.version !== request.snapshot_version
    )
      throw new AppError(
        "INVALID_INPUT",
        "Cursor and requested snapshot differ.",
      );
    const version =
      cursor?.version ??
      ("snapshot_version" in request ? request.snapshot_version : undefined);
    const s = await this.store.snapshot(request.term_code, version);
    if (!s)
      throw new AppError(
        version ? "SNAPSHOT_EXPIRED" : "SNAPSHOT_UNAVAILABLE",
        "No matching stored snapshot; ingest this term or refetch the current version.",
      );
    const dataset = await this.dataset(s.id),
      meta = this.meta(s);
    const page = <T>(items: T[], limit: number) => {
      const offset = cursor?.offset ?? 0;
      return {
        items: items.slice(offset, offset + limit),
        total: items.length,
        next_cursor:
          offset + limit < items.length
            ? this.encode({
                version: s.id,
                offset: offset + limit,
                fingerprint,
              })
            : null,
      };
    };
    if (name === "search_courses") {
      const r = inputs.search_courses.parse(raw),
        text = r.query.toLowerCase(),
        compact = text.replace(/[ -]/g, "");
      const matched = dataset.courses.filter(
        (c) =>
          (c.aliases.some((a) => a.toLowerCase().includes(compact)) ||
            c.title.toLowerCase().includes(text)) &&
          (!r.program || c.programs.some((p) => p.endsWith("/" + r.program))),
      );
      return {
        data: page(
          matched.map((c) => ({
            code: c.code,
            title: c.title,
            units: c.units,
            aliases: c.aliases,
          })),
          r.limit,
        ),
        meta,
      };
    }
    if (
      name === "get_courses" ||
      name === "get_sections" ||
      name === "request_refresh"
    ) {
      const r = inputs[name].parse(raw);
      const matches = r.course_codes.map((code) => ({
        code,
        courses: dataset.courses.filter((c) => c.aliases.includes(code)),
      }));
      if (name === "get_courses")
        return {
          data: matches.map((m) => ({
            requested_code: m.code,
            status: m.courses.length ? "found" : "not_found",
            courses: m.courses,
          })),
          meta,
        };
      const keys = new Set(matches.flatMap((m) => m.courses.map((c) => c.key)));
      if (name === "get_sections")
        return {
          data: {
            ...page(
              dataset.sections.filter((c) => keys.has(c.course_key)),
              inputs.get_sections.parse(raw).limit,
            ),
            missing_courses: matches
              .filter((m) => !m.courses.length)
              .map((m) => m.code),
          },
          meta,
        };
      // No refresh for unknown codes. Cooldowns and queue limits apply even across different callers.
      const pairs = [
        ...new Set(
          matches.flatMap((m) => m.courses.flatMap((c) => c.programs)),
        ),
      ];
      if (pairs.length > 40)
        throw new AppError(
          "INVALID_INPUT",
          "Refresh batch spans too many programs; request fewer courses.",
        );
      const jobs = [];
      for (const pair of pairs) {
        const recent = await this.store.db.query<{
          id: string;
          status: string;
        }>(
          `SELECT id,status FROM jobs WHERE term=$1 AND pair=$2 AND updated_at>$3 ORDER BY updated_at DESC LIMIT 1`,
          [r.term_code, pair, new Date(Date.now() - 300000).toISOString()],
        );
        jobs.push({
          pair,
          ...(recent[0] ?? (await this.store.enqueue(r.term_code, pair))),
        });
      }
      return {
        data: {
          jobs,
          missing_courses: matches
            .filter((m) => !m.courses.length)
            .map((m) => m.code),
          message:
            "Queued or recently attempted; a refresh does not guarantee immediate freshness.",
        },
        meta,
      };
    }
    const r = inputs.validate_schedule.parse(raw);
    return { data: validate(r, dataset.courses, dataset.sections), meta };
  }
}
