import { readFile } from 'node:fs/promises';
import { test, expect, grant, rpc } from './fixtures.js';

function cookieFor(url, patch = {}) {
  return { name: 'transfer_sid', value: 'TRANSFER_FIXTURE_SECRET_A', domain: new URL(url).hostname,
    path: '/', storeId: '0', hostOnly: true, secure: url.startsWith('https:'), httpOnly: true, sameSite: 'lax', session: true, ...patch };
}
function scopeFor(url) { return { type: 'host', url, storeId: '0', incognito: false }; }
async function openCookies(manager, url) {
  await manager.locator('#target-url').fill(url);
  await manager.locator('#scope-type').selectOption('host');
  await manager.locator('#refresh').click();
  await manager.getByRole('link', { name: 'Cookies', exact: true }).click();
  await expect(manager.locator('#transfer')).toBeVisible();
}
async function downloadText(manager, { secrets = false } = {}) {
  const promised = manager.waitForEvent('download');
  await manager.getByRole('button', { name: 'Download file', exact: true }).click();
  if (secrets) await manager.getByRole('button', { name: 'Export values', exact: true }).click();
  const download = await promised;
  expect(await download.failure()).toBeNull();
  return { name: download.suggestedFilename(), text: await readFile(await download.path(), 'utf8') };
}

test('file import preview, per-cookie errors and verified real writes; redacted download and clipboard feedback', async ({ manager, context, httpsURL }) => {
  await grant(manager);
  await openCookies(manager, httpsURL);
  await manager.locator('#transfer').click();
  const valid = [cookieFor(httpsURL), cookieFor(httpsURL, { name: 'transfer_consent', value: 'essential', httpOnly: false })];
  const invalid = cookieFor(httpsURL, { name: '__Host-invalid', secure: false, value: 'SECRET_INVALID_NOT_IN_REPORT' });
  await manager.locator('#import-file').setInputFiles({ name: 'cookie-editor.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify([...valid, invalid])) });
  await expect(manager.locator('#import-text')).toHaveValue(JSON.stringify([...valid, invalid]));
  await manager.getByRole('button', { name: 'Parse & preview', exact: true }).click();
  await expect(manager.locator('#import-preview')).toContainText('"valid": 2');
  await expect(manager.locator('#import-preview')).toContainText('"invalid": 1');
  await expect(manager.locator('#import-preview')).not.toContainText(invalid.value);
  expect((await rpc(manager, 'list', { scope: scopeFor(httpsURL) })).cookies).toHaveLength(0);
  await manager.locator('#import-apply').click();
  const report = manager.getByRole('dialog').filter({ has: manager.getByRole('heading', { name: 'Import results · verified at import time' }) });
  await expect(report).toContainText('"imported": 2');
  await expect(report).toContainText('"failed": 1');
  await expect(report).not.toContainText(valid[0].value);
  const actual = (await rpc(manager, 'list', { scope: scopeFor(httpsURL) })).cookies;
  expect(actual.find(c => c.name === valid[0].name)?.value).toBe(valid[0].value);
  await report.getByRole('button', { name: 'Close', exact: true }).click();
  await manager.locator('#transfer').click();
  const saved = await downloadText(manager);
  expect(saved.name).toMatch(/^cookies-\d{4}-\d{2}-\d{2}\.json$/);
  const redacted = JSON.parse(saved.text);
  expect(redacted.redacted).toBe(true);
  expect(redacted.cookies).toHaveLength(2);
  expect(redacted.cookies.every(c => !Object.hasOwn(c, 'value'))).toBe(true);
  await expect(manager.locator('#status')).toContainText('Download requested:');
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await manager.getByRole('button', { name: 'Copy to clipboard', exact: true }).click();
  await expect(manager.locator('#status')).toContainText('Copied 2 redacted cookies to clipboard.');
  const clipboard = await manager.evaluate(() => navigator.clipboard.readText());
  expect(JSON.parse(clipboard).redacted).toBe(true);
});

test('explicit secret confirmation, JSON/Netscape downloaded roundtrip and drag-drop restore', async ({ manager, httpsURL }) => {
  await grant(manager);
  const cookie = cookieFor(httpsURL, { name: 'roundtrip_sid', sameSite: 'unspecified' });
  await rpc(manager, 'set', { cookie });
  await openCookies(manager, httpsURL);
  await manager.locator('#transfer').click();
  await manager.getByRole('checkbox', { name: 'Redacted export (no secret values)', exact: true }).uncheck();
  const json = await downloadText(manager, { secrets: true });
  expect(JSON.parse(json.text).cookies[0].value).toBe(cookie.value);
  await manager.locator('#export-format').selectOption('netscape');
  const netscape = await downloadText(manager, { secrets: true });
  expect(netscape.name).toMatch(/\.txt$/);
  expect(netscape.text).toContain('#HttpOnly_localhost');
  expect(netscape.text).toContain(cookie.value);
  await rpc(manager, 'set', { cookie: { ...cookie, value: 'CHANGED_BY_BROWSER_FIXTURE' } });
  await manager.locator('#import-text').evaluate((textarea, text) => {
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(new File([text], 'cookies.txt', { type: 'text/plain' }));
    textarea.closest('section').dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer }));
  }, netscape.text);
  await expect(manager.locator('#import-text')).toHaveValue(netscape.text);
  await manager.getByRole('button', { name: 'Parse & preview', exact: true }).click();
  await expect(manager.locator('#import-preview')).toContainText('"overwritten": 1');
  await manager.locator('#import-apply').click();
  await expect(manager.getByRole('heading', { name: 'Import results · verified at import time' })).toBeVisible();
  expect((await rpc(manager, 'list', { scope: scopeFor(httpsURL) })).cookies.find(c => c.name === cookie.name)?.value).toBe(cookie.value);
});

test('redirect-independent target import, later server change and invalid replace preserve unrelated hosts', async ({ manager, context, httpsURL, urls }) => {
  await grant(manager);
  const scope = scopeFor(httpsURL);
  const cookie = cookieFor(httpsURL, { name: 'oauth-stage', value: 'IMPORTED_BEFORE_REDIRECT' });
  const outside = cookieFor(urls.secure, { name: 'outside-target', value: 'UNRELATED_HOST' });
  await rpc(manager, 'set', { cookie: outside });
  const payload = { text: JSON.stringify([cookie]), scope, options: { mode: 'merge', targetUrl: httpsURL, storeId: '0' } };
  const preview = await rpc(manager, 'import.preview', payload);
  expect(preview.counts.imported).toBe(1);
  const imported = await rpc(manager, 'import.execute', payload);
  expect(imported.imported).toBe(1);
  expect(imported.failed).toBe(0);
  expect(imported.note).toMatch(/later reload|redirect/);
  const website = await context.newPage();
  await website.goto(`${httpsURL}/redirect`);
  await expect(website).toHaveURL(/\/callback\?flow=oauth-fixture$/);
  const later = (await rpc(manager, 'list', { scope })).cookies.find(c => c.name === cookie.name);
  expect(later.value).toBe('redirected');
  const invalidReplace = await rpc(manager, 'import.execute', { text: JSON.stringify([cookieFor(httpsURL, { sameSite: 'bad' })]), scope, options: { mode: 'replace' } });
  expect(invalidReplace.aborted).toBe(true);
  expect(invalidReplace.removed).toBe(0);
  expect((await rpc(manager, 'list', { scope: scopeFor(urls.secure) })).cookies.find(c => c.name === outside.name)?.value).toBe(outside.value);
  expect((await rpc(manager, 'list', { scope })).cookies.find(c => c.name === cookie.name)?.value).toBe('redirected');
});
