import { cookieId, inScope, validateCookie } from '../core/cookies.js';

const MAX_PROFILES = 200;
const MAX_SNAPSHOTS = 50;
const MAX_COOKIES = 20_000;
const now = () => new Date().toISOString();
const metadata = cookie => ({ name: cookie.name, domain: cookie.domain, path: cookie.path, storeId: cookie.storeId,
  partitionKey: cookie.partitionKey });
function safeError(error) {
  // Repository errors are deliberately sanitized; never interpolate arbitrary cookie values here.
  return typeof error?.message === 'string' ? error.message : 'The browser could not verify this cookie operation.';
}
function assertScope(scope) {
  if (!scope || typeof scope !== 'object' || !['all', 'url', 'host', 'site', 'domains'].includes(scope.type)) throw new Error('Choose an explicit cookie scope.');
  if (scope.incognito) throw new Error('Persistent incognito profiles and backups are disabled. Use the separate incognito cookie workspace without persistent snapshots.');
  if (typeof scope.storeId !== 'string' || !scope.storeId) throw new Error('Choose an explicit regular cookie store for profiles and snapshots.');
}
function validateCookies(cookies, scope) {
  assertScope(scope);
  if (!Array.isArray(cookies) || cookies.length > MAX_COOKIES) throw new Error('A profile or snapshot supports up to 20,000 cookies.');
  const ids = new Set();
  for (const cookie of cookies) {
    if (cookie.incognito || cookie.storeId !== scope.storeId) throw new Error('Cookie store differs from the explicitly chosen regular profile store. Cross-store transfer is refused.');
    if (!inScope(cookie, scope)) throw new Error('A cookie is outside the chosen profile scope.');
    const errors = validateCookie(cookie);
    if (errors.length) throw new Error(`Invalid cookie in profile: ${errors.join('; ')}`);
    const id = cookieId(cookie);
    if (ids.has(id)) throw new Error('A profile cannot contain duplicate cookie identities.');
    ids.add(id);
  }
}
function text(value, label, max, required = false) {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) throw new Error(`${label} must be ${required ? 'non-empty and ' : ''}at most ${max} characters.`);
  return value.trim();
}
function cleanFields(input) {
  const tags = input.tags ?? [];
  if (!Array.isArray(tags) || tags.length > 30) throw new Error('Use at most 30 profile tags.');
  return { name: text(input.name, 'Profile name', 120, true), description: text(input.description ?? '', 'Description', 2000),
    tags: tags.map(tag => text(tag, 'Tag', 60, true)) };
}
function findProfile(data, id) {
  const profile = data.profiles.find(p => p.id === id);
  if (!profile) throw new Error('Profile no longer exists. Refresh the profile list.');
  return profile;
}
function modeCheck(mode) {
  if (!['merge', 'replace'].includes(mode)) throw new Error('Choose Merge or Replace within the chosen scope.');
}
function planning(profile, current, scope, mode) {
  assertScope(scope); modeCheck(mode);
  if (profile.scope.storeId !== scope.storeId) throw new Error('Profile belongs to a different store. Cross-store application is refused.');
  const target = profile.cookies.filter(cookie => inScope(cookie, scope));
  const existing = current.filter(cookie => inScope(cookie, scope) && inScope(cookie, profile.scope));
  const currentMap = new Map(existing.map(cookie => [cookieId(cookie), cookie]));
  const targetIds = new Set(target.map(cookieId));
  const removals = mode === 'replace' ? existing.filter(cookie => !targetIds.has(cookieId(cookie))) : [];
  return { target, existing, removals, overwrites: target.filter(cookie => currentMap.has(cookieId(cookie))),
    additions: target.filter(cookie => !currentMap.has(cookieId(cookie))) };
}

