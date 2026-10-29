import { test, expect, rpc, grant } from './fixtures.js';

const passphrase = 'Cookiebase UX profile test passphrase';
const scopeFor = url => ({ type: 'host', url, storeId: '0', incognito: false });
const cookieFor = (url, name, value = `UX_SECRET_${name}`) => ({ name, value, domain: new URL(url).hostname, path: '/', storeId: '0', hostOnly: true, secure: false, httpOnly: true, sameSite: 'lax', session: true, incognito: false });
async function openWorkspace(manager, extensionId, url, view) {
  await manager.goto(`chrome-extension://${extensionId}/manager.html?url=${encodeURIComponent(url)}#${view}`);
  await expect(manager.locator('#main')).toBeVisible();
}

test('profile source explicitly saves the entire scope despite an earlier cookie search', async ({ manager, extensionId, baseURL }) => {
  await grant(manager);
  await rpc(manager, 'vault.initialize', { passphrase });
  for (const name of ['alpha_ux_profile', 'beta_ux_profile']) await rpc(manager, 'set', { cookie: cookieFor(baseURL, name) });
  await openWorkspace(manager, extensionId, baseURL, 'cookies');
  await manager.locator('#search').fill('alpha_ux_profile');
  await expect(manager.locator('#search')).toHaveValue('alpha_ux_profile');
  await manager.getByRole('link', { name: 'Profiles', exact: true }).click();
  await manager.locator('#save-scope-profile').click();
  await expect(manager.locator('#profile-source')).toHaveValue('scope');
  await expect(manager.locator('#profile-source-summary')).toContainText('2 cookies');
  await manager.locator('#profile-name').fill('Whole site after search');
  await manager.locator('#profile-save').click();
  const saved = (await rpc(manager, 'profiles.list', { query: 'Whole site after search' }))[0];
  expect(saved.cookieCount).toBe(2);
  expect(saved.scope.type).toBe('host');
  await expect(manager.locator('[data-profile-id]')).toHaveCount(1);
  await expect(manager.getByRole('button', { name: 'Apply this QA state', exact: true })).toHaveCount(0);
});

test('vault unlock submits with Enter and keeps wrong-passphrase errors inside the dialog', async ({ manager, extensionId, baseURL }) => {
  await grant(manager);
  await rpc(manager, 'vault.initialize', { passphrase });
  await rpc(manager, 'profiles.create', { profile: { name: 'Locked UX profile' }, cookies: [], scope: scopeFor(baseURL) });
  await rpc(manager, 'vault.lock');
  await openWorkspace(manager, extensionId, baseURL, 'profiles');
  await manager.locator('#profiles-unlock').click();
  await manager.locator('#vault-passphrase').fill('wrong UX passphrase');
  await manager.locator('#vault-passphrase').press('Enter');
  await expect(manager.locator('#vault-dialog [role="alert"]')).toContainText(/incorrect|damaged/);
  expect((await rpc(manager, 'status')).vault.locked).toBe(true);
  await manager.locator('#vault-passphrase').fill(passphrase);
  await manager.locator('#vault-passphrase').press('Enter');
  await expect(manager.locator('#vault-dialog')).toHaveCount(0);
  await expect(manager.getByRole('heading', { name: 'Locked UX profile', exact: true })).toBeVisible();
  expect((await rpc(manager, 'status')).vault.locked).toBe(false);
});

test('one profile apply flow starts with merge and requires visible consent for protected changes', async ({ manager, extensionId, baseURL }) => {
  await grant(manager);
  await rpc(manager, 'vault.initialize', { passphrase });
  const scope = scopeFor(baseURL);
  const current = cookieFor(baseURL, 'protected_ux_session', 'PROTECTED_CURRENT_UX_SECRET');
  const target = { ...current, value: 'PROTECTED_TARGET_UX_SECRET' };
  await rpc(manager, 'set', { cookie: current });
  await rpc(manager, 'rules.save', { rule: { domain: current.domain, name: current.name, path: '/', storeId: '0' } });
  const saved = await rpc(manager, 'profiles.create', { profile: { name: 'Protected UX state' }, cookies: [target], scope });
  await openWorkspace(manager, extensionId, baseURL, 'profiles');
  await manager.locator(`[data-profile-id="${saved.id}"]`).getByRole('button', { name: 'Preview and apply', exact: true }).click();
  await expect(manager.locator('#profile-mode')).toHaveValue('merge');
  await expect(manager.locator('#profile-protection-warning')).toContainText('1 protected cookies will change');
  await expect(manager.locator('#profile-apply')).toBeDisabled();
  const contents = await manager.locator('#apply-profile-dialog').textContent();
  expect(contents).not.toContain(current.value); expect(contents).not.toContain(target.value);
  await manager.locator('#profile-mode').selectOption('replace');
  await expect(manager.locator('#profile-preview-state')).toContainText('Preview ready');
  await manager.locator('#profile-protection-override').check();
  await expect(manager.locator('#profile-apply')).toBeEnabled();
  await manager.locator('#profile-apply').click();
  await expect(manager.getByRole('heading', { name: 'Profile apply results', exact: true })).toBeVisible();
  expect((await rpc(manager, 'list', { scope })).cookies.find(cookie => cookie.name === target.name).value).toBe(target.value);
});

