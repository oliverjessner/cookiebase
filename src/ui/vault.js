import { h, button, field, accordion, modal, formError } from './components.js';

/** A context unlock step: callers retain their form, scope and selection. */
export async function ensureVault(ctx) {
  await ctx.refreshStatus();
  if (ctx.state.status.incognito) {
    ctx.showError(new Error('Persistent profiles and backups are unavailable in incognito. Use a regular browser window.'));
    return false;
  }
  if (!ctx.state.status.vault.locked) return true;
  return openVault(ctx, { unlockOnly: true });
}

export async function openVault(ctx, { unlockOnly = false } = {}) {
  await ctx.refreshStatus();
  if (ctx.state.status.incognito) {
    ctx.showError(new Error('The incognito workspace keeps Cookiebase data in memory. Persistent vaults are disabled.'));
    return false;
  }
  const status = ctx.state.status.vault;
  const create = !status.initialized;
  const view = modal(status.locked ? (create ? 'Create encrypted vault' : 'Unlock vault') : 'Session vault', { id: 'vault-dialog' });
  if (!status.locked) {
    view.body.append(h('p', {}, 'Vault unlocked. Profiles and restore snapshots are available in this worker session.'),
      h('dl', { class: 'oj-key-value' },
        h('div', {}, h('dt', {}, 'Profiles'), h('dd', {}, status.profileCount ?? 0)),
        h('div', {}, h('dt', {}, 'Restore snapshots'), h('dd', {}, status.snapshotCount ?? 0))),
      accordion('Security and recovery', h('p', {}, 'Locking or restarting the worker/browser clears the key. You must unlock again. A lost passphrase cannot be recovered. Clipboard and downloaded exports are unencrypted.')));
    view.footer.append(button('Lock vault', async () => {
      try { await ctx.rpc('vault.lock'); await ctx.refreshStatus(); view.close(); await ctx.render(); ctx.notify('Vault locked.'); }
      catch (error) { formError(view.body, error); }
    }), button('Close', () => view.close()));
    view.open();
    return true;
  }
  return new Promise(resolve => {
    let success = false;
    const form = h('form', { class: 'oj-stack', id: 'vault-form' });
    const pass = field(create ? 'New passphrase (at least 12 characters)' : 'Vault passphrase', 'vault-passphrase', '', 'password', {
      required: true, autocomplete: create ? 'new-password' : 'current-password', ...(create ? { minlength: '12' } : {}), autofocus: true,
    });
    const repeat = create ? field('Confirm passphrase', 'vault-confirm-passphrase', '', 'password', { required: true, autocomplete: 'new-password' }) : null;
    form.append(h('p', { class: 'oj-helper' }, create ? 'Create the local encrypted vault to save profiles and restore snapshots. Keep this passphrase: there is no recovery service.' : 'Unlock to continue your action. Your current selection and input will be kept.'), pass.node);
    if (repeat) form.append(repeat.node);
    form.append(accordion('How the vault protects sessions', h('p', {}, 'Profiles and their metadata use AES-256-GCM with a PBKDF2-SHA-256 passphrase-derived key. Keys are never saved. Browser or service-worker restart locks the vault. Exported files and clipboard content are outside this encryption.')));
    const submit = h('button', { type: 'submit', class: 'oj-button oj-button-primary', id: 'vault-unlock' }, create ? 'Create encrypted vault' : 'Unlock and continue');
    form.append(h('div', { class: 'oj-cluster' }, submit, button('Cancel', () => view.close())));
    view.body.append(form);
    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (submit.disabled) return;
      pass.setError?.(''); repeat?.setError?.('');
      if (create && pass.input.value.length < 12) { pass.setError?.('Use at least 12 characters.'); pass.input.focus(); return; }
      if (repeat && repeat.input.value !== pass.input.value) { repeat.setError?.('Passphrases do not match.'); repeat.input.focus(); return; }
      submit.disabled = true; submit.setAttribute('aria-busy', 'true'); submit.textContent = create ? 'Creating encrypted vault…' : 'Unlocking…';
      const secret = pass.input.value;
      try {
        await ctx.rpc(create ? 'vault.initialize' : 'vault.unlock', { passphrase: secret });
        pass.input.value = ''; if (repeat) repeat.input.value = '';
        await ctx.refreshStatus(); success = true; view.close();
        ctx.notify(create ? 'Encrypted vault created.' : 'Vault unlocked.');
        if (!unlockOnly) await ctx.render();
      } catch (error) {
        pass.input.value = ''; if (repeat) repeat.input.value = '';
        pass.setError?.('Check your passphrase and try again.');
        formError(form, error); pass.input.focus();
      } finally {
        submit.disabled = false; submit.removeAttribute('aria-busy'); submit.textContent = create ? 'Create encrypted vault' : 'Unlock and continue';
      }
    });
    view.element.addEventListener('close', () => resolve(success), { once: true });
    view.open();
  });
}
