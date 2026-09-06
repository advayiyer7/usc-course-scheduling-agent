import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { openDatabase, migrate, Store } from '../packages/db/src/index.js';
import { UscClient } from '../packages/source-usc/src/client.js';
import { normalize } from '../packages/source-usc/src/schema.js';
import { programs, response, course } from './fixtures.js';
let store: Store;
beforeEach(async () => { const db = await openDatabase(); await migrate(db); store = new Store(db); });
afterEach(async () => { await store.db.close(); });
describe('atomic ingestion', () => {
  it('preserves a good snapshot when coverage or payload validation fails', async () => {
    const good = await store.publish(20263, programs, [response()]);
    await expect(store.publish(20263, programs, [])).rejects.toThrow('coverage');
    await expect(store.publish(20263, programs, [response([])])).rejects.toThrow('Empty');
    const wrong = response(); (wrong.payload as { termCode: number }).termCode = 20261;
    await expect(store.publish(20263, programs, [wrong])).rejects.toThrow('identity');
    expect((await store.current(20263))?.id).toBe(good.id);
  });
  it('pins immutable versions and rejects concurrent stale publication', async () => {
    const a = await store.publish(20263, programs, [response()]);
    const b = await store.publish(20263, programs, [response()], a.id);
    await expect(store.publish(20263, programs, [response()], a.id)).rejects.toThrow('changed');
    expect((await store.snapshot(20263, a.id))?.id).toBe(a.id);
    expect((await store.current(20263))?.id).toBe(b.id);
    expect(await store.db.query('SELECT * FROM sections WHERE snapshot_id=$1', [b.id])).toHaveLength(1);
  });
  it('retains aliases and rejects duplicate coverage', async () => {
    const alias = course(); alias.publishedCourseCode.courseSmashed = 'TEST200';
    expect(normalize(20263, [response([course(), alias])])[0]?.aliases).toContain('TEST200');
    await expect(store.publish(20263, programs, [response(), response()])).rejects.toThrow('coverage');
  });
  it('coalesces 100 concurrent refreshes into one job', async () => {
    const jobs = await Promise.all(Array.from({ length: 100 }, () => store.enqueue(20263, 'DEMO/TEST')));
    expect(new Set(jobs.map(j => j.id)).size).toBe(1);
    expect(await store.db.query('SELECT * FROM jobs')).toHaveLength(1);
  });
  it('allows only one worker lease owner', async () => {
    expect(await store.lease('one')).toBe(true); expect(await store.lease('two')).toBe(false);
    await store.release('one'); expect(await store.lease('two')).toBe(true);
  });
});
it('retries transient errors but stops immediately on access denial', async () => {
  let n = 0;
  const source = new UscClient(store, (async () => ++n === 1 ? new Response('', { status: 503 }) : Response.json(programs)) as typeof fetch, 1, 1000, 2);
  expect(await source.programs(20263)).toHaveLength(1); expect(n).toBe(2);
  const denied = new UscClient(store, (async () => new Response('', { status: 403 })) as typeof fetch, 1, 1000, 3);
  await expect(denied.programs(20263)).rejects.toMatchObject({ code: 'SOURCE_ACCESS_DENIED' }); expect(denied.requestCount).toBe(1);
});
