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
  return domainMatch && wildcardMatch(cookie.name, rule.name ?? '*') && wildcardMatch(cookie.path, rule.path || '*');
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

/** Import replacement obeys the same safe default as cleanup. Explicit override is visible in preview. */
export function protectImportPlan(plan, rules, { overrideProtection = false } = {}) {
  const protectedRemovals = plan.removals.filter(cookie => protectedBy(cookie, rules).length);
  const protectedOverwrites = plan.actions.filter(action => action.action === 'overwrite' && protectedBy(action.previous || action.cookie, rules).length);
  const result = { ...plan, warnings: [...plan.warnings], counts: { ...plan.counts, protectedRemovals: protectedRemovals.length, protectedOverwrites: protectedOverwrites.length },
    actions: plan.actions.map(action => !overrideProtection && protectedOverwrites.includes(action) ? { ...action, action: 'skip', reason: 'Protected by allowlist' } : action),
    removals: overrideProtection ? plan.removals : plan.removals.filter(cookie => !protectedRemovals.includes(cookie)) };
  result.counts.removed = result.removals.length;
  result.counts.overwritten = result.actions.filter(action => action.action === 'overwrite').length;
  result.counts.skipped = result.actions.filter(action => action.action === 'skip').length;
  if (protectedRemovals.length || protectedOverwrites.length) result.warnings.push(overrideProtection ? 'PROTECTION OVERRIDE: this import may remove or overwrite protected cookies.' : 'Protected cookies will be preserved. An explicit protection override is required to replace them.');
  return result;
}
