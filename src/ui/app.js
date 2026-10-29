import 'oj-designsystem/styles.css';
import './app.css';
import { initOJ, confirmDialog, createMultiselect } from 'oj-designsystem';
import { cookieId, scopeLabel, registrableDomain, inScope } from '../core/cookies.js';
import { protectedBy } from '../core/rules.js';
import { createPermissionService } from '../core/permissions.js';
import { h, replace, text, button, field, select, check, panel, accordion, modal, formError, empty, keyValues, report } from './components.js';
import { dataForSource, selectionSummary, targetBinding, groupedCookies, localDateInput } from './model.js';
import { openCookieEditor } from './editor.js';
import { openTransfer } from './transfer.js';
import { renderProfiles, openSaveProfile, openRestoreSnapshot } from './profiles.js';
import { ensureVault, openVault } from './vault.js';
import { renderRules, renderDebug, renderSettings } from './workspaces.js';

const compact = document.body.dataset.page !== 'manager';
const params = new URLSearchParams(location.search);
const views = ['cookies', 'rules', 'profiles', 'debug', 'settings'];
const permissions = createPermissionService(chrome);
const state = {
  url: params.get('url') || '', tabId: Number(params.get('tabId')) || undefined,
  scopeType: 'host', storeId: '', domains: '', followMode: compact && !params.has('url') ? 'follow' : 'pinned',
  view: views.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'cookies',
  cookies: [], stores: [], selected: new Set(), filters: { sortBy: 'domain', direction: 'asc' },
  rules: [], status: null, permission: null, coverage: null, warnings: [], page: 0,
  focusedId: null, cookieMode: 'active', groupByDomain: false, columns: ['name', 'domain', 'lifetime', 'status'],
  compact, binding: { valid: false }, snapshots: [],
};
let viewCleanup = [];
let shellCleanup = () => {};
let contextCleanup = () => {};
let renderGeneration = 0;
let loadingGeneration = 0;
let searchTimer;
let targetTimer;
let windowId;
let currentOperation;
let disposed = false;
const app = document.querySelector('#app');
const main = h('main', { id: 'main', class: 'cb-view', tabindex: '-1' });
const contextBar = h('div', { id: 'site-context', class: 'cb-context' });
const statusLine = h('div', { id: 'status', class: 'oj-inline-message cb-feedback', role: 'status', 'aria-live': 'polite', hidden: true });
const progressLine = h('div', { id: 'operation-progress', class: 'oj-inline-message', role: 'status', 'aria-live': 'polite', hidden: true });
const navigation = h('nav', { class: compact ? 'oj-nav cb-compact-nav' : 'oj-sidebar-nav', 'aria-label': 'Workspaces' });
const vaultButton = button('Vault locked', () => openVault(ctx), 'ghost', { id: 'vault-status' });
const readCommands = new Set(['status', 'list', 'jobs.status', 'delete.preview', 'profiles.list', 'profiles.preview', 'profiles.previewUpdate', 'profiles.export', 'snapshots.list', 'snapshots.preview', 'import.preview', 'history.list', 'history.snapshots', 'history.compare']);

