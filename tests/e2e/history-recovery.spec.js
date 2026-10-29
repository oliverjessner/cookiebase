import { test, expect, grant, rpc } from './fixtures.js';
import { mkdir, writeFile } from 'node:fs/promises';

async function attachMeasurements(testInfo, name, data) {
  await mkdir(testInfo.outputDir, { recursive: true });
  const file = testInfo.outputPath(`${name}.json`);
  await writeFile(file, `${JSON.stringify(data, null, 2)}\n`);
  await testInfo.attach(name, { path: file, contentType: 'application/json' });
}

async function databaseRecords(page) {
  return page.evaluate(async () => {
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open('cookiebase', 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(new Error('Unable to inspect the test database.'));
    });
    try {
      return await new Promise((resolve, reject) => {
        const request = database.transaction('records', 'readonly').objectStore('records').getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(new Error('Unable to inspect test records.'));
      });
    } finally { database.close(); }
  });
}
async function journal(page) {
  return page.evaluate(async () => {
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open('cookiebase', 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(new Error('Unable to inspect the test journal.'));
    });
    try {
      return await new Promise((resolve, reject) => {
        const request = database.transaction('records', 'readonly').objectStore('records').get('jobs');
        request.onsuccess = () => resolve(request.result || []);
        request.onerror = () => reject(new Error('Unable to inspect test jobs.'));
      });
    } finally { database.close(); }
  });
}
const scopeFor = url => ({ type: 'host', url, storeId: '0', incognito: false });
const cookieFor = (url, name, value) => ({ name, value, domain: new URL(url).hostname, path: '/', storeId: '0',
  hostOnly: true, secure: false, httpOnly: true, session: true, sameSite: 'lax', incognito: false });

test('real cookie event storm keeps status and the UI responsive with bounded, redacted history', async ({ manager, context }, testInfo) => {
  await grant(manager);
  await rpc(manager, 'history.configure', { enabled: true, maxEntries: 200, maxAgeHours: 1 });
  const cookies = Array.from({ length: 4000 }, (_, i) => ({ name: `storm_${i}`, value: `STORM_SESSION_SECRET_${i}`, url: `http://load${i % 25}.test/`, httpOnly: true, sameSite: 'Lax' }));
  const writeStarted = performance.now();
  const writes = context.addCookies(cookies);
  const responseStarted = performance.now();
  const during = await rpc(manager, 'status');
  const statusMilliseconds = performance.now() - responseStarted;
  const frames = await manager.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true)))));
  expect(frames).toBe(true);
  expect(statusMilliseconds).toBeLessThan(5000);
  expect(during.history.enabled).toBe(true);
  await writes;
  await expect.poll(async () => (await rpc(manager, 'history.list')).length).toBeGreaterThan(0);
  const status = await rpc(manager, 'status');
  expect(status.history.recordingError).toBeNull();
  expect(Number.isInteger(status.history.droppedEvents)).toBe(true);
  expect(status.history.droppedEvents).toBeGreaterThanOrEqual(0);
  const events = await rpc(manager, 'history.list');
  expect(events.length).toBeLessThanOrEqual(200);
  expect(JSON.stringify(events)).not.toContain('STORM_SESSION_SECRET_');
  expect(JSON.stringify(await databaseRecords(manager))).not.toContain('STORM_SESSION_SECRET_');
  await rpc(manager, 'history.configure', { enabled: false });
  const stopped = await rpc(manager, 'status');
  const timing = { writes: cookies.length, domains: 25, statusMilliseconds: Math.round(statusMilliseconds), totalMilliseconds: Math.round(performance.now() - writeStarted), droppedEvents: stopped.history.droppedEvents, retainedEventsAtCheck: events.length };
  await attachMeasurements(testInfo, 'event-storm-measurements', timing);
  await manager.getByRole('link', { name: 'Debug', exact: true }).click();
  await manager.getByRole('button', { name: 'Refresh timeline', exact: true }).click();
  await expect(manager.getByText(/events dropped during bursts/)).toBeVisible();
  // Chrome may deliver serialized events, so zero drops is valid. If it reports
  // drops, the UI must disclose the count instead of claiming complete coverage.
  await expect(manager.getByText(new RegExp(`${stopped.history.droppedEvents} events dropped during bursts`))).toBeVisible();
});

