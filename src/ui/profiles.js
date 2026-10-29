import { initOJ, confirmDialog } from 'oj-designsystem';
import { cookieId, inScope, scopeLabel } from '../core/cookies.js';
import { parseImport } from '../services/transfer.js';
import { h, button, field, select, check, panel, accordion, modal, formError, empty, report } from './components.js';

const help = message => h('p', { class: 'oj-helper' }, message);
const clone = value => structuredClone(value);
const date = value => value ? new Date(value).toLocaleString() : 'Not yet restored';
const sourceName = source => ({ scope: 'All cookies in this scope', filtered: 'Filtered results', selected: 'Selected cookies' }[source] || 'Imported cookies');
function metadataRows(cookies) {
  const region = h('div', { class: 'oj-stack' });
  const tableRegion = h('div', { class: 'oj-table-container', role: 'region', 'aria-label': 'Affected cookies', tabindex: '0' });
  const pages = h('nav', { class: 'oj-pagination', 'aria-label': 'Affected-cookie pages' });
  let page = 0;
  const draw = () => {
    const total = Math.max(1, Math.ceil(cookies.length / 50)); page = Math.min(page, total - 1);
    tableRegion.replaceChildren(h('table', { class: 'oj-table oj-table-compact' }, h('caption', {}, `${cookies.length} affected cookies · values remain masked`),
      h('thead', {}, h('tr', {}, ...['Cookie', 'Site', 'Path', 'Change'].map(label => h('th', { scope: 'col' }, label)))),
      h('tbody', {}, ...cookies.slice(page * 50, page * 50 + 50).map(cookie => h('tr', {}, h('td', { class: 'oj-mono' }, cookie.name || '(empty name)'), h('td', {}, cookie.domain), h('td', { class: 'oj-mono' }, cookie.path || '/'), h('td', {}, cookie.action || 'Set'))))));
    pages.replaceChildren(button('Previous changes', () => { page--; draw(); }, 'ghost', { disabled: page === 0 }), help(`Page ${page + 1} / ${total}`), button('Next changes', () => { page++; draw(); }, 'ghost', { disabled: page + 1 === total }));
    pages.hidden = cookies.length <= 50;
  };
  region.append(tableRegion, pages); draw(); return region;
}

function previewSummary(preview) {
  return h('div', { class: 'oj-stack' },
    h('dl', { class: 'oj-key-value' }, ...[['Scope', scopeLabel(preview.scope)], ['Saved scope boundary', scopeLabel(preview.profileScope || preview.scope)], ['Add', preview.additions], ['Overwrite', preview.overwrites], ['Remove', preview.removals]].map(([key, value]) => h('div', {}, h('dt', {}, key), h('dd', {}, value)))),
    preview.excluded ? help(`${preview.excluded} saved cookies are outside the chosen scope and will not be applied.`) : null,
    preview.sessionCookies ? help(`${preview.sessionCookies} session cookies. Restoring cookies cannot revive invalid server sessions, MFA or CSRF state.`) : null,
    preview.invalidCookies?.length ? h('div', { class: 'oj-alert oj-alert-danger', role: 'alert' }, h('strong', {}, `${preview.invalidCookies.length} invalid or expired saved cookies`), ...preview.invalidCookies.map(cookie => help(`${cookie.name} · ${cookie.domain}: ${cookie.error}`))) : null);
}
function sourceChoice(ctx, id, chosen = 'scope', captured) {
  return select('Cookie source', id, ['scope', 'filtered', 'selected'].map(source => [source, `${sourceName(source)} (${(captured?.[source] || ctx.data(source)).length})`]), chosen);
}
function captureSources(ctx) { return Object.fromEntries(['scope', 'filtered', 'selected'].map(source => [source, clone(ctx.data(source))])); }
function download(text, name) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const link = h('a', { href: url, download: name }); document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
async function refreshAfter(ctx) { await ctx.refresh({ render: false }); await ctx.render(); }

