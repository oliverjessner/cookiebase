import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseImport, previewImport, executeImport, exportCookies } from '../src/services/transfer.js';
import { cookieId } from '../src/core/cookies.js';

const fixture = JSON.parse(await readFile(new URL('./fixtures/cookies.json', import.meta.url), 'utf8'));
const scope = { type: 'all', storeId: '0', incognito: false };
function repository(cookies = []) {
  const data = new Map(cookies.map(cookie => [cookieId(cookie), structuredClone(cookie)]));
  return {
    data,
    async set(cookie) { data.set(cookieId(cookie), structuredClone(cookie)); return cookie; },
    async verify(cookie) { assert.deepEqual(data.get(cookieId(cookie)), cookie); return cookie; },
    async remove(cookie) { data.delete(cookieId(cookie)); return { removed: true }; },
  };
}

test('Cookie-Editor JSON and native versioned JSON preserve attributes, path/store/partition identity', () => {
  const partitioned = { ...fixture[1], partitionKey: { topLevelSite: 'https://example.test', hasCrossSiteAncestor: true } };
  const parsed = parseImport(JSON.stringify([...fixture, partitioned]));
  assert.equal(parsed.invalid.length, 0);
  assert.equal(parsed.cookies.length, 5);
  const text = exportCookies(parsed.cookies, { scope });
  const imported = parseImport(text);
  assert.equal(imported.metadata.redacted, false);
  assert.deepEqual(imported.cookies, parsed.cookies);
  assert.notEqual(cookieId(parsed.cookies[1]), cookieId(parsed.cookies[4]));
});

