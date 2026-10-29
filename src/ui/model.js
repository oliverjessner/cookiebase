import { cookieId, filterCookies, inScope } from '../core/cookies.js';
import { protectedBy } from '../core/rules.js';

export function dataForSource(cookies, { scope, filters = {}, selected = new Set(), rules = [], source = 'scope' }) {
  const scoped = cookies.filter(cookie => inScope(cookie, scope)).map(cookie => ({ ...cookie, protected: protectedBy(cookie, rules).length > 0 }));
  if (source === 'selected') return scoped.filter(cookie => selected.has(cookieId(cookie)));
  if (source === 'filtered') return filterCookies(scoped, filters);
  return scoped;
}
export function selectionSummary(cookies, filtered, selected) {
  const existing = new Set(cookies.map(cookieId));
  const visible = new Set(filtered.map(cookieId));
  const valid = [...selected].filter(id => existing.has(id));
  return { total: valid.length, hidden: valid.filter(id => !visible.has(id)).length, matching: valid.filter(id => visible.has(id)).length };
}
export function targetBinding(tab, url, incognito = false) {
  try {
    const target = new URL(url), current = new URL(tab?.url);
    if (!['http:', 'https:'].includes(target.protocol) || !['http:', 'https:'].includes(current.protocol)) throw new Error();
    if (Boolean(tab.incognito) !== incognito || target.origin !== current.origin) throw new Error();
    return { valid: true, id: tab.id, url: tab.url, title: tab.title || current.hostname };
  } catch { return { valid: false, reason: 'The linked tab is closed, inaccessible, or belongs to another site. Open this site before reloading.' }; }
}
export function groupedCookies(cookies, group = false) {
  if (!group) return [{ domain: null, cookies }];
  const groups = new Map();
  for (const cookie of cookies) { if (!groups.has(cookie.domain)) groups.set(cookie.domain, []); groups.get(cookie.domain).push(cookie); }
  return [...groups].sort(([a], [b]) => a.localeCompare(b)).map(([domain, items]) => ({ domain, cookies: items }));
}

export function localDateInput(timestamp) {
  if (!Number.isFinite(timestamp)) return '';
  const date = new Date(timestamp);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}
