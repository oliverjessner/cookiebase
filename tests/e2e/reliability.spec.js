import AxeBuilder from '@axe-core/playwright';
import { performance } from 'node:perf_hooks';
import { test, expect, grant, rpc } from './fixtures.js';

async function workspace(manager, name) {
  await manager.getByRole('link', { name, exact: true }).click();
  await expect(manager.locator('#main > section, #main > div')).not.toHaveCount(0);
}

test('all manager workspaces and popup have no serious axe violations; keyboard dialog focus and local assets', async ({ manager, popup, baseURL }, testInfo) => {
  const errors = [];
  manager.on('pageerror', error => errors.push(error.message));
  popup.on('pageerror', error => errors.push(error.message));
  await grant(manager);
  await manager.locator('#target-url').fill(baseURL);
  await manager.locator('#refresh').click();
  for (const name of ['Overview', 'Cookies', 'Rules', 'Profiles', 'Debug', 'Settings']) {
    await workspace(manager, name);
    const result = await new AxeBuilder({ page: manager }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
    expect(result.violations.filter(v => ['serious', 'critical'].includes(v.impact)), `${name}: ${JSON.stringify(result.violations.map(v => ({ id: v.id, impact: v.impact, nodes: v.nodes.map(n => n.target) })))}`).toEqual([]);
  }
  await workspace(manager, 'Cookies');
  await manager.locator('#create-cookie').focus();
  await manager.keyboard.press('Enter');
  const dialog = manager.getByRole('dialog');
  await expect(dialog).toBeVisible();
  for (let i = 0; i < 20; i++) {
    await manager.keyboard.press('Tab');
    expect(await dialog.evaluate(el => el.contains(document.activeElement))).toBe(true);
  }
  await manager.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(manager.locator('#create-cookie')).toBeFocused();
  await manager.locator('#search').focus();
  await manager.keyboard.type('keyboard-search');
  await expect(manager.locator('#cookie-count')).toContainText('0 filtered');
  await manager.locator('#search').fill('');
  const popupResult = await new AxeBuilder({ page: popup }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  expect(popupResult.violations.filter(v => ['serious', 'critical'].includes(v.impact))).toEqual([]);
  const local = await manager.evaluate(() => ({
    fonts: [...document.fonts].filter(f => f.status === 'loaded').map(f => f.family),
    resources: performance.getEntriesByType('resource').map(r => r.name),
  }));
  expect(local.fonts.some(f => f.includes('Comfortaa'))).toBe(true);
  expect(local.resources.filter(url => /^https?:/.test(url))).toEqual([]);
  expect(errors).toEqual([]);
  await manager.screenshot({ path: testInfo.outputPath('manager.png'), fullPage: true });
  await popup.screenshot({ path: testInfo.outputPath('popup.png'), fullPage: true });
});

test('2500 actual cookies render in bounded pages and search stays responsive', async ({ manager, context }, testInfo) => {
  await grant(manager);
  const cookies = Array.from({ length: 2500 }, (_, i) => ({
    name: `bulk-cookie-${String(i).padStart(4, '0')}`, value: `local-fixture-${i}`,
    domain: `load${Math.floor(i / 100)}.test`, path: '/', httpOnly: i % 2 === 0, secure: false, sameSite: 'Lax',
  }));
  const writeStarted = performance.now();
  await context.addCookies(cookies);
  const writeMs = performance.now() - writeStarted;
  await workspace(manager, 'Cookies');
  await manager.locator('#scope-type').selectOption('all');
  await manager.evaluate(() => {
    globalThis.__cookiebaseFrameMetrics = { started: performance.now(), last: performance.now(), maxGapMs: 0, frames: 0 };
    const sample = time => {
      const metrics = globalThis.__cookiebaseFrameMetrics;
      if (!metrics) return;
      metrics.maxGapMs = Math.max(metrics.maxGapMs, time - metrics.last);
      metrics.last = time; metrics.frames++;
      metrics.frame = requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  const loadStarted = performance.now();
  await manager.locator('#refresh').click();
  await expect(manager.locator('#cookie-count')).toContainText('2500 filtered / 2500 in scope');
  const loadMs = performance.now() - loadStarted;
  const rendered = await manager.locator('#cookie-table tbody tr').count();
  expect(rendered).toBeLessThanOrEqual(75);
  const searchStarted = performance.now();
  await manager.locator('#search').fill('bulk-cookie-2499');
  await expect(manager.locator('#cookie-count')).toContainText('1 filtered / 2500 in scope');
  const searchMs = performance.now() - searchStarted;
  const frames = await manager.evaluate(() => {
    const metrics = globalThis.__cookiebaseFrameMetrics;
    cancelAnimationFrame(metrics.frame);
    delete globalThis.__cookiebaseFrameMetrics;
    return { maxGapMs: metrics.maxGapMs, frames: metrics.frames };
  });
  const metrics = { cookies: cookies.length, writeMs, loadMs, searchMs, renderedRows: rendered, ...frames };
  await testInfo.attach('cookie-performance.json', { body: JSON.stringify(metrics, null, 2), contentType: 'application/json' });
  expect(loadMs).toBeLessThan(5000);
  expect(searchMs).toBeLessThan(2000);
  expect(frames.maxGapMs).toBeLessThan(1000);
  console.log(`Cookiebase performance: ${JSON.stringify(metrics)}`);
});

test('closing popup preserves accepted worker operation; journal has no secrets and clearing app data leaves browser cookies', async ({ manager, popup, baseURL }) => {
  await grant(manager);
  const cookie = { name: 'popup-close-session', value: 'POPUP_CLOSE_SECRET_NOT_IN_JOURNAL', domain: new URL(baseURL).hostname,
    path: '/', storeId: '0', hostOnly: true, secure: false, httpOnly: true, sameSite: 'lax', session: true };
  const requestId = 'popup-close-accepted-operation';
  // Submit through the real extension message port, then close its originating
  // document before awaiting any result. Another manager verifies the outcome.
  await popup.evaluate(({ cookie, requestId }) => {
    globalThis.__operation = chrome.runtime.sendMessage({ type: 'set', payload: { cookie }, requestId }).catch(() => {});
  }, { cookie, requestId });
  await popup.close();
  await expect.poll(async () => (await rpc(manager, 'status')).jobs.find(j => j.id === requestId)?.status).toBe('completed');
  const status = await rpc(manager, 'status');
  expect(JSON.stringify(status.jobs)).not.toContain(cookie.value);
  expect(JSON.stringify(status.jobs)).not.toContain('payload');
  const actual = await manager.evaluate(async cookie => (await chrome.cookies.getAll({ name: cookie.name, storeId: cookie.storeId })).find(c => c.domain === cookie.domain), cookie);
  expect(actual.value).toBe(cookie.value);
  await rpc(manager, 'rules.save', { rule: { domain: cookie.domain, name: cookie.name, path: '/', includeSubdomains: false } });
  await rpc(manager, 'data.clear', { area: 'all' });
  const after = await rpc(manager, 'status');
  expect(after.metadata.rules).toEqual([]);
  expect(after.vault.initialized).toBe(false);
  expect(after.jobs).toEqual([]);
  const remaining = await manager.evaluate(async cookie => chrome.cookies.getAll({ name: cookie.name, storeId: cookie.storeId }), cookie);
  expect(remaining.some(c => c.value === cookie.value)).toBe(true);
});
