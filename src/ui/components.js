import { initOJ, openDialog, closeDialog } from 'oj-designsystem';

let sequence = 0;
let lastTrigger = null;
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2), value);
    else if (key === 'class') el.className = value;
    else if (['checked', 'disabled', 'hidden', 'readOnly', 'required', 'multiple', 'autofocus', 'indeterminate'].includes(key)) el[key] = Boolean(value);
    else if (key === 'value') el.value = value ?? '';
    else if (value !== undefined && value !== null && typeof value !== 'function') el.setAttribute(key, String(value));
  }
  for (const child of children.flat(Infinity)) if (child !== null && child !== undefined && child !== false) el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  return el;
}
export function replace(node, ...children) { node.replaceChildren(...children.flat(Infinity).filter(child => child !== null && child !== undefined && child !== false)); }
export const text = message => h('p', { class: 'oj-small cb-help' }, message);
export function button(label, fn, kind = 'secondary', attrs = {}) {
  const b = h('button', { type: 'button', class: `oj-button oj-button-${kind}`, ...attrs }, label);
  b.addEventListener('click', () => {
    if (b.disabled) return;
    lastTrigger = b;
    b.disabled = true; b.setAttribute('aria-busy', 'true');
    let result;
    try { result = fn(); } catch (error) { result = Promise.reject(error); }
    Promise.resolve(result).catch(error => {
      const root = b.closest('dialog') || b.closest('main') || document.querySelector('#main') || document.body;
      formError(root, error);
    }).finally(() => { b.disabled = false; b.removeAttribute('aria-busy'); });
  });
  return b;
}
export function field(label, id, value = '', type = 'text', attrs = {}) {
  const input = h(type === 'textarea' ? 'textarea' : 'input', { class: type === 'textarea' ? 'oj-textarea' : 'oj-input', id, ...(type === 'textarea' ? {} : { type }), value, ...attrs });
  const helper = h('p', { id: `${id}-error`, class: 'oj-helper oj-helper-error', hidden: true });
  const node = h('div', { class: 'oj-field' }, h('label', { class: 'oj-label', for: id }, label), input, helper);
  const setError = message => { helper.textContent = message || ''; helper.hidden = !message; input.setAttribute('aria-invalid', message ? 'true' : 'false'); if (message) input.setAttribute('aria-describedby', helper.id); else input.removeAttribute('aria-describedby'); };
  input.addEventListener('input', () => setError(''));
  return { node, input, setError };
}
export function select(label, id, options, value) {
  const input = h('select', { class: 'oj-select', id }, options.map(option => {
    const [v, title, disabled] = Array.isArray(option) ? option : [option, option];
    return h('option', { value: v, disabled }, title);
  }));
  input.value = value ?? '';
  const helper = h('p', { id: `${id}-error`, class: 'oj-helper oj-helper-error', hidden: true });
  const node = h('div', { class: 'oj-field' }, h('label', { class: 'oj-label', for: id }, label), input, helper);
  return { node, input, setError(message) { helper.textContent = message || ''; helper.hidden = !message; input.setAttribute('aria-invalid', message ? 'true' : 'false'); if (message) input.setAttribute('aria-describedby', helper.id); else input.removeAttribute('aria-describedby'); } };
}
export function check(label, checked = false, attrs = {}) {
  const input = h('input', { class: 'oj-checkbox', type: 'checkbox', checked, ...attrs });
  return { node: h('label', { class: 'oj-check' }, input, h('span', {}, label)), input };
}
export function panel(title, ...children) { return h('section', { class: 'oj-panel cb-card' }, title ? h('h2', { class: 'oj-heading-3' }, title) : null, ...children); }
export function accordion(title, ...children) { return h('details', { class: 'oj-accordion' }, h('summary', {}, title), h('div', { class: 'oj-accordion-body cb-card' }, ...children)); }
export function empty(title, message, ...actions) { return h('div', { class: 'oj-empty-state' }, h('i', { class: 'fa-solid fa-cookie-bite oj-empty-state-icon', 'aria-hidden': 'true' }), h('h3', { class: 'oj-empty-state-title' }, title), h('p', { class: 'oj-empty-state-description' }, message), h('div', { class: 'oj-empty-state-actions' }, ...actions)); }
export function keyValues(entries) { return h('dl', { class: 'oj-key-value' }, entries.map(([key, value]) => h('div', {}, h('dt', {}, key), h('dd', { class: 'cb-break' }, value ?? '—')))); }
export function formError(form, error, { fields = {} } = {}) {
  const root = form?.querySelector?.('.oj-dialog-body') || form || document.body;
  let summary = [...root.children].find(child => child.dataset?.cbError === 'true');
  if (!summary) { summary = h('div', { class: 'oj-inline-message', 'data-oj-kind': 'danger', 'data-cb-error': 'true', role: 'alert', tabindex: '-1' }); root.prepend(summary); }
  const message = error?.message || String(error || 'This operation could not be completed. Check the current site and permissions.');
  summary.textContent = message; summary.hidden = false;
  let first;
  for (const [key, field] of Object.entries(fields)) {
    if (message.toLowerCase().includes(key.toLowerCase())) { field.setError?.(message); first ||= field.input || field; }
  }
  (first || summary).focus();
}
export function modal(title, { id = `cb-dialog-${++sequence}` } = {}) {
  const focused = document.activeElement;
  const opener = focused && focused !== document.body ? focused : lastTrigger?.isConnected ? lastTrigger : focused;
  const heading = h('h2', { class: 'oj-dialog-title', id: `${id}-title` }, title);
  const body = h('div', { class: 'oj-dialog-body cb-card' });
  const footer = h('footer', { class: 'oj-dialog-footer oj-cluster' });
  const element = h('dialog', { class: 'oj-dialog cb-dialog', id, 'data-oj-dialog': '', 'aria-labelledby': heading.id },
    h('header', { class: 'oj-dialog-header' }, heading, button('Close', () => api.close(), 'ghost', { 'aria-label': 'Close dialog' })), body, footer);
  let dispose = () => {};
  const api = { element, body, footer, open() {
    document.body.append(element); dispose = initOJ(element);
    openDialog(id, { root: document, trigger: opener });
    return api;
  }, close(result = 'cancel') { closeDialog(id, result, { root: document }); } };
  element.addEventListener('keydown', event => {
    if (event.key !== 'Tab' || event.altKey || event.ctrlKey || event.metaKey || [...document.querySelectorAll('dialog[open]')].at(-1) !== element) return;
    const controls = [...element.querySelectorAll('a[href],button,input:not([type=hidden]),select,textarea,summary,[tabindex]:not([tabindex="-1"])')].filter(control => !control.disabled && control.tabIndex >= 0 && control.getClientRects().length && !control.closest('[hidden],[inert]'));
    const first = controls[0], last = controls.at(-1);
    if (!first) { event.preventDefault(); element.focus(); return; }
    if (event.shiftKey && (document.activeElement === first || !element.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  });
  element.addEventListener('close', () => { dispose(); element.remove(); if (opener?.isConnected) opener.focus({ preventScroll: true }); }, { once: true });
  return api;
}
function safeDetails(result) {
  const forbidden = new Set(['value', 'cookies', 'previous', 'snapshotCookies', 'passphrase', 'ciphertext', 'salt', 'iv']);
  return JSON.parse(JSON.stringify(result, (key, value) => forbidden.has(key) ? undefined : value));
}
export function report(title, result = {}) {
  const dialog = modal(title);
  const counts = ['processed', 'imported', 'overwritten', 'applied', 'removed', 'skipped', 'preserved', 'failed', 'unchanged'].filter(key => typeof result[key] === 'number');
  if (counts.length) dialog.body.append(h('div', { class: 'cb-metrics' }, counts.map(key => h('div', { class: 'oj-metric' }, h('span', { class: 'oj-metric-label' }, key[0].toUpperCase() + key.slice(1)), h('strong', { class: 'oj-metric-value' }, result[key])))));
  if (result.warning || result.note) dialog.body.append(text(result.warning || result.note));
  if (result.rollback?.attempted) dialog.body.append(h('div', { class: 'oj-alert oj-alert-warning' }, `Backup recovery attempted: ${result.rollback.restored} restored, ${result.rollback.failed} failed. This is best effort.`));
  const items = result.results || result.invalid || [];
  if (items.length) {
    const table = h('table', { class: 'oj-table oj-table-compact' }, h('caption', {}, 'Per-cookie results'), h('thead', {}, h('tr', {}, ['Cookie', 'Site', 'Result', 'Reason / next step'].map(t => h('th', { scope: 'col' }, t)))), h('tbody', {}, items.map(item => h('tr', {}, h('td', { class: 'oj-mono' }, item.name || '(empty name)'), h('td', {}, item.domain || '—'), h('td', {}, h('span', { class: `oj-badge${item.status === 'failed' ? ' oj-badge-danger' : ''}` }, item.status || 'invalid')), h('td', { class: 'cb-break' }, item.error || item.reason || (item.status === 'failed' ? 'Review this cookie and retry.' : item.verified || item.status === 'verified' ? 'Verified against Chrome' : '—'))))));
    dialog.body.append(h('div', { class: 'oj-table-container', role: 'region', 'aria-label': 'Operation results', tabindex: '0' }, table));
  }
  for (const type of ['added', 'removed', 'changed']) if (Array.isArray(result[type])) dialog.body.append(panel(`${type[0].toUpperCase() + type.slice(1)} (${result[type].length})`, ...result[type].map(entry => { const c = entry.cookie || entry; return text(`${c.name || '(empty name)'} · ${c.domain}${c.path || ''}${entry.attributes?.length ? ` · ${entry.attributes.join(', ')}` : ''}${entry.valueChanged ? ' · value changed (masked)' : ''}`); })));
  if (!counts.length && !items.length && !['added', 'removed', 'changed'].some(key => Array.isArray(result[key]))) dialog.body.append(text(result.message || 'Operation finished. Review the details below if needed.'));
  dialog.body.append(accordion('Technical details', h('pre', { class: 'oj-code-block cb-report', tabindex: '0' }, JSON.stringify(safeDetails(result), null, 2))));
  dialog.footer.append(button('Done', () => dialog.close(), 'primary'));
  dialog.open(); return dialog;
}
