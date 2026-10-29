import { stripDot, wildcardMatch, partitionId, inScope } from './cookies.js';

export function validateRule(rule) {
  const errors = [];
  if (!rule || typeof rule !== 'object') return ['Rule must be an object.'];
  if (typeof rule.domain !== 'string' || !rule.domain.trim() || /[\s/:?#@]/.test(rule.domain)) errors.push('Domain pattern is required (hostname or * wildcard).');
  if (rule.name !== undefined && typeof rule.name !== 'string') errors.push('Cookie name pattern must be text.');
  if (rule.path !== undefined && rule.path !== '*' && (typeof rule.path !== 'string' || !rule.path.startsWith('/'))) errors.push('Path pattern must start with / or be *.');
  return errors;
}
export function matchesRule(cookie, rule) {
  if (!rule || rule.enabled === false) return false;
  if (rule.scope && !inScope(cookie, rule.scope)) return false;
  if (rule.storeId && String(rule.storeId) !== String(cookie.storeId)) return false;
  if (rule.partitionKey !== undefined && partitionId(rule.partitionKey) !== partitionId(cookie.partitionKey)) return false;
  if (rule.incognito !== undefined && cookie.incognito !== undefined && rule.incognito !== cookie.incognito) return false;
  const domain = stripDot(cookie.domain);
  const pattern = stripDot(rule.domain || '*');
  const domainMatch = wildcardMatch(domain, pattern) || (rule.includeSubdomains === true && domain.endsWith(`.${pattern}`));
  return domainMatch && wildcardMatch(cookie.name, rule.name || '*') && wildcardMatch(cookie.path, rule.path || '*');
}
export function protectedBy(cookie, rules = []) {
  // Rules are allowlists only: any matching enabled rule protects. No ambiguous deny precedence.
  return rules.filter((rule) => matchesRule(cookie, rule));
}
export function deletePreview(cookies, rules = [], options = {}) {
  const scoped = options.scope ? cookies.filter((cookie) => inScope(cookie, options.scope)) : cookies;
  const preserved = [];
  const remove = [];
  for (const cookie of scoped) {
    const matches = protectedBy(cookie, rules);
    const preserveSubdomain = options.preserveSubdomains && options.host && stripDot(cookie.domain) !== stripDot(options.host);
    if ((matches.length && !options.overrideProtection) || preserveSubdomain) preserved.push({ cookie, rules: matches.map((rule) => rule.id), reason: preserveSubdomain ? 'Subdomain preserved' : 'Protected by allowlist' });
    else remove.push(cookie);
  }
  return {
    remove, preserved, domains: [...new Set(remove.map((cookie) => cookie.domain))],
    stores: [...new Set(remove.map((cookie) => cookie.storeId))],
    counts: { total: scoped.length, remove: remove.length, preserved: preserved.length },
    warning: options.overrideProtection ? 'Protection override: matching allowlist rules will be ignored.' : '',
  };
}
