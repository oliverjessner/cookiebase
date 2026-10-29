import { normalizeCookie, cookieId, cookieUrl, validateCookie, inScope, partitionId } from './cookies.js';

function operationError(error, operation, cookie) {
  let message = String(error?.message || error || 'Browser did not return a cookie.');
  if (cookie?.value) message = message.split(cookie.value).join('[redacted]');
  if (/permission|host access|not allowed.*url/i.test(message)) message = 'Host access is missing or was revoked. Grant access to the target site, then retry.';
  else if (/store|incognito/i.test(message)) message = 'The chosen cookie store is unavailable. Open its browser context and check incognito permission.';
  else if (/partition/i.test(message)) message = 'Chrome rejected the partition context. Check the top-level site and cross-site ancestor, and Chrome 132+ support.';
  else if (/secure|same.?site/i.test(message)) message = 'Chrome rejected Secure/SameSite attributes. SameSite=None and partitioned cookies require HTTPS and Secure.';
  else if (/expired|expiration/i.test(message)) message = 'Cookie expiration is invalid or elapsed. Choose a future time, or Session.';
  else if (/policy|managed|blocked/i.test(message)) message = 'Chrome or an enterprise policy blocked the cookie operation. Cookiebase cannot bypass browser policy.';
  return new Error(`${operation}: ${message.slice(0, 400)}`);
}
export function createRepository(api = globalThis.chrome) {
  if (!api?.cookies) throw new Error('Chrome cookie APIs are unavailable. Load Cookiebase as a Chrome Desktop extension.');
  async function stores() {
    const raw = await api.cookies.getAllCookieStores();
    const contextIncognito = Boolean(api.extension?.inIncognitoContext);
    return Promise.all(raw.map(async (store) => {
      let incognito;
      for (const tabId of store.tabIds || []) {
        try { const tab = await api.tabs.get(tabId); incognito = Boolean(tab.incognito); break; } catch { /* A tab can close between enumeration and inspection. */ }
      }
      if (incognito === undefined && raw.length === 1) incognito = contextIncognito;
      return { ...store, incognito, contextKnown: incognito !== undefined };
    }));
  }
  async function assertStore(cookie) {
    if (!cookie.storeId) throw new Error('Choose an explicit cookie store; Cookiebase will not silently write to a default store.');
    const available = await stores();
    const store = available.find((candidate) => candidate.id === cookie.storeId);
    if (!store) throw new Error('The chosen cookie store is unavailable. Open its browser context and retry.');
    if (!store.contextKnown) throw new Error('The chosen store context cannot be established safely. Open a tab in that context and retry.');
    if (store.incognito !== Boolean(api.extension?.inIncognitoContext)) throw new Error('Cookie stores from another regular/incognito context cannot be changed here. Open Cookiebase in that context.');
    if (cookie.incognito !== undefined && Boolean(cookie.incognito) !== store.incognito) throw new Error('Regular and incognito cookie contexts cannot be mixed.');
    return store;
  }
  async function authorizedUrl(cookie, targetUrl) {
    const candidates = [targetUrl || cookieUrl(cookie)];
    if (!cookie.secure && !targetUrl) candidates.push(cookieUrl({ ...cookie, secure: true }));
    for (const candidate of candidates) {
      const url = new URL(candidate);
      if (await api.permissions.contains({ origins: [`${url.protocol}//${url.hostname}/*`] })) return candidate;
    }
    throw new Error('Host permission is missing. Grant access to the target site, then retry.');
  }
  async function exact(cookie) {
    const details = { name: cookie.name, storeId: cookie.storeId, domain: cookie.domain.replace(/^\./, ''), path: cookie.path };
    if (cookie.partitionKey) details.partitionKey = cookie.partitionKey;
    const candidates = await api.cookies.getAll(details);
    return candidates.find((candidate) => cookieId(normalizeCookie(candidate)) === cookieId(normalizeCookie(cookie))) || null;
  }
  async function verify(cookie) {
    const expected = normalizeCookie(cookie);
    const actual = await exact(expected);
    if (!actual) throw new Error('Verification failed: the exact cookie is absent. It may have expired, been replaced, or been blocked by browser policy.');
    const mismatches = [];
    for (const key of ['value', 'secure', 'httpOnly', 'hostOnly', 'sameSite', 'session']) if (actual[key] !== expected[key]) mismatches.push(key === 'value' ? 'value (masked)' : key);
    if (!expected.session && Math.abs(actual.expirationDate - expected.expirationDate) > 1) mismatches.push('expirationDate (Chrome may cap persistence to 400 days)');
    if (partitionId(actual.partitionKey) !== partitionId(expected.partitionKey)) mismatches.push('partitionKey');
    if (mismatches.length) throw new Error(`Verification failed: Chrome changed ${mismatches.join(', ')}. Inspect the actual cookie before retrying.`);
    return normalizeCookie(actual);
  }
  async function set(input) {
    const cookie = normalizeCookie(input);
    if (input.url) cookie.url = input.url;
    const errors = validateCookie(cookie);
    if (errors.length) throw new Error(errors.join(' '));
    try {
      await assertStore(cookie);
      const url = await authorizedUrl(cookie, input.url);
      const details = {
        url, name: cookie.name, value: cookie.value,
        path: cookie.path, secure: cookie.secure, httpOnly: cookie.httpOnly,
        sameSite: cookie.sameSite, storeId: cookie.storeId,
      };
      if (!cookie.hostOnly) details.domain = cookie.domain;
      if (!cookie.session) details.expirationDate = cookie.expirationDate;
      if (cookie.partitionKey) details.partitionKey = cookie.partitionKey;
      const result = await api.cookies.set(details);
      if (!result) throw new Error('Chrome did not create the cookie. Check host access, browser policy, prefixes and cookie size limits.');
      const verified = await verify(cookie);
      verified.incognito = Boolean(api.extension?.inIncognitoContext);
      return verified;
    } catch (error) { throw operationError(error, 'Set cookie', cookie); }
  }
  async function remove(input) {
    const cookie = normalizeCookie(input);
    try {
      await assertStore(cookie);
      const url = await authorizedUrl(cookie);
      const actual = await exact(cookie);
      if (!actual) throw new Error('Cookie is already absent. Refresh the list before retrying.');
      const details = { url, name: cookie.name, storeId: cookie.storeId };
      if (cookie.partitionKey) details.partitionKey = cookie.partitionKey;
      const siblingQuery = { name: cookie.name, storeId: cookie.storeId };
      if (cookie.partitionKey) siblingQuery.partitionKey = cookie.partitionKey;
      const siblings = (await api.cookies.getAll(siblingQuery)).filter(candidate => cookieId(normalizeCookie(candidate)) !== cookieId(cookie));
      const fullHostAccess = await api.permissions.contains({ origins: ['http://*/*', 'https://*/*'] });
      if (siblings.length || !fullHostAccess) {
        // Chrome remove(name, URL) may remove multiple cookies with the same name
        // and URL-matching paths. Partial grants can hide parent-domain siblings,
        // so use exact domain/path expiration unless coverage is comprehensive.
        const expiration = { ...details, value: '', path: cookie.path, secure: cookie.secure,
          httpOnly: cookie.httpOnly, sameSite: cookie.sameSite, expirationDate: 0 };
        if (!cookie.hostOnly) expiration.domain = cookie.domain;
        await api.cookies.set(expiration);
      } else {
        const winner = await api.cookies.get(details);
        if (!winner || cookieId(normalizeCookie(winner)) !== cookieId(cookie)) throw new Error('Chrome resolves this name/URL to another cookie. Refresh before retrying; Cookiebase refused to delete a different identity.');
        const result = await api.cookies.remove(details);
        if (!result) throw new Error('Chrome did not confirm cookie removal.');
      }
      if (await exact(cookie)) throw new Error('Deletion could not be verified. The cookie may have been recreated by the site or blocked by policy.');
      for (const sibling of siblings) {
        const after = await exact(sibling);
        if (!after || after.value !== sibling.value || ['secure', 'httpOnly', 'hostOnly', 'sameSite', 'session', 'expirationDate'].some(key => after[key] !== sibling[key])) throw new Error('Another cookie with the same name changed during deletion. Inspect current cookies and the Undo snapshot before continuing.');
      }
      return { removed: true, cookieId: cookieId(cookie) };
    } catch (error) { throw operationError(error, 'Remove cookie', cookie); }
  }
  async function list({ scope = { type: 'all', incognito: Boolean(api.extension?.inIncognitoContext) }, tabId } = {}) {
    const warnings = [];
    const available = await stores();
    const currentIncognito = Boolean(api.extension?.inIncognitoContext);
    const requestedIncognito = scope.incognito ?? currentIncognito;
    const selected = available.filter((store) => store.contextKnown && store.incognito === requestedIncognito && store.incognito === currentIncognito && (!scope.storeId || store.id === scope.storeId));
    if (available.some((store) => !store.contextKnown)) warnings.push('Some cookie-store contexts could not be established. Open a tab in the intended context; unknown stores are withheld.');
    if (requestedIncognito !== currentIncognito) warnings.push('Open Cookiebase in the requested regular/incognito window. Stores are isolated across extension contexts.');
    const grants = await api.permissions.getAll();
    const fullAccess = await api.permissions.contains({ origins: ['http://*/*', 'https://*/*'] });
    const collected = new Map();
    const partitions = [];
    if (Number.isInteger(tabId) && api.cookies.getPartitionKey) {
      try { const result = await api.cookies.getPartitionKey({ tabId, frameId: 0 }); if (result?.partitionKey?.topLevelSite) partitions.push(result.partitionKey); }
      catch { warnings.push('The active tab partition context could not be read (closed/restricted tab or missing host access).'); }
    }
    if (scope.partitionKey?.topLevelSite) partitions.push(scope.partitionKey);
    let wildcardPartitionSupported = true;
    for (const store of selected) {
      const queries = [{ storeId: store.id }, { storeId: store.id, partitionKey: {} }, ...partitions.map((partitionKey) => ({ storeId: store.id, partitionKey }))];
      for (const query of queries) {
        try {
          for (const raw of await api.cookies.getAll(query)) {
            const cookie = { ...normalizeCookie(raw), incognito: store.incognito };
            if (inScope(cookie, scope)) collected.set(cookieId(cookie), cookie);
          }
        } catch (error) {
          if (query.partitionKey && !query.partitionKey.topLevelSite) wildcardPartitionSupported = false;
          warnings.push(operationError(error, query.partitionKey ? 'Enumerate partition context' : 'Enumerate store').message);
        }
      }
    }
    if (!fullAccess) warnings.push('Access is limited to granted hosts. An empty list does not mean the browser has no cookies.');
    warnings.push('Partition coverage is best effort: API-reachable partition queries and the active top frame only. Hidden frame contexts, unavailable stores and browser policy may prevent parity with DevTools.');
    return {
      cookies: [...collected.values()], stores: selected,
      coverage: { fullAccess, origins: grants.origins || [], storeIds: selected.map((store) => store.id), activePartitionKeys: partitions, wildcardPartitionSupported, incognito: currentIncognito, partitionLimit: true },
      warnings: [...new Set(warnings)],
    };
  }
  async function get(cookie) {
    await assertStore(cookie);
    await authorizedUrl(cookie);
    return exact(cookie);
  }
  return { stores, list, set, remove, verify, get };
}
