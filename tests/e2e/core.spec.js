import { test, expect, chooseScope, grant } from './fixtures.js';
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
  await chooseScope(manager,{url});
  const hostname=new URL(url).hostname;
  await grant(manager,[`http://${hostname}/*`,`https://${hostname}/*`]);
  await expect(manager.getByText('Access granted for this site',{exact:true})).toBeVisible();
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
  await expect(manager.getByText(/Results cover 0 granted hosts/)).toBeVisible();
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

test('HTTP fixtures across localhost, a domain and its subdomain stay in explicit scopes', async ({ manager, context, baseURL, urls }) => {
  const site = await context.newPage();
  for (const url of [baseURL, urls.app, urls.sub]) await site.goto(`${url}/seed`);
  const storeId = await cookieStore(manager);
  const scope = { type: 'host', url: urls.app, storeId, incognito: false };
  const exact = await rpc(manager, 'list', { scope });
  expect(exact.cookies.filter(c => c.name === 'twin').map(c => c.path).sort()).toEqual(['/', '/account']);
  expect(exact.cookies.every(c => c.domain === 'app.cookiebase.test')).toBe(true);
  const withSubdomains = await rpc(manager, 'list', { scope: { type: 'domains', domains: ['app.cookiebase.test'], storeId, incognito: false } });
  expect(new Set(withSubdomains.cookies.map(c => c.domain))).toEqual(new Set(['app.cookiebase.test', 'sub.app.cookiebase.test']));
  const all = await rpc(manager, 'list', { scope: { type: 'all', storeId, incognito: false } });
  expect(new Set(all.cookies.map(c => c.domain))).toEqual(new Set(['localhost', 'app.cookiebase.test', 'sub.app.cookiebase.test']));
  const urlScope = await rpc(manager, 'list', { scope: { type: 'url', url: `${urls.app}/account/profile`, storeId, incognito: false } });
  expect(urlScope.cookies.filter(c => c.name === 'twin')).toHaveLength(2);
  await rpc(manager, 'vault.initialize', { passphrase: 'a long controlled e2e passphrase' });
  const selected = exact.cookies.find(c => c.name === 'twin' && c.path === '/account');
  const result = await rpc(manager, 'delete', { scope, ids: [cookieId(selected)] });
  expect(result.removed).toBe(1);
  expect(result.failed).toBe(0);
  const after = await rpc(manager, 'list', { scope: { type: 'all', storeId, incognito: false } });
  expect(after.cookies.filter(c => c.name === 'twin')).toHaveLength(5);
  expect(after.cookies.find(c => c.domain === 'app.cookiebase.test' && c.name === 'twin').path).toBe('/');
  await site.close();
});

test('Create editor exposes every advanced attribute, masks secrets and saves through real Chrome APIs', async ({ manager, urls }) => {
  await grantViaButton(manager, urls.secure);
  await manager.getByRole('link', { name: 'Cookies', exact: true }).click();
  await manager.locator('#create-cookie').click();
  const dialog = manager.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Create cookie' })).toBeVisible();
  for (const id of ['edit-name', 'edit-value', 'edit-domain', 'edit-path', 'edit-storeId', 'edit-sameSite']) await expect(dialog.locator(`#${id}`)).toBeVisible();
  await expect(dialog.locator('#edit-expiration')).toBeHidden();
  await expect(dialog.locator('#edit-partition')).toBeHidden();
  await dialog.locator('#edit-name').fill('editor-advanced');
  await dialog.locator('#edit-value').fill('secret visible only after reveal');
  await expect(dialog.locator('#edit-value')).toHaveAttribute('type', 'password');
  await dialog.getByLabel('Reveal secret value', { exact: true }).check();
  await expect(dialog.locator('#edit-value')).toHaveAttribute('type', 'text');
  await dialog.getByLabel('Reveal secret value', { exact: true }).uncheck();
  await dialog.locator('#edit-path').fill('/tools');
  await dialog.locator('#edit-sameSite').selectOption('strict');
  await dialog.getByLabel('HTTP only', { exact: true }).check();
  await dialog.getByLabel('Exact host only', { exact: true }).uncheck();
  await dialog.locator('#edit-lifetime').selectOption('persistent');
  const future = new Date(Date.now() + 86400000).toISOString().slice(0, 19);
  await dialog.locator('#edit-expiration').fill(future);
  await dialog.locator('#edit-partitioned').check();
  await dialog.locator('#edit-partition').fill('https://cookiebase.test');
  await dialog.getByLabel('Partition has cross-site ancestor', { exact: true }).check();
  await dialog.getByRole('button', { name: 'Save & verify', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(manager.locator('#status')).toContainText('saved and verified');
  const storeId = await cookieStore(manager);
  const listed = await rpc(manager, 'list', { scope: { type: 'host', url: urls.secure, storeId, incognito: false } });
  const actual = listed.cookies.find(c => c.name === 'editor-advanced');
  expect(actual).toMatchObject({ path: '/tools', domain: '.app.cookiebase.test', secure: true, httpOnly: true, hostOnly: false, session: false, sameSite: 'strict', partitionKey: { topLevelSite: 'https://cookiebase.test', hasCrossSiteAncestor: true } });
  expect(actual.expirationDate).toBeGreaterThan(Date.now() / 1000);
  await manager.locator('#search').fill('editor-ad*');
  await expect(manager.locator('#cookie-count')).toContainText('1 filtered');
  await manager.getByRole('button', { name: 'Details for editor-advanced', exact: true }).click();
  await manager.getByRole('button',{name:'Edit cookie',exact:true}).click();
  await expect(manager.getByRole('dialog').locator('#edit-value')).toHaveAttribute('type', 'password');
  await manager.keyboard.press('Escape');
  await expect(manager.getByRole('dialog')).toHaveCount(0);
});
