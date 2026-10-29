import { test, expect, rpc } from './fixtures.js';

const cookie = (domain, name) => ({ name, value: `UX_PRIVATE_VALUE_${name}`, domain, path: '/', storeId: '0', hostOnly: true, secure: false, httpOnly: true, sameSite: 'lax', session: true });
async function visit(manager, extensionId, url, view) {
  await manager.goto(`chrome-extension://${extensionId}/manager.html?url=${encodeURIComponent(url)}#${view}`);
  await expect(manager.locator('#main')).toBeVisible();
}

test('recording scope excludes other granted sites and live view can pause without stopping recording', async ({ manager, extensionId, baseURL }) => {
  await visit(manager, extensionId, baseURL, 'debug');
  await manager.locator('#debug-recording-scope').selectOption('site');
  await manager.getByRole('button', { name: 'Start recording', exact: true }).click();
  await expect(manager.locator('#recording-scope-status')).toContainText('localhost');
  const status = await rpc(manager, 'status');
  expect(status.history.recordingScope.type).toBe('host');
  expect(new URL(status.history.recordingScope.url).hostname).toBe('localhost');
  await rpc(manager, 'set', { cookie: cookie('localhost', 'matching_recording') });
  await rpc(manager, 'set', { cookie: cookie('auth.cookiebase.test', 'outside_recording') });
  await expect.poll(async () => (await rpc(manager, 'history.list')).length).toBeGreaterThan(0);
  const events = await rpc(manager, 'history.list');
  expect(events.some(event => event.cookie.name === 'matching_recording')).toBe(true);
  expect(events.some(event => event.cookie.name === 'outside_recording')).toBe(false);
  await expect(manager.locator('#debug-timeline')).toContainText('matching_recording');
  await manager.getByRole('button', { name: 'Pause live view', exact: true }).click();
  await expect(manager.locator('#debug-live-status')).toContainText('View paused');
  expect((await rpc(manager, 'status')).history.enabled).toBe(true);
  await manager.getByRole('button', { name: 'Stop recording', exact: true }).click();
  expect((await rpc(manager, 'status')).history.enabled).toBe(false);
});

test('rule preview and enabled state are visible; protection removal has Undo', async ({ manager, extensionId, baseURL }) => {
  await rpc(manager, 'set', { cookie: cookie('localhost', 'ux_consent') });
  await visit(manager, extensionId, baseURL, 'rules');
  await manager.getByRole('button', { name: 'Create protected rule', exact: true }).click();
  await manager.locator('#rule-domain').fill('localhost');
  await manager.locator('#rule-name').fill('ux_consent');
  await expect(manager.locator('#rule-match-count')).toContainText('Matches 1');
  await manager.getByRole('button', { name: 'Save rule', exact: true }).click();
  await expect(manager.getByRole('heading', { name: 'localhost · ux_consent', exact: true })).toBeVisible();
  const toggle = manager.getByRole('switch', { name: 'Enable rule for localhost and ux_consent', exact: true });
  await toggle.press('Space');
  await expect(toggle).not.toBeChecked();
  await expect.poll(async () => (await rpc(manager, 'status')).metadata.rules[0].enabled).toBe(false);
  await toggle.press('Space');
  await expect(toggle).toBeChecked();
  await expect.poll(async () => (await rpc(manager, 'status')).metadata.rules[0].enabled).toBe(true);
  await manager.getByRole('button', { name: 'Remove', exact: true }).click();
  expect((await rpc(manager, 'status')).metadata.rules).toHaveLength(0);
  await manager.getByRole('button', { name: 'Undo rule removal', exact: true }).click();
  expect((await rpc(manager, 'status')).metadata.rules).toHaveLength(1);
});

test('snapshot comparison waits for two compatible states and settings explain operations without JSON as the main content', async ({ manager, extensionId, baseURL }) => {
  await visit(manager, extensionId, baseURL, 'debug');
  await manager.getByRole('tab', { name: 'Snapshots', exact: true }).click();
  const compare = manager.getByRole('button', { name: 'Compare snapshots', exact: true });
  await expect(compare).toBeDisabled();
  await manager.getByRole('button', { name: 'Capture before', exact: true }).click();
  await expect(compare).toBeDisabled();
  await rpc(manager, 'set', { cookie: cookie('localhost', 'snapshot_added') });
  await manager.getByRole('button', { name: 'Capture after', exact: true }).click();
  await expect(compare).toBeEnabled();
  await compare.click();
  await expect(manager.getByRole('dialog')).toContainText('snapshot_added');
  await manager.getByRole('dialog').getByRole('button', { name: 'Done', exact: true }).click();
  await manager.getByRole('link', { name: 'Settings', exact: true }).click();
  await manager.getByRole('tab', { name: 'Activity', exact: true }).click();
  await expect(manager.getByRole('table', { name: 'Recent Cookiebase operations' })).toContainText('Save cookie');
  await manager.getByRole('tab', { name: 'Data & privacy', exact: true }).click();
  const danger = manager.getByText('Danger zone — remove Cookiebase data', { exact: true });
  await expect(danger).toBeVisible();
  await expect(manager.getByRole('button', { name: 'Delete all Cookiebase data', exact: true })).not.toBeVisible();
  await danger.click();
  await expect(manager.getByRole('button', { name: 'Delete all Cookiebase data', exact: true })).toBeVisible();
});
