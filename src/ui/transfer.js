import { confirmDialog } from 'oj-designsystem';
import { cookieId, scopeLabel } from '../core/cookies.js';
import { exportCookies } from '../services/transfer.js';
import { h, replace, button, field, select, check, panel, accordion, modal, formError, keyValues, report } from './components.js';

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const sourceNames = { scope: 'Current scope', filtered: 'Filtered results', selected: 'Selected cookies' };
const cookieMetadata = cookie => ({ name: cookie.name, domain: cookie.domain, path: cookie.path, storeId: cookie.storeId, partitionKey: cookie.partitionKey });
function httpTarget(value) {
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) ? url : null; } catch { return null; }
}
export function importConfiguration({ scopeType, targetUrl, domains, storeId, incognito = false, mode = 'merge', remapDomain = false }) {
  const target = httpTarget(targetUrl);
  if (!storeId) throw new Error('Choose an accessible destination cookie store.');
  if (!['host', 'site', 'url', 'domains', 'all'].includes(scopeType)) throw new Error('Choose an explicit destination scope.');
  if ((['host', 'site', 'url'].includes(scopeType) || remapDomain) && !target) throw new Error('Enter a valid HTTP(S) destination URL. The website does not need to be open.');
  const sites = String(domains || '').split(/[\s,]+/).filter(Boolean);
  if (scopeType === 'domains' && !sites.length) throw new Error('Enter at least one destination domain.');
  if (sites.some(site => /[\s/:?#@]/.test(site))) throw new Error('Use domain names without a scheme, port or path.');
  if (!['skip', 'merge', 'replace'].includes(mode)) throw new Error('Choose an import strategy.');
  return { scope: { type: scopeType, ...(target ? { url: target.href } : {}), ...(scopeType === 'domains' ? { domains: sites } : {}), storeId, incognito },
    options: { mode, ...(target ? { targetUrl: target.href } : {}), storeId, remapDomain } };
}
function download(content, filename, mime) {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const link = h('a', { href: url, download: filename });
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
function safePreview(plan) {
  return { scope: plan.scope, mode: plan.mode, counts: plan.counts, requiredOrigins: plan.requiredOrigins, warnings: plan.warnings, invalid: plan.invalid,
    mapping: plan.mapping, actions: plan.actions.map(action => ({ ...cookieMetadata(action.cookie), action: action.action, reason: action.reason })), removals: plan.removals.map(cookieMetadata) };
}
function operationTable(caption, headers, rows) {
  return h('div', { class: 'oj-table-container', role: 'region', 'aria-label': caption, tabindex: '0' },
    h('table', { class: 'oj-table oj-table-compact' }, h('caption', {}, caption), h('thead', {}, h('tr', {}, headers.map(label => h('th', { scope: 'col' }, label)))),
      h('tbody', {}, rows.map(row => h('tr', {}, row.map(value => h('td', { class: 'cb-break' }, value ?? '—')))))));
}

/** Separate dialogs retain each task's own source, scope, preview and result state. */
export function openTransfer(ctx, { tab = 'import', source = 'scope' } = {}) {
  return tab === 'export' ? openExport(ctx, source) : openImport(ctx);
}
function openExport(ctx, initialSource) {
  const dialog = modal('Export cookies', { id: 'cookie-export' });
  const scope = structuredClone(ctx.scope());
  const datasets = Object.fromEntries(Object.keys(sourceNames).map(source => [source, structuredClone(ctx.data(source))]));
  const choice = select('Cookies to export', 'export-source', Object.entries(sourceNames).map(([key, name]) => [key, `${name} (${datasets[key].length})`, key === 'selected' && !datasets[key].length]), datasets[initialSource]?.length ? initialSource : 'scope');
  const purpose = select('Export purpose', 'export-purpose', [['redacted', 'Share a redacted report — no secret values'], ['working', 'Export working cookies — contains secrets']], 'redacted');
  const format = select('File format', 'export-format', [['json', 'Cookiebase JSON — retains supported attributes'], ['netscape', 'Netscape cookies.txt — for tools such as yt-dlp']], 'json');
  const acknowledge = check('I understand these values can grant account access and the output is unencrypted.', false, { id: 'export-secrets-consent' });
  const risk = h('div', { class: 'oj-alert oj-alert-warning', hidden: true }, h('p', {}, 'Working cookie exports can grant account access. Files and clipboard history are outside vault encryption. Share only with a trusted recipient.'), acknowledge.node);
  const details = h('div', { id: 'export-count', 'aria-live': 'polite' });
  const formatHelp = h('p', { class: 'oj-helper' });
  const feedback = h('div', { id: 'export-status', class: 'oj-inline-message', role: 'status', hidden: true });
  const outputActions = h('div', { class: 'oj-cluster' });
  const copy = button('Copy to clipboard', () => output(true), 'secondary', { id: 'export-copy' });
  const save = button('Download file', () => output(false), 'primary', { id: 'export-download' });
  outputActions.append(copy, save);
  function update() {
    const records = datasets[choice.input.value];
    const secrets = purpose.input.value === 'working';
    risk.hidden = !secrets;
    const partitioned = records.some(cookie => cookie.partitionKey);
    format.input.querySelector('option[value="netscape"]').disabled = partitioned;
    if (partitioned && format.input.value === 'netscape') format.input.value = 'json';
    const empty = !records.length;
    copy.disabled = empty || (secrets && !acknowledge.input.checked); save.disabled = copy.disabled;
    details.replaceChildren(keyValues([['Scope', scopeLabel(scope)], ['Source', `${sourceNames[choice.input.value]} · ${records.length} cookies`], ['Values', secrets ? 'Included — unencrypted session secrets' : 'Removed — informational report, cannot restore cookies']]));
    formatHelp.textContent = partitioned ? 'This selection contains partitioned cookies. Use JSON to retain partition identity.' : format.input.value === 'netscape' ? 'Netscape preserves domain/path, Secure, HttpOnly and expiration; it loses SameSite and store metadata.' : 'Versioned Cookiebase JSON retains every supported cookie attribute, including store and partition identity.';
  }
  for (const input of [choice.input, purpose.input, format.input, acknowledge.input]) input.addEventListener('change', update);
  async function output(clipboard) {
    try {
      const records = datasets[choice.input.value];
      const redacted = purpose.input.value !== 'working';
      if (!records.length) throw new Error('Choose a source containing at least one cookie.');
      if (!redacted && !acknowledge.input.checked) throw new Error('Confirm that you intend to handle unencrypted session secrets.');
      if (!redacted && !await confirmDialog({ title: 'Export session secrets?', message: `${records.length} cookies from ${scopeLabel(scope)} will leave the encrypted vault boundary. Clipboard history and downloaded files can be read by other applications or recipients.`, confirmLabel: 'Export values' })) return;
      const content = exportCookies(records, { scope, format: format.input.value, redacted });
      let message;
      if (clipboard) { await navigator.clipboard.writeText(content); message = `Copied ${records.length} ${redacted ? 'redacted ' : ''}cookies to clipboard.`; }
      else {
        const name = `cookies-${new Date().toISOString().slice(0, 10)}.${format.input.value === 'json' ? 'json' : 'txt'}`;
        download(content, name, format.input.value === 'json' ? 'application/json' : 'text/plain');
        message = `Download requested: ${name} (${records.length} cookies). Check browser Downloads for completion and location.`;
      }
      feedback.hidden = false; feedback.textContent = message; ctx.notify(message);
    } catch (error) { formError(dialog.element, error); }
    finally { update(); }
  }
  dialog.body.append(choice.node, purpose.node, risk, format.node, details, formatHelp, h('p', { class: 'oj-helper' }, 'This is a snapshot of the chosen cookie set when the dialog opened. Reopen Export to refresh it.'), feedback, outputActions);
  dialog.footer.append(button('Done', () => dialog.close()));
  update(); dialog.open(); return dialog;
}
function openImport(ctx) {
  const initial = structuredClone(ctx.scope());
  const dialog = modal('Import cookies', { id: 'cookie-import' });
  const state = { step: 1, plan: null, revision: 0, previewRevision: -1, ready: false, validPlan: false, busy: false, missingOrigins: [] };
  const steps = h('p', { id: 'import-step', class: 'oj-kicker', 'aria-live': 'polite' });
  const content = h('div', { class: 'cb-card' });
  const feedback = h('div', { id: 'import-feedback', class: 'oj-inline-message', role: 'status', hidden: true });
  const controls = h('div', { class: 'oj-cluster' });
  const file = field('Import file', 'import-file', '', 'file', { accept: '.json,.txt,application/json,text/plain' });
  const source = field('Paste JSON or Netscape cookies.txt', 'import-text', '', 'textarea', { rows: '7', spellcheck: 'false', autocomplete: 'off' });
  const dropzone = h('div', { class: 'oj-dropzone', id: 'import-dropzone' }, file.node);
  const sourcePanel = panel('1. Choose source', h('p', { class: 'oj-helper' }, 'Choose a cookie file, paste its contents, or drop a file here. Nothing changes until you approve a preview.'), dropzone, source.node,
    button('Read clipboard', () => navigator.clipboard.readText().then(text => { source.input.value = text; invalidate(); }).catch(() => { throw new Error('Clipboard read was denied. Paste into the text field or choose a file instead.'); }), 'ghost'));
  const target = field('Destination URL (does not need to be open)', 'import-target', initial.url || ctx.state.url || '', 'url');
  const scopes = select('Destination scope', 'import-scope', [['host', 'Exact destination host'], ['site', 'Destination site including subdomains'], ['domains', 'Selected destination domains'], ['all', 'All granted sites in this store']], ['host', 'site', 'domains', 'all'].includes(initial.type) ? initial.type : 'host');
  const domains = field('Destination domains (comma separated)', 'import-domains', (initial.domains || []).join(', '));
  const stores = select('Destination cookie store', 'import-store', ctx.state.stores.map(store => [store.id, `${store.incognito ? 'Incognito' : 'Regular'} · Store ${store.id}`]), initial.storeId || ctx.state.stores[0]?.id || '');
  const mapping = select('Source domain handling', 'import-mapping', [['preserve', 'Keep domains from file; fill missing domains from destination URL'], ['target', 'Explicitly copy all cookies to the destination domain']], 'preserve');
  const mode = select('Import strategy', 'import-mode', [['skip', 'Add missing only'], ['merge', 'Add and overwrite matching cookies'], ['replace', 'Replace only within the destination scope']], 'merge');
  const backup = check('Create an encrypted backup before overwrites', false, { id: 'import-backup' });
  const backupStatus = h('p', { class: 'oj-helper', id: 'import-backup-status' });
  const override = check('Override protection for this import', false, { id: 'import-protection-override' });
  const sensitive = h('div', { class: 'oj-alert oj-alert-warning', hidden: true }, 'Explicit remapping changes the cookie domain, but keeps supplied store and privacy metadata. Credentials may not work on another site. Existing destination cookies may be overwritten according to the chosen strategy.');
  const destinationSummary = h('p', { class: 'oj-helper' }, 'The scope below belongs to this import. Changing it does not change or depend on the manager’s current scope. Supplied store IDs are preserved; cross-context transfers are refused.');
  const destinationPanel = panel('2. Destination & strategy', destinationSummary, h('div', { class: 'cb-grid' }, target.node, scopes.node, stores.node), domains.node, mapping.node, sensitive, mode.node, backup.node, backupStatus, accordion('Protection override', h('p', { class: 'oj-helper' }, 'Protected cookies are preserved by default. Only enable this if you deliberately want to replace consent or session cookies covered by your allowlist.'), override.node), button('Grant destination access', () => {
    if (!httpTarget(target.input.value)) throw new Error('Enter a valid HTTP(S) destination URL before requesting access.');
    return ctx.requestSite(target.input.value).then(granted => { if (!granted) throw new Error('Destination access was declined. The import can only write granted hosts.'); feedback.hidden = false; feedback.textContent = 'Destination host access granted. Preview the import to inspect all required origins.'; });
  }, 'secondary', { id: 'import-grant-target' }));
  const preview = h('div', { id: 'import-preview', class: 'cb-card', 'aria-live': 'polite' });
  const previewPanel = panel('3. Review changes', preview);
  const apply = h('button', { type: 'button', id: 'import-apply', class: 'oj-button oj-button-primary', disabled: true }, 'Apply import & verify');
  const back = button('Back', () => { if (state.step > 1) show(state.step - 1); }, 'ghost', { id: 'import-back' });
  const next = button('Choose destination', () => {
    if (!source.input.value.trim()) { source.setError('Choose a file or paste cookies before continuing.'); source.input.focus(); return; }
    show(2);
  }, 'primary', { id: 'import-next' });
  const inspect = h('button', { type: 'button', class: 'oj-button oj-button-primary', id: 'import-preview-action' }, 'Parse & preview');
  const ensureState = () => {
    const replacing = mode.input.value === 'replace';
    if (replacing) backup.input.checked = true;
    backup.input.disabled = replacing;
    backupStatus.textContent = replacing ? 'Encrypted backup is required for Replace. You can unlock or create the vault before applying without losing this import.' : 'An encrypted backup is optional for merge and add-only imports. Vault unlock will be requested before applying if needed.';
    domains.node.hidden = scopes.input.value !== 'domains';
    sensitive.hidden = mapping.input.value !== 'target';
  };
  function invalidate() {
    state.revision++; state.ready = false; apply.disabled = true;
    if (state.plan) { feedback.hidden = false; feedback.textContent = 'Preview out of date. Update the preview before applying changes.'; }
  }
  function configuration() {
    const config = importConfiguration({ scopeType: scopes.input.value, targetUrl: target.input.value.trim(), domains: domains.input.value, storeId: stores.input.value, incognito: Boolean(ctx.state.status?.incognito), mode: mode.input.value, remapDomain: mapping.input.value === 'target' });
    config.options.overrideProtection = override.input.checked;
    return config;
  }
  function show(step) {
    state.step = step; steps.textContent = `Step ${step} of 3 · ${step === 1 ? 'Source' : step === 2 ? 'Destination & strategy' : 'Preview'}`;
    sourcePanel.hidden = step !== 1; destinationPanel.hidden = step !== 2; previewPanel.hidden = step !== 3;
    replace(controls, step > 1 ? back : null, step === 1 ? next : null, step >= 2 ? inspect : null, step === 3 ? apply : null);
    inspect.textContent = state.plan ? 'Update preview' : 'Parse & preview';
    if (step === 3) apply.disabled = !state.ready;
    if (step === 1) source.input.focus(); else if (step === 2) target.input.focus();
  }
  async function readFile(candidate) {
    if (!candidate) return;
    if (candidate.size > MAX_FILE_BYTES) throw new Error('Import files must be at most 5 MiB. Split larger files into smaller scopes.');
    source.input.value = await candidate.text(); invalidate();
    feedback.hidden = false; feedback.textContent = `${candidate.name} loaded. Choose the destination to continue.`;
  }
  file.input.addEventListener('change', () => readFile(file.input.files[0]).catch(error => formError(dialog.element, error)));
  sourcePanel.addEventListener('dragover', event => { event.preventDefault(); dropzone.setAttribute('data-oj-state', 'drag-active'); });
  sourcePanel.addEventListener('dragleave', () => dropzone.removeAttribute('data-oj-state'));
  sourcePanel.addEventListener('drop', event => {
    event.preventDefault(); dropzone.removeAttribute('data-oj-state');
    if (event.dataTransfer.files[0]) readFile(event.dataTransfer.files[0]).catch(error => formError(dialog.element, error));
    else { source.input.value = event.dataTransfer.getData('text/plain'); invalidate(); }
  });
  for (const input of [source.input, target.input, domains.input]) input.addEventListener('input', invalidate);
  for (const input of [scopes.input, stores.input, mapping.input, mode.input, override.input]) input.addEventListener('change', () => { ensureState(); invalidate(); });
  backup.input.addEventListener('change', invalidate);
  async function checkAccess(plan) {
    const access = await Promise.all(plan.requiredOrigins.map(async origin => [origin, await chrome.permissions.contains({ origins: [origin] })]));
    state.missingOrigins = access.filter(([, granted]) => !granted).map(([origin]) => origin);
    state.ready = state.validPlan && !state.missingOrigins.length;
    apply.disabled = !state.ready;
  }
  function drawPreview(plan) {
    const counts = plan.counts;
    preview.replaceChildren(keyValues([['Destination scope', scopeLabel(plan.scope)], ['Strategy', mode.input.selectedOptions[0].textContent], ['Ready', `${counts.valid} valid · ${counts.invalid} invalid`], ['Changes', `${counts.imported} additions · ${counts.overwritten} overwrites · ${counts.removed} removals · ${counts.skipped} skipped`], ['Protection', `${counts.protectedRemovals || 0} protected removals / ${counts.protectedOverwrites || 0} protected overwrites ${override.input.checked ? 'will be allowed by explicit override' : 'will be preserved'}`]]));
    if (state.missingOrigins.length) preview.append(h('div', { class: 'oj-alert oj-alert-warning', id: 'import-missing-access' }, `Host access is required for ${state.missingOrigins.length} destination origin${state.missingOrigins.length === 1 ? '' : 's'}. Grant the listed sites before applying.`));
    if (plan.warnings.length) preview.append(h('div', { class: 'oj-alert oj-alert-warning' }, h('ul', { class: 'oj-bullet-list' }, plan.warnings.map(warning => h('li', {}, warning)))));
    const rows = plan.actions.slice(0, 100).map(action => [action.cookie.name || '(empty name)', action.cookie.domain, action.cookie.path, action.cookie.storeId, action.action === 'import' ? 'Add' : action.action === 'overwrite' ? 'Overwrite' : 'Skip']);
    if (rows.length) preview.append(operationTable(`Cookie changes (${plan.actions.length})`, ['Cookie', 'Destination domain', 'Path', 'Store', 'Action'], rows));
    if (plan.mapping?.length) preview.append(accordion('Source → destination mapping', operationTable(`Domain and store mapping (${plan.mapping.length})`, ['Cookie', 'Source domain', 'Destination domain', 'Source store', 'Destination store'], plan.mapping.slice(0, 100).map(item => [item.name || '(empty name)', item.sourceDomain, item.targetDomain, item.sourceStoreId, item.targetStoreId]))));
    if (plan.invalid.length) preview.append(operationTable(`Validation errors (${plan.invalid.length})`, ['Record', 'Cookie', 'Source domain', 'Fix before importing'], plan.invalid.slice(0, 100).map(item => [item.index, item.name || '(unknown)', item.domain, item.error])));
    if (plan.removals.length) preview.append(accordion(`Cookies to remove (${plan.removals.length})`, operationTable('Removal preview', ['Cookie', 'Domain', 'Path', 'Store'], plan.removals.slice(0, 100).map(cookie => [cookie.name || '(empty name)', cookie.domain, cookie.path, cookie.storeId]))));
    if (plan.actions.length > 100 || plan.invalid.length > 100 || plan.removals.length > 100) preview.append(h('p', { class: 'oj-helper' }, 'Tables show the first 100 records per section. Full value-free metadata is available under Technical details.'));
    if (state.missingOrigins.length) preview.append(panel('Required host access', h('ul', { class: 'oj-bullet-list' }, state.missingOrigins.map(origin => h('li', { class: 'oj-mono' }, origin))), button('Grant access to listed sites', () => {
      const origins = [...new Set(state.missingOrigins.flatMap(origin => [origin.replace(/^https?:/, 'http:'), origin.replace(/^https?:/, 'https:')]))];
      return chrome.permissions.request({ origins }).then(async granted => { if (!granted) throw new Error('Access to the listed hosts was declined. Only granted hosts can be written.'); await checkAccess(plan); drawPreview(plan); feedback.hidden = false; feedback.textContent = state.ready ? 'Access granted. The preview is ready to apply.' : 'Review the validation errors before applying.'; });
    })));
    preview.append(accordion('Technical details', h('pre', { class: 'oj-code-block cb-report', tabindex: '0' }, JSON.stringify(safePreview(plan), null, 2))));
  }
  inspect.addEventListener('click', async () => {
    if (state.busy) return;
    state.busy = true; inspect.disabled = true; inspect.setAttribute('aria-busy', 'true'); inspect.textContent = 'Checking cookies…'; apply.disabled = true;
    try {
      const revision = state.revision;
      const config = configuration();
      const plan = await ctx.rpc('import.preview', { text: source.input.value, ...config });
      if (revision !== state.revision) { feedback.hidden = false; feedback.textContent = 'Inputs changed during validation. Update the preview.'; return; }
      state.plan = plan; state.previewRevision = revision;
      state.validPlan = (plan.mode === 'replace' ? plan.invalid.length === 0 : plan.counts.valid > 0) && (plan.actions.length > 0 || plan.removals.length > 0);
      await checkAccess(plan);
      if (revision !== state.revision) { state.ready = false; return; }
      drawPreview(plan); show(3);
      if (!state.ready) { feedback.hidden = false; feedback.textContent = state.missingOrigins.length ? 'Grant the required destination host access before applying this preview.' : plan.mode === 'replace' && plan.invalid.length ? 'Replace is blocked until every invalid or out-of-scope record is fixed.' : 'No changes are ready. Fix invalid records, change the strategy, or choose another source.'; }
      else { feedback.hidden = false; feedback.textContent = 'Preview ready. Review additions, overwrites, removals and protection before applying.'; }
    } catch (error) { formError(dialog.element, error, { fields: { destination: target, store: stores, domain: domains } }); }
    finally { state.busy = false; inspect.disabled = false; inspect.removeAttribute('aria-busy'); inspect.textContent = state.plan ? 'Update preview' : 'Parse & preview'; apply.disabled = !state.ready; }
  });
  apply.addEventListener('click', async () => {
    if (state.busy || !state.ready || state.previewRevision !== state.revision) return;
    state.busy = true; apply.disabled = true; back.disabled = true; inspect.disabled = true; apply.setAttribute('aria-busy', 'true'); apply.textContent = 'Applying & verifying…';
    try {
      const config = configuration();
      if (config.options.mode === 'replace' || backup.input.checked) {
        if (ctx.state.status?.incognito) throw new Error('Encrypted import backups are unavailable in incognito. Use Add missing or Merge without a persistent backup.');
        if (!await ctx.ensureVault()) return;
      }
      if (config.options.remapDomain && !await confirmDialog({ title: 'Copy cookies to another domain?', message: `The preview explicitly maps source domains to ${new URL(config.options.targetUrl).hostname}. Store IDs and privacy contexts are preserved. Credentials may be invalid or powerful on the destination site.`, confirmLabel: 'Use destination domain', variant: 'danger' })) return;
      if (override.input.checked && !await confirmDialog({ title: 'Override protected cookies?', message: 'Protected consent and session cookies in the displayed destination scope may be overwritten or removed. This import deliberately ignores their allowlist protection.', confirmLabel: 'Override protection', variant: 'danger' })) return;
      if (config.options.mode === 'replace' && !await confirmDialog({ title: `Replace cookies in ${scopeLabel(config.scope)}?`, message: `The preview includes ${state.plan.counts.overwritten} overwrites and ${state.plan.removals.length} removals. An encrypted backup will be saved first. The browser operation is best effort.`, confirmLabel: 'Replace & verify', variant: 'danger' })) return;
      const result = await ctx.rpc('import.execute', { text: source.input.value, ...config, expectedRemovalIds: state.plan.removals.map(cookieId), backup: config.options.mode === 'replace' || backup.input.checked });
      dialog.close();
      try { await ctx.refresh({ render: true }); } catch { ctx.showError(new Error('Import returned the report below, but the manager list could not refresh. Retry the list before making another change.')); }
      report('Import results · verified at import time', result);
    } catch (error) { formError(dialog.element, error); }
    finally { state.busy = false; apply.disabled = !state.ready; back.disabled = false; inspect.disabled = false; apply.removeAttribute('aria-busy'); apply.textContent = 'Apply import & verify'; }
  });
  dialog.body.append(steps, content, feedback); content.append(sourcePanel, destinationPanel, previewPanel);
  dialog.footer.append(controls, button('Cancel', () => dialog.close(), 'ghost'));
  dialog.element.addEventListener('close', () => { source.input.value = ''; state.plan = null; }, { once: true });
  ensureState(); show(1); dialog.open(); source.input.focus(); return dialog;
}
