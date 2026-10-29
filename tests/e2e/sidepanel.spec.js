import { writeFile } from 'node:fs/promises';
import { test, expect } from './fixtures.js';

// Native side-panel targets are extension surfaces and are not exposed in
// context.pages(). Attach through CDP without prescribing a test-page viewport.
async function attachNative(session, targetId) {
  const { sessionId } = await session.send('Target.attachToTarget', { targetId, flatten: false });
  let sequence = 0;
  const pending = new Map();
  const receive = event => {
    if (event.sessionId !== sessionId) return;
    const response = JSON.parse(event.message);
    const request = pending.get(response.id);
    if (!request) return;
    pending.delete(response.id);
    if (response.error) request.reject(new Error(response.error.message));
    else request.resolve(response.result);
  };
  session.on('Target.receivedMessageFromTarget', receive);
  return {
    send(method, params = {}) {
      const id = ++sequence;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        session.send('Target.sendMessageToTarget', { sessionId, message: JSON.stringify({ id, method, params }) }).catch(reject);
      });
    },
    async detach() { session.off('Target.receivedMessageFromTarget', receive); await session.send('Target.detachFromTarget', { sessionId }); },
  };
}

test('native side panel follows the active site with a responsive list and opens a scoped manager', async ({ context, worker, extensionId, manager, baseURL }, testInfo) => {
  const browserSession = await context.browser().newBrowserCDPSession();
  let sidepanel;
  try {
    expect(await worker.evaluate(() => chrome.action.getPopup({}))).toBe('');
    await expect.poll(() => worker.evaluate(() => chrome.sidePanel.getPanelBehavior())).toMatchObject({openPanelOnActionClick:true});
    const managerSession=await context.newCDPSession(manager);
    await managerSession.send('Runtime.evaluate',{expression:'chrome.windows.getCurrent().then(w => chrome.sidePanel.open({windowId:w.id}))',userGesture:true,awaitPromise:true});
    await managerSession.detach();
    let target;
    await expect.poll(async () => {
      target=(await browserSession.send('Target.getTargets')).targetInfos.find(info => info.url===`chrome-extension://${extensionId}/sidepanel.html`);
      return Boolean(target);
    }).toBe(true);
    sidepanel=await attachNative(browserSession,target.targetId);
    const evaluate=async expression=>{
      const output=await sidepanel.send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});
      if(output.exceptionDetails) throw new Error(output.exceptionDetails.text);
      return output.result.value;
    };
    await expect.poll(()=>evaluate("Boolean(document.querySelector('#search'))")).toBe(true);
    const site=await context.newPage();await site.goto(`${baseURL}/seed`);await site.bringToFront();
    await expect.poll(()=>evaluate("document.querySelector('.cb-site-name')?.textContent")).toBe('localhost');
    await expect.poll(()=>evaluate("document.querySelector('#cookie-count')?.textContent")).toContain('4 filtered / 4 in scope');
    const size=await evaluate("document.fonts.ready.then(()=>({width:innerWidth,height:innerHeight,body:document.body.getBoundingClientRect().width,scrollWidth:document.documentElement.scrollWidth,tableShown:Boolean(document.querySelector('#cookie-table')),listShown:Boolean(document.querySelector('.cb-cookie-list .oj-list'))}))");
    expect(size.width).toBeGreaterThanOrEqual(300);expect(size.scrollWidth).toBeLessThanOrEqual(size.width+1);expect(size.listShown).toBe(true);expect(size.tableShown).toBe(false);
    await evaluate("document.querySelector('.cb-intro button')?.click()");
    const screenshot=await sidepanel.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
    await writeFile(testInfo.outputPath('native-sidepanel.png'),Buffer.from(screenshot.data,'base64'));
    await evaluate("document.querySelector('.cb-compact-cookie input').click()");
    const opening=context.waitForEvent('page');
    await evaluate("document.querySelector('#open-manager').click()");
    const expanded=await opening;
    await expect(expanded.locator('#cookie-count')).toContainText('4 filtered / 4 in scope');
    await expect(expanded.locator('#selection-actions')).toContainText('1 selected');
    await expect(expanded.locator('.cb-site-name')).toHaveText('localhost');
    console.log('Native side panel dimensions',JSON.stringify(size));
  } finally { if(sidepanel) await sidepanel.detach();await browserSession.detach(); }
});
