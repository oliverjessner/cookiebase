import { test, expect } from './fixtures.js';
import { cookieId } from '../../src/core/cookies.js';

async function rpc(page, type, payload = {}) {
  const response = await page.evaluate(({ type, payload }) => chrome.runtime.sendMessage({ type, payload, requestId: crypto.randomUUID() }), { type, payload });
  if (!response.ok) throw new Error(response.error);
  return response.result;
}
async function cookieStore(manager) {
  return manager.evaluate(async () => {
    const stores = await chrome.cookies.getAllCookieStores();
    return stores[0].id;
  });
}
function cookie(domain, storeId, patch = {}) {
  return { name: 'e2e-auth', value: 'controlled-fixture-session-secret', domain, path: '/', storeId,
    hostOnly: true, secure: true, httpOnly: true, sameSite: 'lax', session: true, ...patch };
}
async function grantViaButton(manager, url) {
  await manager.locator('#target-url').fill(url);
  await manager.locator('#grant-site').click();
  await expect.poll(() => manager.evaluate(async (target) => chrome.permissions.contains({ origins: [`${new URL(target).protocol}//${new URL(target).hostname}/*`] }), url)).toBe(true);
}

test.describe('fresh install without host access', () => {
  test.use({ hostAccess: false });
  test('fresh manager and popup load local OJ CSS, fonts, icons and honest no-access state', async ({ manager, popup }) => {
  await expect(manager.locator('#main')).toBeVisible();
  await expect(popup.locator('#main')).toBeVisible();
  const oj = await manager.evaluate(async () => {
    await document.fonts.ready;
    return { font: getComputedStyle(document.body).fontFamily, styles: [...document.styleSheets].map(s => s.href), icons: [...document.querySelectorAll('.fa-solid')].map(i => getComputedStyle(i, '::before').fontFamily), localFonts: [...document.fonts].filter(f => f.status === 'loaded').map(f => f.family) };
  });
  expect(oj.font).toContain('Comfortaa');
  expect(oj.styles.every(url => !url || url.startsWith('chrome-extension://'))).toBeTruthy();
  expect(oj.icons.some(font => font.includes('Font Awesome'))).toBeTruthy();
  expect(oj.localFonts.some(font => font.includes('Comfortaa'))).toBeTruthy();
  await expect(manager.getByText(/Limited access: only explicitly granted hosts/)).toBeVisible();
});

});

test('pregranted host access, same-name paths, advanced attrs and protection', async ({ manager, httpsURL }) => {
  await grantViaButton(manager, httpsURL);
  const storeId = await cookieStore(manager);
  const hostname = new URL(httpsURL).hostname;
  const scope = { type: 'host', url: httpsURL, storeId, incognito: false };
  const rootCookie = cookie(hostname, storeId);
  const deepCookie = cookie(hostname, storeId, { path: '/admin', value: 'second-path-fixture' });
  expect((await rpc(manager, 'set', { cookie: rootCookie })).httpOnly).toBe(true);
  await rpc(manager, 'set', { cookie: deepCookie });
  let current = await rpc(manager, 'list', { scope });
  const sameNames = current.cookies.filter(c => c.name === rootCookie.name);
  expect(sameNames.map(c => c.path).sort()).toEqual(['/', '/admin']);
  expect(sameNames.every(c => c.httpOnly && c.secure && c.hostOnly && c.session && c.sameSite === 'lax')).toBeTruthy();
  expect(current.coverage.storeIds).toEqual([storeId]);
  expect(current.warnings.join(' ')).toMatch(/partition|frame/i);
  await rpc(manager, 'vault.initialize', { passphrase: 'a long controlled e2e passphrase' });
  await rpc(manager, 'rules.save', { rule: { domain: hostname, name: rootCookie.name, path: '/', includeSubdomains: false } });
  const preview = await rpc(manager, 'delete.preview', { scope });
  expect(preview.preserved.some(item => item.cookie.name === rootCookie.name && item.cookie.path === '/')).toBeTruthy();
  expect(preview.remove.some(c => c.name === rootCookie.name && c.path === '/admin')).toBeTruthy();
  const report = await rpc(manager, 'delete', { scope, ids: sameNames.map(cookieId) });
  expect(report.failed).toBe(0);
  expect(report.preserved).toBe(1);
  current = await rpc(manager, 'list', { scope });
  expect(current.cookies.filter(c => c.name === rootCookie.name).map(c => c.path)).toEqual(['/']);
});

test('advanced create validation, actual disable/snapshot/restore and partition separation', async ({ manager, httpsURL }) => {
  await grantViaButton(manager, httpsURL);
  const storeId = await cookieStore(manager);
  const scope = { type: 'host', url: httpsURL, storeId, incognito: false };
  const actual = cookie(new URL(httpsURL).hostname, storeId, { name: '__Host-e2e-advanced', sameSite: 'no_restriction' });
  const invalid = await manager.evaluate(async (cookie) => chrome.runtime.sendMessage({ type: 'set', payload: { cookie }, requestId: crypto.randomUUID() }), { ...actual, secure: false });
  expect(invalid.ok).toBe(false);
  expect(invalid.error).toMatch(/Secure/);
  await rpc(manager, 'vault.initialize', { passphrase: 'a long controlled e2e passphrase' });
  const written = await rpc(manager, 'set', { cookie: actual });
  const disabled = await rpc(manager, 'disable', { cookie: written, scope });
  expect(disabled.removed).toBe(true);
  expect((await rpc(manager, 'list', { scope })).cookies.some(c => c.name === actual.name)).toBe(false);
  const restore = await rpc(manager, 'snapshots.restore', { id: disabled.snapshot.id });
  expect(restore.failed).toBe(0);
  expect((await rpc(manager, 'list', { scope })).cookies.some(c => c.name === actual.name)).toBe(true);
  const partitioned = { ...actual, name: 'e2e-partition', partitionKey: { topLevelSite: 'https://example.org', hasCrossSiteAncestor: true } };
  await rpc(manager, 'set', { cookie: partitioned });
  await rpc(manager, 'set', { cookie: { ...partitioned, partitionKey: undefined } });
  const result = await rpc(manager, 'list', { scope });
  expect(result.cookies.filter(c => c.name === 'e2e-partition')).toHaveLength(2);
  expect(new Set(result.cookies.filter(c => c.name === 'e2e-partition').map(cookieId)).size).toBe(2);
});

test.describe('permission denial without optional grants', () => {
  test.use({ hostAccess: false });
  test('permission loss and invalid store return errors without a false success', async ({ manager, httpsURL }) => {
  const storeId = await cookieStore(manager);
  const payload = { cookie: cookie(new URL(httpsURL).hostname, storeId) };
  const denied = await manager.evaluate(async (payload) => chrome.runtime.sendMessage({ type: 'set', payload, requestId: crypto.randomUUID() }), payload);
  expect(denied.ok).toBe(false);
  expect(denied.error).toMatch(/access|permission/i);
  expect(denied.error).not.toContain(payload.cookie.value);
  const badStore = await manager.evaluate(async (payload) => chrome.runtime.sendMessage({ type: 'set', payload, requestId: crypto.randomUUID() }), { cookie: { ...payload.cookie, storeId: 'unavailable-e2e-store' } });
  expect(badStore.ok).toBe(false);
  expect(badStore.error).toMatch(/store/i);
});

});
