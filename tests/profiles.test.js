import test from 'node:test';
import assert from 'node:assert/strict';
import { createVault } from '../src/services/vault.js';
import { createProfileService } from '../src/services/profiles.js';
import { cookieId, inScope } from '../src/core/cookies.js';
const scope = { type: 'site', url: 'https://example.com/', storeId: '0', incognito: false };
const cookie = { name: 'sid', value: 'test-user-secret', domain: 'example.com', path: '/', storeId: '0', hostOnly: true, secure: true, httpOnly: true, session: true, sameSite: 'lax', incognito: false };
async function setup(initial = []) {
  const state = new Map(initial.map(c => [cookieId(c), structuredClone(c)]));
  const map = new Map();
  const storage = { get: async key => structuredClone(map.get(key)), set: async (key, value) => { map.set(key, structuredClone(value)); }, delete: async key => { map.delete(key); } };
  const vault = createVault(storage);
  await vault.initialize('a sufficiently strong test passphrase');
  const repository = {
    list: async ({ scope: selected }) => ({ cookies: [...state.values()].filter(c => inScope(c, selected)) }),
    set: async c => { state.set(cookieId(c), structuredClone(c)); return structuredClone(c); },
    remove: async c => { state.delete(cookieId(c)); return { removed: true }; },
    verify: async c => { const actual = state.get(cookieId(c)); if (!actual || actual.value !== c.value) throw new Error('Verification failed'); return actual; },
  };
  return { state, map, vault, repository, service: createProfileService({ vault, repository }) };
}
test('named profile CRUD, search, duplicate, export and import persist encrypted metadata and secrets', async () => {
  const { service, map } = await setup();
  const first = await service.create({ name: 'Test User', description: 'QA session', tags: ['staging'], scope, cookies: [cookie] });
  assert.equal(first.cookieCount, 1);
  assert.equal((await service.list('staging')).length, 1);
  const copy = await service.duplicate(first.id);
  await service.update(copy.id, { name: 'Admin', tags: ['admin'] });
  assert.equal((await service.list('admin'))[0].name, 'Admin');
  const exported = await service.exportProfile(first.id);
  const imported = await service.importProfile(exported);
  assert.equal(imported.cookieCount, 1);
  await service.remove(copy.id);
  assert.equal((await service.list()).length, 2);
  const disk = JSON.stringify([...map]);
  assert.equal(disk.includes('test-user-secret'), false);
  assert.equal(disk.includes('Test User'), false);
  assert.equal(disk.includes('staging'), false);
});
test('profile A/B apply previews, verifies, replaces only scoped regular cookies and provides encrypted backup restore', async () => {
  const unrelated = { ...cookie, name: 'other', domain: 'unrelated.test', value: 'untouched' };
  const privateCookie = { ...cookie, storeId: '1', incognito: true, value: 'private' };
  const { service, state } = await setup([cookie, unrelated, privateCookie]);
  const loggedOut = await service.create({ name: 'Logged out', scope, cookies: [] });
  const testUser = await service.create({ name: 'Test User', scope, cookies: [{ ...cookie, value: 'profile-b' }] });
  const preview = await service.preview(loggedOut.id, { scope, mode: 'replace' });
  assert.equal(preview.removals, 1);
  const report = await service.apply(loggedOut.id, { scope, mode: 'replace' });
  assert.equal(report.removed, 1);
  assert.equal(report.failed, 0);
  assert.ok(report.backupId);
  assert.equal(state.has(cookieId(cookie)), false);
  assert.equal(state.get(cookieId(unrelated)).value, 'untouched');
  assert.equal(state.get(cookieId(privateCookie)).value, 'private');
  const applyB = await service.apply(testUser.id, { scope, mode: 'merge' });
  assert.equal(applyB.applied, 1);
  assert.equal(state.get(cookieId(cookie)).value, 'profile-b');
  const restored = await service.restoreSnapshot(report.backupId);
  assert.equal(restored.applied, 1);
  assert.equal(state.get(cookieId(cookie)).value, cookie.value);
  assert.equal(JSON.stringify(report).includes(cookie.value), false);
});
test('failed application reports individual failure and best effort rollback without claiming atomic success', async () => {
  const { service, state, repository } = await setup([cookie]);
  const bad = { ...cookie, name: 'fail', value: 'cannot-set' };
  const profile = await service.create({ name: 'Broken target', scope, cookies: [bad] });
  const originalSet = repository.set;
  repository.set = async c => { if (c.name === 'fail') throw new Error('Browser policy refused this cookie.'); return originalSet(c); };
  const report = await service.apply(profile.id, { scope, mode: 'replace' });
  assert.equal(report.failed, 1);
  assert.equal(report.results.find(r => r.status === 'failed').error, 'Browser policy refused this cookie.');
  assert.equal(report.rollback.atomic, false);
  assert.equal(report.rollback.restored, 1);
  assert.equal(state.get(cookieId(cookie)).value, cookie.value);
});
test('incognito, cross-store transfer, out-of-scope and duplicate profile cookies are refused', async () => {
  const { service } = await setup();
  await assert.rejects(service.create({ name: 'Private', scope: { ...scope, incognito: true }, cookies: [] }), /incognito/);
  await assert.rejects(service.create({ name: 'Wrong store', scope, cookies: [{ ...cookie, storeId: '1' }] }), /store/);
  await assert.rejects(service.create({ name: 'Wrong domain', scope, cookies: [{ ...cookie, domain: 'other.test' }] }), /scope/);
  await assert.rejects(service.create({ name: 'Duplicate', scope, cookies: [cookie, cookie] }), /duplicate/);
  const item = await service.create({ name: 'Regular', scope, cookies: [cookie] });
  await assert.rejects(service.preview(item.id, { scope: { ...scope, storeId: '2' }, mode: 'merge' }), /store/);
});
test('stored expired cookies do not prevent renaming or duplicating a profile', async () => {
  const { service, vault } = await setup();
  const item = await service.create({ name: 'Aging profile', scope, cookies: [{ ...cookie, session: false, expirationDate: Date.now() / 1000 + 3600 }] });
  // Advance the captured state without wall-clock sleeps. The stored session is now stale.
  await vault.update(data => { data.profiles[0].cookies[0].expirationDate = Date.now() / 1000 - 60; });
  await service.update(item.id, { name: 'Archived QA state' });
  assert.equal((await service.get(item.id)).name, 'Archived QA state');
  const copied = await service.duplicate(item.id);
  assert.equal(copied.cookieCount, 1);
  assert.equal((await service.get(copied.id)).name, 'Archived QA state copy');
});
