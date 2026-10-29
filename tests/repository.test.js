import test from 'node:test';
import assert from 'node:assert/strict';
import { createRepository } from '../src/core/repository.js';
import { cookieId } from '../src/core/cookies.js';
const base = { name: 'auth', value: 'test-secret-123', domain: 'example.test', path: '/', storeId: '0', hostOnly: true, secure: true, httpOnly: true, sameSite: 'lax', session: true };
function fixture() {
  const jar = [structuredClone(base)];
  const calls = [];
  const api = {
    extension: { inIncognitoContext: false },
    tabs: { async get(id) { return { id, incognito: id === 2 }; } },
    permissions: { async contains() { return true; }, async getAll() { return { origins: ['http://*/*', 'https://*/*'] }; } },
    cookies: {
      async getAllCookieStores() { return [{ id: '0', tabIds: [1] }, { id: '1', tabIds: [2] }]; },
      async getAll(details) { calls.push(details); return jar.filter((c) => (!details.storeId || c.storeId === details.storeId) && (!details.name || c.name === details.name) && (!details.path || c.path === details.path) && (details.partitionKey ? JSON.stringify(details.partitionKey) === '{}' || JSON.stringify(details.partitionKey) === JSON.stringify(c.partitionKey) : !c.partitionKey)); },
      async get(details) { return jar.find((c) => c.name === details.name && c.storeId === details.storeId) || null; },
      async set(details) { const c = { ...details, domain: details.domain || new URL(details.url).hostname, hostOnly: !details.domain, session: details.expirationDate == null }; delete c.url; const at = jar.findIndex((old) => cookieId(old) === cookieId(c)); if (at >= 0) jar.splice(at, 1); if (details.expirationDate !== 0) jar.push(c); return c; },
      async remove(details) { const at = jar.findIndex((c) => c.name === details.name && c.storeId === details.storeId); if (at < 0) return null; jar.splice(at, 1); return details; },
      async getPartitionKey() { return { partitionKey: { topLevelSite: 'https://example.test' } }; },
    },
  };
  return { jar, calls, api, repository: createRepository(api) };
}
test('enumeration isolates regular and incognito stores, dedupes partitions', async () => {
  const { jar, repository, calls } = fixture();
  jar.push({ ...base, storeId: '1' }, { ...base, partitionKey: { topLevelSite: 'https://example.test' } });
  const result = await repository.list({ scope: { type: 'all', incognito: false }, tabId: 1 });
  assert.equal(result.cookies.length, 2);
  assert.deepEqual(result.coverage.storeIds, ['0']);
  assert.equal(result.coverage.activePartitionKeys.length, 1);
  assert.ok(calls.every((c) => c.storeId === '0'));
  assert.match(result.warnings.join(), /best effort/);
});
test('a resolved set Promise is not success unless reread matches exact value and attrs', async () => {
  const { api, repository } = fixture();
  api.cookies.set = async () => ({ ...base, value: 'pretend' });
  await assert.rejects(repository.set({ ...base, value: 'new-secret-value' }), /Verification failed/);
});
test('real adapter verifies set and removal and refuses unavailable stores', async () => {
  const { repository } = fixture();
  const result = await repository.set({ ...base, value: 'new-value' });
  assert.equal(result.value, 'new-value');
  assert.equal((await repository.remove(result)).removed, true);
  assert.equal(await repository.get(result), null);
  await assert.rejects(repository.set({ ...base, storeId: '9' }), /store is unavailable/);
  await assert.rejects(repository.set({ ...base, storeId: '1' }), /another regular\/incognito|store is unavailable|cookie store is unavailable/i);
});
test('deletion expires exact identity when Chrome remove could affect same-name siblings', async () => {
  const { jar, api, repository } = fixture();
  const target = { ...base, path: '/admin' };
  jar.push(target);
  api.cookies.remove = async () => { throw new Error('Ambiguous remove API must not be called'); };
  assert.equal((await repository.remove(target)).removed, true);
  assert.deepEqual(jar.map(c => c.path), ['/']);
});
test('permission loss gives actionable reason and browser value text is redacted', async () => {
  const { api, repository } = fixture();
  api.permissions.contains = async () => false;
  await assert.rejects(repository.set(base), /Host access is missing/);
  api.permissions.contains = async () => true;
  api.cookies.set = async () => { throw new Error(`Rejected input ${base.value}`); };
  try { await repository.set(base); assert.fail('expected rejection'); }
  catch (error) { assert.match(error.message, /\[redacted\]/); assert.doesNotMatch(error.message, /test-secret-123/); }
});
test('partition or store enumeration failure is partial coverage, not a whole-app crash', async () => {
  const { api, repository } = fixture();
  const original = api.cookies.getAll;
  api.cookies.getAll = async (details) => { if (details.partitionKey) throw new Error('partition query rejected'); return original(details); };
  const result = await repository.list();
  assert.equal(result.cookies.length, 1);
  assert.equal(result.coverage.wildcardPartitionSupported, false);
  assert.match(result.warnings.join(), /partition/i);
});