export function createProfileService({ vault, repository }) {
  async function profile(id) { return findProfile(await vault.read(), id); }
  async function current(scope) {
    assertScope(scope);
    const result = await repository.list({ scope });
    return result.cookies;
  }
  async function saveSnapshot({ name, scope, cookies, kind = 'manual' }) {
    validateCookies(cookies, scope);
    const snapshot = { id: crypto.randomUUID(), name: text(name, 'Snapshot name', 120, true), scope: structuredClone(scope),
      cookies: structuredClone(cookies), kind, createdAt: now() };
    await vault.update(data => { data.snapshots.push(snapshot); data.snapshots = data.snapshots.slice(-MAX_SNAPSHOTS); });
    return { id: snapshot.id, name: snapshot.name, scope: snapshot.scope, cookieCount: cookies.length, createdAt: snapshot.createdAt, kind };
  }
  async function execute(target, scope, { mode = 'merge', backup = true, rollbackOnFailure = true, expectedRemovalIds } = {}) {
    const before = await current(scope);
    const plan = planning(target, before, scope, mode);
    if (expectedRemovalIds && JSON.stringify([...expectedRemovalIds].sort()) !== JSON.stringify(plan.removals.map(cookieId).sort())) throw new Error('Cookie state changed since preview. Preview this profile again before applying.');
    const invalid = plan.target.map(cookie => ({ cookie, errors: validateCookie(cookie) })).filter(item => item.errors.length);
    if (invalid.length) return { processed: invalid.length, applied: 0, removed: 0, failed: invalid.length, results: invalid.map(({ cookie, errors }) => ({ ...metadata(cookie), action: 'set', status: 'failed', error: errors.join(' ') })), backupId: null, rollback: null, warning: 'Apply aborted before any changes because stored cookies are invalid or expired. Edit the profile or choose a valid state.' };
    let backupSnapshot = null;
    if (backup) backupSnapshot = await saveSnapshot({ name: `Before ${target.name}`.slice(0, 120), scope, cookies: before, kind: 'apply-backup' });
    const report = { processed: 0, applied: 0, removed: 0, failed: 0, results: [], backupId: backupSnapshot?.id ?? null,
      rollback: null, warning: 'Cookies were verified at application time. Websites may subsequently change them; server sessions, MFA and CSRF cannot be restored by Cookiebase.' };
    for (const cookie of plan.removals) {
      report.processed++;
      try { await repository.remove(cookie); report.removed++; report.results.push({ ...metadata(cookie), action: 'remove', status: 'verified' }); }
      catch (error) { report.failed++; report.results.push({ ...metadata(cookie), action: 'remove', status: 'failed', error: safeError(error) }); }
    }
    for (const cookie of plan.target) {
      report.processed++;
      try {
        await repository.set(cookie);
        if (repository.verify) {
          const checked = await repository.verify(cookie);
          if (checked === false || checked?.ok === false) throw new Error('Cookie was not present with the requested attributes after setting it.');
        }
        report.applied++;
        report.results.push({ ...metadata(cookie), action: 'set', status: 'verified' });
      } catch (error) { report.failed++; report.results.push({ ...metadata(cookie), action: 'set', status: 'failed', error: safeError(error) }); }
    }
    if (report.failed && rollbackOnFailure && backupSnapshot) {
      report.rollback = { attempted: true, restored: 0, removed: 0, failed: 0, results: [], atomic: false };
      // Remove only identities this apply introduced, then restore the original scoped snapshot.
      const beforeIds = new Set(before.map(cookieId));
      for (const cookie of plan.target.filter(c => !beforeIds.has(cookieId(c)))) {
        try { await repository.remove(cookie); report.rollback.removed++; }
        catch (error) { report.rollback.failed++; report.rollback.results.push({ ...metadata(cookie), action: 'remove', error: safeError(error) }); }
      }
      for (const cookie of before) {
        try { await repository.set(cookie); report.rollback.restored++; }
        catch (error) { report.rollback.failed++; report.rollback.results.push({ ...metadata(cookie), action: 'restore', error: safeError(error) }); }
      }
    }
    return report;
  }
  return {
    async list(query = '') {
      const data = await vault.read();
      const q = String(query).toLowerCase();
      return data.profiles.filter(p => `${p.name} ${p.description} ${p.tags.join(' ')} ${JSON.stringify(p.scope)}`.toLowerCase().includes(q))
        .map(({ cookies, ...item }) => ({ ...item, cookieCount: cookies.length }));
    },
    get: profile,
    async create(input) {
      const fields = cleanFields(input);
      validateCookies(input.cookies, input.scope);
      const item = { id: crypto.randomUUID(), ...fields, scope: structuredClone(input.scope), cookies: structuredClone(input.cookies), createdAt: now(), updatedAt: now() };
      await vault.update(data => { if (data.profiles.length >= MAX_PROFILES) throw new Error('Vault supports at most 200 profiles.'); data.profiles.push(item); });
      return { ...item, cookies: undefined, cookieCount: item.cookies.length };
    },
    async update(id, patch) {
      await vault.update(data => {
        const item = findProfile(data, id);
        const fields = cleanFields({ ...item, ...patch });
        const cookies = patch.cookies ?? item.cookies;
        const scope = patch.scope ?? item.scope;
        if (patch.cookies !== undefined || patch.scope !== undefined) validateCookies(cookies, scope);
        else assertScope(scope);
        Object.assign(item, fields, { cookies: structuredClone(cookies), scope: structuredClone(scope), updatedAt: now() });
      });
      return { id, updated: true };
    },
    async duplicate(id, name) {
      const original = await profile(id);
      const fields = cleanFields({ ...original, name: name ?? `${original.name.slice(0, 110)} copy` });
      // Expiration can elapse after capture. Duplicating stored data still works;
      // applying an expired cookie is separately rejected by the verified repository.
      const item = { ...original, ...fields, id: crypto.randomUUID(), createdAt: now(), updatedAt: now() };
      await vault.update(data => { if (data.profiles.length >= MAX_PROFILES) throw new Error('Vault supports at most 200 profiles.'); data.profiles.push(item); });
      return { ...item, cookies: undefined, cookieCount: item.cookies.length };
    },
    async remove(id) {
      return vault.update(data => { findProfile(data, id); data.profiles = data.profiles.filter(p => p.id !== id); return { removed: true }; });
    },
    async preview(id, { scope, mode = 'merge' }) {
      const item = await profile(id);
      const plan = planning(item, await current(scope), scope, mode);
      return { profileId: id, name: item.name, scope, profileScope: item.scope, mode, invalidCookies: plan.target.flatMap(cookie => { const errors = validateCookie(cookie); return errors.length ? [{ ...metadata(cookie), error: errors.join(' ') }] : []; }), additions: plan.additions.length, overwrites: plan.overwrites.length,
        removals: plan.removals.length, excluded: item.cookies.length - plan.target.length,
        sessionCookies: plan.target.filter(c => c.session).length,
        cookies: plan.target.map(metadata), removeCookies: plan.removals.map(metadata),
        warning: 'Apply changes browser cookies in this explicit scope. Sessions may already be invalid; this is not an automatic login.' };
    },
    async apply(id, options) { return execute(await profile(id), options.scope, options); },
    async exportProfile(id) { return { format: 'cookiebase-profile', version: 1, exportedAt: now(), profile: await profile(id), warning: 'Unencrypted session secrets. Share only with trusted recipients.' }; },
    async importProfile(input) {
      if (input?.format !== 'cookiebase-profile' || input.version !== 1 || !input.profile) throw new Error('Unsupported Cookiebase profile file.');
      return this.create(input.profile);
    },
    saveSnapshot,
    async getSnapshot(id) {
      const item = (await vault.read()).snapshots.find(s => s.id === id);
      if (!item) throw new Error('Snapshot no longer exists.');
      return item;
    },
    async listSnapshots() {
      return (await vault.read()).snapshots.map(({ cookies, ...s }) => ({ ...s, cookieCount: cookies.length }));
    },
    async restoreSnapshot(id, options = {}) {
      const snapshot = await this.getSnapshot(id);
      return execute({ ...snapshot, name: snapshot.name }, snapshot.scope, { mode: options.mode ?? 'merge', backup: false, rollbackOnFailure: false });
    },
    async deleteSnapshot(id) { await vault.update(data => { data.snapshots = data.snapshots.filter(s => s.id !== id); }); return { removed: true }; },
  };
}
