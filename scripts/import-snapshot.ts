import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { configuredStore } from '../packages/db/src/config.js';
import { termCode, type SourceResponse } from '../packages/contracts/src/index.js';
const dir = process.argv[2]; if (!dir) throw new Error('Usage: npm run import:snapshot -- /path/to/extracted-snapshot [term]');
const term = termCode.parse(Number(process.argv[3] ?? 20263));
const programs: unknown = JSON.parse(await readFile(join(dir, 'programs.json'), 'utf8'));
const responses: SourceResponse[] = [];
for (const file of (await readdir(join(dir, 'programs'))).filter(f => f.endsWith('.json'))) {
  const p = join(dir, 'programs', file), payload = JSON.parse(await readFile(p, 'utf8'));
  const school = String(payload.schoolPrefix), program = String(payload.programPrefix);
  // Archive member mtime is the original observation approximation; never mark imports as freshly fetched.
  responses.push({ school, program, checked_at: (await stat(p)).mtime.toISOString(), url: `https://classes.usc.edu/api/Courses/CoursesByTermSchoolProgram?termCode=${term}&school=${school}&program=${program}`, payload });
}
const store = await configuredStore();
try { console.log(JSON.stringify(await store.publish(term, programs, responses), null, 2)); } finally { await store.db.close(); }
