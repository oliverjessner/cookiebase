import { test, expect, rpc, chooseScope } from './fixtures.js';
import { cookieId } from '../../src/core/cookies.js';
function cookie(url, name, path = '/') { return { name, value: 'UX_COOKIE_SECRET', domain: new URL(url).hostname, path, storeId: '0', hostOnly: true, secure: false, httpOnly: true, sameSite: 'lax', session: true }; }

test('manager shows cookies first, precise selection, mixed checkbox and visible resettable filters', async ({ manager, baseURL }, testInfo) => {
  await rpc(manager,'onboard');
  for (const [name,path] of [['consent','/'],['sid','/'],['sid','/account']]) await rpc(manager,'set',{cookie:cookie(baseURL,name,path)});
  await chooseScope(manager,{url:baseURL});
  await expect(manager.locator('#cookie-count')).toContainText('3 filtered / 3 in scope');
  const table = manager.locator('#cookie-table');
  expect(await table.locator('thead th').count()).toBe(5);
  const box = await table.boundingBox(); expect(box.y).toBeLessThan(650);
  await manager.getByLabel('Select consent at localhost/').check();
  await expect(manager.locator('#selection-actions')).toContainText('1 selected');
  expect(await manager.getByLabel('Select this page',{exact:true}).evaluate(el=>el.indeterminate)).toBe(true);
  await manager.locator('#search').fill('sid');
  await expect(manager.locator('#cookie-count')).toContainText('2 filtered / 3 in scope');
  await expect(manager.locator('#selection-actions')).toContainText('1 hidden by filters');
  await expect(manager.locator('#active-filters')).toContainText('Search');
  await manager.getByRole('button',{name:'Reset filters',exact:true}).click();
  await expect(manager.locator('#cookie-count')).toContainText('3 filtered');
  await manager.getByRole('button',{name:'Details for consent',exact:true}).click();
  await expect(manager.getByRole('region',{name:'Cookie details'})).toBeVisible();
  await expect(manager.locator('#cookie-secret')).toContainText('••••');
  await expect(manager.getByRole('dialog')).toHaveCount(0);
  await manager.getByRole('button',{name:'Protect cookie',exact:true}).click();
  await expect(manager.getByText('Protected by 1 rule',{exact:false})).toBeVisible();
  expect((await rpc(manager,'status')).metadata.rules.length).toBe(1);
  await expect(manager.getByText('null',{exact:true})).toHaveCount(0);
  await manager.evaluate(()=>window.scrollTo(0,0));
  await manager.screenshot({path:testInfo.outputPath('manager-cookies.png'),fullPage:true});
});

test('scope changes do not disable Debug stop and reload cannot target a different pinned site', async ({ manager, context, baseURL, urls, extensionId }) => {
  const site=await context.newPage();await site.goto(baseURL);
  const tabId=await manager.evaluate(async url=>(await chrome.tabs.query({})).find(t=>t.url===url+'/')?.id,baseURL);
  await manager.goto(`chrome-extension://${extensionId}/manager.html?url=${encodeURIComponent(baseURL)}&tabId=${tabId}#debug`);
  await expect(manager.locator('#debug-toggle')).toBeVisible();
  await manager.locator('#debug-toggle').click();
  await expect(manager.locator('#debug-toggle')).toContainText('Stop');
  await chooseScope(manager,{url:urls.auth});
  await expect(manager.locator('#debug-toggle')).toBeEnabled();
  await expect(manager.locator('#debug-toggle')).toContainText('Stop');
  const reload=manager.getByRole('button',{name:/Reload linked/});
  if(await reload.count()) await expect(reload).toBeDisabled();
  await manager.locator('#debug-toggle').click();
  expect((await rpc(manager,'status')).history.enabled).toBe(false);
});

test('disabled cookies are scoped and enable refreshes current actual state', async ({ manager, baseURL, urls }) => {
  await rpc(manager,'vault.initialize',{passphrase:'Cookiebase UX disabled test passphrase'});
  const here=cookie(baseURL,'disabled-here'),there=cookie(urls.auth,'disabled-there');
  await rpc(manager,'set',{cookie:here});await rpc(manager,'set',{cookie:there});
  await rpc(manager,'disable',{cookie:here,scope:{type:'host',url:baseURL,storeId:'0'}});
  await rpc(manager,'disable',{cookie:there,scope:{type:'host',url:urls.auth,storeId:'0'}});
  await chooseScope(manager,{url:baseURL});await manager.locator('#cookie-state').selectOption('disabled');
  await expect(manager.getByRole('heading',{name:'Disabled: disabled-here'})).toBeVisible();
  await expect(manager.getByRole('heading',{name:'Disabled: disabled-there'})).toHaveCount(0);
  await manager.getByRole('button',{name:'Enable cookie',exact:true}).click();
  await manager.locator('#snapshot-restore').click();
  await expect(manager.getByRole('heading',{name:'Disabled: disabled-here'})).toHaveCount(0);
  const data=await rpc(manager,'list',{scope:{type:'host',url:baseURL,storeId:'0'}});
  expect(data.cookies.map(cookieId)).toContain(cookieId(here));
});
