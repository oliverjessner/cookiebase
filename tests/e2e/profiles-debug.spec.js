import { test, expect, grant } from './fixtures.js';
import { chromium } from '@playwright/test';
import path from 'node:path';
import { access } from 'node:fs/promises';

async function rpc(manager, type, payload = {}) {
  const result = await manager.evaluate(async ({ type, payload }) => chrome.runtime.sendMessage({ type, payload, requestId: crypto.randomUUID() }), { type, payload });
  if (!result.ok) throw new Error(`${type}: ${result.error}`);
  return result.result;
}
async function response(manager, type, payload = {}) {
  return manager.evaluate(async ({ type, payload }) => chrome.runtime.sendMessage({ type, payload, requestId: crypto.randomUUID() }), { type, payload });
}
async function diskState(manager) {
  return manager.evaluate(async () => {
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open('cookiebase', 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(new Error('Cannot inspect Cookiebase test database.'));
    });
    const records = await new Promise((resolve, reject) => {
      const request = database.transaction('records', 'readonly').objectStore('records').getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(new Error('Cannot inspect Cookiebase test records.'));
    });
    database.close();
    return JSON.stringify({ records, metadata: await chrome.storage.local.get(null) });
  });
}

const phrase = 'Cookiebase QA passphrase 2026';
function scopeFor(url) { return { type: 'host', url, storeId: '0', incognito: false }; }
function secretCookie(url, value, name = 'profile_sid') {
  return { name, value, domain: new URL(url).hostname, path: '/', storeId: '0', hostOnly: true,
    secure: url.startsWith('https:'), httpOnly: true, session: true, sameSite: 'lax', incognito: false };
}

test('real encrypted profile A/B apply, verification, backup restore, wrong passphrase and manager reopen', async ({ manager, context, extensionId, baseURL }) => {
  await grant(manager);
  const scope = scopeFor(baseURL);
  await rpc(manager, 'vault.initialize', { passphrase: phrase });
  const cookie = secretCookie(baseURL, 'PROFILE_SECRET_A_8b0795');
  await rpc(manager, 'set', { cookie });
  const listed = await rpc(manager, 'list', { scope });
  const a = await rpc(manager, 'profiles.create', { scope, cookies: listed.cookies, profile: { name: 'Test User', description: 'Local QA only', tags: ['qa'] } });
  const b = await rpc(manager, 'profiles.create', { scope, cookies: [], profile: { name: 'Logged out', description: 'No cookies', tags: ['qa'] } });
  const preview = await rpc(manager, 'profiles.preview', { id: b.id, scope, options: { mode: 'replace' } });
  expect(preview.removals).toBeGreaterThanOrEqual(1);
  const loggedOut = await rpc(manager, 'profiles.apply', { id: b.id, scope, options: { mode: 'replace', backup: true } });
  expect(loggedOut.failed).toBe(0);
  expect(loggedOut.backupId).toBeTruthy();
  expect((await rpc(manager, 'list', { scope })).cookies.some(c => c.name === cookie.name)).toBe(false);
  const restored = await rpc(manager, 'profiles.apply', { id: a.id, scope, options: { mode: 'merge', backup: true } });
  expect(restored.failed).toBe(0);
  expect(restored.applied).toBeGreaterThanOrEqual(1);
  expect((await rpc(manager, 'list', { scope })).cookies.find(c => c.name === cookie.name)?.value).toBe(cookie.value);
  const backupRestored = await rpc(manager, 'snapshots.restore', { id: loggedOut.backupId });
  expect(backupRestored.failed).toBe(0);
  const duplicate = await rpc(manager, 'profiles.duplicate', { id: a.id });
  await rpc(manager, 'profiles.update', { id: duplicate.id, patch: { name: 'Renamed QA user', tags: ['duplicate'] } });
  expect((await rpc(manager, 'profiles.list', { query: 'duplicate' })).map(p => p.id)).toContain(duplicate.id);
  await rpc(manager, 'profiles.remove', { id: duplicate.id });
  const exported = await rpc(manager, 'profiles.export', { id: a.id });
  expect(exported.format).toBe('cookiebase-profile');
  expect((await rpc(manager, 'profiles.import', { data: exported })).cookieCount).toBe(a.cookieCount);
  const disk = await diskState(manager);
  expect(disk).not.toContain(cookie.value);
  expect(disk).not.toContain(phrase);
  expect(disk).not.toContain('Local QA only');
  await rpc(manager, 'vault.lock');
  const wrong = await response(manager, 'vault.unlock', { passphrase: 'wrong but sufficiently long phrase' });
  expect(wrong.ok).toBe(false);
  expect(wrong.error).toMatch(/incorrect|damaged/i);
  expect(wrong.error).not.toContain(cookie.value);
  const reopened = await context.newPage();
  await reopened.goto(`chrome-extension://${extensionId}/manager.html#profiles`);
  expect((await rpc(reopened, 'status')).vault.locked).toBe(true);
  await rpc(reopened, 'vault.unlock', { passphrase: phrase });
  expect((await rpc(reopened, 'profiles.list', { query: 'Test User' })).length).toBeGreaterThanOrEqual(1);
  const devtools = await context.newCDPSession(reopened);
  await devtools.send('ServiceWorker.enable');
  await devtools.send('ServiceWorker.stopAllWorkers');
  await devtools.detach();
  await expect.poll(async () => (await rpc(reopened, 'status')).vault.locked).toBe(true);
  const lockedProfiles = await response(reopened, 'profiles.list');
  expect(lockedProfiles.ok).toBe(false);
  expect(lockedProfiles.error).toMatch(/locked/i);
  await rpc(reopened, 'vault.unlock', { passphrase: phrase });
  expect((await rpc(reopened, 'profiles.list', { query: 'Test User' })).length).toBeGreaterThanOrEqual(1);
  await reopened.close();
});

