import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { cookieId, normalizeCookie, registrableDomain, inScope, filterCookies, validateCookie, cookieUrl, partitionId } from '../src/core/cookies.js';
import { matchesRule, deletePreview, protectedBy, validateRule } from '../src/core/rules.js';
import { createPermissionService } from '../src/core/permissions.js';
const base = { name: 'session', value: 'sensitive', domain: 'example.co.uk', path: '/', storeId: '0', hostOnly: true, secure: true, httpOnly: true, sameSite: 'lax', session: true, incognito: false };

test('identity keeps stores, paths, domains and CHIPS partitions separate', () => {
  const identities = [base, { ...base, path: '/admin' }, { ...base, storeId: '1' }, { ...base, domain: '.example.co.uk', hostOnly: false }, { ...base, partitionKey: { topLevelSite: 'https://example.org', hasCrossSiteAncestor: false } }, { ...base, partitionKey: { topLevelSite: 'https://example.org', hasCrossSiteAncestor: true } }].map(cookieId);
  assert.equal(new Set(identities).size, 6);
  assert.equal(partitionId({ topLevelSite: 'https://example.org' }), partitionId({ topLevelSite: 'https://example.org', hasCrossSiteAncestor: false }));
});
test('PSL handles co.uk and private multi-label suffixes', () => {
  assert.equal(registrableDomain('a.shop.example.co.uk'), 'example.co.uk');
  assert.equal(registrableDomain('a.customer.github.io'), 'customer.github.io');
  assert.equal(registrableDomain('localhost'), 'localhost');
  assert.equal(inScope(base, { type: 'site', url: 'https://shop.example.co.uk' }), true);
  assert.equal(inScope({ ...base, domain: 'other.co.uk' }, { type: 'site', url: 'https://example.co.uk' }), false);
});
test('URL scope respects hostOnly, path boundary and HTTPS; host/site scopes explicit', () => {
  assert.equal(inScope(base, { type: 'url', url: 'https://sub.example.co.uk' }), false);
  assert.equal(inScope({ ...base, hostOnly: false, domain: '.example.co.uk' }, { type: 'url', url: 'https://sub.example.co.uk' }), true);
  assert.equal(inScope({ ...base, path: '/admin' }, { type: 'url', url: 'https://example.co.uk/administrator' }), false);
  assert.equal(inScope({ ...base, path: '/admin' }, { type: 'url', url: 'https://example.co.uk/admin/tools' }), true);
  assert.equal(inScope(base, { type: 'url', url: 'http://example.co.uk/' }), false);
  assert.equal(inScope(base, { type: 'host', url: 'https://sub.example.co.uk' }), false);
  assert.equal(inScope(base, { type: 'site', url: 'https://sub.example.co.uk' }), true);
});
test('scope enforces domains boundary, store and incognito isolation', () => {
  assert.equal(inScope(base, { type: 'domains', domains: ['example.co.uk'] }), true);
  assert.equal(inScope({ ...base, domain: 'notexample.co.uk' }, { type: 'domains', domains: ['example.co.uk'] }), false);
  assert.equal(inScope(base, { type: 'all', storeId: '1' }), false);
  assert.equal(inScope(base, { type: 'all', incognito: true }), false);
  assert.equal(inScope(base, { type: 'host', url: 'chrome://extensions' }), false);
});
test('search is case-insensitive, optional sensitive and wildcard-safe', () => {
  const fixture = [base, { ...base, name: 'CONSENT', value: 'private', secure: false, httpOnly: false, session: false, expirationDate: 2000000000 }, { ...base, name: 'metrics.1', partitionKey: { topLevelSite: 'https://other.org' } }];
  assert.equal(filterCookies(fixture, { query: 'cons*' }).length, 1);
  assert.equal(filterCookies(fixture, { query: 'private' }).length, 0);
  assert.equal(filterCookies(fixture, { query: 'private', searchValues: true }).length, 1);
  assert.equal(filterCookies(fixture, { query: 'metrics.1' }).length, 1);
  assert.equal(filterCookies(fixture, { secure: 'false', session: false }).length, 1);
  assert.equal(filterCookies(fixture, { partitioned: true }).length, 1);
  assert.equal(filterCookies(fixture, { expiresAfter: 1900000000 }).length, 1);
  assert.equal(filterCookies(fixture, { observedAfter: 1000 }).length, 0);
});
test('validation enforces create advanced browser rules without echoing values', () => {
  assert.deepEqual(validateCookie(base), []);
  assert.match(validateCookie({ ...base, secure: false, sameSite: 'no_restriction' }).join(), /Secure/);
  assert.match(validateCookie({ ...base, name: '__Host-auth', hostOnly: false }).join(), /HostOnly/);
  assert.match(validateCookie({ ...base, name: '__Secure-auth', secure: false }).join(), /Secure/);
  assert.match(validateCookie({ ...base, domain: '.co.uk', hostOnly: false }).join(), /public suffix/);
  assert.match(validateCookie({ ...base, session: false, expirationDate: 5 }).join(), /future/);
  assert.match(validateCookie({ ...base, path: 'relative' }).join(), /Path/);
  assert.match(validateCookie({ ...base, value: 'supersecret;bad' }).join(), /control/);
  assert.doesNotMatch(validateCookie({ ...base, value: 'supersecret;bad' }).join(), /supersecret/);
  assert.match(validateCookie({ ...base, url: 'http://example.co.uk' }).join(), /HTTPS/);
  assert.match(validateCookie({ ...base, storeId: '' }).join(), /explicit/);
});
test('normalization drops unsupported fields and preserves partition attribution', () => {
  const normalized = normalizeCookie({ ...base, domain: '.EXAMPLE.co.uk', hostOnly: false, creationDate: 123, irrelevant: 'secret', partitionKey: { topLevelSite: 'https://other.org', hasCrossSiteAncestor: true } });
  assert.equal(normalized.domain, '.example.co.uk');
  assert.equal('creationDate' in normalized, false);
  assert.equal('irrelevant' in normalized, false);
  assert.equal(cookieUrl(normalized), 'https://example.co.uk/');
});
test('allowlist rules are additive and deletion preview preserves consent and subdomains', () => {
  const rules = [{ id: 'consent', domain: 'example.co.uk', name: 'consent', path: '/', includeSubdomains: true }, { id: 'specific', domain: 'example.co.uk', name: '*', storeId: '1' }];
  const consent = { ...base, name: 'consent' };
  assert.equal(protectedBy(consent, rules).length, 1);
  assert.equal(matchesRule({ ...consent, domain: 'sub.example.co.uk' }, rules[0]), true);
  assert.equal(matchesRule(consent, { ...rules[0], enabled: false }), false);
  const fixture = [base, consent, { ...base, domain: 'sub.example.co.uk' }];
  const preview = deletePreview(fixture, rules, { preserveSubdomains: true, host: 'example.co.uk' });
  assert.deepEqual(preview.counts, { total: 3, remove: 1, preserved: 2 });
  assert.equal(preview.remove[0].name, 'session');
  assert.match(deletePreview(fixture, rules, { overrideProtection: true }).warning, /override/);
  assert.equal(validateRule({ domain: 'https://wrong' }).length, 1);
});
test('permission request calls Chrome before yielding the click gesture', async () => {
  const calls = [];
  const service = createPermissionService({ permissions: { request(details) { calls.push(details); return Promise.resolve(false); } } });
  const result = service.requestSite('https://example.co.uk/path');
  assert.deepEqual(calls, [{ origins: ['http://example.co.uk/*', 'https://example.co.uk/*'] }]);
  assert.equal(await result, false);
  assert.throws(() => service.requestSite('chrome://settings'), /blocks/);
});
test('10,000 cookies can be searched, scoped and sorted without quadratic work', (t) => {
  const fixture = Array.from({ length: 10000 }, (_, i) => ({ ...base, name: `cookie-${i}`, domain: `${i % 10}.example.co.uk` }));
  const start = performance.now();
  const filtered = filterCookies(fixture, { query: 'cookie-*7', scope: { type: 'site', url: 'https://example.co.uk' }, sortBy: 'name' });
  const elapsed = performance.now() - start;
  assert.equal(filtered.length, 1000);
  assert.ok(elapsed < 1500, `10k filter elapsed ${elapsed.toFixed(1)}ms`);
  t.diagnostic(`10k cookie PSL scope + wildcard search + sort: ${elapsed.toFixed(1)}ms`);
});
