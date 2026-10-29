import { test, expect, rpc } from './fixtures.js';
import { cookieId } from '../../src/core/cookies.js';

test('actual incognito extension access keeps stores separate and disables persistent vaults', async ({ context, extensionId, manager, baseURL }, testInfo) => {
  const regularStore = await manager.evaluate(async () => (await chrome.cookies.getAllCookieStores())[0].id);
  const regularCookie = { name: 'regular-isolation-check', value: 'controlled-regular-fixture', domain: 'localhost', path: '/', storeId: regularStore,
    hostOnly: true, secure: false, httpOnly: true, sameSite: 'lax', session: true };
  await rpc(manager, 'set', { cookie: regularCookie });
  const extensions = await context.newPage();
  await extensions.goto(`chrome://extensions/?id=${extensionId}`);
  const developerMode = extensions.locator('extensions-toolbar #devMode');
  await expect(developerMode).toBeVisible();
  if (await developerMode.getAttribute('aria-checked') !== 'true') await developerMode.click();
  await expect(developerMode).toHaveAttribute('aria-checked', 'true');
  const toggle = extensions.locator('extensions-detail-view #allow-incognito cr-toggle');
  await expect(toggle).toBeVisible();
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  // Changing incognito access reloads the extension and closes its existing pages.
  const regularManager = await context.newPage();
  await expect(async () => {
    await regularManager.goto(`chrome-extension://${extensionId}/manager.html`);
    await expect(regularManager.locator('#main')).toBeVisible();
  }).toPass({ timeout: 10000 });
  const allowed = await regularManager.evaluate(() => new Promise(resolve => chrome.extension.isAllowedIncognitoAccess(resolve)));
  expect(allowed).toBe(true);
  const privateContext = await context.browser().newContext();
  try {
    const site = await privateContext.newPage();
    await site.goto(baseURL);
    const privateManager = await privateContext.newPage();
    await privateManager.goto(`chrome-extension://${extensionId}/manager.html`);
    await expect(privateManager.locator('#main')).toBeVisible();
    const status = await rpc(privateManager, 'status');
    expect(status.incognito).toBe(true);
    const privateStores = await privateManager.evaluate(async () => chrome.cookies.getAllCookieStores());
    expect(privateStores.length).toBeGreaterThan(0);
    const privateList = await rpc(privateManager, 'list', { scope: { type: 'all', incognito: true } });
    expect(privateList.cookies.some(cookie => cookie.name === regularCookie.name)).toBe(false);
    const privateStore = privateList.stores[0].id;
    expect(privateStore).not.toBe(regularStore);
    expect(privateList.stores.every(store => store.incognito)).toBe(true);
    const privateCookie = { ...regularCookie, storeId: privateStore, incognito: true, value: 'controlled-private-fixture' };
    const written = await rpc(privateManager, 'set', { cookie: privateCookie });
    expect(written.value).toBe(privateCookie.value);
    const crossed = await privateManager.evaluate(cookie => chrome.runtime.sendMessage({ type: 'set', payload: { cookie }, requestId: crypto.randomUUID() }), regularCookie);
    expect(crossed.ok).toBe(false);
    expect(crossed.error).toMatch(/store|incognito/i);
    const privateScope = { type: 'host', url: baseURL, storeId: privateStore, incognito: true };
    const removed = await rpc(privateManager, 'delete', { scope: privateScope, ids: [cookieId(written)], backup: false });
    expect(removed.removed).toBe(1);
    expect(removed.failed).toBe(0);
    expect((await rpc(privateManager, 'list', { scope: privateScope })).cookies.some(cookie => cookie.name === regularCookie.name)).toBe(false);
    testInfo.annotations.push({ type: 'incognito-isolation', description: 'Developer mode and Allow in incognito enabled through Chrome UI. Genuine off-the-record context verified split workspace, distinct stores, private set/delete, cross-store refusal and unchanged regular cookie.' });
    const vault = await privateManager.evaluate(() => chrome.runtime.sendMessage({ type: 'vault.initialize', payload: { passphrase: 'controlled incognito passphrase' }, requestId: crypto.randomUUID() }));
    expect(vault.ok).toBe(false);
    expect(vault.error).toMatch(/incognito/i);
    const regularList = await rpc(regularManager, 'list', { scope: { type: 'all', storeId: regularStore, incognito: false } });
    expect(regularList.cookies.some(cookie => cookie.name === regularCookie.name && cookie.value === regularCookie.value)).toBe(true);
  } finally { await privateContext.close(); await extensions.close(); await regularManager.close(); }
});
