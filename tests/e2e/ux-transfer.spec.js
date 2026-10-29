import { readFile } from 'node:fs/promises';
import { test, expect, rpc } from './fixtures.js';

const cookie = (url, name, value = 'UX_SESSION_SECRET') => ({ name, value, domain:new URL(url).hostname,path:'/',storeId:'0',hostOnly:true,secure:url.startsWith('https:'),httpOnly:true,sameSite:'lax',session:true,incognito:false });
async function openSite(manager, extensionId, url) {
  await manager.goto(`chrome-extension://${extensionId}/manager.html?url=${encodeURIComponent(url)}#cookies`);
  await expect(manager.locator('#main')).toBeVisible();
}
async function beginTransfer(manager, type) {
  await manager.getByRole('button',{name:type,exact:true}).first().click();
  await expect(manager.locator(type === 'Import' ? '#cookie-import' : '#cookie-export')).toBeVisible();
}

test('editor rejects invalid fields inside the dialog, models dependent attributes and preserves immutable identity', async ({ manager,extensionId,baseURL }) => {
  await openSite(manager,extensionId,baseURL);
  await manager.locator('#create-cookie').click();
  const dialog=manager.locator('#cookie-editor');
  await expect(dialog).toBeVisible();
  await manager.locator('#edit-name').fill('invalid name');
  await manager.locator('#edit-value').fill('EDITOR_SECRET_UNREVEALED');
  await manager.getByRole('button',{name:'Save & verify',exact:true}).click();
  await expect(dialog.getByRole('alert')).toContainText('Name');
  await expect(manager.locator('#edit-name')).toHaveAttribute('aria-invalid','true');
  await expect(manager.locator('#edit-expiration')).toBeHidden();
  await manager.locator('#edit-lifetime').selectOption('persistent');
  await expect(manager.locator('#edit-expiration')).toBeVisible();
  await manager.locator('#edit-lifetime').selectOption('session');
  await manager.locator('#edit-partitioned').check();
  await expect(manager.locator('#edit-partition')).toBeVisible();
  await expect(manager.locator('#edit-ancestor')).toBeEnabled();
  await manager.locator('#edit-partitioned').uncheck();
  await expect(manager.locator('#edit-partition')).toBeHidden();
  await expect(manager.locator('#edit-ancestor')).toBeDisabled();
  await expect(dialog).not.toContainText('EDITOR_SECRET_UNREVEALED');
  await manager.locator('#edit-reveal').check();
  await expect(manager.locator('#edit-value-preview')).toContainText('EDITOR_SECRET_UNREVEALED');
  await manager.locator('#edit-reveal').uncheck();
  await expect(manager.locator('#edit-value-preview')).toBeHidden();
  await manager.locator('#edit-name').fill('ux-editor');
  await manager.getByRole('button',{name:'Save & verify',exact:true}).click();
  await expect(dialog).toHaveCount(0);
  const result=await rpc(manager,'list',{scope:{type:'host',url:baseURL,storeId:'0'}});
  expect(result.cookies.find(item=>item.name==='ux-editor')?.value).toBe('EDITOR_SECRET_UNREVEALED');
  await manager.getByRole('button',{name:'Details for ux-editor',exact:true}).click();
  await manager.getByRole('button',{name:'Edit cookie',exact:true}).click();
  await expect(manager.locator('#edit-name')).not.toBeEditable();
  await expect(manager.locator('#edit-domain')).not.toBeEditable();
  await expect(manager.locator('#edit-path')).not.toBeEditable();
  await expect(manager.locator('#edit-storeId')).toBeDisabled();
  await manager.getByRole('button',{name:'Duplicate as new cookie',exact:true}).click();
  await expect(manager.locator('#edit-name')).toBeEditable();
  await expect(manager.locator('#edit-name')).toHaveValue('ux-editor_copy');
});

