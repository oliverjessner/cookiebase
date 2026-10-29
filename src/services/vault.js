/** Encrypted, versioned local vault. No passphrase or key is ever persisted. */
const KEY = 'vault';
const VERSION = 1;
const ITERATIONS = 600_000;
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const aad = encoder.encode('cookiebase:vault:1');
const MAX_BYTES = 25 * 1024 * 1024;

function base64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
}
function unbase64(value) {
  if (typeof value !== 'string' || value.length > MAX_BYTES * 2) throw new Error('Invalid vault encoding.');
  try { return Uint8Array.from(atob(value), c => c.charCodeAt(0)); }
  catch { throw new Error('Invalid vault encoding.'); }
}
async function derive(passphrase, salt, iterations) {
  const material = await crypto.subtle.importKey('raw', encoder.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, material,
    { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
function validateEnvelope(record) {
  if (record?.version !== VERSION) throw new Error('Unsupported vault version. Keep a backup before upgrading Cookiebase.');
  if (record.kdf?.name !== 'PBKDF2-SHA-256' || record.kdf.iterations !== ITERATIONS) throw new Error('Unsupported vault key derivation settings.');
  if (unbase64(record.salt).length !== 16 || unbase64(record.iv).length !== 12) throw new Error('Invalid vault salt or nonce.');
}
function validateData(data) {
  if (data?.version !== VERSION || !Array.isArray(data.profiles) || !Array.isArray(data.snapshots)) throw new Error('Invalid vault data.');
}

export function createVault(storage) {
  let key = null;
  let data = null;
  let envelope = null;
  let queue = Promise.resolve();
  const serial = fn => {
    const result = queue.then(fn);
    queue = result.catch(() => {});
    return result;
  };
  function requireUnlocked() {
    if (!key || !data) throw new Error('Vault is locked. Unlock with your passphrase first.');
  }
  async function persist(next) {
    validateData(next);
    const clear = encoder.encode(JSON.stringify(next));
    if (clear.byteLength > MAX_BYTES) throw new Error('Vault exceeds the 25 MiB safety limit. Export and remove unused snapshots.');
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad, tagLength: 128 }, key, clear);
    const nextEnvelope = { ...envelope, iv: base64(iv), ciphertext: base64(new Uint8Array(cipher)) };
    await storage.set(KEY, nextEnvelope);
    envelope = nextEnvelope;
    data = next;
  }
  return {
    async status() {
      const stored = await storage.get(KEY);
      return { initialized: Boolean(stored), locked: !key, version: stored?.version ?? VERSION,
        profileCount: key ? data.profiles.length : null, snapshotCount: key ? data.snapshots.length : null };
    },
    initialize(passphrase) {
      return serial(async () => {
        if (await storage.get(KEY)) throw new Error('Vault already exists. Unlock it instead of creating another.');
        if (typeof passphrase !== 'string' || passphrase.length < 12) throw new Error('Use a passphrase with at least 12 characters. It cannot be recovered if lost.');
        const salt = crypto.getRandomValues(new Uint8Array(16));
        key = await derive(passphrase, salt, ITERATIONS);
        envelope = { version: VERSION, kdf: { name: 'PBKDF2-SHA-256', iterations: ITERATIONS }, salt: base64(salt) };
        try { await persist({ version: VERSION, profiles: [], snapshots: [] }); }
        catch (error) { key = null; envelope = null; data = null; throw error; }
        return { initialized: true, locked: false };
      });
    },
    unlock(passphrase) {
      return serial(async () => {
        const stored = await storage.get(KEY);
        if (!stored) throw new Error('No vault exists yet. Create one with a new passphrase.');
        validateEnvelope(stored);
        if (typeof passphrase !== 'string') throw new Error('Enter your vault passphrase.');
        let nextKey;
        let nextData;
        try {
          nextKey = await derive(passphrase, unbase64(stored.salt), stored.kdf.iterations);
          const clear = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unbase64(stored.iv), additionalData: aad, tagLength: 128 }, nextKey, unbase64(stored.ciphertext));
          nextData = JSON.parse(decoder.decode(clear));
          validateData(nextData);
        } catch {
          key = null; data = null; envelope = null;
          throw new Error('Unable to unlock vault. The passphrase is incorrect or the encrypted vault is damaged.');
        }
        key = nextKey; data = nextData; envelope = stored;
        return { initialized: true, locked: false };
      });
    },
    lock() { return serial(async () => { key = null; data = null; envelope = null; return { locked: true }; }); },
    read() { return serial(async () => { requireUnlocked(); return structuredClone(data); }); },
    update(mutator) {
      return serial(async () => {
        requireUnlocked();
        const next = structuredClone(data);
        const result = await mutator(next);
        await persist(next);
        return structuredClone(result ?? null);
      });
    },
    reset() { return serial(async () => { key = null; data = null; envelope = null; await storage.delete(KEY); }); },
  };
}