/** Explicit scope/filtered/selected source; filters never silently narrow scope. */
export async function openSaveProfile(ctx, { source = 'scope', cookies, scope: suppliedScope, profile = null } = {}) {
  if (!await ctx.ensureVault()) return;
  const savedScope = clone(profile?.scope || suppliedScope || ctx.scope());
  const imported = cookies !== undefined;
  const captured = !profile && !imported ? captureSources(ctx) : null;
  const view = modal(profile ? 'Edit profile details' : 'Save session profile', { id: 'profile-dialog' });
  const form = h('form', { class: 'oj-stack', id: 'profile-form' });
  const name = field('Profile name', 'profile-name', profile?.name || '', 'text', { required: true, maxlength: '120', autofocus: true });
  const description = field('Description', 'profile-description', profile?.description || '', 'text', { maxlength: '2000' });
  const tags = field('Tags (comma separated)', 'profile-tags', profile?.tags.join(', ') || '');
  const choice = !profile && !imported ? sourceChoice(ctx, 'profile-source', source, captured) : null;
  const summary = h('div', { class: 'oj-inline-message', 'aria-live': 'polite', id: 'profile-source-summary' });
  const records = () => profile ? [] : imported ? cookies : captured[choice.input.value];
  const draw = () => {
    const count = profile?.cookieCount ?? records().length;
    summary.textContent = `${profile ? 'Saved profile' : imported ? 'Imported file' : sourceName(choice.input.value)} · ${count} cookies · ${scopeLabel(savedScope)}`;
  };
  if (choice) { form.append(choice.node); choice.input.addEventListener('change', draw); }
  form.append(summary, name.node, description.node, tags.node, help(profile ? 'These fields change profile details only. Use “Update from current cookies” to replace its saved cookie state.' : 'Only the stated source is saved. Profile names, metadata and cookie values are encrypted locally. An empty profile can be used as an explicit logged-out state.'));
  const save = h('button', { type: 'submit', class: 'oj-button oj-button-primary', id: 'profile-save' }, 'Save profile');
  form.append(h('div', { class: 'oj-cluster' }, save, button('Cancel', () => view.close())));
  form.addEventListener('submit', async event => {
    event.preventDefault(); if (save.disabled) return;
    name.setError?.('');
    if (!name.input.value.trim()) { name.setError?.('Give this profile a name.'); name.input.focus(); return; }
    const fields = { name: name.input.value.trim(), description: description.input.value, tags: tags.input.value.split(',').map(tag => tag.trim()).filter(Boolean) };
    save.disabled = true; save.setAttribute('aria-busy', 'true'); save.textContent = 'Encrypting profile…';
    try {
      if (profile) await ctx.rpc('profiles.update', { id: profile.id, patch: fields });
      else await ctx.rpc('profiles.create', { profile: fields, cookies: records(), scope: savedScope });
      view.close(); await ctx.refreshStatus(); await ctx.navigate('profiles'); ctx.notify('Profile encrypted and saved.');
    } catch (error) { formError(form, error); }
    finally { save.disabled = false; save.removeAttribute('aria-busy'); save.textContent = 'Save profile'; }
  });
  draw(); view.body.append(form); view.open();
}

