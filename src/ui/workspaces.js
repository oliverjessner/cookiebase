import { confirmDialog } from 'oj-designsystem';
import { inScope as inCookieScope } from '../core/cookies.js';
import { matchesRule, validateRule } from '../core/rules.js';
import { h, button, field, select, check, panel, accordion, modal, formError, empty, report } from './components.js';

const paragraph = text => h('p', { class: 'oj-small oj-muted' }, text);
const badge = (text, kind = '') => h('span', { class: `oj-badge${kind ? ` oj-badge-${kind}` : ''}` }, text);
function shortScope(scope) {
  if (!scope || scope.type === 'all') return 'All granted sites';
  if (scope.type === 'domains') return `${(scope.domains || []).join(', ')}${scope.includeSubdomains === false ? '' : ' + subdomains'}`;
  try { return `${new URL(scope.url).hostname}${scope.type === 'site' ? ' + subdomains' : scope.type === 'url' ? new URL(scope.url).pathname : ''}`; }
  catch { return 'Choose a site'; }
}
function time(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Not available' : date.toLocaleString();
}
function metadataTable(headers, rows, caption) {
  return h('div', { class: 'oj-table-container', role: 'region', 'aria-label': caption, tabindex: '0' },
    h('table', { class: 'oj-table oj-table-compact oj-table-hover' }, h('caption', {}, caption),
      h('thead', {}, h('tr', {}, headers.map(label => h('th', { scope: 'col' }, label)))),
      h('tbody', {}, rows.map(cells => h('tr', {}, cells.map(cell => h('td', {}, cell)))))));
}
function tabs(name, entries) {
  const prefix = `workspace-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;
  return h('div', { class: 'oj-tabs', 'data-oj-tabs': '' },
    h('div', { class: 'oj-tab-list', role: 'tablist', 'aria-label': name }, entries.map(([key, label], index) => h('button', {
      class: 'oj-tab', type: 'button', role: 'tab', id: `${prefix}-${key}-tab`, 'aria-controls': `${prefix}-${key}`, 'aria-selected': index === 0 ? 'true' : 'false',
    }, label))),
    entries.map(([key, _label, content]) => h('div', { class: 'oj-tab-panel cb-view', role: 'tabpanel', id: `${prefix}-${key}`, 'aria-labelledby': `${prefix}-${key}-tab` }, content)));
}
async function rerender(ctx) { await ctx.refresh({ render: false }); await ctx.render(); }

function openRule(ctx, existing = null) {
  const d = modal(existing ? 'Edit protected rule' : 'Create protected rule', { id: 'rule-editor' });
  const form = h('form', { id: 'rule-form' });
  let hostname = '';
  try { hostname = new URL(ctx.state.url).hostname; } catch { /* The rule can also target a manually entered site. */ }
  const domain = field('Site or domain pattern', 'rule-domain', existing?.domain ?? hostname, 'text', { required: true, autocomplete: 'off' });
  const name = field('Cookie name pattern (* means any name)', 'rule-name', existing?.name ?? '*');
  const subdomains = check('Include subdomains', existing?.includeSubdomains ?? false);
  const enabled = check('Rule enabled', existing?.enabled !== false);
  const path = field('Path pattern', 'rule-path', existing?.path ?? '*');
  const store = select('Cookie store', 'rule-storeId', [['', 'All stores in this workspace'], ...ctx.state.stores.map(item => [item.id, `${item.incognito ? 'Incognito' : 'Regular'} (${item.id})`])], existing?.storeId ?? '');
  const partition = select('Partition restriction', 'rule-partition-mode', [['any', 'Any partition'], ['none', 'Unpartitioned only'], ['site', 'Specific top-level site']], existing?.partitionKey === null ? 'none' : existing?.partitionKey ? 'site' : 'any');
  const topSite = field('Partition top-level site', 'rule-partition-site', existing?.partitionKey?.topLevelSite ?? '', 'url');
  const ancestor = check('Partition has a cross-site ancestor', existing?.partitionKey?.hasCrossSiteAncestor ?? false);
  const savedScope = existing?.scope ? structuredClone(existing.scope) : ctx.scope();
  if (savedScope.type === 'all' && hostname) { savedScope.type = 'site'; savedScope.url = ctx.state.url; }
  const siteOnly = check(`Limit rule to ${shortScope(savedScope)}`, Boolean(existing?.scope), { disabled: savedScope.type === 'all' });
  const count = h('p', { class: 'oj-inline-message', role: 'status', 'aria-live': 'polite', id: 'rule-match-count' });
  const matches = h('div');
  const draft = () => {
    const rule = { ...existing, domain: domain.input.value.trim(), name: name.input.value, path: path.input.value || '*', enabled: enabled.input.checked, includeSubdomains: subdomains.input.checked };
    if (store.input.value) rule.storeId = store.input.value; else delete rule.storeId;
    if (partition.input.value === 'none') rule.partitionKey = null;
    else if (partition.input.value === 'site') rule.partitionKey = { topLevelSite: topSite.input.value.replace(/\/$/, ''), hasCrossSiteAncestor: ancestor.input.checked };
    else delete rule.partitionKey;
    if (siteOnly.input.checked) rule.scope = savedScope; else delete rule.scope;
    return rule;
  };
  const preview = () => {
    const chosen = partition.input.value === 'site';
    topSite.node.hidden = !chosen; ancestor.node.hidden = !chosen; topSite.input.required = chosen;
    const rule = draft(); const errors = validateRule(rule);
    const selected = errors.length ? [] : ctx.data('scope').filter(cookie => matchesRule(cookie, { ...rule, enabled: true }));
    count.textContent = errors.length ? errors[0] : `Matches ${selected.length} currently loaded cookies${enabled.input.checked ? '' : ' when enabled'}.`;
    matches.replaceChildren(...selected.slice(0, 5).map(cookie => paragraph(`${cookie.name || '(empty name)'} · ${cookie.domain}${cookie.path}`)));
    if (selected.length > 5) matches.append(paragraph(`And ${selected.length - 5} more loaded cookies.`));
  };
  form.append(domain.node, name.node, subdomains.node, enabled.node,
    accordion('Advanced restrictions', path.node, store.node, partition.node, topSite.node, ancestor.node, siteOnly.node,
      paragraph('Patterns use * as a wildcard. A preview covers loaded cookies only; other granted sites may also match a broad rule.')),
    count, matches);
  for (const control of [domain.input, name.input, path.input, store.input, partition.input, topSite.input, ancestor.input, enabled.input, subdomains.input, siteOnly.input]) control.addEventListener('input', preview);
  d.body.append(form);
  const save = h('button', { class: 'oj-button oj-button-primary', type: 'submit', form: 'rule-form' }, 'Save rule');
  d.footer.append(button('Cancel', () => d.close()), save);
  form.addEventListener('submit', async event => {
    event.preventDefault(); save.disabled = true; save.setAttribute('aria-busy', 'true');
    try {
      const rule = draft(); const errors = validateRule(rule);
      if (errors.length) throw new Error(errors.join(' '));
      if (partition.input.value === 'site') { const url = new URL(rule.partitionKey.topLevelSite); if (!['http:', 'https:'].includes(url.protocol) || url.origin !== rule.partitionKey.topLevelSite) throw new Error('Partition top-level site must be an HTTP(S) origin.'); }
      await ctx.rpc('rules.save', { rule }); d.close(); await rerender(ctx); ctx.notify('Protection rule saved.');
    } catch (error) { formError(form, error, { fields: { domain, name, path, partition: topSite } }); }
    finally { save.disabled = false; save.removeAttribute('aria-busy'); }
  });
  preview(); d.open();
}

export async function renderRules(ctx) {
  const rules = ctx.state.status.metadata.rules || [];
  const list = h('div', { class: 'cb-view' });
  const body = h('div', { class: 'cb-view' },
    h('header', { class: 'oj-section-header' }, h('div', {}, h('h2', { class: 'oj-heading-2' }, 'Protected rules'), paragraph('Matching cookies are preserved during cleanup and ordinary imports.')), button('Create protected rule', () => openRule(ctx), 'primary', { id: 'create-rule' })), list);
  if (ctx.state.ruleUndo) {
    const rule = ctx.state.ruleUndo;
    body.insertBefore(h('div', { class: 'oj-alert oj-alert-info', role: 'status' }, h('span', {}, `Protection removed: ${rule.domain} · ${rule.name || '(empty name)'}.`),
      button('Undo rule removal', async () => { await ctx.rpc('rules.save', { rule }); ctx.state.ruleUndo = null; await rerender(ctx); }, 'secondary'),
      button('Dismiss', () => { ctx.state.ruleUndo = null; ctx.render(); }, 'ghost')), list);
  }
  if (!rules.length) list.append(empty('No protected rules', 'Protect a consent cookie from Cookies, or create a site rule here.', button('Create rule', () => openRule(ctx), 'primary')));
  for (const rule of rules) {
    const count = ctx.data('scope').filter(cookie => matchesRule(cookie, { ...rule, enabled: true })).length;
    const toggleInput = h('input', { type: 'checkbox', role: 'switch', checked: rule.enabled !== false, 'aria-label': `Enable rule for ${rule.domain} and ${rule.name || 'empty cookie name'}` });
    const toggle = { input: toggleInput, node: h('label', { class: 'oj-switch' }, toggleInput, h('span', { class: 'oj-switch-track', 'aria-hidden': 'true' }), h('span', {}, 'Enabled')) };
    toggle.input.addEventListener('change', async () => {
      toggle.input.disabled = true;
      try { await ctx.rpc('rules.save', { rule: { ...rule, enabled: toggle.input.checked } }); await ctx.refreshStatus(); }
      catch (error) { toggle.input.checked = !toggle.input.checked; ctx.showError(error, { root: body }); }
      finally { toggle.input.disabled = false; }
    });
    const remove = button('Remove', async () => {
      if (count > 1 && !await confirmDialog({ title: 'Remove protection rule?', message: `${count} currently loaded cookies match this rule. Future cleanup may delete them. You can undo the rule removal from this page.`, confirmLabel: 'Remove protection', variant: 'danger' })) return;
      await ctx.rpc('rules.remove', { id: rule.id }); ctx.state.ruleUndo = structuredClone(rule); await rerender(ctx);
    }, 'ghost');
    list.append(panel(`${rule.domain} · ${rule.name || '(empty name)'}`,
      h('div', { class: 'oj-cluster' }, badge(rule.includeSubdomains ? 'Includes subdomains' : 'Exact domain'), badge(`Path ${rule.path || '*'}`), badge(`${count} loaded matches`), toggle.node),
      paragraph(rule.scope ? `Limited to ${shortScope(rule.scope)}.` : 'Applies wherever the pattern matches in this browser workspace.'),
      h('div', { class: 'oj-cluster' }, button('Edit rule', () => openRule(ctx, rule)), remove)));
  }
  body.append(accordion('How protection works', paragraph('Any enabled matching allowlist protects a cookie. Rules do not cancel one another. Explicit profile replacement or a confirmed import override can change protected identities.')));
  return body;
}

function eventDetail(event) {
  const d = modal('Observed cookie change');
  const cookie = event.cookie || {};
  const entries = [['Cookie', cookie.name || '(empty name)'], ['Site', cookie.domain], ['Path', cookie.path], ['Observed', time(event.observedAt)], ['Change', event.kind], ['Chrome cause', event.cause], ['Value', event.valueChanged === true ? 'Changed (masked)' : event.valueChanged === false ? 'Unchanged' : 'Not compared'], ['Attributes changed', (event.changedAttributes || []).join(', ') || 'None reported']];
  d.body.append(h('dl', { class: 'oj-key-value' }, entries.map(([key, value]) => [h('dt', {}, key), h('dd', {}, value || 'Not available')])),
    accordion('Technical details', h('pre', { class: 'oj-code-block', tabindex: '0' }, JSON.stringify(event, null, 2))));
  d.footer.append(button('Close', () => d.close())); d.open();
}

export async function renderDebug(ctx) {
  const local = ctx.state.debugUI ??= { paused: false, domain: '', name: '', viewScope: 'recording', page: 0 };
  let info = await ctx.rpc('history.snapshots');
  let policy = ctx.state.status.history;
  let events = [];
  let disposed = false; let polling = false; let liveError = null;
  const body = h('div', { class: 'cb-view' });
  const liveStatus = h('span', { class: 'oj-status', id: 'debug-live-status', role: 'status', 'aria-live': 'polite' });
  const scopeStatus = h('p', { class: 'oj-small cb-value', id: 'recording-scope-status' });
  const recording = select('Recording scope', 'debug-recording-scope', [['site', 'Displayed site / chosen scope'], ['all', 'All granted sites in this workspace']], policy.enabled && policy.recordingScope?.type === 'all' ? 'all' : 'site');
  const hasSite = (() => { try { return ['http:', 'https:'].includes(new URL(ctx.state.url).protocol) || ctx.scope().type === 'domains'; } catch { return false; } })();
  if (!hasSite && !policy.enabled) recording.input.value = 'all';
  const chosenRecordingScope = () => { const chosen = ctx.scope(); return chosen.type === 'all' && hasSite ? { ...chosen, type: 'host', url: ctx.state.url } : chosen; };
  const startStop = button(policy.enabled ? 'Stop recording' : 'Start recording', async () => {
    const requested = recording.input.value === 'all' ? { type: 'all', incognito: ctx.state.status.incognito, storeId: ctx.scope().storeId } : chosenRecordingScope();
    if (!policy.enabled && requested.type !== 'all' && !hasSite) throw new Error('Choose an HTTP(S) site before starting a site-scoped recording.');
    policy = await ctx.rpc('history.configure', policy.enabled ? { enabled: false } : { enabled: true, recordingScope: requested });
    await ctx.refreshStatus(); updateStatus(); await updateTimeline(true);
  }, policy.enabled ? 'danger' : 'primary', { id: 'debug-toggle' });
  const pause = button(local.paused ? 'Resume live view' : 'Pause live view', async () => { local.paused = !local.paused; updateStatus(); if (!local.paused) await updateTimeline(true); });
  const domain = field('Timeline domain filter', 'history-domain', local.domain, 'search');
  const name = field('Timeline cookie filter', 'history-name', local.name, 'search');
  const viewScope = select('View filter', 'debug-view-scope', [['recording', 'All recorded sites'], ['current', 'Displayed site / chosen scope']], local.viewScope);
  const timeline = h('div', { class: 'cb-timeline', id: 'debug-timeline' });
  const count = h('p', { class: 'oj-small oj-muted', 'aria-live': 'polite' });
  const dropped = h('p', { class: 'oj-inline-message', id: 'debug-dropped-events' });
  const timelineError = h('p', { class: 'oj-inline-message', role: 'alert', hidden: true });
  const draw = () => {
    let rows = events.filter(event => (event.cookie?.domain || '').toLowerCase().includes(local.domain.toLowerCase()) && (event.cookie?.name || '').toLowerCase().includes(local.name.toLowerCase()));
    if (local.viewScope === 'current') rows = rows.filter(event => matchesScope(event.cookie, ctx.scope()));
    const pages = Math.max(1, Math.ceil(rows.length / 50)); local.page = Math.min(local.page || 0, pages - 1);
    const visible = rows.slice(local.page * 50, local.page * 50 + 50);
    count.textContent = `${rows.length} observed events · Page ${local.page + 1} of ${pages}${local.paused ? ' · View paused; recording state is unchanged' : ''}. Values stay masked.`;
    if (!rows.length) {
      timeline.replaceChildren(empty(policy.enabled ? 'Waiting for observed changes' : 'No observed cookie changes', policy.enabled ? 'Use the site and new matching cookie changes will appear here. An empty timeline does not establish that the site has no cookies.' : 'Choose what to record, then Start recording before reproducing the issue.'));
      return;
    }
    timeline.replaceChildren(metadataTable(['Observed', 'Cookie / site', 'Change', 'Cause', 'Details'], visible.map(event => [time(event.observedAt), h('div', {}, h('strong', {}, event.cookie?.name || '(empty name)'), paragraph(`${event.cookie?.domain || ''}${event.cookie?.path || '/'}`)), badge(event.kind === 'overwrite-pending' ? 'Overwrite pending' : event.kind, event.kind === 'remove' ? 'warning' : event.kind === 'add' ? 'success' : 'info'), event.cause, button('Inspect change', () => eventDetail(event), 'ghost')]), 'Observed cookie events'), h('nav', { class: 'oj-pagination', 'aria-label': 'Timeline pages' }, button('Previous events', () => { local.page--; draw(); }, 'ghost', { disabled: local.page === 0 }), paragraph(`Page ${local.page + 1} of ${pages}`), button('Next events', () => { local.page++; draw(); }, 'ghost', { disabled: local.page + 1 >= pages })));
  };
  function updateStatus() {
    startStop.textContent = policy.enabled ? 'Stop recording' : 'Start recording';
    startStop.className = `oj-button oj-button-${policy.enabled ? 'danger' : 'primary'}`;
    recording.input.disabled = policy.enabled;
    pause.textContent = local.paused ? 'Resume live view' : 'Pause live view';
    liveStatus.textContent = policy.enabled ? `Recording · ${local.paused ? 'View paused' : 'Live view'}` : `Recording off${local.paused ? ' · View paused' : ''}`;
    const chosen = policy.enabled ? policy.recordingScope : recording.input.value === 'all' ? { type: 'all' } : chosenRecordingScope();
    scopeStatus.textContent = `${policy.enabled ? 'Recording' : 'Ready to record'}: ${shortScope(chosen)}. Viewing filters do not change what is recorded.`;
    dropped.textContent = `${ctx.state.status.history.droppedEvents || 0} events dropped during bursts in this worker session. ${ctx.state.status.history.recordingError || ''}`;
  }
  async function updateTimeline(force = false) {
    if (disposed || polling || (!force && (local.paused || document.hidden))) return;
    polling = true;
    try {
      const [status, next] = await Promise.all([ctx.rpc('status'), ctx.rpc('history.list', {})]);
      if (disposed) return;
      ctx.state.status = status; policy = status.history; events = next; liveError = null; timelineError.hidden = true; updateStatus(); draw();
    } catch (error) { if (!disposed) { liveStatus.textContent = 'Live view unavailable'; if (liveError !== error.message) { liveError = error.message; timelineError.textContent = `Live update unavailable: ${error.message}. Use Refresh timeline to retry.`; timelineError.hidden = false; } } }
    finally { polling = false; }
  }
  for (const [control, key] of [[domain.input, 'domain'], [name.input, 'name'], [viewScope.input, 'viewScope']]) control.addEventListener('input', () => { local[key] = control.value; local.page = 0; draw(); });
  recording.input.addEventListener('change', updateStatus);
  const maxEntries = field('Maximum retained events', 'debug-retention', policy.maxEntries, 'number', { min: '1', max: '10000', required: true });
  const maxAge = field('Retention hours', 'debug-hours', policy.maxAgeHours, 'number', { min: '1', max: '168', required: true });
  const retention = h('form', {}, h('div', { class: 'cb-grid' }, maxEntries.node, maxAge.node));
  retention.append(h('button', { type: 'submit', class: 'oj-button oj-button-secondary' }, 'Save retention policy'));
  retention.addEventListener('submit', async event => { event.preventDefault(); try { await ctx.rpc('history.configure', { maxEntries: Number(maxEntries.input.value), maxAgeHours: Number(maxAge.input.value) }); await ctx.refreshStatus(); ctx.notify('Recording retention updated.'); await updateTimeline(true); } catch (error) { formError(retention, error, { fields: { maxEntries, maxAgeHours: maxAge } }); } });
  const timelinePanel = panel('Change timeline', h('div', { class: 'cb-grid' }, domain.node, name.node, viewScope.node), count, timelineError, timeline);
  const snapshotsPanel = h('div', { class: 'cb-view' });
  const snapshotName = field('Snapshot label', 'debug-name', 'Before action', 'text', { maxlength: '120' });
  const before = select('Before snapshot', 'debug-before', [], ''); const after = select('After snapshot', 'debug-after', [], '');
  const snapshotStatus = h('p', { class: 'oj-inline-message', role: 'status' });
  const compare = button('Compare snapshots', async () => { const diff = await ctx.rpc('history.compare', { before: before.input.value, after: after.input.value }); report('Observed snapshot comparison', diff); });
  const snapshotCompatible = (a, b) => a && b && a.id !== b.id && a.scope.storeId === b.scope.storeId && Boolean(a.scope.incognito) === Boolean(b.scope.incognito);
  const updateSnapshots = () => {
    const oldBefore = before.input.value; const oldAfter = after.input.value;
    before.input.replaceChildren(...info.map(item => h('option', { value: item.id }, `${item.name} · ${time(item.observedAt)} · ${item.cookieCount} cookies`)));
    after.input.replaceChildren(...info.map(item => h('option', { value: item.id }, `${item.name} · ${time(item.observedAt)} · ${item.cookieCount} cookies`)));
    before.input.value = info.some(item => item.id === oldBefore) ? oldBefore : info[0]?.id || '';
    after.input.value = info.some(item => item.id === oldAfter) ? oldAfter : info.at(-1)?.id || '';
    const a = info.find(item => item.id === before.input.value); const b = info.find(item => item.id === after.input.value);
    compare.disabled = !snapshotCompatible(a, b);
    before.input.disabled = !info.length; after.input.disabled = !info.length;
    snapshotStatus.textContent = info.length < 2 ? 'Capture a before snapshot, perform the action, then capture an after snapshot.' : !snapshotCompatible(a, b) ? 'Choose two different snapshots from the same store and privacy context.' : `${shortScope(a.scope)} → ${shortScope(b.scope)} · ${a.cookieCount} / ${b.cookieCount} cookies`;
  };
  const capture = async nameValue => {
    const captured = await ctx.rpc('history.capture', { name: nameValue || snapshotName.input.value || 'Snapshot', scope: ctx.scope(), tabId: ctx.state.tabId });
    info = await ctx.rpc('history.snapshots'); after.input.value = captured.id; updateSnapshots();
    if (info.length === 1) snapshotName.input.value = 'After action';
    ctx.notify(`${captured.cookieCount} cookies captured for comparison. Values remain masked.`);
    return captured;
  };
  const reload = button('Reload bound site', async () => { await ctx.reloadTarget(); ctx.notify('Bound site reloaded. Capture the after snapshot once the site has settled.'); });
  const binding = await ctx.tabBinding?.();
  if (binding) { reload.disabled = !binding.valid; reload.title = binding.valid ? binding.title || binding.url : 'No matching live tab is attached to this site.'; }
  snapshotsPanel.append(panel('Before / after comparison',
    h('div', { class: 'oj-alert oj-alert-info' }, 'Debug snapshots are redacted and memory-only. They disappear when the worker restarts and cannot restore cookies.'),
    snapshotName.node, h('div', { class: 'oj-cluster' }, button('Capture before', () => capture('Before action')), reload, button('Capture after', () => capture('After action')), button('Capture named snapshot', () => capture(), 'ghost')),
    paragraph('1. Capture before. 2. Reload, log in or import. 3. Capture after. 4. Compare observed differences. Server-side session validity and Set-Cookie rejection reasons are not observable here.'),
    before.node, after.node, snapshotStatus, compare));
  before.input.addEventListener('change', updateSnapshots); after.input.addEventListener('change', updateSnapshots);
  body.append(h('header', { class: 'oj-section-header' }, h('h2', { class: 'oj-heading-2' }, 'Cookie debugger'), liveStatus),
    panel('Recording', recording.node, scopeStatus, h('div', { class: 'oj-cluster' }, startStop, pause, button('Refresh timeline', () => updateTimeline(true))), dropped,
      accordion('Recording settings', retention, paragraph('Recording starts OFF. Observed timestamps are not cookie creation times. Names, sites and attributes are local metadata; no plaintext values are retained.'))),
    tabs('Debug views', [['timeline', 'Timeline', timelinePanel], ['snapshots', 'Snapshots', snapshotsPanel]]));
  updateStatus(); updateSnapshots(); await updateTimeline(true);
  const timer = setInterval(() => { void updateTimeline(); }, 1200);
  ctx.cleanup(() => { disposed = true; clearInterval(timer); });
  return body;
}

function matchesScope(cookie, scope) {
  // Keep one canonical matching implementation across inspection and timeline.
  return cookie && inCookieScope(cookie, scope);
}

const jobName = type => ({ set: 'Save cookie', delete: 'Delete cookies', disable: 'Temporarily disable cookie', 'import.execute': 'Import cookies', 'profiles.apply': 'Apply session profile', 'profiles.create': 'Save session profile', 'snapshots.restore': 'Restore saved cookies', 'rules.save': 'Save protection rule', 'rules.remove': 'Remove protection rule' }[type] || String(type || 'Cookiebase operation').replaceAll('.', ' '));
function jobState(job) {
  if (job.status === 'interrupted') return 'Interrupted — inspect current cookies before retrying';
  if (job.status === 'failed') return 'Failed — review the current state';
  if (job.status === 'running') return 'In progress';
  const failed = job.summary?.failed ?? job.failed;
  return failed > 0 ? `Finished with ${failed} errors` : job.summary ? 'Finished — see result counts' : 'Finished — per-cookie result not retained';
}

export async function renderSettings(ctx) {
  await ctx.refreshStatus();
  const grants = ctx.permissions ? await ctx.permissions.granted() : ctx.state.coverage?.origins || [];
  const origins = grants.origins || grants;
  const access = h('div', { class: 'cb-view' },
    panel('Site access', paragraph('Only grant sites you intend to inspect or change. All-sites access is optional.'), button('Manage site access', () => ctx.manageAccess?.()),
      ...(origins.length ? origins.map(origin => {
        let name; try { name = new URL(origin.replace('*.', '')).hostname || 'All sites'; } catch { name = origin.includes('*') ? 'All granted sites' : origin; }
        return h('div', { class: 'cb-record-row' }, h('div', {}, h('strong', {}, name), accordion('Permission pattern', h('code', { class: 'oj-mono' }, origin))), button('Revoke access', async () => { await ctx.permissions.revoke(origin); await rerender(ctx); }));
      }) : [empty('No sites granted', 'Grant a site when you open its cookies. You can still manage Cookiebase settings without granting a website.')])));
  const vault = ctx.state.status.vault;
  const security = panel('Security & vault', h('div', { class: 'oj-cluster' }, badge(vault.initialized ? vault.locked ? 'Vault locked' : 'Vault unlocked' : 'Vault not created', vault.locked ? 'warning' : 'success'), button(vault.locked ? 'Unlock vault' : 'Lock vault', async () => { if (vault.locked) await ctx.ensureVault(); else await ctx.rpc('vault.lock'); await rerender(ctx); })),
    paragraph('Profile metadata and saved cookie values are encrypted locally. The key is kept only in worker memory; worker/browser restart locks the vault. Forgotten passphrases cannot be recovered.'),
    accordion('Encryption details', paragraph('AES-256-GCM with fresh IVs and PBKDF2-SHA-256 (600,000 iterations). Cookiebase does not encrypt downloaded exports or clipboard contents.')));
  const jobs = ctx.state.status.jobs || [];
  const activity = panel('Activity & recovery', paragraph('Closing a surface does not cancel an accepted operation. Interrupted jobs are never automatically replayed. Inspect cookies and use a saved restore point when available.'),
    jobs.length ? metadataTable(['Action', 'Started', 'Result', 'Details'], jobs.map(job => [jobName(job.type), time(job.startedAt), h('span', { class: 'oj-status' }, jobState(job)), accordion('Technical details', h('pre', { class: 'oj-code-block', tabindex: '0' }, JSON.stringify(job, null, 2)))]), 'Recent Cookiebase operations') : empty('No recent operations', 'Cookie changes, imports and profile applications will appear here.'));
  const profileCount = vault.profileCount == null ? 'all encrypted profiles' : `${vault.profileCount} profiles`;
  const snapshotCount = vault.snapshotCount == null ? 'all encrypted restore points' : `${vault.snapshotCount} restore points`;
  const dangers = [
    ['rules', 'Delete protection rules', `${ctx.state.status.metadata.rules?.length || 0} rules will be removed. Future cleanup may delete previously protected cookies.`],
    ['history', 'Delete debug history', `${ctx.state.status.history.eventCount ?? 'All'} redacted events and memory-only comparisons will be cleared, and recording will stop.`],
    ['vault', 'Delete encrypted vault', `Deletes ${profileCount} and ${snapshotCount}. Disabled-cookie backups will also be lost.`],
    ['all', 'Delete all Cookiebase data', `Deletes settings, rules, history, ${profileCount} and ${snapshotCount}. Browser cookies remain unchanged.`],
  ];
  const privacy = h('div', { class: 'cb-view' }, panel('Local processing', paragraph('No account, tracking, analytics, advertising, remote fonts or cookie uploads. Cookiebase does not change your search engine or homepage.'), paragraph('Revealed values, clipboard copies and downloaded files can grant account access. External copies are unencrypted and must be managed separately.')),
    accordion('Danger zone — remove Cookiebase data', h('div', { class: 'oj-alert oj-alert-danger' }, 'These actions permanently remove Cookiebase records. They do not delete browser cookies.'),
      ...dangers.map(([area, label, impact]) => h('section', { class: 'cb-card' }, h('h3', { class: 'oj-heading-4' }, label), paragraph(impact), button(label, async () => {
        if (!await confirmDialog({ title: `${label}?`, message: `${impact} This cannot be undone without an external backup.`, confirmLabel: label, variant: 'danger' })) return;
        await ctx.rpc('data.clear', { area }); if (area === 'rules' || area === 'all') ctx.state.ruleUndo = null; await rerender(ctx); ctx.notify('Selected Cookiebase records deleted. Browser cookies were kept.');
      }, 'danger')))));
  const about = panel('About Cookiebase', paragraph('Chrome Desktop 132+ is the target. Automated tests use Playwright Chromium. Edge/Brave and the minimum-version engine have not been independently tested. Firefox, Safari and Chrome Android are unsupported.'), paragraph('Incognito requires Chrome permission and uses a separate cookie store. Persistent incognito vaults and profiles are disabled. Browser policy, hidden partition contexts and server-side session invalidation remain outside Cookiebase control.'), paragraph('Cookiebase source is inspectable in this repository. A project licence has not been declared; dependency notices are included in the build.'));
  return h('div', { class: 'cb-view' }, h('h2', { class: 'oj-heading-2' }, 'Settings'), tabs('Settings sections', [['access', 'Site access', access], ['security', 'Security & vault', security], ['activity', 'Activity', activity], ['privacy', 'Data & privacy', privacy], ['about', 'About', about]]));
}
