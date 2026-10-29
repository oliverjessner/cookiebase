import { getDomain, getPublicSuffix } from 'tldts';

export const stripDot = (domain = '') => String(domain).toLowerCase().replace(/^\./, '').replace(/\.$/, '');
export function registrableDomain(host) {
  const normalized = stripDot(host);
  return getDomain(normalized, { allowPrivateDomains: true }) || normalized;
}
export function partitionId(partition) {
  if (!partition) return '';
  return JSON.stringify([partition.topLevelSite || '', partition.hasCrossSiteAncestor ?? false]);
}
export function normalizeCookie(cookie) {
  const domain = stripDot(cookie.domain);
  const hostOnly = cookie.hostOnly ?? !String(cookie.domain || '').startsWith('.');
  const normalized = {
    name: String(cookie.name ?? ''), value: String(cookie.value ?? ''),
    domain: hostOnly ? domain : `.${domain}`, path: cookie.path ?? '/',
    hostOnly, secure: cookie.secure ?? false, httpOnly: cookie.httpOnly ?? false,
    sameSite: cookie.sameSite ?? 'unspecified', session: cookie.session ?? cookie.expirationDate == null,
    storeId: cookie.storeId == null ? '' : String(cookie.storeId),
  };
  if (!normalized.session && cookie.expirationDate != null) normalized.expirationDate = Number(cookie.expirationDate);
  if (cookie.partitionKey) {
    normalized.partitionKey = { topLevelSite: cookie.partitionKey.topLevelSite };
    if (cookie.partitionKey.hasCrossSiteAncestor !== undefined) normalized.partitionKey.hasCrossSiteAncestor = cookie.partitionKey.hasCrossSiteAncestor;
  }
  if (cookie.observedAt != null) normalized.observedAt = Number(cookie.observedAt);
  if (cookie.incognito !== undefined) normalized.incognito = Boolean(cookie.incognito);
  return normalized;
}
export function cookieId(cookie) {
  return JSON.stringify([String(cookie.name ?? ''), String(cookie.domain ?? '').toLowerCase(), cookie.path ?? '/', String(cookie.storeId ?? ''), partitionId(cookie.partitionKey)]);
}
export function cookieUrl(cookie) {
  const host = stripDot(cookie.domain);
  const safeHost = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
  return `${cookie.secure ? 'https' : 'http'}://${safeHost}${cookie.path?.startsWith('/') ? cookie.path : '/'}`;
}
function httpUrl(url) {
  try { const parsed = new URL(url); return ['https:', 'http:'].includes(parsed.protocol) ? parsed : null; } catch { return null; }
}
function domainMatches(cookie, host) {
  const domain = stripDot(cookie.domain);
  return host === domain || (!cookie.hostOnly && host.endsWith(`.${domain}`));
}
function pathMatches(path, cookiePath) {
  return path === cookiePath || (path.startsWith(cookiePath) && (cookiePath.endsWith('/') || path[cookiePath.length] === '/'));
}
export function inScope(cookie, scope = { type: 'all' }) {
  if (scope.storeId != null && scope.storeId !== '' && String(cookie.storeId) !== String(scope.storeId)) return false;
  if (scope.incognito !== undefined && cookie.incognito !== undefined && Boolean(cookie.incognito) !== Boolean(scope.incognito)) return false;
  if (scope.partitionKey !== undefined && partitionId(cookie.partitionKey) !== partitionId(scope.partitionKey)) return false;
  const domain = stripDot(cookie.domain);
  if (scope.type === 'all' || !scope.type) return true;
  if (scope.type === 'domains') {
    const domains = Array.isArray(scope.domains) ? scope.domains : String(scope.domains || '').split(/[\s,]+/);
    return domains.filter(Boolean).some((host) => {
      const target = stripDot(host);
      return domain === target || (scope.includeSubdomains !== false && domain.endsWith(`.${target}`));
    });
  }
  const target = httpUrl(scope.url || (scope.host ? `https://${scope.host}` : ''));
  if (!target) return false;
  const host = target.hostname.toLowerCase();
  if (scope.type === 'host') return domain === host;
  if (scope.type === 'site') return registrableDomain(domain) === registrableDomain(host);
  if (scope.type === 'url') return domainMatches(cookie, host) && (!cookie.secure || target.protocol === 'https:') && pathMatches(target.pathname || '/', cookie.path || '/');
  return false;
}
export function scopeLabel(scope = {}) {
  const store = scope.storeId != null && scope.storeId !== '' ? ` · Store ${scope.storeId}` : '';
  const context = scope.incognito ? ' · Incognito' : ' · Regular';
  if (scope.type === 'all') return `All accessible sites${store}${context}`;
  if (scope.type === 'domains') return `Domains: ${(scope.domains || []).join(', ')}${scope.includeSubdomains === false ? ' (exact)' : ' + subdomains'}${store}${context}`;
  const target = httpUrl(scope.url);
  return `${scope.type === 'url' ? 'Current URL' : scope.type === 'site' ? 'Site + subdomains' : 'Exact host'}: ${target ? (scope.type === 'site' ? registrableDomain(target.hostname) : scope.type === 'url' ? target.href : target.hostname) : 'choose an HTTP(S) target'}${store}${context}`;
}
export function validateCookie(cookie, { now = Date.now() / 1000, requireStore = true } = {}) {
  const errors = [];
  if (!cookie || typeof cookie !== 'object') return ['Cookie must be an object.'];
  if (typeof cookie.name !== 'string' || !cookie.name || !/^[!#$%&'*+\-.^_`|~0-9a-zA-Z]+$/.test(cookie.name)) errors.push('Name is required and must be a valid HTTP token.');
  // eslint-disable-next-line no-control-regex -- HTTP cookie fields cannot contain control characters.
  if (typeof cookie.value !== 'string' || /[\x00-\x1f\x7f;]/.test(cookie.value)) errors.push('Value must be text without control characters or semicolons.');
  const domain = stripDot(cookie.domain);
  if (!domain || /[\s/:?#@\\]/.test(domain) || domain.includes('..') || domain.length > 253 || domain.split('.').some((label) => !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label))) errors.push('Domain must be a valid hostname, without a scheme, port or path.');
  else if (!cookie.hostOnly && getPublicSuffix(domain, { allowPrivateDomains: true }) === domain && domain !== 'localhost' && !/^\d+(\.\d+){3}$/.test(domain)) errors.push('Domain cookies cannot target a public suffix.');
  // eslint-disable-next-line no-control-regex -- HTTP cookie fields cannot contain control characters.
  if (typeof cookie.path !== 'string' || !cookie.path.startsWith('/') || /[\x00-\x1f\x7f;?\x23]/.test(cookie.path)) errors.push('Path must start with / and contain no control characters, semicolon, query or fragment.');
  if (!['unspecified', 'no_restriction', 'lax', 'strict'].includes(cookie.sameSite ?? 'unspecified')) errors.push('SameSite must be unspecified, no_restriction, lax or strict.');
  if (cookie.sameSite === 'no_restriction' && !cookie.secure) errors.push('SameSite=None requires Secure (HTTPS).');
  if ((typeof cookie.name === 'string' && cookie.name.startsWith('__Secure-')) && !cookie.secure) errors.push('__Secure- cookies require Secure (HTTPS).');
  if ((typeof cookie.name === 'string' && cookie.name.startsWith('__Host-')) && (!cookie.secure || !cookie.hostOnly || cookie.path !== '/')) errors.push('__Host- cookies require Secure, HostOnly and Path=/ (HTTPS).');
  if ((typeof cookie.name === 'string' && cookie.name.startsWith('__Http-')) && (!cookie.secure || !cookie.httpOnly)) errors.push('__Http- cookies require Secure and HttpOnly (HTTPS).');
  if ((typeof cookie.name === 'string' && cookie.name.startsWith('__Host-Http-')) && (!cookie.secure || !cookie.httpOnly || !cookie.hostOnly || cookie.path !== '/')) errors.push('__Host-Http- cookies require Secure, HttpOnly, HostOnly and Path=/.');
  for (const flag of ['secure', 'httpOnly', 'hostOnly', 'session']) if (cookie[flag] !== undefined && typeof cookie[flag] !== 'boolean') errors.push(`${flag} must be a boolean.`);
  if (cookie.session === false && (!Number.isFinite(Number(cookie.expirationDate)) || Number(cookie.expirationDate) <= now)) errors.push('Persistent expiration must be a future UNIX timestamp in seconds.');
  if (requireStore && (typeof cookie.storeId !== 'string' || !cookie.storeId)) errors.push('Choose an explicit cookie store.');
  if (cookie.partitionKey) {
    const top = httpUrl(cookie.partitionKey.topLevelSite);
    if (typeof cookie.partitionKey.topLevelSite !== 'string' || !top || top.origin !== cookie.partitionKey.topLevelSite.replace(/\/$/, '')) errors.push('Partition top-level site must be an HTTP(S) origin.');
    if (!cookie.secure) errors.push('Partitioned cookies require Secure (HTTPS).');
    if (cookie.partitionKey.hasCrossSiteAncestor !== undefined && typeof cookie.partitionKey.hasCrossSiteAncestor !== 'boolean') errors.push('Partition cross-site ancestor must be a boolean.');
  }
  if (cookie.url) {
    const url = httpUrl(cookie.url);
    if (!url) errors.push('Target URL must use HTTP or HTTPS.');
    else {
      if (cookie.secure && url.protocol !== 'https:') errors.push('Secure cookies require an HTTPS target URL.');
      if (!domainMatches(cookie, url.hostname)) errors.push('Target URL hostname does not match the cookie domain.');
    }
  }
  return errors;
}
export function wildcardMatch(text, pattern) {
  // Literal chunks avoid regular-expression backtracking from user-supplied wildcards.
  const value = String(text).toLowerCase();
  const pieces = String(pattern).toLowerCase().split('*');
  if (pieces.length === 1) return value === pieces[0];
  if (!value.startsWith(pieces[0])) return false;
  let cursor = pieces[0].length;
  for (let i = 1; i < pieces.length - 1; i++) {
    const found = value.indexOf(pieces[i], cursor);
    if (found < 0) return false;
    cursor = found + pieces[i].length;
  }
  const ending = pieces.at(-1);
  return value.endsWith(ending) && value.length - ending.length >= cursor;
}
export function filterCookies(cookies, filters = {}) {
  const query = String(filters.query ?? filters.search ?? '').trim().toLowerCase();
  const result = cookies.filter((cookie) => {
    if (filters.scope && !inScope(cookie, filters.scope)) return false;
    if (query) {
      const fields = [cookie.name, cookie.domain, cookie.path];
      if (filters.searchValues) fields.push(cookie.value);
      if (!fields.some((field) => query.includes('*') ? wildcardMatch(field, query) : String(field).toLowerCase().includes(query))) return false;
    }
    for (const flag of ['secure', 'httpOnly', 'hostOnly', 'session', 'protected']) {
      if (filters[flag] !== undefined && filters[flag] !== '' && filters[flag] !== 'all') {
        const expected = filters[flag] === true || filters[flag] === 'true' || filters[flag] === 'yes';
        if (Boolean(cookie[flag]) !== expected) return false;
      }
    }
    if (filters.sameSite && filters.sameSite !== 'all' && cookie.sameSite !== filters.sameSite) return false;
    if (filters.storeId && filters.storeId !== 'all' && String(cookie.storeId) !== String(filters.storeId)) return false;
    if (filters.partitioned !== undefined && filters.partitioned !== '' && filters.partitioned !== 'all' && Boolean(cookie.partitionKey) !== (filters.partitioned === true || filters.partitioned === 'true' || filters.partitioned === 'yes')) return false;
    if (filters.expiresAfter && (cookie.session || cookie.expirationDate < Number(filters.expiresAfter))) return false;
    if (filters.expiresBefore && (cookie.session || cookie.expirationDate > Number(filters.expiresBefore))) return false;
    if (filters.observedAfter && (!cookie.observedAt || cookie.observedAt < Number(filters.observedAfter))) return false;
    if (filters.observedBefore && (!cookie.observedAt || cookie.observedAt > Number(filters.observedBefore))) return false;
    return true;
  });
  const sortBy = filters.sortBy ?? filters.sort ?? 'domain';
  const direction = filters.direction === 'desc' ? -1 : 1;
  return result.sort((a, b) => {
    let compared = 0;
    if (sortBy === 'expiration' || sortBy === 'expirationDate') compared = (a.expirationDate ?? Infinity) - (b.expirationDate ?? Infinity);
    else if (sortBy === 'observed' || sortBy === 'observedAt') compared = (a.observedAt ?? 0) - (b.observedAt ?? 0);
    else compared = String(a[sortBy] ?? a.domain).localeCompare(String(b[sortBy] ?? b.domain));
    return (compared || a.name.localeCompare(b.name) || a.path.localeCompare(b.path)) * direction;
  });
}
