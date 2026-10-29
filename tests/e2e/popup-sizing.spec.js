import { writeFile } from 'node:fs/promises';
import { test, expect } from './fixtures.js';

// Toolbar popup targets are native extension surfaces and are not exposed in
// context.pages(). Attach through CDP without prescribing a test-page viewport.
async function attachPopup(session, targetId) {
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

test('native toolbar popup sizes itself independently of its initial viewport', async ({ context, worker, extensionId }, testInfo) => {
  const browserSession = await context.browser().newBrowserCDPSession();
  let popup;
  try {
    await worker.evaluate(() => chrome.action.openPopup());
    let target;
    await expect.poll(async () => {
      const targets = await browserSession.send('Target.getTargets');
      target = targets.targetInfos.find(info => info.url === `chrome-extension://${extensionId}/popup.html`);
      return Boolean(target);
    }).toBe(true);
    popup = await attachPopup(browserSession, target.targetId);
    await expect.poll(async () => {
      const result = await popup.send('Runtime.evaluate', { expression: "Boolean(document.querySelector('#main'))", returnByValue: true });
      return result.result.value;
    }).toBe(true);
    const { result } = await popup.send('Runtime.evaluate', {
      expression: `(async () => {
        await document.fonts.ready;
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const brand = document.querySelector('.cb-brand').getBoundingClientRect();
        const manager = document.querySelector('.cb-header > button').getBoundingClientRect();
        return { width: window.innerWidth, body: document.body.getBoundingClientRect().width,
          root: document.documentElement.getBoundingClientRect().width, height: window.innerHeight,
          brandRight: brand.right, managerLeft: manager.left };
      })()`,
      awaitPromise: true, returnByValue: true,
    });
    const size = result.value;
    console.log('Native popup size', JSON.stringify(size));
    const screenshot = await popup.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    await writeFile(testInfo.outputPath('native-popup.png'), Buffer.from(screenshot.data, 'base64'));
    expect(size.width).toBe(560);
    expect(size.body).toBe(560);
    expect(size.height).toBeLessThanOrEqual(600);
    expect(size.managerLeft).toBeGreaterThanOrEqual(size.brandRight);
  } finally {
    if (popup) await popup.detach();
    await browserSession.detach();
  }
});
