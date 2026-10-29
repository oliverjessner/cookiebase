import { createStorage } from './storage.js';
import { createRepository } from './core/repository.js';
import { cookieId } from './core/cookies.js';
import { deletePreview, validateRule } from './core/rules.js';
import { parseImport, previewImport, executeImport } from './services/transfer.js';
import { createVault } from './services/vault.js';
import { createProfileService } from './services/profiles.js';
import { createHistoryService } from './services/history.js';

const incognito = Boolean(chrome.extension.inIncognitoContext);
const privateRecords = new Map();
const storage = incognito ? { get: async key => structuredClone(privateRecords.get(key)), set: async (key, value) => { privateRecords.set(key, structuredClone(value)); }, delete: async key => { privateRecords.delete(key); }, clear: async () => { privateRecords.clear(); } } : createStorage();
const repository = createRepository(chrome);
const vault = createVault(storage);
const profiles = createProfileService({ vault, repository });
const history = createHistoryService(storage);
let queue = Promise.resolve();
let initialized;
const metadataKey = incognito ? 'metadataIncognito' : 'metadata';
async function metadata() {
  const saved = incognito ? await storage.get(metadataKey) : (await chrome.storage.local.get(metadataKey))[metadataKey];
  if (saved && saved.version !== 1) throw new Error('Unsupported settings version. Export data before resetting Cookiebase.');
  return saved || { version: 1, rules: [], onboarding: false };
}
async function saveMetadata(next) { if (incognito) await storage.set(metadataKey, next); else await chrome.storage.local.set({ [metadataKey]: next }); }
async function initialize() {
  if (!initialized) initialized = (async () => {
    const jobs = await storage.get('jobs') || [];
    for (const job of jobs) if (job.status === 'running') { job.status = 'interrupted'; job.message = 'Worker stopped before final verification. Inspect current cookies and restore an encrypted snapshot if needed. Nothing is automatically replayed.'; }
    await storage.set('jobs', jobs);
    await metadata();
    await history.configure({});
  })();
  return initialized;
}
function scoped(scope) { return { ...scope, incognito }; }
async function list(scope, tabId) {
  const result = await repository.list({ scope: scoped(scope), tabId });
  const events = await history.list({ incognito });
  const observed = new Map();
  for (const event of events) if (!observed.has(event.cookieId || event.identity)) observed.set(event.cookieId || event.identity, event.observedAt || event.timestamp);
  result.cookies = result.cookies.map(cookie => ({ ...cookie, observedAt: observed.get(cookieId(cookie)) }));
  return result;
}
async function requireSnapshot(name, scope, cookies, kind) {
  if (incognito) throw new Error('Persistent snapshots are disabled in incognito. Use individual explicit operations without a persistent backup.');
  return profiles.saveSnapshot({ name, scope: scoped(scope), cookies, kind });
}
async function handle({ type, payload: p = {} }) {
  switch (type) {
    case 'status': return { vault: await vault.status(), history: await history.status(), metadata: await metadata(), incognito, jobs: await storage.get('jobs') || [] };
    case 'list': return list(p.scope, p.tabId);
    case 'set': {
      if (p.original && cookieId(p.original) !== cookieId(p.cookie)) throw new Error('Changing cookie identity requires Create followed by an explicit deletion of the original.');
      return repository.set(p.cookie);
    }
    case 'delete.preview': {
      const current = await list(p.scope, p.tabId);
      const candidates = current.cookies.filter(c => !p.ids || p.ids.includes(cookieId(c)));
      return deletePreview(candidates, (await metadata()).rules, { ...p.options, scope: scoped(p.scope) });
    }
    case 'delete': {
      const current = await list(p.scope, p.tabId);
      const candidates = current.cookies.filter(c => p.ids.includes(cookieId(c)));
      const preview = deletePreview(candidates, (await metadata()).rules, { ...p.options, scope: scoped(p.scope) });
      let snapshot;
      if (preview.remove.length && !incognito && p.backup !== false) snapshot = await requireSnapshot('Before deletion', p.scope, preview.remove, 'undo');
      const results = [];
      for (const c of preview.remove) {
        try { await repository.remove(c); results.push({ name: c.name, domain: c.domain, status: 'removed' }); }
        catch (error) { results.push({ name: c.name, domain: c.domain, status: 'failed', error: error.message }); }
      }
      return { removed: results.filter(r => r.status === 'removed').length, preserved: preview.preserved.length, failed: results.filter(r => r.status === 'failed').length, results, snapshot };
    }
    case 'disable': {
      const c = await repository.get(p.cookie);
      if (!c) throw new Error('Cookie no longer exists. Refresh the list.');
      const snapshot = await requireSnapshot(`Disabled: ${c.name}`, p.scope, [c], 'disabled');
      await repository.remove(c); return { snapshot, removed: true };
    }
    case 'rules.save': {
      const m = await metadata();
      const r = { ...p.rule, name: p.rule?.name ?? '*', path: p.rule?.path ?? '*' };
      const errors = validateRule(r);
      if (errors.length) throw new Error(errors.join(' '));
      const rule = { ...r, id: r.id || crypto.randomUUID(), incognito };
      m.rules = [...m.rules.filter(x => x.id !== rule.id), rule]; await saveMetadata(m); return m.rules;
    }
    case 'rules.remove': { const m = await metadata(); m.rules = m.rules.filter(r => r.id !== p.id); await saveMetadata(m); return m.rules; }
    case 'onboard': { const m = await metadata(); m.onboarding = true; await saveMetadata(m); return true; }
    case 'vault.initialize': if (incognito) throw new Error('Persistent vaults are disabled in incognito. Open Cookiebase in a regular window.'); await vault.initialize(p.passphrase); return vault.status();
    case 'vault.unlock': if (incognito) throw new Error('Persistent vaults are disabled in incognito. Open Cookiebase in a regular window.'); await vault.unlock(p.passphrase); return vault.status();
    case 'vault.lock': await vault.lock(); return vault.status();
    case 'profiles.list': return profiles.list(p.query);
    case 'profiles.create': return profiles.create({ ...p.profile, scope: scoped(p.scope), cookies: p.cookies });
    case 'profiles.update': return profiles.update(p.id, p.patch);
    case 'profiles.duplicate': return profiles.duplicate(p.id);
    case 'profiles.remove': return profiles.remove(p.id);
    case 'profiles.preview': return profiles.preview(p.id, { ...p.options, scope: scoped(p.scope) });
    case 'profiles.apply': return profiles.apply(p.id, { ...p.options, scope: scoped(p.scope) });
    case 'profiles.export': return profiles.exportProfile(p.id);
    case 'profiles.import': return profiles.importProfile(p.data);
    case 'snapshots.list': return profiles.listSnapshots();
    case 'snapshots.restore': return profiles.restoreSnapshot(p.id, { mode: 'merge' });
    case 'snapshots.delete': return profiles.deleteSnapshot(p.id);
    case 'import.preview': {
      const parsed = parseImport(p.text, p.options);
      return previewImport(parsed, (await list(p.scope)).cookies, { ...p.options, scope: scoped(p.scope) });
    }
    case 'import.execute': {
      const parsed = parseImport(p.text, p.options);
      const plan = previewImport(parsed, (await list(p.scope)).cookies, { ...p.options, scope: scoped(p.scope) });
      return executeImport(plan, { repository, snapshot: p.backup || plan.mode === 'replace' ? cookies => requireSnapshot('Before import', p.scope, cookies, 'import') : undefined });
    }
    case 'history.configure': return history.configure(p);
    case 'history.list': return history.list({ ...p, incognito });
    case 'history.capture': return history.capture({ name: p.name, scope: scoped(p.scope), cookies: (await list(p.scope, p.tabId)).cookies });
    case 'history.snapshots': return history.snapshots();
    case 'history.compare': return history.compare(p.before, p.after);
    case 'history.clear': await history.clear({ incognito }); await history.clearSnapshots(); return true;
    case 'data.clear': {
      if (p.area === 'rules') { const m = await metadata(); m.rules = []; await saveMetadata(m); }
      else if (p.area === 'history') { await history.configure({ enabled: false }); await history.clear({ incognito }); await history.clearSnapshots(); }
      else if (p.area === 'vault') await vault.reset();
      else if (p.area === 'all') { await vault.lock(); await history.clear({ incognito }); await history.clearSnapshots(); await storage.clear(); await chrome.storage.local.remove(metadataKey); initialized = undefined; }
      else throw new Error('Choose rules, history, vault, or all Cookiebase data.');
      return true;
    }
    default: throw new Error('Unsupported Cookiebase command. Reload the extension and retry.');
  }
}
const readOnly = new Set(['status', 'list', 'delete.preview', 'profiles.list', 'profiles.preview', 'profiles.export', 'snapshots.list', 'import.preview', 'history.list', 'history.snapshots', 'history.compare']);
async function dispatch(message) {
  await initialize();
  if (readOnly.has(message.type) || message.type.startsWith('vault.') || (message.type === 'data.clear' && message.payload?.area === 'all')) return handle(message);
  const jobs = await storage.get('jobs') || [];
  if (message.requestId && jobs.some(j => j.id === message.requestId)) throw new Error('This operation was already submitted. Refresh cookies and check its recovery status before trying again.');
  const job = { id: message.requestId || crypto.randomUUID(), type: message.type, status: 'running', startedAt: Date.now() };
  jobs.unshift(job); await storage.set('jobs', jobs.slice(0, 30));
  try { const result = await handle(message); job.status = 'completed'; job.completedAt = Date.now(); await storage.set('jobs', jobs.slice(0, 30)); return result; }
  catch (error) { job.status = 'failed'; job.completedAt = Date.now(); job.message = 'Operation failed. Inspect the per-cookie report or retry after checking current state.'; await storage.set('jobs', jobs.slice(0, 30)); throw error; }
}
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || !sender.url?.startsWith(chrome.runtime.getURL('')) || typeof message?.type !== 'string') return false;
  queue = queue.catch(() => {}).then(() => dispatch(message));
  queue.then(result => sendResponse({ ok: true, result }), error => sendResponse({ ok: false, error: error.message || 'Browser operation failed. Check host permission, store and browser policy.' }));
  return true;
});
chrome.cookies.onChanged.addListener(change => {
  const observedAt = Date.now();
  // Values are handed only to the redacting history service; never logged or journaled.
  queue = queue.catch(() => {}).then(async () => { await initialize(); const store = (await repository.stores()).find(s => s.id === change.cookie.storeId); if (store?.contextKnown && store.incognito === incognito) await history.record(change, { incognito, observedAt }); }).catch(() => {});
});
chrome.runtime.onInstalled.addListener(() => { initialize().catch(() => {}); });