/** One consistent Apply entry. Replace and protection changes are explicit. */
export async function openApplyProfile(ctx, profile) {
  if (!await ctx.ensureVault()) return;
  const targetScope = clone(ctx.scope());
  const view = modal(`Apply ${profile.name}`, { id: 'apply-profile-dialog' });
  const mode = select('Apply strategy', 'profile-mode', [['merge', 'Add and overwrite matching cookies'], ['replace', 'Replace the saved site state']], 'merge');
  const backup = check('Save an encrypted backup and attempt rollback if application fails', true, { id: 'profile-backup' });
  const protectedConsent = check('Allow the protected-cookie changes shown below', false, { id: 'profile-protection-override' });
  const protection = h('div', { hidden: true, class: 'oj-alert oj-alert-warning', id: 'profile-protection-warning' });
  const previewBody = h('div', { class: 'oj-stack', id: 'profile-preview', 'aria-live': 'polite' });
  const status = h('p', { class: 'oj-inline-message', role: 'status', id: 'profile-preview-state' }, 'Loading preview…');
  let preview = null; let version = 0; let closed = false; let busy = false;
  const apply = h('button', { type: 'button', class: 'oj-button oj-button-primary', id: 'profile-apply', disabled: true }, 'Apply and verify');
  apply.addEventListener('click', async () => {
    if (busy || apply.disabled || !preview) return;
    if (preview.protectedChanges?.length && !protectedConsent.input.checked) { formError(view.body, new Error('Review and allow the protected-cookie changes before applying.')); return; }
    busy = true; mode.input.disabled = true; backup.input.disabled = true; protectedConsent.input.disabled = true; previewButton.disabled = true;
    apply.disabled = true; apply.setAttribute('aria-busy', 'true'); apply.textContent = 'Applying and verifying…';
    try {
      const result = await ctx.rpc('profiles.apply', { id: profile.id, scope: targetScope, options: {
        mode: mode.input.value, backup: backup.input.checked, rollbackOnFailure: backup.input.checked,
        expectedRemovalIds: preview.removeCookies.map(cookieId), overrideProtection: protectedConsent.input.checked,
      } });
      view.close(); await refreshAfter(ctx); report('Profile apply results', result);
    } catch (error) { preview = null; status.textContent = 'Preview out of date or application blocked. Update the preview before trying again.'; formError(view.body, error); }
    finally { busy = false; mode.input.disabled = false; backup.input.disabled = false; protectedConsent.input.disabled = false; previewButton.disabled = false; apply.removeAttribute('aria-busy'); apply.textContent = 'Apply and verify'; setEnabled(); }
  });
  const setEnabled = () => { apply.disabled = busy || !preview || !(preview.additions + preview.overwrites + preview.removals) || Boolean(preview.invalidCookies?.length) || Boolean(preview.protectedChanges?.length && !protectedConsent.input.checked); };
  const inspect = async () => {
    if (busy) return;
    const request = ++version; preview = null; protectedConsent.input.checked = false; setEnabled();
    status.textContent = 'Loading preview…'; previewBody.replaceChildren(h('span', { class: 'oj-spinner', 'aria-label': 'Loading preview' })); protection.hidden = true;
    try {
      const result = await ctx.rpc('profiles.preview', { id: profile.id, scope: targetScope, options: { mode: mode.input.value } });
      if (request !== version || closed) return;
      preview = result; previewBody.replaceChildren(previewSummary(result));
      status.textContent = result.invalidCookies?.length ? 'Blocked: fix invalid or expired saved cookies first.' : !(result.additions + result.overwrites + result.removals) ? (result.excluded ? 'No saved cookies match the chosen scope. Choose the saved site before applying.' : 'No changes needed for this saved state.') : 'Preview ready. Review the changes before applying.';
      if (result.protectedChanges?.length) {
        protection.hidden = false;
        protection.replaceChildren(h('strong', {}, `${result.protectedChanges.length} protected cookies will change`), help('Explicit profile state changes can overwrite or remove protected cookies. Cleanup protection does not silently authorize this.'), metadataRows(result.protectedChanges), protectedConsent.node);
      }
      setEnabled();
    } catch (error) { if (request === version && !closed) { status.textContent = 'Preview unavailable.'; previewBody.replaceChildren(); formError(view.body, error); } }
  };
  mode.input.addEventListener('change', inspect); protectedConsent.input.addEventListener('change', setEnabled);
  view.element.addEventListener('close', () => { closed = true; version++; }, { once: true });
  view.body.append(help('Application is limited to the intersection of the saved profile scope and the chosen manager scope. Websites may invalidate restored sessions.'), mode.node, backup.node, status, previewBody, protection);
  const previewButton = button('Update preview', inspect);
  view.footer.append(previewButton, apply, button('Cancel', () => view.close()));
  view.open(); await inspect();
}