test('Netscape roundtrip retains supported attributes including HttpOnly and empty values', () => {
  const cookies = fixture.map(cookie => ({ ...cookie, sameSite: 'unspecified' }));
  cookies.push({ ...cookies[0], name: 'empty', value: '' });
  const text = exportCookies(cookies, { format: 'netscape', scope });
  assert.match(text, /#HttpOnly_auth\.example\.test/);
  const parsed = parseImport(text);
  assert.equal(parsed.invalid.length, 0);
  assert.deepEqual(parsed.cookies, cookies);
  assert.match(parsed.warnings.join(' '), /SameSite/);
});

test('parser reports individual invalid JSON cookies without leaking values', () => {
  const invalid = { ...fixture[0], sameSite: 'nonsense', value: 'SECRET-DO-NOT-REPORT' };
  const parsed = parseImport(JSON.stringify([fixture[1], invalid, null]));
  assert.equal(parsed.cookies.length, 1);
  assert.equal(parsed.invalid.length, 2);
  assert.equal(parsed.invalid[0].name, 'consent');
  assert.doesNotMatch(JSON.stringify(parsed.invalid), /SECRET/);
  assert.equal(parseImport('{"value":"SECRET" broken}').cookies.length, 0);
  assert.doesNotMatch(JSON.stringify(parseImport('{"value":"SECRET" broken}')), /SECRET/);
});

test('relative expiration is explicit in seconds and conflicting date formats are rejected', () => {
  const cookie = { ...fixture[0], expirationDate: undefined, maxAge: 3600, session: false };
  const parsed = parseImport(JSON.stringify([cookie]), { now: 1900000000 });
  assert.equal(parsed.invalid.length, 0);
  assert.equal(parsed.cookies[0].expirationDate, 1900003600);
  assert.equal(parseImport(JSON.stringify([{ ...fixture[0], maxAge: 60 }])).invalid.length, 1);
});

test('target URL fills missing domain independent of active tab while existing domains remain explicit', () => {
  const cookie = { ...fixture[1] };
  delete cookie.domain;
  const parsed = parseImport(JSON.stringify([cookie]), { targetUrl: 'https://idp.example.test/redirect' });
  assert.equal(parsed.cookies[0].domain, 'idp.example.test');
  const plan = previewImport(parsed, [], { scope: { type: 'host', url: 'https://idp.example.test/', storeId: '0' } });
  assert.deepEqual(plan.requiredOrigins, ['https://idp.example.test/*']);
  assert.equal(plan.counts.valid, 1);
});

test('skip duplicates and merge differ predictably with same identity and different paths', async () => {
  const parsed = parseImport(JSON.stringify(fixture));
  const old = { ...fixture[2], value: 'old' };
  const repo = repository([old]);
  const skip = await executeImport(previewImport(parsed, [old], { scope, mode: 'skip' }), { repository: repo });
  assert.deepEqual([skip.processed, skip.imported, skip.skipped, skip.failed], [4, 3, 1, 0]);
  assert.equal(repo.data.get(cookieId(old)).value, 'old');
  const merge = await executeImport(previewImport(parsed, [...repo.data.values()], { scope, mode: 'merge' }), { repository: repo });
  assert.equal(merge.overwritten, 4);
  assert.equal(repo.data.get(cookieId(old)).value, 'root');
});

test('replace snapshots first and removes only chosen host/store, never another domain', async () => {
  const target = { ...fixture[2], name: 'stale' };
  const outside = fixture[1];
  const chosen = { type: 'host', url: 'http://app.example.test/', storeId: '0' };
  const parsed = parseImport(JSON.stringify([fixture[2]]));
  const plan = previewImport(parsed, [target, outside], { scope: chosen, mode: 'replace' });
  assert.equal(plan.removals.length, 1);
  let snapshotTaken = false;
  const repo = repository([target, outside]);
  const originalRemove = repo.remove;
  repo.remove = cookie => { assert.ok(snapshotTaken); return originalRemove(cookie); };
  const report = await executeImport(plan, { repository: repo, snapshot: async cookies => { assert.deepEqual(cookies, [target]); snapshotTaken = true; return 'encrypted-snapshot'; } });
  assert.equal(report.removed, 1);
  assert.equal(report.snapshotId, 'encrypted-snapshot');
  assert.ok(repo.data.has(cookieId(outside)));
});

test('replace with invalid or out-of-scope input performs no mutations', async () => {
  const chosen = { type: 'host', url: 'http://app.example.test/', storeId: '0' };
  const plan = previewImport(parseImport(JSON.stringify(fixture)), [fixture[2]], { scope: chosen, mode: 'replace' });
  const repo = repository([fixture[2]]);
  const report = await executeImport(plan, { repository: repo });
  assert.equal(report.aborted, true);
  assert.equal(report.imported, 0);
  assert.equal(report.removed, 0);
  assert.equal(repo.data.size, 1);
});

test('resolved set promise does not produce success when real read-back fails', async () => {
  const plan = previewImport(parseImport(JSON.stringify([fixture[0], fixture[1]])), [], { scope });
  const repo = repository();
  repo.verify = async cookie => { if (cookie.name === 'session') throw new Error('verification mismatch SECRET'); return cookie; };
  const report = await executeImport(plan, { repository: repo });
  assert.deepEqual([report.processed, report.imported, report.failed], [2, 1, 1]);
  assert.match(report.results[1].error, /Read-back verification failed/);
  assert.doesNotMatch(JSON.stringify(report), /SECRET|fixture-session/);
});

test('incognito transfers and mismatched stores are refused by default', () => {
  const secret = { ...fixture[0], storeId: '1' };
  const plan = previewImport(parseImport(JSON.stringify([secret])), [], { scope });
  assert.equal(plan.counts.valid, 0);
  assert.match(plan.invalid[0].error, /Incognito/);
  const otherStore = previewImport(parseImport(JSON.stringify([{ ...fixture[0], storeId: '99' }])), [], { scope });
  assert.equal(otherStore.counts.valid, 0);
  const taggedIncognito = previewImport(parseImport(JSON.stringify([{ ...fixture[0], incognito: true }])), [], { scope });
  assert.equal(taggedIncognito.counts.valid, 0);
  assert.match(taggedIncognito.invalid[0].error, /Incognito/);
});

test('redacted export has no values and is rejected as a restore source', () => {
  const exported = exportCookies(fixture, { scope, redacted: true });
  assert.doesNotMatch(exported, /fixture-session-not-a-real-credential/);
  assert.ok(JSON.parse(exported).cookies.every(cookie => !Object.hasOwn(cookie, 'value')));
  assert.match(parseImport(exported).invalid[0].error, /redacted/);
  assert.match(parseImport(exportCookies(fixture, { scope, format: 'netscape', redacted: true })).invalid[0].error, /redacted/);
});

test('hostOnly and domain-cookie identities are canonicalized before conflict checks', () => {
  const cookie = { ...fixture[0], domain: 'example.test' };
  const parsed = parseImport(JSON.stringify([cookie]));
  assert.equal(parsed.cookies[0].domain, '.example.test');
  assert.equal(previewImport(parsed, [fixture[0]], { scope }).counts.overwritten, 1);
});

test('Netscape refuses lossy partition or tab/newline exports; unknown versions and oversized files fail safely', () => {
  assert.throws(() => exportCookies([{ ...fixture[0], partitionKey: { topLevelSite: 'https://example.test' } }], { scope, format: 'netscape' }), /partitioned/);
  assert.throws(() => exportCookies([{ ...fixture[0], value: 'a\tb' }], { scope, format: 'netscape' }), /tabs/);
  assert.match(parseImport('{"format":"cookiebase","version":999,"cookies":[]}').invalid[0].error, /version/);
  assert.match(parseImport('a'.repeat(10 * 1024 * 1024 + 1)).invalid[0].error, /10 MiB/);
  assert.match(parseImport('invalid\n'.repeat(20001)).invalid[0].error, /20,000/);
  const invalidRows = parseImport('bad\n'.repeat(10001));
  assert.equal(invalidRows.invalid.length, 10001);
  assert.match(invalidRows.invalid.at(-1).error, /10,000/);
});
