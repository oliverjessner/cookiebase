import { validateCookie } from '../core/cookies.js';
import { h, replace, button, field, select, check, accordion, modal } from './components.js';

const identityFields = new Set(['name', 'domain', 'path', 'storeId']);
const errorFields = message => {
  if (/^Name/.test(message)) return ['name'];
  if (/^Value/.test(message)) return ['value'];
  if (/^Domain/.test(message)) return ['domain'];
  if (/^Path/.test(message)) return ['path'];
  if (/expiration/i.test(message)) return ['expiration'];
  if (/store/i.test(message)) return ['storeId'];
  if (/partition/i.test(message)) return ['partition'];
  if (/SameSite|Secure|__Host-|__Http-/.test(message)) return ['sameSite'];
  return [];
};
function localDate(timestamp) {
  if (!Number.isFinite(timestamp)) return '';
  const value = new Date(timestamp * 1000);
  return new Date(value.getTime() - value.getTimezoneOffset() * 60000).toISOString().slice(0, 19);
}

/** Creation and editing share all supported attributes; identity changes are explicit copies. */
export function openCookieEditor(ctx, cookie = null, { duplicate = false } = {}) {
  let host = '';
  let https = true;
  try { const url = new URL(ctx.state.url); host = url.hostname; https = url.protocol === 'https:'; } catch { /* A manually created cookie can supply its own host. */ }
  const editing = Boolean(cookie && !duplicate);
  const source = cookie ? structuredClone(cookie) : { name: '', value: '', domain: host, path: '/', storeId: ctx.state.stores[0]?.id || ctx.scope().storeId || '', secure: https, httpOnly: false, hostOnly: true, sameSite: 'lax', session: true };
  if (duplicate) source.name = source.name ? `${source.name}_copy` : 'cookie_copy';
  const dialog = modal(editing ? 'Edit cookie' : duplicate ? 'Duplicate as new cookie' : 'Create cookie', { id: 'cookie-editor' });
  const form = h('form', { id: 'cookie-form', novalidate: '' });
  const summary = h('div', { class: 'oj-alert oj-alert-danger', role: 'alert', tabindex: '-1', hidden: true });
  const feedback = h('p', { class: 'oj-helper', role: 'status', 'aria-live': 'polite' });
  const fields = {};
  const basic = h('div', { class: 'cb-grid' });
  for (const [key, label, type] of [['name', 'Name', 'text'], ['value', 'Value (secret)', 'password'], ['domain', 'Domain', 'text'], ['path', 'Path', 'text']]) {
    const entry = field(label, `edit-${key}`, source[key], type, { autocomplete: 'off', spellcheck: 'false', required: ['domain', 'path'].includes(key), readonly: editing && identityFields.has(key) ? '' : undefined });
    fields[key] = entry; basic.append(entry.node);
  }
  fields.name.input.autofocus = !editing;
  const lifetime = select('Lifetime', 'edit-lifetime', [['session', 'Session cookie'], ['persistent', 'Expires at a specific time']], source.session ? 'session' : 'persistent');
  const expiration = field('Expiration (local time)', 'edit-expiration', localDate(source.expirationDate), 'datetime-local', { step: '1' });
  fields.expiration = expiration;
  const reveal = check('Reveal secret value', false, { id: 'edit-reveal' });
  const pretty = check('Format valid JSON', false, { id: 'edit-format-json' });
  pretty.input.disabled = true;
  const completeValue = h('pre', { id: 'edit-value-preview', class: 'oj-code-block cb-value', hidden: true, tabindex: '0', 'aria-label': 'Complete revealed cookie value' });
  function updateValueView() {
    fields.value.input.type = reveal.input.checked ? 'text' : 'password';
    completeValue.hidden = !reveal.input.checked;
    let value = fields.value.input.value;
    let parsed;
    let json = false;
    try { parsed = JSON.parse(value); json = typeof parsed === 'object' && parsed !== null; } catch { /* Cookie values need not be JSON. */ }
    pretty.input.disabled = !reveal.input.checked || !json;
    if (pretty.input.disabled) pretty.input.checked = false;
    if (pretty.input.checked && json) value = JSON.stringify(parsed, null, 2);
    completeValue.textContent = reveal.input.checked ? value : '';
  }
  reveal.input.addEventListener('change', updateValueView);
  pretty.input.addEventListener('change', updateValueView);
  fields.value.input.addEventListener('input', updateValueView);
  const copy = button('Copy value', async () => {
    try { await navigator.clipboard.writeText(fields.value.input.value); feedback.textContent = 'Value copied to clipboard. It may grant account access.'; }
    catch { showErrors(['Clipboard access failed. Reveal and select the value, or check browser clipboard permissions.']); }
  }, 'ghost');
  const secure = check('Secure (HTTPS only)', source.secure, { id: 'edit-secure' });
  const httpOnly = check('HTTP only', source.httpOnly, { id: 'edit-httpOnly' });
  const hostOnly = check('Exact host only', source.hostOnly, { id: 'edit-hostOnly', disabled: editing });
  const sameSite = select('SameSite', 'edit-sameSite', [['unspecified', 'Unspecified'], ['no_restriction', 'None'], ['lax', 'Lax'], ['strict', 'Strict']], source.sameSite);
  fields.sameSite = sameSite;
  const availableStores = ctx.state.stores.map(store => [store.id, `${store.incognito ? 'Incognito' : 'Regular'} · Store ${store.id}`]);
  if (source.storeId && !availableStores.some(([id]) => id === source.storeId)) availableStores.push([source.storeId, `Unavailable store ${source.storeId}`]);
  const store = select('Cookie store', 'edit-storeId', availableStores.length ? availableStores : [['', 'No accessible store']], source.storeId);
  store.input.disabled = editing || !availableStores.length;
  fields.storeId = store;
  const partitioned = check('Partitioned cookie', Boolean(source.partitionKey), { id: 'edit-partitioned', disabled: editing });
  const partition = field('Partition top-level site', 'edit-partition', source.partitionKey?.topLevelSite || '', 'url', { readonly: editing ? '' : undefined });
  fields.partition = partition;
  const ancestor = check('Partition has cross-site ancestor', source.partitionKey?.hasCrossSiteAncestor || false, { id: 'edit-ancestor', disabled: editing });
  const partitionFields = h('div', { class: 'cb-card' }, partition.node, ancestor.node, h('p', { class: 'oj-helper' }, 'Use an HTTP(S) origin such as https://example.com. Partitioned cookies require Secure.'));
  const partitionSettings = () => {
    partitionFields.hidden = !partitioned.input.checked;
    partition.input.disabled = !partitioned.input.checked;
    partition.input.required = partitioned.input.checked;
    ancestor.input.disabled = editing || !partitioned.input.checked;
  };
  partitioned.input.addEventListener('change', partitionSettings);
  partitionSettings();
  const lifetimeSettings = () => { expiration.node.hidden = lifetime.input.value === 'session'; expiration.input.disabled = lifetime.input.value === 'session'; expiration.input.required = lifetime.input.value === 'persistent'; };
  lifetime.input.addEventListener('change', lifetimeSettings); lifetimeSettings();
  const advanced = accordion('Security, store & partition', h('div', { class: 'cb-grid' }, sameSite.node, store.node), h('div', { class: 'oj-cluster' }, secure.node, httpOnly.node, hostOnly.node), partitioned.node, partitionFields, h('p', { class: 'oj-helper' }, 'SameSite=None and secure cookie prefixes require HTTPS. Exact host only omits the Domain attribute. Chrome verifies every saved value and supported attribute.'));
  if (!editing) advanced.open = true;
  form.append(summary, editing ? h('p', { class: 'oj-helper' }, 'Name, domain, path, host type, store and partition identify this cookie. Use Duplicate as new cookie to change its identity.') : duplicate ? h('p', { class: 'oj-helper' }, 'Creates a new cookie. The original cookie remains unchanged.') : h('p', { class: 'oj-helper' }, 'All supported attributes are available when creating a cookie.'), basic, h('div', { class: 'oj-cluster' }, reveal.node, pretty.node, copy), completeValue, h('div', { class: 'cb-grid' }, lifetime.node, expiration.node), advanced, feedback);
  const save = h('button', { class: 'oj-button oj-button-primary', type: 'submit', id: 'cookie-save' }, 'Save & verify');
  form.append(h('div', { class: 'oj-cluster' }, save, editing ? button('Duplicate as new cookie', () => { dialog.element.addEventListener('close', () => openCookieEditor(ctx, cookie, { duplicate: true }), { once: true }); dialog.close(); }) : null, button('Cancel', () => dialog.close())));
  dialog.body.append(form); dialog.open();
  dialog.element.addEventListener('close', () => { fields.value.input.value = ''; completeValue.textContent = ''; }, { once: true });
  function showErrors(errors) {
    for (const entry of Object.values(fields)) { if (entry.setError) entry.setError(''); else entry.input.removeAttribute('aria-invalid'); }
    replace(summary, h('p', {}, errors.length === 1 ? errors[0] : 'Check the highlighted fields before saving.'), errors.length > 1 ? h('ul', { class: 'oj-bullet-list' }, errors.map(error => h('li', {}, error))) : null);
    summary.hidden = false;
    let first;
    for (const message of errors) for (const key of errorFields(message)) {
      const entry = fields[key];
      if (entry?.setError) entry.setError(message);
      else if (entry) entry.input.setAttribute('aria-invalid', 'true');
      if (!first && entry && !entry.input.disabled) first = entry.input;
    }
    (first || summary).focus();
  }
  form.addEventListener('submit', async event => {
    event.preventDefault(); summary.hidden = true; feedback.textContent = '';
    const value = {
      name: fields.name.input.value, value: fields.value.input.value, domain: fields.domain.input.value.trim(), path: fields.path.input.value,
      storeId: store.input.value, secure: secure.input.checked, httpOnly: httpOnly.input.checked, hostOnly: hostOnly.input.checked,
      sameSite: sameSite.input.value, session: lifetime.input.value === 'session', incognito: Boolean(ctx.state.status?.incognito),
    };
    if (!value.session) value.expirationDate = Date.parse(expiration.input.value) / 1000;
    if (partitioned.input.checked) value.partitionKey = { topLevelSite: partition.input.value.trim().replace(/\/$/, ''), hasCrossSiteAncestor: ancestor.input.checked };
    const errors = validateCookie(value);
    if (errors.length) { showErrors(errors); return; }
    save.disabled = true; save.setAttribute('aria-busy', 'true'); save.textContent = 'Saving & verifying…';
    let verified = false;
    try {
      await ctx.rpc('set', { cookie: value, original: editing ? cookie : null });
      verified = true; dialog.close(); await ctx.refresh({ render: true }); ctx.notify('Cookie saved and verified against Chrome.');
    } catch (error) { if (verified) ctx.showError(new Error('Cookie was saved and verified, but the list could not refresh. Use Refresh to inspect the latest browser state.')); else showErrors([error.message || 'Cookie could not be saved. Check host access and browser policy.']); }
    finally { save.disabled = false; save.removeAttribute('aria-busy'); save.textContent = 'Save & verify'; }
  });
  return dialog;
}