test('complete snapshot restore previews and removes introduced identities; partial snapshots refuse replacement', async ({ manager, extensionId, baseURL }) => {
  await grant(manager);
  await rpc(manager, 'vault.initialize', { passphrase });
  const scope = scopeFor(baseURL);
  const original = cookieFor(baseURL, 'before_ux_state');
  const introduced = cookieFor(baseURL, 'after_ux_state');
  await rpc(manager, 'set', { cookie: original });
  const state = await rpc(manager, 'profiles.create', { profile: { name: 'New UX state' }, cookies: [introduced], scope });
  const applied = await rpc(manager, 'profiles.apply', { id: state.id, scope, options: { mode: 'replace', backup: true } });
  const snapshot = (await rpc(manager, 'snapshots.list')).find(item => item.id === applied.backupId);
  expect(snapshot.completeScope).toBe(true);
  await openWorkspace(manager, extensionId, baseURL, 'profiles');
  await manager.locator('summary').filter({ hasText: /^Restore snapshots/ }).click();
  const row = manager.getByText(snapshot.name, { exact: true }).locator('..').locator('..');
  await row.getByRole('button', { name: 'Preview restore', exact: true }).click();
  await manager.locator('#snapshot-mode').selectOption('replace');
  await expect(manager.locator('#snapshot-restore')).toBeEnabled();
  await manager.locator('#snapshot-restore').click();
  await expect(manager.getByRole('heading', { name: 'Restore results', exact: true })).toBeVisible();
  const actual = (await rpc(manager, 'list', { scope })).cookies;
  expect(actual.some(cookie => cookie.name === original.name)).toBe(true);
  expect(actual.some(cookie => cookie.name === introduced.name)).toBe(false);
  expect((await rpc(manager, 'snapshots.list')).find(item => item.id === snapshot.id).restoredAt).toBeTruthy();
  const disabled = await rpc(manager, 'disable', { cookie: original, scope });
  const rejected = await manager.evaluate(async id => chrome.runtime.sendMessage({ type: 'snapshots.preview', payload: { id, options: { mode: 'replace' } }, requestId: crypto.randomUUID() }), disabled.snapshot.id);
  expect(rejected.ok).toBe(false);
  expect(rejected.error).toMatch(/only selected cookies/);
});

test('profile apply and restore lock their configuration and submit once while real writes are pending', async ({ manager, extensionId, baseURL }) => {
  await grant(manager);
  await rpc(manager, 'vault.initialize', { passphrase });
  const scope = scopeFor(baseURL);
  const cookies = Array.from({ length: 70 }, (_, index) => cookieFor(baseURL, `busy_ux_${index}`));
  const profile = await rpc(manager, 'profiles.create', { profile: { name: 'Busy UX state' }, cookies, scope });
  await openWorkspace(manager, extensionId, baseURL, 'profiles');
  await manager.locator(`[data-profile-id="${profile.id}"]`).getByRole('button', { name: 'Preview and apply', exact: true }).click();
  await expect(manager.locator('#profile-apply')).toBeEnabled();
  const applying = await manager.locator('#profile-apply').evaluate(button => {
    button.click(); button.click();
    document.querySelector('#profile-mode').dispatchEvent(new Event('change', { bubbles: true }));
    return { button: button.disabled, busy: button.getAttribute('aria-busy'), mode: document.querySelector('#profile-mode').disabled,
      backup: document.querySelector('#profile-backup').disabled, override: document.querySelector('#profile-protection-override')?.disabled,
      preview: [...document.querySelectorAll('#apply-profile-dialog button')].find(item => item.textContent === 'Update preview').disabled };
  });
  expect(applying).toMatchObject({ button: true, busy: 'true', mode: true, backup: true, preview: true });
  await expect(manager.getByRole('heading', { name: 'Profile apply results', exact: true })).toBeVisible();
  let status = await rpc(manager, 'status');
  expect(status.jobs.filter(job => job.type === 'profiles.apply')).toHaveLength(1);
  expect((await rpc(manager, 'list', { scope })).cookies.filter(cookie => cookie.name.startsWith('busy_ux_'))).toHaveLength(70);
  await manager.getByRole('button', { name: 'Done', exact: true }).click();
  const snapshot = (await rpc(manager, 'snapshots.list')).find(item => item.kind === 'apply-backup');
  const backups = manager.locator('summary').filter({ hasText: /^Restore snapshots/ });
  if (!await manager.locator('#profile-snapshots').evaluate(element => element.open)) await backups.click();
  await manager.getByText(snapshot.name, { exact: true }).locator('..').locator('..').getByRole('button', { name: 'Preview restore', exact: true }).click();
  await manager.locator('#snapshot-mode').selectOption('replace');
  await expect(manager.locator('#snapshot-restore')).toBeEnabled();
  const restoring = await manager.locator('#snapshot-restore').evaluate(button => {
    button.click(); button.click();
    document.querySelector('#snapshot-mode').dispatchEvent(new Event('change', { bubbles: true }));
    return { button: button.disabled, busy: button.getAttribute('aria-busy'), mode: document.querySelector('#snapshot-mode').disabled,
      preview: [...document.querySelectorAll('#restore-snapshot-dialog button')].find(item => item.textContent === 'Update preview').disabled };
  });
  expect(restoring).toEqual({ button: true, busy: 'true', mode: true, preview: true });
  await expect(manager.getByRole('heading', { name: 'Restore results', exact: true })).toBeVisible();
  status = await rpc(manager, 'status');
  expect(status.jobs.filter(job => job.type === 'snapshots.restore')).toHaveLength(1);
  expect((await rpc(manager, 'list', { scope })).cookies.filter(cookie => cookie.name.startsWith('busy_ux_'))).toHaveLength(0);
});
