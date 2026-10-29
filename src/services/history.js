import { cookieId, inScope } from '../core/cookies.js';

const CONFIG_KEY = 'history-config';
const EVENTS_KEY = 'history-events';
const DEFAULTS = { enabled: false, maxEntries: 1000, maxAgeHours: 24, recordingScope: { type: 'all' } };
function recordingScope(input) {
  if (!input || typeof input !== 'object' || !['all', 'url', 'host', 'site', 'domains'].includes(input.type)) throw new Error('Choose an explicit recording scope.');
  const result = { type: input.type };
  if (input.storeId != null && input.storeId !== '') {
    if (typeof input.storeId !== 'string') throw new Error('Recording store must be a valid cookie store ID.');
    result.storeId = input.storeId;
  }
  if (input.incognito !== undefined) result.incognito = Boolean(input.incognito);
  if (['url', 'host', 'site'].includes(input.type)) {
    let url; try { url = new URL(input.url); } catch { throw new Error('Recording this page or site needs an HTTP(S) target URL.'); }
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Recording this page or site needs an HTTP(S) target URL.');
    result.url = `${url.origin}${input.type === 'url' ? url.pathname : '/'}`;
  }
  if (input.type === 'domains') {
    if (!Array.isArray(input.domains) || !input.domains.length || input.domains.length > 100 || input.domains.some(domain => typeof domain !== 'string' || !domain || /[\s/:?#@]/.test(domain))) throw new Error('Choose between 1 and 100 valid recording domains.');
    result.domains = [...new Set(input.domains.map(domain => domain.toLowerCase().replace(/^\./, '')))];
    result.includeSubdomains = input.includeSubdomains !== false;
  }
  return result;
}
const ATTRIBUTES = ['domain', 'path', 'storeId', 'hostOnly', 'secure', 'httpOnly', 'sameSite', 'session', 'expirationDate', 'partitionKey'];
const encoder = new TextEncoder();
const safeMetadata = cookie => {
  const item = { name: String(cookie.name ?? ''), domain: String(cookie.domain ?? ''), path: String(cookie.path ?? '/'),
    storeId: String(cookie.storeId ?? ''), hostOnly: Boolean(cookie.hostOnly), secure: Boolean(cookie.secure),
    httpOnly: Boolean(cookie.httpOnly), sameSite: cookie.sameSite ?? 'unspecified', session: Boolean(cookie.session) };
  if (cookie.expirationDate != null) item.expirationDate = Number(cookie.expirationDate);
  if (cookie.partitionKey) item.partitionKey = { topLevelSite: cookie.partitionKey.topLevelSite, ...(cookie.partitionKey.hasCrossSiteAncestor === undefined ? {} : { hasCrossSiteAncestor: cookie.partitionKey.hasCrossSiteAncestor }) };
  if (cookie.incognito !== undefined) item.incognito = Boolean(cookie.incognito);
  return item;
};
function changes(before, after) {
  return ATTRIBUTES.filter(attribute => JSON.stringify(before[attribute]) !== JSON.stringify(after[attribute]));
}
function compare(before, after, getValue) {
  const a = new Map(before.map(c => [cookieId(c), c]));
  const b = new Map(after.map(c => [cookieId(c), c]));
  const result = { added: [], removed: [], changed: [], unchanged: 0 };
  for (const [id, item] of b) {
    if (!a.has(id)) { result.added.push(safeMetadata(item)); continue; }
    const old = a.get(id);
    const attributes = changes(old, item);
    const valueChanged = getValue(old) !== getValue(item);
    if (attributes.length || valueChanged) result.changed.push({ cookie: safeMetadata(item), attributes, valueChanged });
    else result.unchanged++;
  }
  for (const [id, item] of a) if (!b.has(id)) result.removed.push(safeMetadata(item));
  return result;
}
/** Compares values but returns only a boolean; no value is included in the report. */
export function compareSnapshotCookies(before, after) { return compare(before, after, cookie => cookie.value); }

export function createHistoryService(storage) {
  let queue = Promise.resolve();
  let keyPromise;
  const sessionSnapshots = new Map();
  const pending = new Map();
  let privateEvents = [];
  const serial = fn => {
    const result = queue.then(fn);
    queue = result.catch(() => {});
    return result;
  };
  const digest = async value => {
    keyPromise ??= crypto.subtle.generateKey({ name: 'HMAC', hash: 'SHA-256', length: 256 }, false, ['sign']);
    const signed = await crypto.subtle.sign('HMAC', await keyPromise, encoder.encode(String(value ?? '')));
    return Array.from(new Uint8Array(signed), byte => byte.toString(16).padStart(2, '0')).join('');
  };
  async function config() { const saved = await storage.get(CONFIG_KEY); return { ...DEFAULTS, ...saved, recordingScope: structuredClone(saved?.recordingScope ?? DEFAULTS.recordingScope) }; }
  function trim(events, policy) {
    const cutoff = Date.now() - policy.maxAgeHours * 3_600_000;
    return events.filter(item => item.observedAt >= cutoff).slice(-policy.maxEntries);
  }
  async function loadEvents(policy) {
    const stored = await storage.get(EVENTS_KEY);
    return trim(Array.isArray(stored) ? stored : [], policy);
  }
  return {
    configure(input) {
      return serial(async () => {
        const policy = await config();
        if (input.enabled !== undefined) policy.enabled = Boolean(input.enabled);
        if (input.recordingScope !== undefined) { policy.recordingScope = recordingScope(input.recordingScope); pending.clear(); }
        if (input.maxEntries !== undefined) {
          if (!Number.isInteger(Number(input.maxEntries)) || input.maxEntries < 1 || input.maxEntries > 10_000) throw new Error('History retention must be between 1 and 10,000 events.');
          policy.maxEntries = Number(input.maxEntries);
        }
        if (input.maxAgeHours !== undefined) {
          if (!Number.isFinite(Number(input.maxAgeHours)) || input.maxAgeHours < 1 || input.maxAgeHours > 168) throw new Error('History retention must be between 1 and 168 hours.');
          policy.maxAgeHours = Number(input.maxAgeHours);
        }
        await storage.set(CONFIG_KEY, policy);
        await storage.set(EVENTS_KEY, await loadEvents(policy));
        privateEvents = trim(privateEvents, policy);
        if (!policy.enabled) pending.clear();
        return policy;
      });
    },
    async status() { const policy = await config(); return { ...policy, eventCount: (await loadEvents(policy)).length + privateEvents.length, snapshotCount: sessionSnapshots.size, snapshotsPersisted: false,
      observation: 'Timestamps are when Cookiebase observed an event, not cookie creation times.',
      networkDiagnosis: 'Set-Cookie rejection reasons and OAuth causality are not observable through the cookies API. No network headers are recorded.' }; },
    record(changeInfo, { incognito = false, observedAt: observedTimestamp } = {}) {
      return serial(async () => {
        const policy = await config();
        if (!policy.enabled || !changeInfo?.cookie) return { recorded: false };
        const cookie = { ...changeInfo.cookie, incognito };
        if (!inScope(cookie, policy.recordingScope)) return { recorded: false, reason: 'outside-recording-scope' };
        const observedAt = Number.isFinite(observedTimestamp) ? observedTimestamp : Date.now();
        const id = cookieId(cookie);
        const contextKey = `${incognito ? 'private' : 'regular'}:${id}`;
        const events = incognito ? trim(privateEvents, policy) : await loadEvents(policy);
        const item = { id: crypto.randomUUID(), cookieId: id, cookie: safeMetadata(cookie), observedAt,
          cause: String(changeInfo.cause ?? 'not_provided'), removed: Boolean(changeInfo.removed),
          kind: changeInfo.removed ? (changeInfo.cause === 'overwrite' ? 'overwrite-pending' : 'remove') : 'add',
          incognito, value: undefined };
        // No values or hashes are persisted. The digest exists only in this worker's memory.
        delete item.value;
        const valueDigest = await digest(cookie.value);
        if (changeInfo.removed && changeInfo.cause === 'overwrite') {
          pending.set(contextKey, { eventId: item.id, observedAt, cookie: item.cookie, valueDigest });
          events.push(item);
        } else if (!changeInfo.removed) {
          const previous = pending.get(contextKey);
          // Persisted redacted pending pairs can still be correlated after a worker restart.
          const priorIndex = events.findLastIndex(event => event.cookieId === id && event.incognito === incognito && event.kind === 'overwrite-pending' && observedAt - event.observedAt <= 2000);
          if (priorIndex >= 0) {
            const old = events[priorIndex];
            events[priorIndex] = { ...item, id: old.id, kind: 'overwrite', cause: 'overwrite', observedAt: old.observedAt,
              completedAt: observedAt, changedAttributes: changes(old.cookie, item.cookie),
              valueChanged: previous?.eventId === old.id ? previous.valueDigest !== valueDigest : null };
          } else events.push(item);
          pending.delete(contextKey);
        } else {
          pending.delete(contextKey);
          events.push(item);
        }
        for (const [pendingKey, value] of pending) if (observedAt - value.observedAt > 2000) pending.delete(pendingKey);
        while (pending.size > policy.maxEntries) pending.delete(pending.keys().next().value);
        const kept = trim(events, policy);
        if (incognito) privateEvents = kept;
        else await storage.set(EVENTS_KEY, kept);
        return { recorded: true, count: kept.length, persisted: !incognito };
      });
    },
    list(filters = {}) {
      return serial(async () => {
        const policy = await config();
        const events = filters.incognito ? trim(privateEvents, policy) : await loadEvents(policy);
        if (!filters.incognito) await storage.set(EVENTS_KEY, events);
        return events.filter(event => {
          if (filters.scope && !inScope(event.cookie, filters.scope)) return false;
          if (filters.domain && !event.cookie.domain.toLowerCase().includes(String(filters.domain).toLowerCase())) return false;
          if (filters.name && !event.cookie.name.toLowerCase().includes(String(filters.name).toLowerCase())) return false;
          if (filters.storeId && event.cookie.storeId !== filters.storeId) return false;
          return true;
        }).reverse();
      });
    },
    clear({ incognito = false } = {}) {
      return serial(async () => {
        if (incognito) privateEvents = [];
        else await storage.delete(EVENTS_KEY);
        pending.clear();
        return { cleared: true };
      });
    },
    capture({ name = 'Snapshot', scope, cookies }) {
      return serial(async () => {
        if (!scope || !Array.isArray(cookies)) throw new Error('Choose a scope and cookies for the debug snapshot.');
        if (cookies.length > 20_000) throw new Error('Debug snapshots support up to 20,000 cookies. Narrow the scope.');
        const scoped = cookies.filter(cookie => inScope(cookie, scope));
        const redacted = await Promise.all(scoped.map(async cookie => ({ ...safeMetadata(cookie), valueDigest: await digest(cookie.value) })));
        const snapshot = { id: crypto.randomUUID(), name: String(name).slice(0, 120), scope: structuredClone(scope), observedAt: Date.now(), cookies: redacted };
        sessionSnapshots.set(snapshot.id, snapshot);
        while (sessionSnapshots.size > 20) sessionSnapshots.delete(sessionSnapshots.keys().next().value);
        return { id: snapshot.id, name: snapshot.name, scope: snapshot.scope, observedAt: snapshot.observedAt, cookieCount: redacted.length,
          warning: 'Debug snapshots are redacted and memory-only. They disappear on worker restart and cannot restore cookies.' };
      });
    },
    compare(beforeId, afterId) {
      return serial(async () => {
        const before = sessionSnapshots.get(beforeId);
        const after = sessionSnapshots.get(afterId);
        if (!before || !after) throw new Error('Debug snapshot expired or the worker restarted. Capture two new snapshots in this session.');
        if (before.scope.storeId !== after.scope.storeId || Boolean(before.scope.incognito) !== Boolean(after.scope.incognito)) throw new Error('Debug snapshots from different cookie stores or privacy contexts cannot be compared.');
        return { beforeId, afterId, ...compare(before.cookies, after.cookies, cookie => cookie.valueDigest) };
      });
    },
    async snapshots() { return [...sessionSnapshots.values()].map(({ cookies, ...s }) => ({ ...s, cookieCount: cookies.length })); },
    async clearSnapshots() { sessionSnapshots.clear(); return { cleared: true }; },
  };
}