test('real cookie event timeline, overwrite correlation, snapshot value diff, retention and no durable plaintext', async ({ manager, baseURL }) => {
  await grant(manager);
  const scope = scopeFor(baseURL);
  await rpc(manager, 'history.configure', { enabled: true, maxEntries: 50, maxAgeHours: 1 });
  const first = secretCookie(baseURL, 'DEBUG_SECRET_BEFORE_724f03', 'debug_sid');
  await rpc(manager, 'set', { cookie: first });
  await expect.poll(async () => (await rpc(manager, 'history.list', { name: first.name })).length).toBeGreaterThanOrEqual(1);
  const before = await rpc(manager, 'history.capture', { name: 'Before controlled login', scope });
  await rpc(manager, 'set', { cookie: { ...first, value: 'DEBUG_SECRET_AFTER_283df1', sameSite: 'strict' } });
  await expect.poll(async () => (await rpc(manager, 'history.list', { name: first.name })).filter(e => e.kind === 'overwrite').length).toBe(1);
  const after = await rpc(manager, 'history.capture', { name: 'After controlled login', scope });
  const diff = await rpc(manager, 'history.compare', { before: before.id, after: after.id });
  const changed = diff.changed.find(item => item.cookie.name === first.name);
  expect(changed.valueChanged).toBe(true);
  expect(changed.attributes).toContain('sameSite');
  const events = await rpc(manager, 'history.list', { name: first.name });
  expect(events.filter(e => e.kind === 'overwrite').length).toBe(1);
  expect(events.some(e => e.cause === 'overwrite' && e.valueChanged === true)).toBe(true);
  expect(JSON.stringify(events)).not.toContain(first.value);
  const disk = await diskState(manager);
  expect(disk).not.toContain(first.value);
  expect(disk).not.toContain('DEBUG_SECRET_AFTER_283df1');
  expect(disk).not.toContain('valueDigest');
  await rpc(manager, 'history.configure', { maxEntries: 2 });
  for (let i = 0; i < 4; i++) await rpc(manager, 'set', { cookie: secretCookie(baseURL, `DEBUG_SECRET_${i}`, `retention_${i}`) });
  await expect.poll(async () => (await rpc(manager, 'history.list')).length).toBe(2);
  await rpc(manager, 'history.configure', { enabled: false });
  const stoppedCount = (await rpc(manager, 'history.list')).length;
  await rpc(manager, 'set', { cookie: secretCookie(baseURL, 'DEBUG_OFF_SECRET', 'stopped_cookie') });
  expect((await rpc(manager, 'history.list')).length).toBe(stoppedCount);
  await rpc(manager, 'history.clear');
  expect((await rpc(manager, 'history.list')).length).toBe(0);
});