async function updateProfileCookies(ctx, profile) {
  if (!await ctx.ensureVault()) return;
  const view = modal(`Update ${profile.name} from current cookies`, { id: 'update-profile-dialog' });
  const scope = clone(ctx.scope()); const captured = captureSources(ctx); const choice = sourceChoice(ctx, 'profile-update-source', 'scope', captured);
  const output = h('div', { class: 'oj-stack', id: 'profile-update-preview' });
  let compared = null; let generation = 0; let closed = false;
  const save = button('Update saved cookie state', async () => {
    if (!compared) return;
    try {
      await ctx.rpc('profiles.update', { id: profile.id, patch: { scope, cookies: compared.cookies } });
      view.close(); await refreshAfter(ctx); ctx.notify('Saved profile cookie state updated. Browser cookies were not changed.');
    } catch (error) { formError(view.body, error); }
  }, 'primary', { disabled: true, id: 'profile-update-save' });
  const preview = async () => {
    const request = ++generation; compared = null; save.disabled = true; output.replaceChildren(help('Comparing saved and current cookies…'));
    const cookies = clone(captured[choice.input.value]);
    try {
      const result = await ctx.rpc('profiles.previewUpdate', { id: profile.id, scope, cookies });
      if (request !== generation || closed) return;
      compared = { cookies }; output.replaceChildren(h('dl', { class: 'oj-key-value' }, ...[['Source', sourceName(choice.input.value)], ['Previous scope', scopeLabel(result.previousScope)], ['New scope', scopeLabel(scope)], ['Previously saved', result.previousCount], ['Will be saved', result.nextCount], ['Added', result.added.length], ['Removed', result.removed.length], ['Changed', result.changed.length]].map(([label, value]) => h('div', {}, h('dt', {}, label), h('dd', {}, value)))), help('Updating changes this encrypted profile only. Browser cookies are not applied.'), accordion('Review saved-cookie changes', metadataRows([...result.added.map(cookie => ({ ...cookie, action: 'Add to profile' })), ...result.removed.map(cookie => ({ ...cookie, action: 'Remove from profile' })), ...result.changed.map(change => ({ ...change.cookie, action: `Change ${[...change.attributes, ...(change.valueChanged ? ['value (masked)'] : [])].join(', ')}` }))])));
      save.disabled = false;
    } catch (error) { output.replaceChildren(); formError(view.body, error); }
  };
  choice.input.addEventListener('change', preview); view.element.addEventListener('close', () => { closed = true; generation++; }, { once: true });
  view.body.append(choice.node, output); view.footer.append(save, button('Cancel', () => view.close())); view.open(); await preview();
}