test('import owns its destination scope and invalidates a preview after destination edits', async ({ manager,extensionId,baseURL,urls }) => {
  await openSite(manager,extensionId,baseURL);
  await beginTransfer(manager,'Import');
  const incoming=cookie(urls.auth,'own-scope-import','DESTINATION_SECRET');
  await manager.locator('#import-text').fill(JSON.stringify([incoming]));
  await manager.locator('#import-next').click();
  await manager.locator('#import-target').fill(urls.auth);
  await manager.locator('#import-scope').selectOption('host');
  await manager.locator('#import-mode').selectOption('merge');
  await manager.locator('#import-preview-action').click();
  await expect(manager.locator('#import-preview')).toContainText('auth.cookiebase.test');
  await expect(manager.locator('#import-apply')).toBeEnabled();
  await manager.locator('#import-back').click();
  await manager.locator('#import-target').fill(urls.app);
  await expect(manager.locator('#import-feedback')).toContainText('out of date');
  await manager.locator('#import-preview-action').click();
  await expect(manager.locator('#import-apply')).toBeDisabled();
  await expect(manager.locator('#import-preview')).toContainText('outside the chosen scope');
  await manager.locator('#import-back').click();
  await manager.locator('#import-target').fill(urls.auth);
  await manager.locator('#import-preview-action').click();
  await manager.locator('#import-apply').click();
  await expect(manager.getByRole('heading',{name:'Import results · verified at import time',exact:true})).toBeVisible();
  const imported=await rpc(manager,'list',{scope:{type:'host',url:urls.auth,storeId:'0'}});
  expect(imported.cookies.find(item=>item.name===incoming.name)?.value).toBe(incoming.value);
  const managerSite=await rpc(manager,'list',{scope:{type:'host',url:baseURL,storeId:'0'}});
  expect(managerSite.cookies.some(item=>item.name===incoming.name)).toBe(false);
});

test('export source selection includes hidden selected cookies and working exports require deliberate secret consent', async ({ manager,extensionId,baseURL }) => {
  for(const name of ['ux-export-alpha','ux-export-beta']) await rpc(manager,'set',{cookie:cookie(baseURL,name,`SECRET_${name}`)});
  await openSite(manager,extensionId,baseURL);
  for(const name of ['ux-export-alpha','ux-export-beta']) {
    const row=manager.locator('#cookie-table tbody tr').filter({has:manager.getByRole('button',{name:`Details for ${name}`,exact:true})});
    await row.getByRole('checkbox').check();
  }
  await manager.locator('#search').fill('ux-export-alpha');
  await expect(manager.locator('#cookie-count')).toContainText('1');
  await beginTransfer(manager,'Export');
  await manager.locator('#export-source').selectOption('selected');
  await expect(manager.locator('#export-count')).toContainText('Selected cookies · 2 cookies');
  let promised=manager.waitForEvent('download');
  await manager.locator('#export-download').click();
  let download=await promised;
  let exported=JSON.parse(await readFile(await download.path(),'utf8'));
  expect(exported.cookies).toHaveLength(2);expect(exported.redacted).toBe(true);
  expect(exported.cookies.every(item=>!Object.hasOwn(item,'value'))).toBe(true);
  await manager.locator('#export-purpose').selectOption('working');
  await expect(manager.locator('#export-download')).toBeDisabled();
  await manager.locator('#export-secrets-consent').check();
  promised=manager.waitForEvent('download');
  await manager.locator('#export-download').click();
  await manager.getByRole('button',{name:'Export values',exact:true}).click();
  download=await promised;exported=JSON.parse(await readFile(await download.path(),'utf8'));
  expect(exported.cookies).toHaveLength(2);expect(exported.redacted).toBe(false);
  expect(exported.cookies.every(item=>item.value.startsWith('SECRET_'))).toBe(true);
  await expect(manager.locator('#export-status')).toContainText('Download requested:');
});

