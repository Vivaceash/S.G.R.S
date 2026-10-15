import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAltasCache } from '../src/altas-cache.mjs';

test('navigation shares pending work and reuses the session snapshot', async () => {
  const cache = createAltasCache();
  let calls = 0;
  const fetcher = async () => { calls++; return { success: true, data: { users: [{ username: 'test' }] } }; };
  const first = cache.load(fetcher);
  assert.equal(cache.load(fetcher), first);
  const value = await first;
  assert.equal(await cache.load(fetcher), value);
  assert.equal(cache.peek(), value);
  assert.equal(calls, 1);
  await cache.load(fetcher, true);
  assert.equal(calls, 2);
  assert.equal(createAltasCache().peek(), null);
});

test('failed refresh retains data and permits retry', async () => {
  const cache = createAltasCache();
  const value = await cache.load(async () => ({ success: true, data: { users: [] } }));
  await assert.rejects(cache.load(async () => { throw new Error('offline'); }, true));
  assert.equal(cache.peek(), value);
  await cache.load(async () => ({ success: true, data: { users: [{ username: 'new' }] } }), true);
  assert.equal(cache.peek().users[0].username, 'new');
});