/** Partial snapshots can restore saved cookies, never silently replace a site. */
export async function openRestoreSnapshot(ctx, snapshotOrId, { mode: requestedMode = 'merge' } = {}) {
  if (!await ctx.ensureVault()) return;
  const snapshot = typeof snapshotOrId === 'string' ? (await ctx.rpc('snapshots.list')).find(item => item.id === snapshotOrId) : snapshotOrId;
  if (!snapshot) throw new Error('This restore snapshot no longer exists. Refresh the list.');
  const view = modal(snapshot.kind === 'disabled' ? 'Enable saved cookie' : 'Restore snapshot', { id: 'restore-snapshot-dialog' });
  const modes = [['merge', 'Restore saved cookies (keep other cookies)']];
  if (snapshot.completeScope) modes.push(['replace', 'Restore previous site state (remove later cookies)']);
  const mode = select('Restore strategy', 'snapshot-mode', modes, requestedMode === 'replace' && snapshot.completeScope ? 'replace' : 'merge');
  const output = h('div', { class: 'oj-stack', id: 'snapshot-preview', 'aria-live': 'polite' });
  const allow = check('Allow the protected-cookie changes listed in this preview', false, { id: 'snapshot-protection-override' });
  const warning = h('div', { class: 'oj-alert oj-alert-warning', hidden: true });
  let preview = null; let generation = 0; let closed = false; let busy = false;
  const restore = h('button', { type: 'button', class: 'oj-button oj-button-primary', id: 'snapshot-restore', disabled: true }, snapshot.kind === 'disabled' ? 'Enable and verify' : 'Restore and verify');
  restore.addEventListener('click', async () => {
    if (busy || restore.disabled) return;
    busy = true; mode.input.disabled = true; allow.input.disabled = true; previewButton.disabled = true;
    restore.disabled = true; restore.setAttribute('aria-busy', 'true');
    if (!preview) { busy = false; mode.input.disabled = false; allow.input.disabled = false; previewButton.disabled = false; restore.disabled = true; restore.removeAttribute('aria-busy'); return; }
    try {
      const result = await ctx.rpc('snapshots.restore', { id: snapshot.id, options: { mode: mode.input.value, expectedRemovalIds: preview.removeCookies.map(cookieId), overrideProtection: allow.input.checked } });
      view.close(); await refreshAfter(ctx); report('Restore results', result);
    } catch (error) { preview = null; formError(view.body, error); }
    finally { busy = false; mode.input.disabled = false; allow.input.disabled = false; previewButton.disabled = false; restore.removeAttribute('aria-busy'); enable(); }
  });
  const enable = () => { restore.disabled = busy || !preview || !(preview.additions + preview.overwrites + preview.removals) || Boolean(preview.invalidCookies?.length) || Boolean(preview.protectedChanges?.length && !allow.input.checked); };
  const inspect = async () => {
    if (busy) return;
    const request = ++generation; preview = null; allow.input.checked = false; enable(); warning.hidden = true;
    output.replaceChildren(help('Loading restore preview…'));
    try {
      const result = await ctx.rpc('snapshots.preview', { id: snapshot.id, options: { mode: mode.input.value } });
      if (request !== generation || closed) return;
      preview = result; output.replaceChildren(previewSummary(result));
      if (result.protectedChanges?.length) { warning.hidden = false; warning.replaceChildren(h('strong', {}, `${result.protectedChanges.length} protected cookies will change`), metadataRows(result.protectedChanges), allow.node); }
      enable();
    } catch (error) { output.replaceChildren(); formError(view.body, error); }
  };
  mode.input.addEventListener('change', inspect); allow.input.addEventListener('change', enable);
  view.element.addEventListener('close', () => { closed = true; generation++; }, { once: true });
  view.body.append(help(`${snapshot.name} · saved ${date(snapshot.createdAt)}. Restore is best effort; expired cookies, revoked permissions or invalid server sessions can prevent recovery.`), mode.node,
    !snapshot.completeScope ? help('This is a partial snapshot. It restores the saved cookies; it does not reset the entire site.') : null, output, warning);
  const previewButton = button('Update preview', inspect);
  view.footer.append(previewButton, restore, button('Cancel', () => view.close())); view.open(); await inspect();
}

function profileActions(ctx, profile, refreshList) {
  const item = (label, fn, danger = false) => button(label, fn, 'ghost', { role: 'menuitem', class: `oj-menu-item${danger ? ' oj-menu-item-danger' : ''}` });
  return h('div', { class: 'oj-dropdown', 'data-oj-dropdown': '' },
    h('button', { type: 'button', class: 'oj-button oj-button-ghost', 'data-oj-dropdown-trigger': '', 'aria-label': `Actions for ${profile.name}` }, 'More'),
    h('div', { class: 'oj-menu', role: 'menu', 'data-oj-dropdown-menu': '', hidden: true, 'aria-label': `Actions for ${profile.name}` },
      item('Edit details', () => openSaveProfile(ctx, { profile })),
      item('Update from current cookies', () => updateProfileCookies(ctx, profile)),
      item('Duplicate', async () => { await ctx.rpc('profiles.duplicate', { id: profile.id }); await refreshList(); document.querySelector('#profile-search')?.focus(); ctx.notify('Profile duplicated.'); }),
      item('Export profile', async () => {
        if (!await confirmDialog({ title: 'Export session secrets?', message: 'The profile file is unencrypted and may grant account access. Keep it private; it is outside vault protection.', confirmLabel: 'Export values' })) return;
        const data = await ctx.rpc('profiles.export', { id: profile.id }); download(JSON.stringify(data, null, 2), `${profile.name.replace(/[^a-z0-9_-]/gi, '_')}.cookiebase-profile.json`); ctx.notify('Profile download requested. Check browser Downloads for completion.');
      }),
      item('Delete profile', async () => {
        if (await confirmDialog({ title: 'Delete encrypted profile?', message: `${profile.name} contains ${profile.cookieCount} saved cookies. Browser cookies are kept. This cannot be undone without an export.`, confirmLabel: 'Delete profile', variant: 'danger' })) { await ctx.rpc('profiles.remove', { id: profile.id }); await refreshList(); document.querySelector('#profile-search')?.focus(); ctx.notify('Encrypted profile deleted. Browser cookies were kept.'); }
      }, true)));
}