test.describe('import without destination host permission', () => {
  test.use({hostAccess:false});
  test('preview names missing destination access and blocks Apply without starting a native grant prompt', async ({manager,extensionId,baseURL}) => {
    await openSite(manager,extensionId,baseURL);
    await beginTransfer(manager,'Import');
    await manager.locator('#import-text').fill(JSON.stringify([cookie(baseURL,'missing-access')]));
    await manager.locator('#import-next').click();
    await manager.locator('#import-preview-action').click();
    await expect(manager.locator('#import-missing-access')).toContainText('Host access is required');
    await expect(manager.locator('#import-apply')).toBeDisabled();
    await expect(manager.getByRole('button',{name:'Grant access to listed sites',exact:true})).toBeVisible();
    const browserCookies=await manager.evaluate(()=>chrome.cookies.getAll({name:'missing-access',storeId:'0'}));
    expect(browserCookies).toHaveLength(0);
  });
});

test('explicit domain remapping requires confirmation and Replace resumes after mandatory vault creation', async ({manager,extensionId,baseURL,urls}) => {
  const original=cookie(urls.auth,'explicit-domain-copy','DOMAIN_COPY_SECRET');
  await rpc(manager,'set',{cookie:original});
  await openSite(manager,extensionId,baseURL);
  await beginTransfer(manager,'Import');
  await manager.locator('#import-text').fill(JSON.stringify([original]));
  await manager.locator('#import-next').click();
  await manager.locator('#import-target').fill(baseURL);
  await manager.locator('#import-scope').selectOption('host');
  await manager.locator('#import-mapping').selectOption('target');
  await manager.locator('#import-preview-action').click();
  await manager.locator('#import-preview').getByText('Source → destination mapping',{exact:true}).click();
  await expect(manager.locator('#import-preview')).toContainText('auth.cookiebase.test');
  await expect(manager.locator('#import-preview')).toContainText('localhost');
  await manager.locator('#import-apply').click();
  await expect(manager.getByRole('heading',{name:'Copy cookies to another domain?',exact:true})).toBeVisible();
  await manager.getByRole('button',{name:'Use destination domain',exact:true}).click();
  await expect(manager.getByRole('heading',{name:'Import results · verified at import time',exact:true})).toBeVisible();
  let targetCookies=(await rpc(manager,'list',{scope:{type:'host',url:baseURL,storeId:'0'}})).cookies;
  expect(targetCookies.find(item=>item.name===original.name)?.value).toBe(original.value);
  const sourceCookies=(await rpc(manager,'list',{scope:{type:'host',url:urls.auth,storeId:'0'}})).cookies;
  expect(sourceCookies.find(item=>item.name===original.name)?.value).toBe(original.value);
  await manager.getByRole('dialog').filter({has:manager.getByRole('heading',{name:'Import results · verified at import time',exact:true})}).getByRole('button',{name:'Done',exact:true}).click();
  await beginTransfer(manager,'Import');
  await manager.locator('#import-text').fill('[]');
  await manager.locator('#import-next').click();
  await manager.locator('#import-mode').selectOption('replace');
  await expect(manager.locator('#import-backup')).toBeChecked();
  await expect(manager.locator('#import-backup')).toBeDisabled();
  await expect(manager.locator('#import-backup-status')).toContainText('required for Replace');
  await manager.locator('#import-preview-action').click();
  await manager.locator('#import-apply').click();
  await expect(manager.locator('#vault-dialog')).toBeVisible();
  await manager.locator('#vault-passphrase').fill('Import continuation QA passphrase');
  await manager.locator('#vault-confirm-passphrase').fill('Import continuation QA passphrase');
  await manager.locator('#vault-unlock').click();
  await expect(manager.getByRole('button',{name:'Replace & verify',exact:true})).toBeVisible();
  await manager.getByRole('button',{name:'Replace & verify',exact:true}).click();
  await expect(manager.getByRole('heading',{name:'Import results · verified at import time',exact:true})).toBeVisible();
  targetCookies=(await rpc(manager,'list',{scope:{type:'host',url:baseURL,storeId:'0'}})).cookies;
  expect(targetCookies.some(item=>item.name===original.name)).toBe(false);
  expect((await rpc(manager,'snapshots.list')).length).toBeGreaterThan(0);
  expect((await rpc(manager,'list',{scope:{type:'host',url:urls.auth,storeId:'0'}})).cookies.some(item=>item.name===original.name)).toBe(true);
});
