import { test as base, expect, chromium } from '@playwright/test';
import http from 'node:http';
import https from 'node:https';
import { cp, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

export { expect };
export const FIXTURE_ORIGINS = [
  'http://localhost/*', 'https://localhost/*', 'http://*.localhost/*', 'https://*.localhost/*',
  'http://*.cookiebase.test/*', 'https://*.cookiebase.test/*',
  ...Array.from({ length: 25 }, (_, i) => `http://load${i}.test/*`),
];

/** Exercise the same runtime messaging path as the production UI. */
export async function rpc(page, type, payload = {}) {
  const response = await page.evaluate(async ({ type, payload }) => chrome.runtime.sendMessage({ type, payload, requestId: crypto.randomUUID() }), { type, payload });
  if (!response?.ok) throw new Error(response?.error || 'Cookiebase worker did not return an operation result.');
  return response.result;
}

/**
 * The native optional-host dialog is browser chrome, unavailable to headless
 * Playwright. Cookie-operation tests pregrant ONLY local fixture hosts in a
 * temporary manifest copy; no production module or API is mocked. This helper
 * exercises the actual permissions.request API and verifies the actual grant.
 * Accept/deny of a previously ungranted native prompt is a manual acceptance test.
 */
export async function grant(page, origins = FIXTURE_ORIGINS) {
  const already = await page.evaluate(origins => chrome.permissions.contains({ origins }), origins);
  if (!already) throw new Error('Native optional-host dialog cannot be automated headlessly. Use hostAccess=true for local cookie-operation tests; test native accept/deny manually with the production manifest.');
  const session = await page.context().newCDPSession(page);
  try {
    const result = await session.send('Runtime.evaluate', {
      expression: `chrome.permissions.request({origins:${JSON.stringify(origins)}})`, userGesture: true, awaitPromise: true, returnByValue: true,
    });
    expect(result.result.value).toBe(true);
    expect(await page.evaluate(origins => chrome.permissions.contains({ origins }), origins)).toBe(true);
  } finally { await session.detach(); }
}

function fixtureHandler(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  res.setHeader('Cache-Control', 'no-store');
  if (url.pathname === '/seed') {
    res.setHeader('Set-Cookie', [
      'consent=essential; Path=/; SameSite=Lax',
      'sid=fixture-session; Path=/; HttpOnly; SameSite=Lax',
      'twin=root; Path=/; SameSite=Lax',
      'twin=nested; Path=/account; SameSite=Lax',
    ]);
  } else if (url.pathname === '/set') {
    const name = url.searchParams.get('name') || 'server';
    const value = url.searchParams.get('value') || 'fixture';
    const cookiePath = url.searchParams.get('path') || '/';
    const domain = url.searchParams.get('domain');
    if (![name, value, cookiePath, domain || ''].every(value => !/[\r\n;]/.test(value))) { res.writeHead(400); res.end('Invalid fixture cookie.'); return; }
    let cookie = `${name}=${value}; Path=${cookiePath}`;
    if (domain) cookie += `; Domain=${domain}`;
    if (url.searchParams.has('secure')) cookie += '; Secure';
    if (url.searchParams.has('httpOnly')) cookie += '; HttpOnly';
    cookie += `; SameSite=${url.searchParams.get('sameSite') || 'Lax'}`;
    if (url.searchParams.has('partitioned')) cookie += '; Partitioned';
    if (url.searchParams.has('maxAge')) cookie += `; Max-Age=${Number(url.searchParams.get('maxAge'))}`;
    res.setHeader('Set-Cookie', cookie);
  } else if (url.pathname === '/redirect') {
    res.setHeader('Set-Cookie', 'oauth-stage=redirected; Path=/; HttpOnly; SameSite=Lax');
    res.writeHead(302, { Location: '/callback?flow=oauth-fixture' });
    res.end(); return;
  } else if (url.pathname === '/expire') {
    res.setHeader('Set-Cookie', 'sid=; Path=/; Max-Age=0');
  } else if (url.pathname === '/chips') {
    res.setHeader('Set-Cookie', 'chip=fixture-partition; Path=/; Secure; SameSite=None; Partitioned');
  }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end('<!doctype html><html lang="en"><head><title>Cookiebase local fixture</title></head><body><h1>Cookiebase local fixture</h1><p>Controlled local cookie and redirect responses. No real account.</p></body></html>');
}

async function listen(server) {
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return server.address().port;
}

export const test = base.extend({
  hostAccess: [true, { option: true }],
  servers: async ({ browserName }, use) => {
    if (browserName !== 'chromium') throw new Error('Cookiebase extension fixtures require Playwright Chromium.');
    const plain = http.createServer(fixtureHandler);
    const tls = https.createServer({
      key: await readFile(new URL('../fixtures/localhost-key.pem', import.meta.url)),
      cert: await readFile(new URL('../fixtures/localhost-cert.pem', import.meta.url)),
    }, fixtureHandler);
    const httpPort = await listen(plain);
    const httpsPort = await listen(tls);
    try { await use({ httpPort, httpsPort }); }
    finally { await Promise.all([new Promise(resolve => plain.close(resolve)), new Promise(resolve => tls.close(resolve))]); }
  },
  baseURL: async ({ servers }, use) => use(`http://localhost:${servers.httpPort}`),
  httpsURL: async ({ servers }, use) => use(`https://localhost:${servers.httpsPort}`),
  urls: async ({ servers }, use) => use({
    app: `http://app.cookiebase.test:${servers.httpPort}`, auth: `http://auth.cookiebase.test:${servers.httpPort}`,
    sub: `http://sub.app.cookiebase.test:${servers.httpPort}`, secure: `https://app.cookiebase.test:${servers.httpsPort}`,
    subLocal: `http://sub.localhost:${servers.httpPort}`,
  }),
  context: async ({ hostAccess }, use, testInfo) => {
    const temp = await mkdtemp(path.join(tmpdir(), 'cookiebase-e2e-'));
    const extensionPath = path.join(temp, 'extension');
    await cp(path.resolve('dist'), extensionPath, { recursive: true });
    if (hostAccess) {
      const manifestPath = path.join(extensionPath, 'manifest.json');
      const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
      manifest.host_permissions = FIXTURE_ORIGINS;
      await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
      testInfo.annotations.push({ type: 'host-permission-setup', description: 'Actual localhost permissions pregranted through a test-only manifest copy. Native grant/deny dialog requires manual verification.' });
    }
    const context = await chromium.launchPersistentContext(path.join(temp, 'profile'), {
      channel: 'chromium', headless: true, viewport: { width: 1440, height: 1000 }, acceptDownloads: true, ignoreHTTPSErrors: true,
      args: [
        `--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`,
        '--ignore-certificate-errors', '--no-proxy-server',
        '--host-resolver-rules=MAP *.test 127.0.0.1',
      ],
    });
    try { await use(context); }
    finally { await context.close(); await rm(temp, { recursive: true, force: true }); }
  },
  worker: async ({ context }, use) => {
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent('serviceworker');
    await use(worker);
  },
  extensionId: async ({ worker }, use) => use(worker.url().split('/')[2]),
  manager: async ({ context, extensionId }, use) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/manager.html`);
    await expect(page.locator('#main')).toBeVisible();
    await use(page);
  },
  popup: async ({ context, extensionId }, use) => {
    const page = await context.newPage();
    await page.setViewportSize({ width: 560, height: 600 });
    await page.goto(`chrome-extension://${extensionId}/popup.html`);
    await expect(page.locator('#main')).toBeVisible();
    await use(page);
  },
});