test('vault profiles survive a complete Chromium close and restart with the same disk profile', async ({ manager, context, extensionId, baseURL }) => {
  await grant(manager);
  const scope = scopeFor(baseURL);
  const cookie = secretCookie(baseURL, 'BROWSER_RESTART_PROFILE_SECRET_790abd', 'restart_sid');
  await rpc(manager, 'vault.initialize', { passphrase: phrase });
  await rpc(manager, 'history.configure', { enabled: true });
  await rpc(manager, 'set', { cookie });
  const captured = await rpc(manager, 'list', { scope });
  const saved = await rpc(manager, 'profiles.create', { scope, cookies: captured.cookies, profile: { name: 'Persisted restart QA', description: 'Encrypted restart metadata', tags: ['restart'] } });
  expect((await rpc(manager, 'status')).vault.locked).toBe(false);
  const beforeDisk = await diskState(manager);
  expect(beforeDisk).not.toContain(cookie.value);
  expect(beforeDisk).not.toContain(phrase);
  expect(beforeDisk).not.toContain('Encrypted restart metadata');

  const versionPage = await context.newPage();
  await versionPage.goto('chrome://version/');
  const browserProfileDirectory = (await versionPage.locator('#profile_path').textContent()).trim();
  // chrome://version reports the Default profile directory, inside the fixture's
  // persistent user-data directory. The unchanged test extension is its sibling.
  const userDataDirectory = path.dirname(browserProfileDirectory);
  const extensionPath = path.join(path.dirname(userDataDirectory), 'extension');
  await access(path.join(extensionPath, 'manifest.json'));
  await context.close();

  const restarted = await chromium.launchPersistentContext(userDataDirectory, {
    channel: 'chromium', headless: true, viewport: { width: 1440, height: 1000 },
    acceptDownloads: true, ignoreHTTPSErrors: true,
    args: [
      `--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`,
      '--ignore-certificate-errors', '--no-proxy-server',
      '--host-resolver-rules=MAP *.cookiebase.test 127.0.0.1,MAP cookiebase.test 127.0.0.1',
    ],
  });
  try {
    let [restartedWorker] = restarted.serviceWorkers();
    if (!restartedWorker) restartedWorker = await restarted.waitForEvent('serviceworker');
    expect(restartedWorker.url().split('/')[2]).toBe(extensionId);
    const reopened = await restarted.newPage();
    await reopened.goto(`chrome-extension://${extensionId}/manager.html#profiles`);
    await expect(reopened.locator('#main')).toBeVisible();
    const status = await rpc(reopened, 'status');
    expect(status.vault.initialized).toBe(true);
    expect(status.vault.locked).toBe(true);
    const lockedProfiles = await response(reopened, 'profiles.list');
    expect(lockedProfiles.ok).toBe(false);
    expect(lockedProfiles.error).toMatch(/locked/i);
    const persistedDisk = await diskState(reopened);
    expect(persistedDisk).not.toContain(cookie.value);
    expect(persistedDisk).not.toContain(phrase);
    expect(persistedDisk).not.toContain('Encrypted restart metadata');
    await rpc(reopened, 'vault.unlock', { passphrase: phrase });
    const profiles = await rpc(reopened, 'profiles.list', { query: 'Persisted restart QA' });
    expect(profiles).toHaveLength(1);
    expect(profiles[0].id).toBe(saved.id);
    expect(profiles[0].cookieCount).toBe(saved.cookieCount);
    const applied = await rpc(reopened, 'profiles.apply', { id: saved.id, scope, options: { mode: 'merge', backup: true } });
    expect(applied.failed).toBe(0);
    expect(applied.applied).toBeGreaterThanOrEqual(1);
    expect((await rpc(reopened, 'list', { scope })).cookies.find(c => c.name === cookie.name)?.value).toBe(cookie.value);
  } finally {
    await restarted.close();
  }
});