const ctx = {
  state, permissions, compact, scope, rpc, data: source => dataForSource(state.cookies, { scope: scope(), filters: state.filters, selected: state.selected, rules: state.rules, source: source || 'scope' }),
  refresh, refreshStatus, render: renderWorkspace, navigate, notify, showError, reloadTarget, tabBinding,
  ensureVault: () => ensureVault(ctx), requestSite: (url, options) => permissions.requestSite(url, options),
  saveProfile: options => openSaveProfile(ctx, options), manageAccess,
  cleanup: fn => { viewCleanup.push(fn); },
};
function scope() { return { type: state.scopeType, url: state.url, domains: state.domains.split(/[\s,]+/).filter(Boolean), storeId: state.storeId || undefined, incognito: Boolean(state.status?.incognito) }; }
function host(url = state.url) { try { const u = new URL(url); return ['http:', 'https:'].includes(u.protocol) ? u.hostname : ''; } catch { return ''; } }
function friendlyScope(s = scope()) {
  if (s.type === 'all') return 'All granted sites';
  if (s.type === 'domains') return `${s.domains.length} selected sites`;
  if (s.type === 'site') return `${registrableDomain(host(s.url))} + subdomains`;
  if (s.type === 'url') { try { return `${new URL(s.url).hostname}${new URL(s.url).pathname}`; } catch { return 'Choose a page'; } }
  return host(s.url) || 'Choose a site';
}
function notify(message, { action, actionLabel = 'Review', kind = 'success' } = {}) {
  statusLine.hidden = false; statusLine.setAttribute('role', 'status');
  statusLine.dataset.ojKind = kind;
  replace(statusLine, h('span', {}, message), action ? button(actionLabel, action, 'ghost') : null, button('Dismiss', () => { statusLine.hidden = true; }, 'ghost', { 'aria-label': 'Dismiss notification' }));
}
function showError(error, { root } = {}) {
  if (root || document.querySelector('dialog[open]')) { formError(root || [...document.querySelectorAll('dialog[open]')].at(-1), error); return; }
  statusLine.hidden = false; statusLine.dataset.ojKind = 'danger'; statusLine.setAttribute('role', 'alert');
  replace(statusLine, h('span', {}, error?.message || 'This operation could not be completed.'), button('Dismiss', () => { statusLine.hidden = true; }, 'ghost'));
}
async function rpc(type, payload = {}) {
  const requestId = crypto.randomUUID();
  let interval;
  const activeDialog = [...document.querySelectorAll('dialog[open]')].at(-1);
  const operationProgress = activeDialog ? h('div', { class: 'oj-inline-message cb-operation-progress', role: 'status', 'aria-live': 'polite' }) : progressLine;
  if (!readCommands.has(type)) {
    currentOperation = requestId;
    if (activeDialog) activeDialog.querySelector('.oj-dialog-body').append(operationProgress);
    operationProgress.hidden = false;
    replace(operationProgress, h('span', { class: 'oj-spinner', 'aria-hidden': 'true' }), h('span', {}, operationLabel(type)));
    interval = setInterval(async () => {
      try {
        const response = await chrome.runtime.sendMessage({ type: 'jobs.status', payload: { id: requestId } });
        const job = response?.result;
        if (currentOperation !== requestId || !job?.progress) return;
        const done = job.progress.completed ?? job.progress.processed ?? 0, total = job.progress.total;
        replace(operationProgress, h('span', {}, `${operationLabel(type)}${total ? ` ${done} of ${total} verified` : ''}`), total ? h('progress', { class: 'oj-progress', value: done, max: Math.max(total, 1), 'aria-label': 'Cookie operation progress' }) : h('span', { class: 'oj-spinner', 'aria-hidden': 'true' }));
      } catch { /* The final message reports interruption; progress is only supplemental. */ }
    }, 350);
  }
  try {
    const response = await chrome.runtime.sendMessage({ type, payload, requestId });
    if (!response?.ok) throw new Error(response?.error || 'The worker stopped before a verified result arrived. Review Activity in Settings before retrying.');
    return response.result;
  } catch (error) {
    if (/message port|receiving end|context invalidated/i.test(error.message)) throw new Error('Cookiebase restarted before a verified result arrived. Review Activity in Settings; this operation has not been confirmed successful.');
    throw error;
  } finally {
    clearInterval(interval);
    if (currentOperation === requestId) { currentOperation = null; operationProgress.hidden = true; if (activeDialog) operationProgress.remove(); }
  }
}
function operationLabel(type) {
  return ({ 'import.execute': 'Importing cookies…', 'profiles.apply': 'Applying profile…', 'snapshots.restore': 'Restoring saved cookies…', delete: 'Deleting cookies…', disable: 'Temporarily removing cookie…', set: 'Saving and verifying cookie…' })[type] || 'Saving changes…';
}
async function refreshStatus() {
  state.status = await rpc('status'); state.rules = state.status.metadata.rules;
  state.permission = await permissions.status(state.url);
  state.binding = await tabBinding();
  updateShell();
  return state.status;
}
async function refresh({ render = false } = {}) {
  const generation = ++loadingGeneration;
  const requestedScope = structuredClone(scope());
  await refreshStatus();
  const result = await rpc('list', { scope: requestedScope, tabId: state.tabId });
  if (generation !== loadingGeneration) return;
  state.cookies = result.cookies; state.stores = result.stores; state.coverage = result.coverage; state.warnings = result.warnings;
  if (!state.storeId && state.stores.length) state.storeId = state.stores[0].id;
  state.selected = new Set([...state.selected].filter(id => state.cookies.some(cookie => cookieId(cookie) === id)));
  if (state.focusedId && !state.cookies.some(c => cookieId(c) === state.focusedId)) state.focusedId = null;
  if (!state.status.vault.locked && !state.status.incognito) state.snapshots = await rpc('snapshots.list');
  else state.snapshots = [];
  updateShell();
  if (render) await renderWorkspace();
  return result;
}
function updateShell() {
  for (const link of navigation.querySelectorAll('a')) { if (link.dataset.view === state.view) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current'); }
  vaultButton.textContent = state.status?.incognito ? 'Private workspace' : state.status?.vault.locked ? 'Vault locked' : 'Vault unlocked';
  vaultButton.disabled = Boolean(state.status?.incognito);
  if (!state.status) return;
  contextCleanup(); replace(contextBar, );
  const siteScoped = !['all', 'domains'].includes(state.scopeType);
  const hasSite = siteScoped && Boolean(host());
  const access = hasSite ? state.permission?.current ? 'Access granted for this site' : 'Site access needed' : ['all', 'domains'].includes(state.scopeType) ? state.coverage?.fullAccess ? 'All HTTP(S) sites granted' : `Results cover ${new Set((state.permission?.origins || []).map(origin => origin.replace(/^https?:\/\//, '').replace(/\/.*$/, ''))).size} granted hosts` : 'Choose a website';
  contextBar.append(h('div', { class: 'cb-context-heading' }, h('div', {}, h('strong', { class: 'cb-site-name' }, friendlyScope()), h('p', { class: 'oj-small oj-muted' }, `${state.followMode === 'follow' ? 'Following active website tab' : 'Pinned scope'} · ${state.status.incognito ? 'Incognito' : 'Regular browser'}`)), h('span', { class: `oj-status${state.permission?.current || state.coverage?.fullAccess ? ' oj-status-success' : ''}` }, h('span', { class: 'oj-status-dot', 'aria-hidden': 'true' }), access)));
  const actions = h('div', { class: 'oj-cluster' }, button('Change site / scope', () => chooseScope(), 'ghost', { id: 'change-scope' }), button('Refresh', () => refresh({ render: true }), 'ghost', { id: 'refresh' }));
  if (hasSite && !state.permission?.current) actions.append(button('Grant access to this site', () => permissions.requestSite(state.url).then(async granted => { if (!granted) throw new Error('Site access was declined. Other granted sites remain available. Retry when you are ready to allow this site.'); await refresh({ render: true }); }), 'primary', { id: 'grant-site' }));
  actions.append(button('Manage access', manageAccess, 'ghost'));
  contextBar.append(actions);
  if (!state.status.metadata.onboarding) contextBar.append(h('div', { class: 'oj-alert oj-alert-info cb-intro' }, h('span', {}, 'Session cookies are secrets. Reveal or export them only when you intend to handle account credentials.'), button('Got it', async () => { await rpc('onboard'); await refreshStatus(); }, 'ghost'), accordion('Learn more', text('All processing is local. Cookie values can grant account access. Exports and clipboard are unencrypted; profiles are encrypted in your vault. Cookiebase restores cookies, not server-side sessions, MFA, passwords or website storage.'))));
  contextCleanup = initOJ(contextBar);
}
function mountShell() {
  navigation.replaceChildren();
  const brand = h('div', { class: 'cb-brand' }, h('i', { class: 'fa-solid fa-cookie-bite', 'aria-hidden': 'true' }), h('h1', { class: 'oj-heading-2' }, 'Cookiebase'));
  for (const [view, icon] of [['cookies', 'cookie-bite'], ['rules', 'shield-halved'], ['profiles', 'layer-group'], ['debug', 'bug'], ['settings', 'gear']]) navigation.append(h('a', { class: 'oj-nav-link', href: `#${view}`, 'data-view': view, onclick: event => { event.preventDefault(); navigate(view).catch(showError); } }, h('i', { class: `fa-solid fa-${icon}`, 'aria-hidden': 'true' }), h('span', {}, view[0].toUpperCase() + view.slice(1))));
  const header = h('header', { class: 'cb-header' }, brand, compact ? button('Open Manager', () => openManager(state.view), 'secondary', { id: 'open-manager' }) : null, vaultButton);
  const sidebar = compact ? navigation : h('aside', { class: 'cb-sidebar' }, navigation, h('div', { class: 'cb-sidebar-footer oj-small oj-muted' }, 'Local processing. Your cookies stay in this browser.'));
  const workspace = h('div', { class: 'cb-workspace' }, contextBar, progressLine, statusLine, main);
  replace(app, h('div', { class: compact ? 'cb-shell cb-shell-compact' : 'cb-shell' }, header, sidebar, workspace));
  main.append(h('div', { class: 'cb-loading', role: 'status' }, h('span', { class: 'oj-spinner', 'aria-hidden': 'true' }), 'Loading Cookiebase…'));
  shellCleanup = initOJ(app);
}
async function navigate(view) {
  state.view = views.includes(view) ? view : 'cookies';
  if (location.hash.slice(1) !== state.view) history.replaceState(null, '', `#${state.view}`);
  await renderWorkspace();
}
async function renderWorkspace() {
  const generation = ++renderGeneration;
  const activeId = document.activeElement?.id;
  const selectionStart = document.activeElement?.selectionStart;
  clearTimeout(searchTimer);
  for (const dispose of viewCleanup.splice(0)) dispose();
  updateShell();
  main.setAttribute('aria-busy', 'true');
  try {
    const view = state.view === 'cookies' ? renderCookies() : await ({ profiles: renderProfiles, rules: renderRules, debug: renderDebug, settings: renderSettings })[state.view](ctx);
    if (generation !== renderGeneration || disposed) return;
    replace(main, view); viewCleanup.push(initOJ(main));
    if (activeId) {
      const target = document.getElementById(activeId);
      if (target && !target.disabled && !document.querySelector('dialog[open]')) { target.focus({ preventScroll: true }); if (typeof selectionStart === 'number' && target.setSelectionRange) try { target.setSelectionRange(selectionStart, selectionStart); } catch { /* Native selects have no text range. */ } }
    }
  } catch (error) { if (generation === renderGeneration) replace(main, panel('This workspace could not load', text(error.message), button('Retry', () => renderWorkspace()))); }
  finally { if (generation === renderGeneration) main.removeAttribute('aria-busy'); }
}
async function tabBinding() {
  if (!state.tabId) return { valid: false, reason: 'No website tab is linked. Open the site or choose Follow active tab.' };
  try { return targetBinding(await chrome.tabs.get(state.tabId), state.url, Boolean(state.status?.incognito)); }
  catch { return { valid: false, reason: 'The linked tab has closed. Open this site to continue.' }; }
}
async function reloadTarget() {
  const binding = await tabBinding();
  if (!binding.valid) throw new Error(binding.reason);
  await chrome.tabs.reload(binding.id);
  notify(`Reload requested for ${host(binding.url)}. Website changes after a verified write are recorded separately.`);
}
async function openManager(view = 'cookies') {
  const token = crypto.randomUUID();
  await chrome.storage.session.set({ [`handoff:${token}`]: { scope: scope(), selected: [...state.selected], filters: state.filters, view, tabId: state.tabId, createdAt: Date.now(), incognito: Boolean(state.status?.incognito) } });
  const target = new URL(chrome.runtime.getURL('manager.html')); target.searchParams.set('handoff', token); target.hash = view;
  await chrome.tabs.create({ url: target.href });
}
function normalizeURL(value) {
  const url = new URL(value.includes('://') ? value : `https://${value}`);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Choose an HTTP(S) website without embedded credentials.');
  return url.href;
}
function chooseScope() {
  const dialog = modal('Choose site & scope', { id: 'scope-dialog' });
  const form = h('form', { class: 'cb-form' });
  const mode = select('Website context', 'context-mode', [['pinned', 'Pinned site'], ['follow', 'Follow active tab']], state.followMode);
  const url = field('Target website URL', 'target-url', state.url, 'text', { placeholder: 'https://example.com' });
  const choice = select('Cookie scope', 'scope-type', [['host', 'This host only'], ['site', 'Site + subdomains'], ['url', 'This page'], ['domains', 'Selected sites'], ['all', 'All granted sites']], state.scopeType);
  const known = [...new Set([...state.cookies.map(c => c.domain.replace(/^\./, '')), ...state.domains.split(/[\s,]+/).filter(Boolean), ...(state.permission?.origins || []).map(origin => origin.replace(/^https?:\/\/(\*\.)?/, '').replace(/\/.*$/, '')).filter(value => value && value !== '*')])].sort();
  const selectedDomains = state.domains.split(/[\s,]+/).filter(Boolean);
  const multiselect = createMultiselect({ label: 'Selected sites', options: known.map(value => ({ value, label: value })), value: selectedDomains });
  const add = field('Add a site', 'scope-domain-add', '', 'text', { placeholder: 'example.com' });
  const domainPanel = panel('Choose sites', multiselect.node, h('div', { class: 'cb-inline-fields' }, add.node, button('Add site', () => { const name = host(normalizeURL(add.input.value)); if (!known.includes(name)) known.push(name); multiselect.setOptions(known.sort().map(value => ({ value, label: value }))); multiselect.setValue([...multiselect.value(), name]); add.input.value = ''; })), text('A selected site includes its subdomains. Permissions remain separate and are never granted silently.'));
  const store = select('Cookie store', 'store', state.stores.map(item => [item.id, `${item.incognito ? 'Incognito' : 'Regular'} browser · store ${item.id}`]), state.storeId);
  const advanced = accordion('Browser context', store.node, text('Regular and incognito cookies are handled in separate workspaces.'));
  const update = () => { domainPanel.hidden = choice.input.value !== 'domains'; url.node.hidden = ['all', 'domains'].includes(choice.input.value); };
  choice.input.addEventListener('change', update); update();
  form.append(mode.node, choice.node, url.node, domainPanel, advanced, text('Applying this context refreshes cookie results. Profiles, Settings and Stop recording remain available.'));
  const apply = h('button', { type: 'submit', class: 'oj-button oj-button-primary', id: 'apply-scope' }, 'Apply scope');
  form.append(h('div', { class: 'oj-cluster' }, apply, button('Cancel', () => dialog.close())));
  form.addEventListener('submit', async event => {
    event.preventDefault(); apply.disabled = true;
    try {
      const type = choice.input.value;
      const target = mode.input.value === 'follow' && !url.input.value ? '' : ['all', 'domains'].includes(type) ? (url.input.value ? normalizeURL(url.input.value) : '') : normalizeURL(url.input.value);
      if (type === 'domains' && !multiselect.value().length) throw new Error('Choose at least one site.');
      const oldTarget = state.url;
      state.url = target; state.scopeType = type; state.storeId = store.input.value || state.storeId; state.domains = multiselect.value().join(','); state.followMode = mode.input.value;
      state.selected.clear(); state.focusedId = null; state.page = 0;
      if (host(oldTarget) !== host(target)) state.binding = { valid: false };
      dialog.close();
      if (state.followMode === 'follow') await followActiveTab();
      await refresh({ render: true });
    } catch (error) { formError(form, error, { fields: { URL: url } }); } finally { apply.disabled = false; }
  });
  dialog.body.append(form); dialog.element.addEventListener('close', () => multiselect.dispose(), { once: true }); dialog.open();
}
function manageAccess() {
  const dialog = modal('Manage site access', { id: 'access-dialog' });
  const target = field('Website URL', 'access-url', state.url, 'text', { placeholder: 'https://example.com' });
  const sites = field('Selected sites (comma separated)', 'access-sites', state.domains);
  const refreshAfter = async granted => { if (!granted) throw new Error('Access was declined. Existing grants are unchanged.'); dialog.close(); await refresh({ render: true }); notify('Host access updated.'); };
  dialog.body.append(text('Grant only the websites you need. All-sites access is optional. Cookiebase cannot bypass browser or enterprise policy.'), target.node, h('div', { class: 'oj-cluster' }, button('Grant target host', () => permissions.requestSite(normalizeURL(target.input.value)).then(refreshAfter), 'primary'), button('Grant site + subdomains', () => { const url = new URL(normalizeURL(target.input.value)); url.hostname = registrableDomain(url.hostname); return permissions.requestSite(url.href, { subdomains: true }).then(refreshAfter); })), accordion('Selected sites and global access', sites.node, button('Grant selected sites', () => { const domains = sites.input.value.split(/[\s,]+/).filter(Boolean).map(value => host(normalizeURL(value))); if (!domains.length) throw new Error('Enter at least one site.'); return permissions.requestDomains(domains).then(refreshAfter); }), button('Grant access to all sites', () => permissions.requestAll().then(refreshAfter), 'secondary', { id: 'grant-all' })));
  const granted = state.permission?.origins || [];
  if (granted.length) dialog.body.append(panel('Granted hosts', ...granted.map(origin => h('div', { class: 'cb-record-row' }, h('div', {}, h('strong', {}, origin.replace(/^https?:\/\//, '').replace(/\/.*$/, '')), h('p', { class: 'oj-small oj-muted' }, origin.startsWith('https:') ? 'HTTPS' : 'HTTP')), button('Revoke access', async () => { await permissions.revoke(origin); dialog.close(); await refresh({ render: true }); })))));
  dialog.footer.append(button('Done', () => dialog.close(), 'primary')); dialog.open();
}
async function followActiveTab(tabId) {
  if (state.followMode !== 'follow') return;
  let tab;
  try { tab = tabId ? await chrome.tabs.get(tabId) : (await chrome.tabs.query({ active: true, currentWindow: true }))[0]; } catch { return; }
  if (!tab || (windowId !== undefined && tab.windowId !== windowId) || Boolean(tab.incognito) !== Boolean(state.status?.incognito)) return;
  if (tab.url?.startsWith(chrome.runtime.getURL(''))) return;
  state.tabId = tab.id;
  state.url = host(tab.url) ? tab.url : '';
  if (!['host', 'site', 'url'].includes(state.scopeType)) state.scopeType = 'host';
  state.selected.clear(); state.focusedId = null; state.page = 0;
}
function scheduleFollow(tabId) {
  if (state.followMode !== 'follow') return;
  clearTimeout(targetTimer);
  targetTimer = setTimeout(() => followActiveTab(tabId).then(() => refresh({ render: true })).catch(showError), 120);
}
const columns = [ ['name', 'Name'], ['domain', 'Domain / path'], ['lifetime', 'Lifetime'], ['status', 'Security & protection'], ['path', 'Path'], ['value', 'Value (masked)'], ['sameSite', 'SameSite'], ['secure', 'Secure'], ['httpOnly', 'HTTP only'], ['hostOnly', 'Exact host'], ['partition', 'Partition'], ['store', 'Store'], ['observed', 'Observed change'] ];
function renderCookies() {
  const root = h('div', { class: 'cb-cookie-workspace cb-card' });
  const search = field('Search cookies', 'search', state.filters.query || '', 'search', { placeholder: 'Name, site or path' });
  const listMode = select('Cookie state', 'cookie-state', [['active', 'Active cookies'], ['disabled', 'Disabled cookies']], state.cookieMode);
  const actions = h('div', { class: 'oj-cluster' }, button('New cookie', () => openCookieEditor(ctx), 'primary', { id: 'create-cookie' }), button('Import', () => openTransfer(ctx, { tab: 'import' }), 'secondary', { id: 'import-cookies' }), button('Export', () => openTransfer(ctx, { tab: 'export', source: state.selected.size ? 'selected' : 'scope' }), 'secondary', { id: 'export-cookies' }), moreMenu());
  const tools = h('div', { class: 'cb-cookie-toolbar' }, search.node, listMode.node, actions);
  const filters = buildFilters();
  const chips = h('div', { class: 'cb-filter-chips', id: 'active-filters', 'aria-label': 'Active filters' });
  const selectionBar = h('div', { class: 'oj-toolbar cb-selection', id: 'selection-actions', hidden: true });
  const count = h('p', { class: 'oj-small oj-muted', id: 'cookie-count', 'aria-live': 'polite' });
  const tableRegion = h('div', { class: 'oj-table-container cb-table', role: 'region', 'aria-label': 'Cookies', tabindex: '0' });
  const listRegion = h('div', { class: 'cb-cookie-list' });
  const details = h('section', { class: 'oj-panel cb-inspector', 'aria-label': 'Cookie details', hidden: true });
  const paging = h('nav', { class: 'oj-pagination', 'aria-label': 'Cookie pages' });
  const listArea = h('div', { class: 'cb-results' }, count, tableRegion, listRegion, paging);
  const layout = h('div', { class: 'cb-cookie-layout' }, listArea, details);
  const viewOptions = h('div', { class: 'oj-cluster cb-view-options' });
  const grouped = check('Group by domain', state.groupByDomain, { id: 'group-domains' });
  grouped.input.addEventListener('change', () => { state.groupByDomain = grouped.input.checked; draw(); savePreferences(); });
  if (!compact) {
    const picker = createMultiselect({ label: 'Columns', options: columns.map(([value, label]) => ({ value, label, disabled: value === 'name' })), value: state.columns });
    picker.node.addEventListener('oj:change', () => { state.columns = [...new Set(['name', ...picker.value()])]; draw(); savePreferences(); });
    viewCleanup.push(() => picker.dispose()); viewOptions.append(grouped.node, picker.node);
  }
  let tableCleanup = () => {};
  let detailCleanup = () => {};
  viewCleanup.push(() => { tableCleanup(); detailCleanup(); });
  function draw() {
    tableCleanup();
    const filtered = ctx.data('filtered');
    const ordered = groupedCookies(filtered, state.groupByDomain).flatMap(group => group.cookies);
    const pages = Math.max(1, Math.ceil(ordered.length / 50)); state.page = Math.min(state.page, pages - 1);
    const visible = ordered.slice(state.page * 50, state.page * 50 + 50);
    const selection = selectionSummary(state.cookies, filtered, state.selected);
    count.textContent = state.cookieMode === 'disabled' ? 'Disabled cookies are encrypted restore snapshots. Enable restores the saved cookie, best effort.' : `${filtered.length} filtered / ${state.cookies.length} in scope · Page ${state.page + 1}/${pages}`;
    drawChips(chips);
    selectionBar.hidden = !selection.total || state.cookieMode !== 'active';
    replace(selectionBar, h('strong', {}, `${selection.total} selected`), selection.hidden ? h('span', { class: 'oj-badge oj-badge-warning' }, `${selection.hidden} hidden by filters`) : null, button('Export selected', () => openTransfer(ctx, { tab: 'export', source: 'selected' })), button('Save profile', () => openSaveProfile(ctx, { source: 'selected' })), button('Delete selected', () => deleteCookies('selected'), 'danger'), button('Clear selection', () => { state.selected.clear(); draw(); }, 'ghost'));
    if (state.cookieMode === 'disabled') { tableRegion.hidden = true; listRegion.hidden = false; paging.hidden = true; renderDisabled(listRegion); details.hidden = true; root.classList.remove('cb-has-detail'); return; }
    paging.hidden = !ordered.length; tableRegion.hidden = compact; listRegion.hidden = !compact;
    if (!ordered.length) {
      const access = state.permission?.current || state.coverage?.fullAccess || state.scopeType === 'all' && state.permission?.origins.length || state.scopeType === 'domains' && state.cookies.length;
      const hasFilters = Object.entries(state.filters).some(([key, value]) => !['sortBy', 'direction'].includes(key) && value && value !== 'all');
      const blank = !access ? empty(host() ? 'Site access needed' : 'Choose a site', 'Allow a website to inspect its cookies. Other browser profiles and ungranted sites are not included.', host() ? button('Grant access to this site', () => permissions.requestSite(state.url).then(async granted => { if (!granted) throw new Error('Site access was declined.'); await refresh({ render: true }); }), 'primary') : button('Choose site', chooseScope, 'primary')) : hasFilters ? empty('No matching cookies', 'Try a broader search or clear the active filters.', button('Reset filters', resetFilters, 'primary')) : empty('No cookies in this scope', 'This site has no reachable cookies in the selected context.', button('Create cookie', () => openCookieEditor(ctx), 'primary'), button('Import cookies', () => openTransfer(ctx, { tab: 'import' })));
      tableRegion.hidden = true; listRegion.hidden = false; replace(listRegion, blank);
    } else if (compact) {
      replace(listRegion, h('ul', { class: 'oj-list oj-list-interactive' }, visible.map(cookie => {
        const chosen = check('', state.selected.has(cookieId(cookie)), { 'aria-label': `Select ${cookie.name || '(empty name)'}` });
        chosen.input.addEventListener('change', () => { if (chosen.input.checked) state.selected.add(cookieId(cookie)); else state.selected.delete(cookieId(cookie)); draw(); });
        return h('li', { class: 'cb-compact-cookie' }, chosen.node, h('button', { type: 'button', class: 'oj-list-item', onclick: () => inspect(cookie) }, h('strong', { class: 'oj-mono cb-break' }, cookie.name || '(empty name)'), h('span', { class: 'oj-small oj-muted' }, `${cookie.domain}${cookie.path}`), cookieStatus(cookie)));
      })));
    } else {
      const all = check('', visible.length > 0 && visible.every(c => state.selected.has(cookieId(c))), { 'aria-label': 'Select this page' });
      all.input.indeterminate = visible.some(c => state.selected.has(cookieId(c))) && !all.input.checked;
      all.input.addEventListener('change', () => { for (const cookie of visible) { if (all.input.checked) state.selected.add(cookieId(cookie)); else state.selected.delete(cookieId(cookie)); } draw(); });
      const th = key => {
        const title = columns.find(([value]) => value === key)?.[1] || key;
        const sort = ({ name: 'name', domain: 'domain', lifetime: 'expiration', observed: 'observed' })[key];
        return h('th', { scope: 'col', 'aria-sort': sort && state.filters.sortBy === sort ? state.filters.direction === 'desc' ? 'descending' : 'ascending' : undefined }, sort ? h('button', { type: 'button', class: 'oj-table-sort', onclick: () => { state.filters.direction = state.filters.sortBy === sort && state.filters.direction !== 'desc' ? 'desc' : 'asc'; state.filters.sortBy = sort; draw(); } }, title, state.filters.sortBy === sort ? ` ${state.filters.direction === 'desc' ? '↓' : '↑'}` : '') : title);
      };
      const body = h('tbody'); let previousDomain;
      for (const cookie of visible) {
        if (state.groupByDomain && previousDomain !== cookie.domain) { previousDomain = cookie.domain; body.append(h('tr', { class: 'cb-domain-row' }, h('td', { colspan: state.columns.length + 1 }, cookie.domain))); }
        const chosen = check('', state.selected.has(cookieId(cookie)), { 'aria-label': `Select ${cookie.name} at ${cookie.domain}${cookie.path}` });
        chosen.input.addEventListener('change', () => { if (chosen.input.checked) state.selected.add(cookieId(cookie)); else state.selected.delete(cookieId(cookie)); draw(); });
        body.append(h('tr', { 'data-oj-state': state.selected.has(cookieId(cookie)) ? 'selected' : undefined }, h('td', {}, chosen.node), state.columns.map(key => h('td', { class: key === 'name' ? 'cb-cookie-name' : undefined }, cell(cookie, key)))));
      }
      replace(tableRegion, h('table', { id: 'cookie-table', class: 'oj-table oj-table-compact oj-table-hover oj-table-sticky' }, h('caption', { class: 'oj-sr-only' }, `Cookies in ${friendlyScope()}. Values remain masked.`), h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, all.node), state.columns.map(th))), body));
    }
    replace(paging, button('Previous', () => { state.page--; draw(); }, 'ghost', { disabled: state.page === 0 }), text(`Page ${state.page + 1} / ${pages}`), button('Next', () => { state.page++; draw(); }, 'ghost', { disabled: state.page + 1 >= pages }), visible.length && !visible.every(c => state.selected.has(cookieId(c))) ? button('Select this page', () => { for (const c of visible) state.selected.add(cookieId(c)); draw(); }, 'ghost') : null, ordered.length > visible.length ? button(`Select all ${ordered.length} results`, () => { for (const c of ordered) state.selected.add(cookieId(c)); draw(); }, 'ghost') : null);
    drawDetails();
    tableCleanup = initOJ(root);
  }
  function cell(cookie, key) {
    if (key === 'name') return button(cookie.name || '(empty name)', () => inspect(cookie), 'ghost', { class: 'oj-button oj-button-ghost cb-cookie-open', 'aria-label': `Details for ${cookie.name || '(empty name)'}` });
    if (key === 'domain') return h('div', { class: 'cb-cell-site' }, h('span', { class: 'oj-mono' }, cookie.domain), h('span', { class: 'oj-small oj-muted oj-mono' }, cookie.path));
    if (key === 'lifetime') return cookie.session ? 'Session' : new Date(cookie.expirationDate * 1000).toLocaleString();
    if (key === 'status') return cookieStatus(cookie);
    if (key === 'value') return h('span', { class: 'oj-mono' }, '••••••••');
    if (key === 'partition') return cookie.partitionKey ? 'Partitioned' : 'Unpartitioned';
    if (key === 'sameSite') return sameSiteLabel(cookie.sameSite);
    if (key === 'observed') return cookie.observedAt ? new Date(cookie.observedAt).toLocaleString() : 'Not observed';
    if (key === 'store') return `${cookie.incognito ? 'Incognito' : 'Regular'} · ${cookie.storeId}`;
    if (typeof cookie[key] === 'boolean') return cookie[key] ? 'Yes' : 'No';
    return h('span', { class: 'oj-mono' }, cookie[key] ?? '—');
  }
  function inspect(cookie) { state.focusedId = cookieId(cookie); drawDetails(); }
  function drawDetails() {
    detailCleanup();
    const cookie = state.cookies.find(item => cookieId(item) === state.focusedId);
    details.hidden = !cookie; root.classList.toggle('cb-has-detail', Boolean(cookie));
    if (!cookie) { replace(details, ); return; }
    const rules = protectedBy(cookie, state.rules);
    const value = h('pre', { class: 'oj-code-block cb-secret', 'aria-label': 'Cookie value', id: 'cookie-secret' }, '••••••••');
    let revealed = false;
    const reveal = button('Reveal value', () => { revealed = !revealed; value.textContent = revealed ? cookie.value : '••••••••'; reveal.textContent = revealed ? 'Mask value' : 'Reveal value'; }, 'secondary', { id: 'reveal-value' });
    const attributes = [['Domain', cookie.domain], ['Path', cookie.path], ['Lifetime', cookie.session ? 'Session' : new Date(cookie.expirationDate * 1000).toLocaleString()], ['SameSite', sameSiteLabel(cookie.sameSite)], ['Secure', cookie.secure ? 'HTTPS only' : 'HTTP and HTTPS'], ['HTTP only', cookie.httpOnly ? 'Yes' : 'No'], ['Exact host only', cookie.hostOnly ? 'Yes' : 'Includes subdomains'], ['Partition', cookie.partitionKey ? `${cookie.partitionKey.topLevelSite} · ${cookie.partitionKey.hasCrossSiteAncestor ? 'Cross-site ancestor' : 'Same-site ancestry'}` : 'Unpartitioned'], ['Browser context', cookie.incognito ? 'Incognito' : 'Regular'], ['Observed change', cookie.observedAt ? new Date(cookie.observedAt).toLocaleString() : 'No recorded change time']];
    replace(details, h('header', { class: 'oj-section-header' }, h('h2', { class: 'oj-heading-3 cb-break' }, cookie.name || '(empty name)'), button('Back to cookies', () => { state.focusedId = null; drawDetails(); }, 'ghost')), cookieStatus(cookie), h('div', { class: 'oj-cluster' }, button('Edit cookie', () => openCookieEditor(ctx, cookie), 'primary'), button('Duplicate as new', () => openCookieEditor(ctx, cookie, { duplicate: true }))), keyValues(attributes), panel('Secret value', value, h('div', { class: 'oj-cluster' }, reveal, button('Copy value', async () => { await navigator.clipboard.writeText(cookie.value); notify('Cookie value copied. It may grant account access.'); }))), rules.length ? accordion(`Protected by ${rules.length} ${rules.length === 1 ? 'rule' : 'rules'}`, ...rules.map(rule => text(`${rule.domain} · ${rule.name || '(empty name)'} · ${rule.path}`)), button('Manage matching rules', () => navigate('rules'))) : button('Protect cookie', () => protectCookie(cookie), 'secondary'), h('div', { class: 'oj-dropdown', 'data-oj-dropdown': '' }, h('button', { class: 'oj-button oj-button-secondary', type: 'button', 'data-oj-dropdown-trigger': '' }, 'More actions'), h('div', { class: 'oj-menu', 'data-oj-dropdown-menu': '', role: 'menu', hidden: true }, h('button', { class: 'oj-menu-item', role: 'menuitem', type: 'button', onclick: () => disableCookie(cookie).catch(error => showError(error)) }, 'Temporarily remove'), h('button', { class: 'oj-menu-item oj-menu-item-danger', role: 'menuitem', type: 'button', onclick: () => deleteCookies('selected', [cookieId(cookie)]).catch(showError) }, 'Delete cookie'))));
    detailCleanup = initOJ(details);
  }
  function buildFilters() {
    const body = h('div', { class: 'cb-grid' });
    for (const [key, label] of [['secure', 'Secure'], ['httpOnly', 'HTTP only'], ['hostOnly', 'Exact host only'], ['session', 'Session cookie'], ['protected', 'Protected'], ['partitioned', 'Partitioned']]) {
      const item = select(label, `filter-${key}`, [['all', 'Any'], ['true', 'Yes'], ['false', 'No']], state.filters[key] || 'all');
      item.input.addEventListener('change', () => { state.filters[key] = item.input.value; state.page = 0; draw(); }); body.append(item.node);
    }
    const same = select('SameSite', 'filter-sameSite', [['', 'Any'], ['unspecified', 'Unspecified'], ['no_restriction', 'None'], ['lax', 'Lax'], ['strict', 'Strict']], state.filters.sameSite);
    same.input.addEventListener('change', () => { state.filters.sameSite = same.input.value; state.page = 0; draw(); }); body.append(same.node);
    const sensitive = check('Also search secret cookie values', state.filters.searchValues, { id: 'search-values' });
    sensitive.input.addEventListener('change', () => { state.filters.searchValues = sensitive.input.checked; state.page = 0; draw(); });
    const time = h('div', { class: 'cb-grid' });
    const observed = state.cookies.filter(cookie => cookie.observedAt).map(cookie => cookie.observedAt);
    for (const [key, label] of [['expiresAfter', 'Expires after'], ['expiresBefore', 'Expires before'], ['observedAfter', 'Observed after'], ['observedBefore', 'Observed before']]) {
      const current = state.filters[key] ? localDateInput(state.filters[key] * (key.startsWith('expires') ? 1000 : 1)) : '';
      const item = field(label, `filter-${key}`, current, 'datetime-local', { disabled: key.startsWith('observed') && !observed.length });
      item.input.addEventListener('change', () => { state.filters[key] = item.input.value ? Date.parse(item.input.value) / (key.startsWith('expires') ? 1000 : 1) : undefined; state.page = 0; draw(); }); time.append(item.node);
    }
    return accordion('Filters', body, sensitive.node, text('Value search is sensitive and is never saved as a preference.'), accordion('Expiration and observed times', time, observed.length ? text(`Recorded changes visible here: ${new Date(Math.min(...observed)).toLocaleString()} to ${new Date(Math.max(...observed)).toLocaleString()}. These are observation times, never creation dates.`) : h('div', { class: 'oj-inline-message' }, 'No recorded change times for this scope. ', h('a', { class: 'oj-link', href: '#debug', onclick: event => { event.preventDefault(); navigate('debug').catch(showError); } }, 'Start a Debug recording'))));
  }
  function drawChips(container) {
    const active = Object.entries(state.filters).filter(([key, value]) => !['sortBy', 'direction'].includes(key) && value && value !== 'all');
    filters.querySelector('summary').textContent = `Filters${active.length ? ` (${active.length})` : ''}`;
    replace(container, ...active.map(([key, value]) => h('span', { class: 'oj-tag' }, `${({ query: 'Search', searchValues: 'Sensitive value search', httpOnly: 'HTTP only', hostOnly: 'Exact host', expiresAfter: 'Expires after', expiresBefore: 'Expires before', observedAfter: 'Observed after', observedBefore: 'Observed before' })[key] || key}: ${key === 'query' && state.filters.searchValues ? '(masked)' : typeof value === 'boolean' ? 'on' : value}`, button('×', () => { delete state.filters[key]; state.page = 0; renderWorkspace().catch(showError); }, 'ghost', { 'aria-label': `Remove ${key} filter` }))), active.length ? button('Reset filters', resetFilters, 'ghost') : null);
  }
  function resetFilters() { state.filters = { sortBy: state.filters.sortBy, direction: state.filters.direction }; state.page = 0; renderWorkspace().catch(showError); }
  function moreMenu() {
    return h('div', { class: 'oj-dropdown', 'data-oj-dropdown': '' }, h('button', { type: 'button', class: 'oj-button oj-button-secondary', 'data-oj-dropdown-trigger': '' }, 'More'), h('div', { class: 'oj-menu', 'data-oj-dropdown-menu': '', role: 'menu', hidden: true }, h('button', { type: 'button', class: 'oj-menu-item', role: 'menuitem', onclick: () => openSaveProfile(ctx, { source: 'scope' }).catch(showError) }, 'Save site as profile'), h('button', { type: 'button', class: 'oj-menu-item oj-menu-item-danger', role: 'menuitem', onclick: () => deleteCookies('filtered').catch(showError), disabled: !state.cookies.length }, 'Review site cleanup')));
  }
  async function renderDisabled(container) {
    if (state.status.incognito) { replace(container, empty('Disabled-cookie backups unavailable', 'Persistent cookie snapshots are disabled in incognito.')); return; }
    if (state.status.vault.locked) { replace(container, empty('Unlock to view disabled cookies', 'Temporarily removed cookies are kept encrypted in the vault.', button('Unlock vault', async () => { if (await ctx.ensureVault()) { await refresh(); draw(); } }, 'primary'))); return; }
    const snapshots = state.snapshots.filter(snapshot => snapshot.kind === 'disabled' && !snapshot.restoredAt && snapshot.cookieMetadata?.some(cookie => inScope(cookie, scope())));
    replace(container, ...snapshots.map(snapshot => panel(snapshot.name, text(`${snapshot.cookieCount} saved cookie · ${scopeLabel(snapshot.scope)}`), button('Enable cookie', () => openRestoreSnapshot(ctx, snapshot), 'primary'))));
    if (!snapshots.length) container.append(empty('No disabled cookies', 'Cookies you temporarily remove with an encrypted backup will appear here.'));
  }
  listMode.input.addEventListener('change', () => { state.cookieMode = listMode.input.value; state.focusedId = null; draw(); });
  search.input.addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { state.filters.query = search.input.value; state.page = 0; draw(); }, 140); });
  root.append(tools, h('div', { class: 'cb-filter-options' }, filters, viewOptions), chips, selectionBar, layout, accordion('Coverage details', text(`Scope: ${scopeLabel(scope())}. Only granted hosts in this browser context are included.`), ...state.warnings.map(text)));
  draw(); return root;
}
function sameSiteLabel(value) { return ({ no_restriction: 'None', lax: 'Lax', strict: 'Strict', unspecified: 'Unspecified' })[value] || value; }
function cookieStatus(cookie) {
  return h('div', { class: 'cb-badges' }, protectedBy(cookie, state.rules).length ? h('span', { class: 'oj-badge oj-badge-success' }, 'Protected') : null, cookie.secure ? h('span', { class: 'oj-badge' }, 'Secure') : null, cookie.httpOnly ? h('span', { class: 'oj-badge' }, 'HTTP only') : null, cookie.partitionKey ? h('span', { class: 'oj-badge' }, 'Partitioned') : null, !cookie.secure && !cookie.httpOnly && !cookie.partitionKey && !protectedBy(cookie, state.rules).length ? h('span', { class: 'oj-small oj-muted' }, 'Unprotected') : null);
}
async function protectCookie(cookie) {
  if (protectedBy(cookie, state.rules).length) { notify('This cookie is already protected.'); return; }
  await rpc('rules.save', { rule: { domain: cookie.domain.replace(/^\./, ''), name: cookie.name, path: cookie.path, storeId: cookie.storeId, partitionKey: cookie.partitionKey || null, includeSubdomains: false, enabled: true } });
  await refresh({ render: true }); notify('Cookie protected. Site cleanup will preserve matching cookies.');
}
async function disableCookie(cookie) {
  if (!await ctx.ensureVault()) return;
  if (!await confirmDialog({ title: 'Temporarily remove cookie?', message: `${cookie.name} at ${cookie.domain}${cookie.path}. An encrypted backup will be saved. Enable is available in Cookies → Disabled cookies. Sessions may expire.`, confirmLabel: 'Temporarily remove' })) return;
  await rpc('disable', { cookie, scope: scope() }); await refresh({ render: true });
  notify('Cookie temporarily removed. Its encrypted backup is available.', { actionLabel: 'Show disabled cookies', action: async () => { state.cookieMode = 'disabled'; await navigate('cookies'); } });
}
async function deleteCookies(source, explicitIds) {
  const actionScope = structuredClone(scope());
  const ids = explicitIds || ctx.data(source).map(cookieId);
  if (!ids.length) throw new Error('There are no cookies in this action’s selection.');
  const dialog = modal('Review cookie deletion', { id: 'delete-dialog' });
  const preserve = check('Preserve subdomain cookies', false);
  preserve.node.hidden = !host(actionScope.url) || actionScope.type !== 'site';
  const backup = check('Save encrypted restore snapshot', !state.status.vault.locked && !state.status.incognito);
  backup.input.disabled = state.status.incognito;
  const noUndo = check('I understand this deletion will have no restore snapshot', false);
  const output = h('div', { class: 'cb-card', 'aria-live': 'polite' });
  const apply = button('Delete cookies', async () => {
    if (backup.input.checked && !await ctx.ensureVault()) return;
    preserve.input.disabled = true; backup.input.disabled = true; noUndo.input.disabled = true;
    const result = await rpc('delete', { ids, scope: actionScope, options: { preserveSubdomains: preserve.input.checked, host: host(actionScope.url) }, backup: backup.input.checked, expectedRemovalIds: preview.remove.map(cookieId) });
    dialog.close(); await refresh({ render: true });
    const snapshot = result.snapshot;
    notify(`${result.removed} deleted · ${result.preserved} protected/preserved · ${result.failed} failed.`, snapshot ? { actionLabel: 'Restore deleted cookies', action: () => openRestoreSnapshot(ctx, snapshot) } : {});
    if (result.failed) report('Deletion results', result);
  }, 'danger', { disabled: true, id: 'delete-confirm' });
  let preview;
  let generation = 0;
  const ready = () => { noUndo.node.hidden = backup.input.checked; apply.disabled = !preview?.remove.length || !backup.input.checked && !noUndo.input.checked; apply.textContent = preview ? `Delete ${preview.remove.length} cookies` : 'Checking cookies…'; };
  const update = async () => {
    const current = ++generation; preview = null; apply.disabled = true;
    const next = await rpc('delete.preview', { ids, scope: actionScope, options: { preserveSubdomains: preserve.input.checked, host: host(actionScope.url) } });
    if (current !== generation) return;
    preview = next;
    replace(output, keyValues([['Scope', scopeLabel(actionScope)], ['Delete', next.remove.length], ['Protected/preserved', next.preserved.length], ['Affected domains', next.domains.join(', ') || 'None'], ['Stores', next.stores.join(', ') || 'None']]), text('Protection rules are respected. Restore is best effort and cannot revive a server-invalidated session.'));
    ready();
  };
  backup.input.addEventListener('change', ready); noUndo.input.addEventListener('change', ready); preserve.input.addEventListener('change', () => update().catch(error => showError(error, { root: dialog.body })));
  dialog.body.append(output, preserve.node, backup.node, noUndo.node); dialog.footer.append(button('Cancel', () => dialog.close()), apply); dialog.open(); await update();
}
function savePreferences() { if (state.status?.incognito) return; chrome.storage.local.set({ 'ui-preferences': { version: 1, columns: state.columns, groupByDomain: state.groupByDomain } }).catch(() => {}); }
async function boot() {
  mountShell();
  try {
    const own = await chrome.tabs.getCurrent(); windowId = own?.windowId;
    if (windowId === undefined) windowId = (await chrome.windows.getCurrent()).id;
    state.status = await rpc('status');
    const saved = state.status.incognito ? null : (await chrome.storage.local.get('ui-preferences'))['ui-preferences'];
    if (saved?.version === 1) { state.columns = [...new Set(['name', ...(saved.columns || []).filter(key => columns.some(([value]) => value === key))])]; state.groupByDomain = Boolean(saved.groupByDomain); }
    if (params.has('handoff')) {
      const key = `handoff:${params.get('handoff')}`;
      const handoff = (await chrome.storage.session.get(key))[key]; await chrome.storage.session.remove(key);
      if (handoff && handoff.incognito === Boolean(state.status.incognito) && Date.now() - handoff.createdAt < 60_000) { const s = handoff.scope; state.url = s.url || ''; state.scopeType = s.type; state.storeId = s.storeId || ''; state.domains = s.domains?.join(',') || ''; state.selected = new Set(handoff.selected); state.filters = handoff.filters; state.tabId = handoff.tabId; }
    }
    if (!state.url && state.followMode === 'follow') await followActiveTab();
    if (!state.url && !compact) state.scopeType = 'all';
    await refresh({ render: true });
  } catch (error) { replace(main, panel('Cookiebase could not open', text(error.message), button('Retry', () => { shellCleanup(); boot(); }), button('Reset Cookiebase own data', async () => { if (await confirmDialog({ title: 'Reset all Cookiebase data?', message: 'Deletes local profiles, snapshots, rules and history. Browser cookies are kept. This cannot recover a lost vault passphrase.', confirmLabel: 'Reset own data', variant: 'danger' })) { await rpc('data.clear', { area: 'all' }); await boot(); } }, 'danger'))); }
}
const onActivated = info => { if (info.windowId === windowId) scheduleFollow(info.tabId); };
const onUpdated = (tabId, change) => { if (state.followMode === 'follow' && tabId === state.tabId && (change.url || change.status === 'complete')) scheduleFollow(tabId); };
const onPermission = () => refresh({ render: true }).catch(showError);
chrome.tabs.onActivated.addListener(onActivated); chrome.tabs.onUpdated.addListener(onUpdated);
chrome.permissions.onAdded.addListener(onPermission); chrome.permissions.onRemoved.addListener(onPermission);
window.addEventListener('hashchange', () => { const view = location.hash.slice(1); if (views.includes(view) && view !== state.view) navigate(view).catch(showError); });
window.addEventListener('pagehide', () => { disposed = true; ++renderGeneration; shellCleanup(); contextCleanup(); for (const cleanup of viewCleanup.splice(0)) cleanup(); clearTimeout(searchTimer); clearTimeout(targetTimer); chrome.tabs.onActivated.removeListener(onActivated); chrome.tabs.onUpdated.removeListener(onUpdated); chrome.permissions.onAdded.removeListener(onPermission); chrome.permissions.onRemoved.removeListener(onPermission); });
boot().catch(showError);
