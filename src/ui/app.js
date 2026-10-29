import 'oj-designsystem/styles.css';
import './app.css';
import { initOJ, toast, confirmDialog } from 'oj-designsystem';
import { cookieId, filterCookies, scopeLabel, registrableDomain, inScope } from '../core/cookies.js';
import { protectedBy } from '../core/rules.js';
import { createPermissionService } from '../core/permissions.js';
import { exportCookies, parseImport } from '../services/transfer.js';

const popup = document.body.dataset.page === 'popup';
const permissions = createPermissionService(chrome);
const params = new URLSearchParams(location.search);
const state = { url: params.get('url') || '', tabId: Number(params.get('tabId')) || undefined, scopeType: 'host', storeId: '', domains: '', cookies: [], stores: [], selected: new Set(), rules: [], page: 0, filters: {}, view: popup ? 'cookies' : (location.hash.slice(1) || 'overview'), status: null, coverage: null, warnings: [] };
let cleanup = () => {};
let searchTimer;
let renderGeneration = 0;
const app = document.querySelector('#app');
function node(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
    else if (key === 'class') el.className = value;
    else if (key === 'checked' || key === 'disabled' || key === 'hidden') el[key] = Boolean(value);
    else if (value !== undefined && value !== null) el.setAttribute(key, String(value));
  }
  for (const child of children.flat(Infinity)) if (child !== null && child !== undefined) el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  return el;
}
const p = text => node('p', { class: 'oj-small cb-help' }, text);
function button(label, fn, variant = 'secondary', attrs = {}) {
  const b = node('button', { type: 'button', class: `oj-button oj-button-${variant}`, ...attrs }, label);
  b.addEventListener('click', () => {
    b.disabled = true;
    // fn is invoked before any await so permissions.request keeps the real gesture.
    try { Promise.resolve(fn()).catch(showError).finally(() => { b.disabled = false; }); }
    catch (error) { b.disabled = false; showError(error); }
  });
  return b;
}
function field(label, id, value = '', type = 'text', attrs = {}) {
  const input = node('input', { class: 'oj-input', id, type, value: value ?? '', ...attrs });
  return { node: node('div', { class: 'oj-field' }, node('label', { class: 'oj-label', for: id }, label), input), input };
}
function select(label, id, options, value) {
  const input = node('select', { class: 'oj-select', id }, options.map(o => { const [v, t] = Array.isArray(o) ? o : [o, o]; return node('option', { value: v }, t); }));
  input.value = value ?? '';
  return { node: node('div', { class: 'oj-field' }, node('label', { class: 'oj-label', for: id }, label), input), input };
}
function check(label, checked = false, attrs = {}) {
  const input = node('input', { class: 'oj-checkbox', type: 'checkbox', checked, ...attrs });
  return { node: node('label', { class: 'oj-check' }, input, label), input };
}
function panel(title, ...content) { return node('section', { class: 'oj-panel cb-card' }, node('h2', { class: 'oj-heading-3' }, title), ...content); }
function notify(message) { toast(message, { type: 'success' }); const s = document.querySelector('#status'); if (s) s.textContent = message; }
function showError(error) { const message = error?.message || String(error); const s = document.querySelector('#status'); if (s) { s.textContent = message; s.setAttribute('role', 'alert'); } toast(message, { type: 'danger', duration: 0 }); }
async function rpc(type, payload = {}) {
  let response;
  try { response = await chrome.runtime.sendMessage({ type, payload, requestId: crypto.randomUUID() }); }
  catch { throw new Error('Connection to Cookiebase stopped before a result arrived. Reopen Manager and inspect operation recovery; success has not been confirmed.'); }
  if (!response?.ok) throw new Error(response?.error || 'Cookiebase could not return a verified result. Reload and check recovery status.');
  return response.result;
}
function scope() { return { type: state.scopeType, url: state.url, domains: state.domains.split(/[\s,]+/).filter(Boolean), storeId: state.storeId || undefined, incognito: state.status?.incognito || false }; }
function labelScope() { try { return scopeLabel(scope()); } catch { return 'Choose a valid HTTP(S) target and scope'; } }
function filtered() {
  return filterCookies(state.cookies.filter(c => inScope(c, scope())).map(c => ({ ...c, protected: protectedBy(c, state.rules).length > 0 })), state.filters);
}
function managerURL(view = 'cookies') { const url = new URL(chrome.runtime.getURL('manager.html')); if (state.url) url.searchParams.set('url', state.url); if (state.tabId) url.searchParams.set('tabId', state.tabId); url.hash = view; return url.href; }
async function refresh() {
  state.status = await rpc('status'); state.rules = state.status.metadata.rules;
  const result = await rpc('list', { scope: scope(), tabId: state.tabId });
  state.cookies = result.cookies; state.stores = result.stores; state.coverage = result.coverage; state.warnings = result.warnings;
  if (!state.storeId && state.stores.length) { state.storeId = state.stores[0].id; }
  state.selected = new Set([...state.selected].filter(id => state.cookies.some(c => cookieId(c) === id)));
}
function report(title, result) {
  const body = node('div', { class: 'oj-dialog-body cb-card' }, node('h2', { class: 'oj-heading-3', id: 'report-title' }, title), node('pre', { class: 'cb-report', tabindex: '0' }, JSON.stringify(result, null, 2)));
  const d = modal(body, 'report-title'); body.append(button('Close', () => d.close()));
}
function modal(body, labelId) {
  const dialog = node('dialog', { class: 'oj-dialog cb-dialog', 'data-oj-dialog': '', 'aria-labelledby': labelId }, body);
  document.body.append(dialog); const dispose = initOJ(dialog); dialog.showModal();
  dialog.addEventListener('close', () => { dispose(); dialog.remove(); }, { once: true });
  return dialog;
}
async function render() {
  const generation = ++renderGeneration;
  cleanup(); app.replaceChildren();
  const heading = node('header', { class: 'cb-header' }, node('div', { class: 'cb-brand' }, node('i', { class: 'fa-solid fa-cookie-bite', 'aria-hidden': 'true' }), node('div', {}, node('h1', { class: 'oj-heading-2' }, 'Cookiebase'), node('p', { class: 'oj-small oj-muted' }, 'Your cookies. Your control.'))), popup ? button('Open Manager', () => chrome.tabs.create({ url: managerURL() }), 'primary') : node('span', { class: 'oj-badge' }, 'Inspect · Control · Profiles'));
  const nav = node('nav', { class: 'oj-nav', 'aria-label': 'Workspaces' }, ['overview', 'cookies', 'rules', 'profiles', 'debug', 'settings'].map(view => node('a', { class: 'oj-nav-link', href: popup ? managerURL(view) : `#${view}`, 'aria-current': state.view === view ? 'page' : undefined, onclick: popup ? e => { e.preventDefault(); chrome.tabs.create({ url: managerURL(view) }).catch(showError); } : e => { e.preventDefault(); state.view = view; location.hash = view; render().catch(showError); } }, view[0].toUpperCase() + view.slice(1))));
  const status = node('div', { id: 'status', class: 'oj-inline-message cb-status', role: 'status', 'aria-live': 'polite' }, 'Local processing only. Cookie values are masked.');
  const main = node('main', { id: 'main', class: 'cb-view', tabindex: '-1' });
  const shell = node('div', { class: 'cb-shell' }, heading, nav, status, commonScope(), main);
  app.append(shell);
  if (!state.status?.metadata.onboarding) main.append(panel('Session cookies are secrets', p('Cookie values can grant account access. Reveal, copy and export only when you intend to handle these secrets. No account, server, tracking or advertising is used.'), p('Cookiebase profiles contain only cookies in this Chrome profile. They cannot restore invalidated server sessions, MFA, localStorage or passwords.'), button('I understand', async () => { await rpc('onboard'); await refresh(); await render(); }, 'primary')));
  const view = await ({ overview: overviewView, cookies: cookiesView, rules: rulesView, profiles: profilesView, debug: debugView, settings: settingsView }[state.view] || cookiesView)();
  if (generation !== renderGeneration) return;
  main.append(view); cleanup = initOJ(app);
}
function commonScope() {
  const url = field('Target URL (works without an open site)', 'target-url', state.url, 'url');
  url.input.addEventListener('change', () => { state.url = url.input.value; state.page = 0; invalidateScope(); });
  const choice = select('Cookie scope', 'scope-type', [['url', 'Current URL'], ['host', 'Current host'], ['site', 'Site incl. subdomains (PSL)'], ['domains', 'Selected domains'], ['all', 'All accessible sites']], state.scopeType);
  choice.input.addEventListener('change', () => { state.scopeType = choice.input.value; state.page = 0; updateScopeText(); invalidateScope(); });
  const store = select('Store / browser context', 'store', state.stores.length ? state.stores.map(s => [s.id, `${s.id} · ${s.incognito ? 'Incognito' : 'Regular'}`]) : [['', 'No accessible store']], state.storeId);
  store.input.addEventListener('change', () => { state.storeId = store.input.value; state.page = 0; invalidateScope(); });
  const domains = field('Selected domains (comma separated)', 'domains', state.domains); domains.input.addEventListener('change', () => { state.domains = domains.input.value; invalidateScope(); });
  const tools = node('div', { class: 'oj-cluster' }, button('Refresh / Retry', async () => { state.url = url.input.value; state.scopeType = choice.input.value; state.storeId = store.input.value; state.domains = domains.input.value; await refresh(); await render(); }, 'secondary', { id: 'refresh' }), button('Grant access to this site', () => permissions.requestSite(url.input.value).then(async granted => { if (!granted) throw new Error('Site access was declined. Cookiebase still works for other granted sites. Use Retry after granting access.'); state.url = url.input.value; await refresh(); await render(); }), 'primary', { id: 'grant-site' }), button('Grant access to all sites', () => permissions.requestAll().then(async granted => { if (!granted) throw new Error('All-sites access was declined. Choose specific sites instead.'); await refresh(); await render(); }), 'secondary', { id: 'grant-all' }));
  tools.append(button('Grant selected domains', () => permissions.requestDomains(domains.input.value.split(/[\s,]+/).filter(Boolean)).then(async granted => { if (!granted) throw new Error('Access to selected domains was declined.'); state.domains = domains.input.value; await refresh(); await render(); })), button('Grant site incl. subdomains', () => { const target = new URL(url.input.value); target.hostname = registrableDomain(target.hostname); return permissions.requestSite(target.href, { subdomains: true }).then(async granted => { if (!granted) throw new Error('Site access was declined.'); await refresh(); await render(); }); }));
  if (popup) return panel('Current site', node('p', { class: 'cb-value oj-small' }, state.url || 'Restricted or unavailable page. Open Manager to choose an HTTP(S) target.'), node('div', { class: 'oj-cluster' }, tools.children[0], tools.children[1]), p(`${state.cookies.length} reachable cookies · ${state.coverage?.origins.length ? 'Granted hosts only' : 'No host access'} · ${state.status?.incognito ? 'Incognito' : 'Regular'} store ${state.storeId || 'unavailable'}`));
  return panel('Scope & access', node('div', { class: 'cb-scope' }, url.node, choice.node, store.node, domains.node), tools, node('p', { id: 'scope-label', class: 'oj-small cb-value' }, `Scope: ${labelScope()} · Store: ${state.storeId || 'not available'}`), p(`${state.coverage?.fullAccess ? 'All HTTP(S) host access granted' : 'Limited access: only explicitly granted hosts'} · ${state.cookies.length} reachable cookies · Stores: ${state.coverage?.storeIds.join(', ') || 'none'} · ${state.status?.incognito ? 'Incognito, memory-only workspace' : 'Regular browser context'}`));
}
function invalidateScope() {
  state.cookies = []; state.selected.clear();
  updateScopeText();
  const table = document.querySelector('#cookie-table');
  if (table) table.replaceChildren(node('caption', {}, 'Scope changed. Use Refresh / Retry to load cookies for this scope.'));
  for (const control of document.querySelectorAll('#main button')) control.disabled = true;
  const count = document.querySelector('#cookie-count');
  if (count) count.textContent = 'Scope changed. Refresh to load the new scope.';
}
function updateScopeText() { const text = document.querySelector('#scope-label'); if (text) text.textContent = `Scope: ${labelScope()} · Store: ${state.storeId || 'not available'}. Refresh to load this scope.`; }
function overviewView() {
  return panel('Inspect. Control. Reuse your test sessions.', p(`${state.cookies.length} cookies across ${new Set(state.cookies.map(c => c.domain)).size} domains in the chosen scope. ${state.rules.length} protection rules.`), p('Open Cookies to inspect and edit, Rules to preserve consent cookies, Profiles for encrypted test sessions, and Debug to observe changes. Debug recording starts OFF.'), ...state.warnings.map(p), button('Inspect cookies', async () => { state.view = 'cookies'; await render(); }, 'primary'));
}
function cookiesView() {
  const search = field('Search name, domain or path (* wildcard)', 'search', state.filters.query || '', 'search');
  const sensitive = check('Also search cookie values (sensitive)', state.filters.searchValues);
  const sort = select('Sort by', 'sort', [['domain', 'Domain'], ['name', 'Name'], ['expiration', 'Expiration'], ['observed', 'Observed change']], state.filters.sortBy || 'domain');
  const tools = node('div', { class: 'cb-tools' }, search.node, ...(popup ? [] : [sort.node, sensitive.node]));
  const filters = node('details', { class: `oj-details${popup ? ' cb-full' : ''}` }, node('summary', {}, 'Attribute & time filters'));
  const grid = node('div', { class: 'cb-grid' });
  for (const [key, label] of [['secure', 'Secure'], ['httpOnly', 'HttpOnly'], ['hostOnly', 'HostOnly'], ['session', 'Session'], ['protected', 'Protected'], ['partitioned', 'Partitioned']]) {
    const f = select(label, `filter-${key}`, [['all', 'Any'], ['true', 'Yes'], ['false', 'No']], state.filters[key] || 'all');
    f.input.addEventListener('change', () => { state.filters[key] = f.input.value; state.page = 0; renderTable(); }); grid.append(f.node);
  }
  const same = select('SameSite', 'filter-sameSite', [['', 'Any'], ['unspecified', 'Unspecified'], ['no_restriction', 'None'], ['lax', 'Lax'], ['strict', 'Strict']], state.filters.sameSite);
  same.input.addEventListener('change', () => { state.filters.sameSite = same.input.value; renderTable(); }); grid.append(same.node);
  for (const [key, label] of [['expiresAfter', 'Expires after'], ['expiresBefore', 'Expires before'], ['observedAfter', 'Observed after'], ['observedBefore', 'Observed before']]) {
    const f = field(label, `filter-${key}`, state.filters[`${key}Input`] || '', 'datetime-local');
    f.input.addEventListener('change', () => { state.filters[`${key}Input`] = f.input.value; state.filters[key] = f.input.value ? Date.parse(f.input.value) / (key.startsWith('expires') ? 1000 : 1) : undefined; renderTable(); }); grid.append(f.node);
  }
  filters.append(grid, p('Observed time is when Cookiebase saw an event while Debug was recording, never a browser creation date.'));
  const preserve = check('Preserve subdomain cookies', false, { id: 'preserve-subdomains' });
  const actionBar = node('div', { class: 'oj-cluster' }, button('Create cookie', () => cookieEditor(), 'primary', { id: 'create-cookie' }), button('Delete selected', () => deletion([...state.selected], preserve.input.checked)), button('Delete filtered except protected', () => deletion(filtered().map(cookieId), preserve.input.checked), 'danger', { id: 'delete-filtered' }), button('Import / Export', () => transferDialog(), 'secondary', { id: 'transfer' }), button('Save selection as profile', () => profileEditor(null, state.cookies.filter(c => state.selected.has(cookieId(c))))), preserve.node);
  if (popup) { actionBar.replaceChildren(button('Create cookie', () => cookieEditor(), 'primary'), button('Delete selected', () => deletion([...state.selected], false), 'danger'), button('Import / Export', () => transferDialog())); }
  const count = node('p', { id: 'cookie-count', class: 'oj-small', 'aria-live': 'polite' });
  const tableWrap = node('div', { class: 'oj-table-container cb-table', role: 'region', 'aria-label': 'Cookie attributes', tabindex: '0' });
  const paging = node('nav', { class: 'oj-pagination', 'aria-label': 'Cookie pages' });
  function renderTable() {
    const cookies = filtered(); const pages = Math.max(1, Math.ceil(cookies.length / 50)); state.page = Math.min(state.page, pages - 1);
    count.textContent = `${cookies.length} filtered / ${state.cookies.length} in scope · ${state.selected.size} selected · Page ${state.page + 1}/${pages}`;
    const all = check('Select page', false, { 'aria-label': 'Select this page' });
    const visible = cookies.slice(state.page * 50, state.page * 50 + 50);
    all.input.checked = visible.length > 0 && visible.every(c => state.selected.has(cookieId(c)));
    all.input.addEventListener('change', () => { for (const c of visible) if (all.input.checked) state.selected.add(cookieId(c)); else state.selected.delete(cookieId(c)); renderTable(); });
    const head = node('thead', {}, node('tr', {}, node('th', { scope: 'col' }, all.node), ...['Name', 'Domain', 'Path', 'Value', 'Expires / Session', 'SameSite', 'Secure', 'HttpOnly', 'HostOnly', 'Partition', 'Store', 'Protection / Actions'].map(t => node('th', { scope: 'col' }, t))));
    const body = node('tbody'); let domain;
    for (const c of visible) {
      if (domain !== c.domain) { domain = c.domain; body.append(node('tr', { class: 'cb-domain-row' }, node('td', { colspan: '13' }, `${c.domain} · Site: ${registrableDomain(c.domain)}`))); }
      const chosen = check('', state.selected.has(cookieId(c)), { 'aria-label': `Select ${c.name} at ${c.domain}${c.path}` });
      chosen.input.addEventListener('change', () => { if (chosen.input.checked) state.selected.add(cookieId(c)); else state.selected.delete(cookieId(c)); count.textContent = `${cookies.length} filtered / ${state.cookies.length} in scope · ${state.selected.size} selected`; });
      const protectedCookie = protectedBy(c, state.rules).length;
      body.append(node('tr', {}, node('td', {}, chosen.node), node('td', { class: 'cb-name', title: c.name }, button(c.name || '(empty name)', () => cookieEditor(c), 'ghost')), ...[c.domain, c.path, '••••••••', c.session ? 'Session' : new Date(c.expirationDate * 1000).toLocaleString(), c.sameSite, c.secure ? 'Yes' : 'No', c.httpOnly ? 'Yes' : 'No', c.hostOnly ? 'Yes' : 'No', c.partitionKey ? JSON.stringify(c.partitionKey) : 'Unpartitioned', c.storeId].map(t => node('td', { class: 'oj-mono' }, t)), node('td', {}, node('span', { class: 'oj-badge' }, protectedCookie ? 'Protected' : 'Unprotected'), button('Protect', () => quickProtect(c), 'ghost'), button('Disable', async () => { if (await confirmDialog({ title: 'Temporarily remove this cookie?', message: 'Disable stores an encrypted local snapshot and removes this cookie. Restore is best effort; sessions may expire. Unlock the vault first.', confirmLabel: 'Disable' })) { const r = await rpc('disable', { cookie: c, scope: scope() }); notify('Cookie removed; encrypted restore snapshot saved in Profiles.'); await refresh(); renderTable(); return r; } }, 'ghost'))));
    }
    if (!cookies.length) body.append(node('tr', {}, node('td', { colspan: '13' }, state.coverage?.origins.length ? 'No cookies match this scope and filters.' : 'No host access. Grant access to a site, then Retry.')));
    tableWrap.replaceChildren(node('table', { id: 'cookie-table', class: 'oj-table oj-table-compact oj-table-hover' }, node('caption', {}, `Cookies · ${labelScope()} · values masked`), head, body));
    paging.replaceChildren(button('Previous', () => { state.page--; renderTable(); }, 'ghost', { disabled: state.page === 0 }), p(`Page ${state.page + 1} / ${pages}`), button('Next', () => { state.page++; renderTable(); }, 'ghost', { disabled: state.page + 1 >= pages }));
  }
  search.input.addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { state.filters.query = search.input.value; state.page = 0; renderTable(); }, 140); });
  sensitive.input.addEventListener('change', () => { state.filters.searchValues = sensitive.input.checked; renderTable(); });
  sort.input.addEventListener('change', () => { state.filters.sortBy = sort.input.value; renderTable(); });
  renderTable();
  return node('div', { class: 'cb-view' }, panel('Cookies', tools, filters, actionBar, count, tableWrap, paging), ...(popup ? [] : state.warnings.map(p)));
}
async function quickProtect(cookie) {
  await rpc('rules.save', { rule: { domain: cookie.domain.replace(/^\./, ''), name: cookie.name, path: cookie.path, storeId: cookie.storeId, partitionKey: cookie.partitionKey || null, includeSubdomains: false, enabled: true } });
  await refresh(); await render(); notify('Cookie protected. Cleanup will preserve matching consent cookies.');
}
async function deletion(ids, preserveSubdomains) {
  if (!ids.length) throw new Error('Select cookies or choose a filter with results first.');
  let host = ''; try { host = new URL(state.url).hostname; } catch { if (preserveSubdomains) throw new Error('Choose a target URL to preserve its subdomains.'); }
  const options = { preserveSubdomains, host };
  const preview = await rpc('delete.preview', { ids, scope: scope(), options });
  if (!preview.remove.length) return notify(`Nothing to delete; ${preview.preserved.length} cookies are protected or preserved.`);
  if (await confirmDialog({ title: `Delete ${preview.remove.length} cookies?`, message: `Scope: ${labelScope()}. Store: ${state.storeId}. ${preview.preserved.length} preserved. Domains: ${preview.domains.join(', ')}. ${state.status.vault.locked ? 'Vault is locked: this deletion has NO UNDO. Unlock Profiles first if you need an encrypted backup.' : 'An encrypted Undo snapshot will be saved. Restore is best effort.'}`, confirmLabel: state.status.vault.locked ? 'Delete without Undo' : 'Delete except protected', variant: 'danger' })) {
    const result = await rpc('delete', { ids, scope: scope(), options, backup: !state.status.vault.locked }); await refresh(); await render(); report('Deletion verified', result);
  }
}
function cookieEditor(cookie = null) {
  const host = (() => { try { return new URL(state.url).hostname; } catch { return ''; } })();
  const c = cookie || { name: '', value: '', domain: host, path: '/', secure: true, httpOnly: false, hostOnly: true, sameSite: 'lax', session: true, storeId: state.storeId };
  const form = node('form', {}, node('h2', { id: 'editor-title', class: 'oj-heading-3' }, cookie ? 'Edit cookie' : 'Create cookie · all attributes'));
  const grid = node('div', { class: 'cb-grid' }); const inputs = {};
  for (const [key, label, type] of [['name', 'Name', 'text'], ['value', 'Value (secret)', 'password'], ['domain', 'Domain', 'text'], ['path', 'Path', 'text'], ['storeId', 'Store ID', 'text']]) {
    const f = field(label, `edit-${key}`, c[key], type, { autocomplete: 'off', required: key !== 'name' && key !== 'value' }); inputs[key] = f.input; grid.append(f.node);
  }
  const same = select('SameSite', 'edit-sameSite', [['unspecified', 'Unspecified'], ['no_restriction', 'None'], ['lax', 'Lax'], ['strict', 'Strict']], c.sameSite); inputs.sameSite = same.input; grid.append(same.node);
  const expires = field('Expiration (local time)', 'edit-expiration', c.expirationDate ? new Date(c.expirationDate * 1000 - new Date(c.expirationDate * 1000).getTimezoneOffset() * 60000).toISOString().slice(0, 19) : '', 'datetime-local', { step: '1' }); grid.append(expires.node);
  const partition = field('Partition top-level site (blank = unpartitioned)', 'edit-partition', c.partitionKey?.topLevelSite || '', 'url'); grid.append(partition.node);
  const toggles = node('div', { class: 'oj-cluster' });
  for (const key of ['secure', 'httpOnly', 'hostOnly', 'session']) { const f = check(key, c[key]); inputs[key] = f.input; toggles.append(f.node); }
  const ancestor = check('Partition has cross-site ancestor', c.partitionKey?.hasCrossSiteAncestor || false); toggles.append(ancestor.node);
  const reveal = check('Reveal secret value'); reveal.input.addEventListener('change', () => { inputs.value.type = reveal.input.checked ? 'text' : 'password'; }); toggles.append(reveal.node);
  form.append(grid, toggles, p('HostOnly omits Domain when setting. SameSite=None, __Secure-, __Host- and partitioned cookies require Secure / HTTPS. Editing identity fields requires creating a new cookie. Browser policy can reject attributes; success is shown only after verification.'));
  const d = modal(node('div', { class: 'oj-dialog-body' }, form), 'editor-title');
  const save = node('button', { class: 'oj-button oj-button-primary', type: 'submit' }, 'Save & verify');
  form.append(node('div', { class: 'oj-cluster' }, save, button('Copy value', async () => { await navigator.clipboard.writeText(inputs.value.value); notify('Cookie value copied to clipboard. It may grant account access.'); }), button('Cancel', () => d.close())));
  form.addEventListener('submit', async event => { event.preventDefault(); save.disabled = true;
    try { const next = {}; for (const [k, input] of Object.entries(inputs)) next[k] = input.type === 'checkbox' ? input.checked : input.value;
      if (!next.session) next.expirationDate = Date.parse(expires.input.value) / 1000;
      if (partition.input.value) next.partitionKey = { topLevelSite: partition.input.value, hasCrossSiteAncestor: ancestor.input.checked };
      await rpc('set', { cookie: next, original: cookie }); d.close(); await refresh(); await render(); notify('Cookie saved and verified against Chrome.');
    } catch (error) { showError(error); } finally { save.disabled = false; }
  });
}
function rulesView() {
  const list = node('div', { class: 'cb-view' }, ...state.rules.map(rule => panel(`${rule.domain} · ${rule.name}`, p(`Path ${rule.path} · ${rule.includeSubdomains ? 'Includes subdomains' : 'Exact domain only'} · Store ${rule.storeId || 'all in this context'} · ${rule.enabled === false ? 'Disabled' : 'Enabled'}`), node('div', { class: 'oj-cluster' }, button('Edit', () => ruleEditor(rule)), button('Remove rule', async () => { await rpc('rules.remove', { id: rule.id }); await refresh(); await render(); }, 'danger')))));
  return node('div', { class: 'cb-view' }, panel('Protected cookie rules', p('Any enabled matching allowlist protects a cookie. Rules never silently override one another. Safe deletion always preserves protected cookies. Use * for domain, cookie-name or path wildcards.'), button('Create protected rule', () => ruleEditor(), 'primary')), list, !state.rules.length ? p('No protection rules yet. Use Protect next to a consent cookie for a one-action exact rule.') : null);
}
function ruleEditor(rule = {}) {
  const form = node('form', {}, node('h2', { id: 'rule-title', class: 'oj-heading-3' }, 'Protected rule'));
  const inputs = {};
  for (const [key, label, fallback] of [['domain', 'Domain pattern', '*'], ['name', 'Cookie name pattern', '*'], ['path', 'Path pattern', '/'], ['storeId', 'Optional store ID', '']]) { const f = field(label, `rule-${key}`, rule[key] ?? fallback); inputs[key] = f.input; form.append(f.node); }
  const partition = field('Partition JSON (blank = all, null = unpartitioned)', 'rule-partition', rule.partitionKey !== undefined ? JSON.stringify(rule.partitionKey) : ''); form.append(partition.node);
  const sub = check('Include subdomains', rule.includeSubdomains); const enabled = check('Enabled', rule.enabled !== false); const siteOnly = check('Limit rule to the current site scope', Boolean(rule.scope)); form.append(sub.node, enabled.node, siteOnly.node);
  const d = modal(node('div', { class: 'oj-dialog-body' }, form), 'rule-title');
  form.append(node('div', { class: 'oj-cluster' }, node('button', { type: 'submit', class: 'oj-button oj-button-primary' }, 'Save rule'), button('Cancel', () => d.close())));
  form.addEventListener('submit', async e => { e.preventDefault(); try { const r = { ...rule, includeSubdomains: sub.input.checked, enabled: enabled.input.checked }; for (const [k, f] of Object.entries(inputs)) r[k] = f.value || undefined; if (partition.input.value) r.partitionKey = JSON.parse(partition.input.value); else delete r.partitionKey; if (siteOnly.input.checked) r.scope = { type: 'site', url: state.url, storeId: state.storeId }; else delete r.scope; await rpc('rules.save', { rule: r }); d.close(); await refresh(); await render(); } catch (error) { showError(error); } });
}
async function consentSecrets() { return confirmDialog({ title: 'Export session secrets?', message: 'Cookie values may allow account takeover. Clipboard and downloaded files are unencrypted and outside the vault. Do not send them to untrusted recipients.', confirmLabel: 'Export values' }); }
function download(content, name, mime = 'application/json') { const url = URL.createObjectURL(new Blob([content], { type: mime })); const a = node('a', { href: url, download: name }); document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000); notify(`Download requested: ${name}. Check browser Downloads for completion and location.`); }
function transferDialog() {
  const body = node('div', { class: 'oj-dialog-body cb-card' }, node('h2', { id: 'transfer-title', class: 'oj-heading-3' }, 'Import / Export'), p(`Scope: ${labelScope()} · Store ${state.storeId}. Exports use selected cookies if any are selected, otherwise all filtered cookies.`));
  const d = modal(body, 'transfer-title');
  const format = select('Export format', 'export-format', [['json', 'Cookiebase JSON'], ['netscape', 'Netscape cookies.txt']], 'json'); const redacted = check('Redacted export (no secret values)', true);
  async function output(copy) { if (!redacted.input.checked && !await consentSecrets()) return; const cookies = state.selected.size ? filtered().filter(c => state.selected.has(cookieId(c))) : filtered(); const text = exportCookies(cookies, { format: format.input.value, redacted: redacted.input.checked, scope: scope() }); if (copy) { await navigator.clipboard.writeText(text); notify(`Copied ${cookies.length} ${redacted.input.checked ? 'redacted ' : ''}cookies to clipboard.`); } else download(text, `cookies-${new Date().toISOString().slice(0, 10)}.${format.input.value === 'json' ? 'json' : 'txt'}`, format.input.value === 'json' ? 'application/json' : 'text/plain'); }
  body.append(panel('Export', format.node, redacted.node, p('Netscape omits SameSite, HostOnly detail, store and partition metadata. Partitioned cookies require JSON. Redacted exports cannot restore secrets.'), node('div', { class: 'oj-cluster' }, button('Copy to clipboard', () => output(true)), button('Download file', () => output(false)))));
  const textarea = node('textarea', { id: 'import-text', class: 'oj-textarea', rows: '5', spellcheck: 'false', 'aria-label': 'Import JSON or Netscape cookies' });
  const mode = select('Import mode', 'import-mode', [['merge', 'Merge'], ['replace', 'Replace only within chosen scope'], ['skip', 'Skip duplicates'], ['overwrite', 'Overwrite conflicts']], 'merge');
  const target = field('Explicit target URL (does not need to be open)', 'import-target', state.url, 'url');
  const store = field('Target store ID (preserves supplied stores)', 'import-store', state.storeId);
  const backup = check('Create encrypted backup before import', false);
  const override = check('Override cookie protection (risk: consent/session cookies can be lost)', false);
  const file = field('Import file', 'import-file', '', 'file', { accept: '.json,.txt,application/json,text/plain' });
  file.input.addEventListener('change', async () => { try { if (file.input.files[0]?.size > 5 * 1024 * 1024) throw new Error('Import files must be at most 5 MiB.'); textarea.value = await file.input.files[0].text(); } catch (error) { showError(error); } });
  const preview = node('pre', { class: 'cb-report', id: 'import-preview', tabindex: '0', 'aria-live': 'polite' }, 'Parse and preview before applying.');
  let lastPlan; let lastInput;
  const options = () => ({ mode: mode.input.value, targetUrl: target.input.value, storeId: store.input.value, overrideProtection: override.input.checked });
  const apply = button('Apply import & verify', async () => { if (!lastPlan || lastInput !== JSON.stringify([textarea.value, options(), scope()])) throw new Error('Input or scope changed. Preview again before applying.'); if (override.input.checked && !await confirmDialog({ title: 'Override protected cookies?', message: 'This import can overwrite or remove protected consent and session cookies in the shown scope. This explicit override ignores allowlist protection.', confirmLabel: 'Override protection', variant: 'danger' })) return; const r = await rpc('import.execute', { text: textarea.value, options: options(), scope: scope(), expectedRemovalIds: lastPlan.removals.map(cookieId), backup: backup.input.checked }); await refresh(); d.close(); await render(); report('Import results · verified at import time', r); }, 'primary', { disabled: true, id: 'import-apply' });
  const inspect = button('Parse & preview', async () => { lastPlan = await rpc('import.preview', { text: textarea.value, options: options(), scope: scope() }); lastInput = JSON.stringify([textarea.value, options(), scope()]); preview.textContent = JSON.stringify({ scope: scope(), counts: lastPlan.counts, requiredOrigins: lastPlan.requiredOrigins, warnings: lastPlan.warnings, invalid: lastPlan.invalid, conflicts: lastPlan.actions.map(a => ({ name: a.cookie?.name, domain: a.cookie?.domain, action: a.action || a.type })) }, null, 2); apply.disabled = lastPlan.mode === 'replace' && lastPlan.invalid.length > 0; });
  const imports = panel('Import', file.node, node('label', { class: 'oj-label', for: 'import-text' }, 'Paste or drop JSON / cookies.txt'), textarea, node('div', { class: 'cb-grid' }, mode.node, target.node, store.node), backup.node, override.node, p('Imports target the explicitly selected scope, without depending on OAuth redirects or an open website. Relative JSON expiration uses maxAge in seconds. Replace requires an unlocked vault backup. Later website changes are separate from import verification.'), node('div', { class: 'oj-cluster' }, button('Read clipboard', async () => { textarea.value = await navigator.clipboard.readText(); }), button('Grant target access', () => permissions.requestSite(target.input.value).then(granted => { if (!granted) throw new Error('Target permission declined. Import cannot write that host.'); notify('Target host access granted.'); })), inspect, apply), preview);
  imports.addEventListener('dragover', e => e.preventDefault()); imports.addEventListener('drop', async e => { e.preventDefault(); try { const f = e.dataTransfer.files[0]; if (f) { if (f.size > 5 * 1024 * 1024) throw new Error('File exceeds 5 MiB.'); textarea.value = await f.text(); } else textarea.value = e.dataTransfer.getData('text/plain'); } catch (error) { showError(error); } });
  body.append(imports, button('Close', () => d.close()));
}
async function profilesView() {
  const body = node('div', { class: 'cb-view' }, panel('Encrypted session vault', p('Profiles and restore snapshots are encrypted locally with AES-256-GCM and PBKDF2-SHA-256 (600,000 iterations). Passphrases and keys are never saved. The vault locks when the worker/browser restarts; there is no recovery for a lost passphrase.'), p('Only cookies in this Chrome profile are captured. Incognito persistent profiles are disabled. Page reload, MFA, server expiration, CSRF and session rotation can invalidate restored sessions.')));
  if (state.status.incognito) { body.append(p('Incognito workspace: profile persistence is unavailable. Open a regular window to manage the vault.')); return body; }
  if (state.status.vault.locked) {
    const pass = field(state.status.vault.initialized ? 'Vault passphrase' : 'New vault passphrase (12+ characters)', 'vault-passphrase', '', 'password', { autocomplete: 'off', minlength: '12' });
    body.append(panel(state.status.vault.initialized ? 'Unlock vault' : 'Create vault', pass.node, button(state.status.vault.initialized ? 'Unlock' : 'Create encrypted vault', async () => { const secret = pass.input.value; pass.input.value = ''; await rpc(state.status.vault.initialized ? 'vault.unlock' : 'vault.initialize', { passphrase: secret }); await refresh(); await render(); }, 'primary', { id: 'vault-unlock' })));
    return body;
  }
  const search = field('Search profiles (name, description, tags, scope)', 'profile-search', '', 'search');
  const list = node('div', { class: 'cb-view' });
  const populate = async () => { const profiles = await rpc('profiles.list', { query: search.input.value }); const previews = new Map(); await Promise.all(profiles.map(async profile => { try { previews.set(profile.id, await rpc('profiles.preview', { id: profile.id, scope: scope(), options: { mode: 'replace' } })); } catch { /* A mismatched scope can still be inspected through explicit preview. */ } })); list.replaceChildren(...profiles.map(profile => panel(profile.name, p(profile.description || 'No description'), p(`${profile.cookieCount} cookies · ${scopeLabel(profile.scope)} · ${profile.tags.join(', ')} · Created ${profile.createdAt} · Updated ${profile.updatedAt}`), node('div', { class: 'oj-cluster' }, button('Preview / Apply', () => applyProfile(profile), 'primary'), previews.has(profile.id) ? node('div', { class: 'cb-card' }, p(`QA state preview in ${labelScope()}: ${previews.get(profile.id).additions} additions, ${previews.get(profile.id).overwrites} overwrites, ${previews.get(profile.id).removals} removals. Encrypted backup and best-effort rollback enabled. Explicit state switching can replace protected cookies; sessions may be invalid.`), button('Apply this QA state', async () => { const result = await rpc('profiles.apply', { id: profile.id, scope: scope(), options: { mode: 'replace', backup: true, rollbackOnFailure: true, expectedRemovalIds: previews.get(profile.id).removeCookies.map(cookieId) } }); await refresh(); await render(); report('QA state apply results', result); })) : null, button('Edit', () => profileEditor(profile)), button('Duplicate', async () => { await rpc('profiles.duplicate', { id: profile.id }); await populate(); }), button('Export profile', async () => { if (await consentSecrets()) download(JSON.stringify(await rpc('profiles.export', { id: profile.id }), null, 2), `${profile.name.replace(/[^a-z0-9_-]/gi, '_')}.cookiebase-profile.json`); }), button('Delete profile', async () => { if (await confirmDialog({ title: 'Delete encrypted profile?', message: profile.name, confirmLabel: 'Delete', variant: 'danger' })) { await rpc('profiles.remove', { id: profile.id }); await populate(); } }, 'danger'))))); if (!profiles.length) list.append(p('No profiles yet. Save the current scope or import a profile.')); };
  search.input.addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => populate().catch(showError), 140); });
  const input = field('Import profile or cookie file (JSON / Netscape)', 'profile-file', '', 'file', { accept: '.json,.txt' });
  input.input.addEventListener('change', async () => {
    try {
      const f = input.input.files[0];
      if (!f || f.size > 5 * 1024 * 1024) throw new Error('Choose a profile or cookie file of at most 5 MiB.');
      const text = await f.text();
      let data;
      if (text.trim().startsWith('{')) {
        try { data = JSON.parse(text); } catch { throw new Error('Invalid profile JSON syntax. Check quoting and brackets.'); }
      }
      if (data?.format === 'cookiebase-profile') {
        if (await confirmDialog({ title: 'Import session profile?', message: `File contains ${data.profile?.cookies?.length ?? 0} cookies. Scope: ${scopeLabel(data.profile?.scope || {})}. Import encrypts secrets in this vault without changing browser cookies. Cross-store or incognito imports are refused.`, confirmLabel: 'Import into vault' })) {
          await rpc('profiles.import', { data }); await populate();
        }
      } else {
        const parsed = parseImport(text, { targetUrl: state.url, storeId: state.storeId });
        if (parsed.invalid.length) { report('Cookie-file validation errors', { invalid: parsed.invalid, warnings: parsed.warnings }); return; }
        if (parsed.cookies.some(c => !inScope(c, scope()))) throw new Error('The file contains cookies outside the selected profile scope/store. Choose the intended scope and refresh before importing.');
        profileEditor(null, parsed.cookies);
      }
    } catch (error) { showError(error); }
  });
  body.append(panel('Session profiles', search.node, node('div', { class: 'oj-cluster' }, button('Save current scope as profile', () => profileEditor(null, filtered()), 'primary'), button('Lock vault', async () => { await rpc('vault.lock'); await refresh(); await render(); })), input.node), list);
  const snapshots = await rpc('snapshots.list');
  body.append(panel('Encrypted restore snapshots / disabled cookies', p('Undo and Enable restore a prior cookie snapshot. Best effort: expired cookies, revoked permissions or server invalidation can prevent restoration.'), ...snapshots.map(s => node('div', { class: 'cb-profile' }, p(`${s.name} · ${s.cookieCount} cookies · ${s.createdAt}`), node('div', { class: 'oj-cluster' }, button(s.kind === 'disabled' ? 'Enable / restore' : 'Undo / restore', async () => { if (await confirmDialog({ title: 'Restore snapshot?', message: `Scope: ${scopeLabel(s.scope)}. Existing matching identities can be overwritten.`, confirmLabel: 'Restore & verify' })) report('Restore results', await rpc('snapshots.restore', { id: s.id })); }), button('Delete snapshot', async () => { await rpc('snapshots.delete', { id: s.id }); await render(); }, 'ghost'))))));
  await populate(); return body;
}
function profileEditor(profile, cookies) {
  const form = node('form', {}, node('h2', { id: 'profile-title', class: 'oj-heading-3' }, profile ? 'Edit profile metadata' : 'Save session profile'));
  const name = field('Profile name', 'profile-name', profile?.name || '', 'text', { required: true, maxlength: '120' });
  const description = field('Description', 'profile-description', profile?.description || ''); const tags = field('Tags (comma separated)', 'profile-tags', profile?.tags.join(', ') || '');
  form.append(name.node, description.node, tags.node, p(`Scope: ${profile ? scopeLabel(profile.scope) : labelScope()} · ${cookies?.length ?? profile?.cookieCount} cookies. Session data is encrypted locally; it cannot guarantee login restoration.`));
  const d = modal(node('div', { class: 'oj-dialog-body' }, form), 'profile-title');
  form.append(node('div', { class: 'oj-cluster' }, node('button', { class: 'oj-button oj-button-primary', type: 'submit' }, 'Save profile'), button('Cancel', () => d.close())));
  form.addEventListener('submit', async e => { e.preventDefault(); try { const data = { name: name.input.value, description: description.input.value, tags: tags.input.value.split(',').map(t => t.trim()).filter(Boolean) }; if (profile) await rpc('profiles.update', { id: profile.id, patch: data }); else await rpc('profiles.create', { profile: data, cookies, scope: scope() }); d.close(); state.view = 'profiles'; await refresh(); await render(); notify('Session profile encrypted and saved.'); } catch (error) { showError(error); } });
}
async function applyProfile(profile) {
  const body = node('div', { class: 'oj-dialog-body cb-card' }, node('h2', { id: 'apply-title', class: 'oj-heading-3' }, `Apply ${profile.name}`));
  const mode = select('Apply mode', 'profile-mode', [['merge', 'Merge'], ['replace', 'Replace only within chosen scope']], 'merge'); const backup = check('Encrypted backup + best-effort rollback on failure', true); const reload = check('Reload target tab after verified apply', false);
  const output = node('pre', { class: 'cb-report', tabindex: '0' });
  let currentPreview;
  const preview = async () => { currentPreview = await rpc('profiles.preview', { id: profile.id, scope: scope(), options: { mode: mode.input.value } }); output.textContent = JSON.stringify(currentPreview, null, 2); };
  mode.input.addEventListener('change', () => preview().catch(showError));
  const d = modal(body, 'apply-title');
  body.append(p(`Scope: ${labelScope()} · Store ${state.storeId}. Apply may overwrite consent cookies, including protected identities: protection applies to cleanup, not an explicit profile state change.`), mode.node, backup.node, reload.node, output, node('div', { class: 'oj-cluster' }, button('Apply & verify', async () => { const result = await rpc('profiles.apply', { id: profile.id, scope: scope(), options: { mode: mode.input.value, backup: backup.input.checked, rollbackOnFailure: backup.input.checked, expectedRemovalIds: currentPreview.removeCookies.map(cookieId) } }); d.close(); if (reload.input.checked && !result.failed) await reloadTarget(); await refresh(); await render(); report('Profile apply results', result); }, 'primary'), button('Cancel', () => d.close()))); await preview();
}
async function reloadTarget() { if (!state.tabId) throw new Error('No target tab is attached. Open Cookiebase from the target site, or reload it manually.'); await chrome.tabs.reload(state.tabId); }
async function debugView() {
  const info = await rpc('history.snapshots'); const events = await rpc('history.list', {});
  const enabled = state.status.history.enabled; const retention = field('Keep at most events (1–10,000)', 'debug-retention', state.status.history.maxEntries, 'number', { min: '1', max: '10000' }); const hours = field('Retention hours (1–168)', 'debug-hours', state.status.history.maxAgeHours, 'number', { min: '1', max: '168' });
  const body = node('div', { class: 'cb-view' }, panel('Cookie debugger', p(`Recording ${enabled ? 'ON' : 'OFF'} · ${state.status.history.droppedEvents || 0} events dropped during bursts. ${state.status.history.recordingError || ''} Timeline contains observed time, identity, cause and attributes; no plaintext values. Overwrite remove/set pairs are correlated. Snapshots are redacted and memory-only, lost on worker restart.`), node('div', { class: 'oj-cluster' }, button(enabled ? 'Stop recording' : 'Start recording', async () => { await rpc('history.configure', { enabled: !enabled }); await refresh(); await render(); }, enabled ? 'danger' : 'primary', { id: 'debug-toggle' }), button('Refresh timeline', async () => { await refresh(); await render(); })), node('div', { class: 'cb-grid' }, retention.node, hours.node), button('Save retention policy', async () => { await rpc('history.configure', { maxEntries: Number(retention.input.value), maxAgeHours: Number(hours.input.value) }); await refresh(); await render(); })));
  const snapName = field('Snapshot label (e.g. Before login / After reload)', 'debug-name', 'Before reload');
  body.append(panel('Snapshots & reload diagnosis', snapName.node, node('div', { class: 'oj-cluster' }, button('Capture current scope', async () => { await rpc('history.capture', { name: snapName.input.value, scope: scope(), tabId: state.tabId }); await render(); }), button('Reload target page', reloadTarget)), p('Capture before and after reload/login/import, then compare. Events show what Cookiebase observed; server invalidation and Set-Cookie rejection reasons are not observable here. OAuth/ADFS redirects can change cookies after a successful import. Check host access, cookie store, hostOnly/subdomains, expiration, partition and browser policy.')));
  const before = select('Before snapshot', 'debug-before', info.map(s => [s.id, `${s.name} (${s.cookieCount})`]), info[0]?.id); const after = select('After snapshot', 'debug-after', info.map(s => [s.id, `${s.name} (${s.cookieCount})`]), info.at(-1)?.id);
  body.append(panel('Compare snapshots', before.node, after.node, button('Compare added / removed / changed', async () => report('Observed snapshot diff', await rpc('history.compare', { before: before.input.value, after: after.input.value })))));
  const domain = field('Timeline domain filter', 'history-domain', '', 'search'); const name = field('Timeline name filter', 'history-name', '', 'search'); const timeline = node('div', { class: 'cb-timeline' }); const draw = () => { let items = events.filter(e => { const c = e.cookie || e; return String(c.domain || '').toLowerCase().includes(domain.input.value.toLowerCase()) && String(c.name || '').toLowerCase().includes(name.input.value.toLowerCase()); }); items = items.filter(e => { const c = e.cookie || e; return inScope(c, scope()); }); timeline.replaceChildren(...items.map(e => node('pre', { class: 'cb-report' }, JSON.stringify(e, null, 2)))); if (!items.length) timeline.append(p('No observed events for these filters. Start recording before reproducing the issue.')); }; domain.input.addEventListener('input', draw); name.input.addEventListener('input', draw); draw();
  body.append(panel(`Timeline · ${labelScope()}`, domain.node, name.node, timeline)); return body;
}
async function settingsView() {
  const grants = await permissions.granted();
  const origins = grants.origins || grants;
  return node('div', { class: 'cb-view' }, panel('Access & browser support', p('Chrome Desktop 132+ is the target. Automated verification uses Playwright Chromium; Edge and Brave are untested. Firefox and Chrome Android are unsupported. Incognito requires Chrome’s explicit Allow in incognito setting and a separate workspace. Enterprise policy cannot be bypassed.'), p('Host access lets Cookiebase read and change cookies for that host. All-sites access is optional and needed for the widest global view. Revoking a host reduces coverage immediately.'), ...origins.map(origin => node('div', { class: 'cb-profile' }, node('code', { class: 'oj-mono' }, origin), button('Revoke access', async () => { await permissions.revoke(origin); await refresh(); await render(); })))), panel('Operation recovery', p('Mutations run in the service worker and have a durable, secret-free journal. Closing the popup does not cancel an accepted operation. After worker interruption, inspect cookies and restore a prior encrypted snapshot; unfinished jobs are never automatically repeated.'), node('pre', { class: 'cb-report' }, JSON.stringify(state.status.jobs, null, 2))), panel('Delete Cookiebase data', p('These actions remove only Cookiebase data. Browser cookie deletion is a separate action in Cookies. Deleting the vault destroys all profiles and Undo snapshots.'), node('div', { class: 'oj-cluster' }, ...['rules', 'history', 'vault', 'all'].map(area => button(`Delete ${area === 'all' ? 'all Cookiebase data' : area}`, async () => { if (await confirmDialog({ title: `Delete ${area} data?`, message: 'This removes local Cookiebase records only. Vault deletion cannot be undone without a prior export. Browser cookies remain unchanged.', confirmLabel: 'Delete data', variant: 'danger' })) { await rpc('data.clear', { area }); await refresh(); await render(); notify('Selected Cookiebase data deleted. Browser cookies were not changed.'); } }, 'danger')))), panel('Privacy', p('All cookie processing is local. No tracking, analytics, advertising, external fonts, remote scripts or search-engine changes. Plaintext clipboard and downloads are outside vault encryption. A compromised OS, browser or unlocked extension session can still access secrets.')));
}
async function boot() {
  if (!state.url) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.url && /^https?:/.test(tab.url)) { state.url = tab.url; state.tabId = tab.id; }
    else if (!popup) state.scopeType = 'all';
  }
  if (state.url) { try { new URL(state.url); } catch { state.url = ''; state.scopeType = 'all'; } }
  await refresh(); await render();
}
window.addEventListener('pagehide', () => { cleanup(); clearTimeout(searchTimer); });
window.addEventListener('hashchange', () => { const view = location.hash.slice(1); if (view && view !== state.view) { state.view = view; render().catch(showError); } });
boot().catch(error => { app.replaceChildren(node('main', { id: 'main', class: 'cb-shell' }, panel('Cookiebase could not open', p(error.message), button('Retry', () => boot())))); });