export async function renderProfiles(ctx) {
  const body = h('div', { class: 'cb-view', id: 'profiles-workspace' });
  if (ctx.state.status.incognito) return empty('Profiles are unavailable in incognito', 'Incognito Cookiebase data stays in memory. Open a regular browser window to use encrypted profiles.');
  if (ctx.state.status.vault.locked) return panel('Session profiles', empty(ctx.state.status.vault.initialized ? 'Unlock your profiles' : 'Create your encrypted vault', 'Profiles store cookie states, names and metadata encrypted locally. Unlock here and continue without changing the selected site.', button(ctx.state.status.vault.initialized ? 'Unlock vault' : 'Create encrypted vault', async () => { if (await ctx.ensureVault()) await ctx.render(); }, 'primary', { id: 'profiles-unlock' })), accordion('What profiles can restore', help('Profiles contain cookies only. They do not restore MFA, passwords, localStorage, IndexedDB or server-invalidated sessions. A lost passphrase cannot be recovered.')));
  const search = field('Search profiles', 'profile-search', ctx.state.profileSearch || '', 'search', { placeholder: 'Name, site, tag or description' });
  const list = h('div', { class: 'oj-stack', id: 'profile-list', 'aria-live': 'polite' });
  let request = 0; let disposed = false; let timer; let disposeMenus = () => {};
  ctx.cleanup(() => { disposed = true; clearTimeout(timer); disposeMenus(); });
  const populate = async () => {
    const version = ++request;
    const profiles = await ctx.rpc('profiles.list', { query: search.input.value });
    if (version !== request || disposed) return;
    disposeMenus();
    list.replaceChildren(...profiles.map(profile => h('article', { class: 'oj-panel oj-panel-compact cb-profile-row', 'data-profile-id': profile.id },
      h('div', { class: 'cb-profile-main' }, h('h3', { class: 'oj-heading-4' }, profile.name), h('p', { class: 'oj-small oj-muted' }, `${scopeLabel(profile.scope)} · ${profile.cookieCount} cookies · Updated ${date(profile.updatedAt)}`),
        profile.tags.length ? h('div', { class: 'oj-cluster' }, ...profile.tags.map(tag => h('span', { class: 'oj-tag' }, tag))) : null),
      h('div', { class: 'oj-cluster' }, button('Preview and apply', () => openApplyProfile(ctx, profile), 'primary'), profileActions(ctx, profile, populate)))));
    if (!profiles.length) list.append(empty(search.input.value ? 'No profiles match' : 'No saved profiles yet', search.input.value ? 'Try a different search or clear it.' : 'Save the selected site, filtered results or a deliberate cookie selection as a reusable QA state.'));
    disposeMenus = initOJ(list);
  };
  search.input.addEventListener('input', () => { ctx.state.profileSearch = search.input.value; clearTimeout(timer); timer = setTimeout(() => populate().catch(error => ctx.showError(error)), 140); });
  const file = field('Import a profile or cookie file', 'profile-file', '', 'file', { accept: '.json,.txt,application/json,text/plain' });
  file.input.addEventListener('change', async () => {
    try {
      const chosen = file.input.files[0];
      if (!chosen || chosen.size > 5 * 1024 * 1024) throw new Error('Choose a JSON or Netscape file of at most 5 MiB.');
      const text = await chosen.text(); let data;
      if (text.trim().startsWith('{')) { try { data = JSON.parse(text); } catch { throw new Error('Invalid profile JSON syntax. Check quoting and brackets.'); } }
      if (data?.format === 'cookiebase-profile') {
        if (await confirmDialog({ title: 'Import encrypted-vault profile?', message: `The input file itself is unencrypted. Save ${data.profile?.cookies?.length ?? 0} cookies in this local encrypted vault without applying them to the browser?`, confirmLabel: 'Import into vault' })) { await ctx.rpc('profiles.import', { data }); await populate(); ctx.notify('Profile imported into the encrypted vault. Browser cookies were not changed.'); }
      } else {
        const scope = clone(ctx.scope()); const parsed = parseImport(text, { targetUrl: scope.url, storeId: scope.storeId });
        if (parsed.invalid.length) { report('Cookie file could not become a profile', { failed: parsed.invalid.length, results: parsed.invalid.map(item => ({ ...item, status: 'failed' })) }); return; }
        if (parsed.cookies.some(cookie => !inScope(cookie, scope))) throw new Error('File cookies are outside the selected profile scope or store. Choose the intended site before importing this profile.');
        await openSaveProfile(ctx, { cookies: parsed.cookies, scope });
      }
    } catch (error) { ctx.showError(error); }
    finally { file.input.value = ''; }
  });
  body.append(panel('Session profiles', h('div', { class: 'cb-tools' }, search.node, button('Save cookies as profile', () => openSaveProfile(ctx), 'primary', { id: 'save-scope-profile' })), list), accordion('Import a profile or cookie file', file.node, help('Import encrypts the saved state in this vault. It does not change browser cookies. Use the preview/apply action separately.')));
  const snapshots = await ctx.rpc('snapshots.list');
  const snapshotList = h('div', { class: 'oj-stack' });
  for (const snapshot of [...snapshots].reverse()) snapshotList.append(h('div', { class: 'cb-profile-row' },
    h('div', { class: 'cb-profile-main' }, h('strong', {}, snapshot.name), help(`${snapshot.cookieCount} cookies · ${snapshot.kind === 'disabled' ? 'Disabled cookie' : snapshot.completeScope ? 'Site-state backup' : 'Saved-cookie snapshot'} · ${date(snapshot.createdAt)}`), snapshot.restoredAt ? h('span', { class: 'oj-badge oj-badge-success' }, `Restored ${date(snapshot.restoredAt)}`) : null),
    h('div', { class: 'oj-cluster' }, button(snapshot.kind === 'disabled' && !snapshot.restoredAt ? 'Enable cookie' : 'Preview restore', () => openRestoreSnapshot(ctx, snapshot)), button('Delete snapshot', async () => {
      if (!await confirmDialog({ title: 'Delete restore snapshot?', message: `${snapshot.name}: ${snapshot.cookieCount} saved cookies. This removes this recovery copy permanently; live browser cookies are kept.`, confirmLabel: 'Delete snapshot', variant: 'danger' })) return;
      await ctx.rpc('snapshots.delete', { id: snapshot.id }); await ctx.render(); document.querySelector('#profile-snapshots > summary')?.focus(); ctx.notify('Restore snapshot deleted. Browser cookies were kept.');
    }, 'ghost'))));
  const backups = accordion(`Restore snapshots (${snapshots.length})`, help('Saved-cookie restore keeps other cookies. Full site-state restore is offered only for complete backups. Disabled cookies are also directly available in the Cookies workspace.'), snapshots.length ? snapshotList : help('No restore snapshots yet. Backups are created when you explicitly enable them for an operation.'));
  backups.id = 'profile-snapshots'; backups.open = Boolean(ctx.state.profileSnapshotsOpen);
  backups.addEventListener('toggle', () => { ctx.state.profileSnapshotsOpen = backups.open; });
  body.append(backups);
  await populate(); return body;
}
