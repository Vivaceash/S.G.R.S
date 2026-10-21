import test from 'node:test';
import assert from 'node:assert/strict';
import { createInventoryCache, clearInventoryCache } from '../src/inventory-cache.mjs';

const storage = () => {
  const values = new Map();
  return { get length() { return values.size; }, key: i => [...values.keys()][i],
    getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
};

test('navigation and browser reload reuse data; only explicit refresh fetches again', async () => {
  const store = storage(); const cache = createInventoryCache('user-a', store);
  let reads = 0; const fetch = () => ({ count: ++reads });
  await cache.load('aps', fetch);
  await cache.load('aps', fetch);
  const reloaded = createInventoryCache('user-a', store);
  assert.equal((await reloaded.load('aps', fetch)).value.count, 1);
  assert.equal(reads, 1);
  assert.equal((await reloaded.load('aps', fetch, true)).value.count, 2);
});

test('in-flight queries are shared and a later edit wins over an older read', async () => {
  const cache = createInventoryCache('user-b', storage());
  let finish; const request = cache.load('catalog', () => new Promise(resolve => { finish = resolve; }));
  assert.equal(cache.load('catalog', () => { throw new Error('duplicate'); }), request);
  await Promise.resolve();
  cache.set('catalog', { location: 'Corregida' });
  finish({ location: 'Anterior' });
  assert.equal((await request).value.location, 'Corregida');
});

test('failed refresh preserves the last confirmed browser snapshot', async () => {
  const cache = createInventoryCache('user-c', storage());
  cache.set('catalog', { revision: 'confirmed' });
  await assert.rejects(cache.load('catalog', () => { throw new Error('offline'); }, true));
  assert.equal(cache.peek('catalog').value.revision, 'confirmed');
});

test('user and permission scopes are isolated; logout clears pending writes and persisted data', async () => {
  const store = storage(); const cache = createInventoryCache('admin', store);
  cache.set('catalog', { assets: ['private'] });
  assert.equal(createInventoryCache('viewer', store).peek('catalog'), null);
  let finish; const request = cache.load('aps', () => new Promise(resolve => { finish = resolve; }));
  await Promise.resolve(); clearInventoryCache(store); finish({ aps: ['late'] }); await request;
  assert.equal(store.length, 0);
  assert.equal(cache.peek('catalog'), null);
});

test('cache works in memory when browser storage is unavailable', async () => {
  const cache = createInventoryCache('memory', null);
  await cache.load('aps', () => [1]);
  assert.deepEqual(cache.peek('aps').value, [1]);
});
