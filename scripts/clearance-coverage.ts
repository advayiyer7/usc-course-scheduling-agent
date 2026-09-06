import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  termCode,
  type SourceResponse,
} from "../packages/contracts/src/index.js";
import {
  programsSchema,
  normalize,
} from "../packages/source-usc/src/schema.js";
import { guidanceForCourse } from "../packages/domain/src/clearance.js";
import {
  CLEARANCE_REGISTRY_VERSION,
  clearanceRegistry,
} from "../packages/source-usc/src/clearance-registry.js";

// Offline audit: consumes an existing public archive, never opens a DB or fetches USC.
const [archive, output, rawTerm = "20263"] = process.argv.slice(2);
if (!archive || !output)
  throw new Error(
    "Usage: node --import=tsx scripts/clearance-coverage.ts ARCHIVE OUTPUT.json [TERM]",
  );
const term = termCode.parse(Number(rawTerm));
const programs = programsSchema.parse(
  JSON.parse(await readFile(join(archive, "programs.json"), "utf8")),
);
if (programs.some((p) => p.termCode !== term))
  throw new Error("Archive term mismatch");
const pairs = new Set(
  programs.flatMap((p) => p.schools.map((s) => `${s.prefix}/${p.prefix}`)),
);
const sourceDir = await stat(join(archive, "program-data"))
  .then(() => "program-data")
  .catch(() => "programs");
const responses: SourceResponse[] = [];
const observed = new Set<string>();
for (const filename of (await readdir(join(archive, sourceDir)))
  .filter((f) => f.endsWith(".json"))
  .sort()) {
  const path = join(archive, sourceDir, filename);
  const payload = JSON.parse(await readFile(path, "utf8"));
  const school = String(payload.schoolPrefix),
    program = String(payload.programPrefix);
  const pair = `${school}/${program}`;
  if (!pairs.has(pair) || observed.has(pair))
    throw new Error(`Unexpected/duplicate pair: ${pair}`);
  observed.add(pair);
  responses.push({
    school,
    program,
    payload,
    checked_at: (await stat(path)).mtime.toISOString(),
    url: `https://classes.usc.edu/api/Courses/CoursesByTermSchoolProgram?termCode=${term}&school=${school}&program=${program}`,
  });
}
if (observed.size !== pairs.size)
  throw new Error("Archive missing program responses");
const courses = normalize(term, responses);
const rows = courses.map((c) => {
  const guidance = guidanceForCourse(c, term);
  return {
    course_code: c.code,
    scheduled_key: c.key,
    programs: c.programs,
    coverage: guidance.coverage_status,
    d_section_ids: c.sections
      .filter((s) => s.d_clearance === true)
      .map((s) => s.id),
    routes: guidance.routes.map((r) => ({ id: r.id, url: r.url })),
  };
});
function totals(subset: typeof rows) {
  return {
    courses: subset.length,
    department_instructions: subset.filter(
      (c) => c.coverage === "department_instructions",
    ).length,
    catalog_only: subset.filter((c) => c.coverage === "catalog_only").length,
    unresolved: subset.filter((c) => c.coverage === "unresolved").length,
    d_sections: new Set(subset.flatMap((c) => c.d_section_ids)).size,
    d_sections_with_department_instructions: new Set(
      subset
        .filter((c) => c.coverage === "department_instructions")
        .flatMap((c) => c.d_section_ids),
    ).size,
  };
}
const schools = [
  ...new Set(programs.flatMap((p) => p.schools.map((s) => s.prefix))),
].sort();
const summary = {
  term,
  registry_version: CLEARANCE_REGISTRY_VERSION,
  registry_entries: clearanceRegistry.length,
  upstream_requests: 0,
  program_pairs: pairs.size,
  schools: schools.length,
  ...totals(rows),
};
const by_school = schools.map((school) => ({
  school,
  ...totals(
    rows.filter((c) => c.programs.some((p) => p.startsWith(school + "/"))),
  ),
}));
await writeFile(
  output,
  JSON.stringify({ summary, by_school, courses: rows }, null, 2) + "\n",
);
console.log(JSON.stringify({ summary, by_school }, null, 2));