test('actual in-flight import interruption yields an interrupted journal and never replays automatically', async ({ manager, context, baseURL }, testInfo) => {
  await grant(manager);
  const scope = scopeFor(baseURL);
  const cookies = Array.from({ length: 100 }, (_, i) => cookieFor(baseURL, `recovery_${i}`, `RECOVERY_SESSION_SECRET_${i}`));
  const text = JSON.stringify(cookies);
  const options = { mode: 'merge', targetUrl: baseURL, storeId: '0' };
  const preview = await rpc(manager, 'import.preview', { text, options, scope });
  expect(preview.counts.valid).toBe(100);
  const session = await context.newCDPSession(manager);
  await session.send('ServiceWorker.enable');
  const requestId = `real-import-recovery-${crypto.randomUUID()}`;
  try {
    await manager.evaluate(({ requestId, text, options, scope }) => {
      globalThis.cookiebaseRecoveryResult = null;
      void chrome.runtime.sendMessage({ type: 'import.execute', payload: { text, options, scope, backup: false }, requestId })
        .then(response => { globalThis.cookiebaseRecoveryResult = response; })
        .catch(() => { globalThis.cookiebaseRecoveryResult = { ok: false, error: 'Message channel closed before a verified result arrived.' }; });
    }, { requestId, text, options, scope });
    await expect.poll(async () => (await journal(manager)).find(job => job.id === requestId)?.status, { intervals: [1, 5, 10], timeout: 10000 }).toBe('running');
    await expect.poll(async () => (await context.cookies(baseURL)).filter(c => c.name.startsWith('recovery_')).length, { intervals: [1, 5, 10], timeout: 10000 }).toBeGreaterThan(0);
    expect((await journal(manager)).find(job => job.id === requestId)?.status).toBe('running');
    await session.send('ServiceWorker.stopAllWorkers');
    await expect.poll(async () => manager.evaluate(() => globalThis.cookiebaseRecoveryResult), { intervals: [5, 10, 25], timeout: 10000 }).not.toBeNull();
    const interruptedResponse = await manager.evaluate(() => globalThis.cookiebaseRecoveryResult);
    expect(interruptedResponse.ok).not.toBe(true);
    const partialCookies = (await context.cookies(baseURL)).filter(c => c.name.startsWith('recovery_'));
    expect(partialCookies.length).toBeGreaterThan(0);
    expect(partialCookies.length).toBeLessThan(100);
    const recovered = await rpc(manager, 'status');
    const job = recovered.jobs.find(item => item.id === requestId);
    expect(job.status).toBe('interrupted');
    expect(job.message).toMatch(/Nothing is automatically replayed/);
    expect(JSON.stringify(recovered.jobs)).not.toContain('RECOVERY_SESSION_SECRET_');
    await manager.reload();
    await expect(manager.locator('#main')).toBeVisible();
    expect((await rpc(manager, 'status')).jobs.find(item => item.id === requestId).status).toBe('interrupted');
    const afterReloadCookies = (await context.cookies(baseURL)).filter(c => c.name.startsWith('recovery_'));
    expect(afterReloadCookies.length).toBe(partialCookies.length);
    expect(JSON.stringify(await databaseRecords(manager))).not.toContain('RECOVERY_SESSION_SECRET_');
    await attachMeasurements(testInfo, 'actual-import-interruption', { requested: 100, writtenBeforeInterruption: partialCookies.length, recoveredStatus: job.status, responseSuccess: interruptedResponse.ok === true, replayedAfterManagerReload: afterReloadCookies.length - partialCookies.length });
  } finally { await session.detach(); }
});

test('generic JSON and Netscape cookie files become encrypted profiles and the direct QA-state button applies them', async ({ manager, context, extensionId, baseURL }) => {
  await grant(manager);
  await rpc(manager, 'vault.initialize', { passphrase: 'UI profile import QA passphrase' });
  await manager.goto(`chrome-extension://${extensionId}/manager.html?url=${encodeURIComponent(baseURL)}#profiles`);
  const generic = cookieFor(baseURL, 'ui_profile_sid', 'UI_PROFILE_JSON_SECRET_621bca');
  await manager.locator('#profile-file').setInputFiles({ name: 'generic-cookies.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify([generic])) });
  await expect(manager.getByRole('dialog')).toBeVisible();
  await manager.locator('#profile-name').fill('Imported JSON QA');
  await manager.getByRole('button', { name: 'Save profile', exact: true }).click();
  await expect(manager.getByRole('heading', { name: 'Imported JSON QA', exact: true })).toBeVisible();
  const netscape = '# Netscape HTTP Cookie File\n#HttpOnly_localhost\tFALSE\t/\tFALSE\t0\tui_netscape_sid\tUI_PROFILE_NETSCAPE_SECRET_3d86ac\n';
  await manager.locator('#profile-file').setInputFiles({ name: 'cookies.txt', mimeType: 'text/plain', buffer: Buffer.from(netscape) });
  await manager.locator('#profile-name').fill('Imported Netscape QA');
  await manager.getByRole('button', { name: 'Save profile', exact: true }).click();
  await expect(manager.getByRole('heading', { name: 'Imported Netscape QA', exact: true })).toBeVisible();
  expect((await context.cookies(baseURL)).filter(c => c.name.startsWith('ui_'))).toHaveLength(0);
  const profile = manager.getByRole('heading', { name: 'Imported JSON QA', exact: true }).locator('..');
  await expect(profile.getByText(/QA state preview/)).toBeVisible();
  await profile.getByRole('button', { name: 'Apply this QA state', exact: true }).click();
  await expect(manager.getByRole('heading', { name: 'QA state apply results', exact: true })).toBeVisible();
  const result = JSON.parse(await manager.getByRole('dialog').locator('pre').textContent());
  expect(result.failed).toBe(0);
  expect(result.applied).toBe(1);
  expect((await context.cookies(baseURL)).find(cookie => cookie.name === generic.name)?.value).toBe(generic.value);
  const records = JSON.stringify(await databaseRecords(manager));
  expect(records).not.toContain(generic.value);
  expect(records).not.toContain('UI_PROFILE_NETSCAPE_SECRET_3d86ac');
  expect(records).not.toContain('Imported JSON QA');
});
