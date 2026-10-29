import test from 'node:test';
import assert from 'node:assert/strict';
import { createVault } from '../src/services/vault.js';

function memoryStorage() {
  const map = new Map();
  return { map, get: async key => structuredClone(map.get(key)), set: async (key, value) => { map.set(key, structuredClone(value)); }, delete: async key => { map.delete(key); } };
}

test('vault encrypts all secrets and metadata, relocks across process recreation and rejects wrong passphrase', async () => {
  const storage = memoryStorage();
  const vault = createVault(storage);
  assert.equal((await vault.status()).initialized, false);
  await assert.rejects(vault.initialize('short'), /12 characters/);
  await vault.initialize('correct horse battery staple');
  await vault.update(data => { data.profiles.push({ name: 'Sensitive admin profile', cookies: [{ value: 'SUPER_SECRET_SESSION' }] }); });
  const serialized = JSON.stringify([...storage.map]);
  assert.equal(serialized.includes('SUPER_SECRET_SESSION'), false);
  assert.equal(serialized.includes('Sensitive admin'), false);
  const restarted = createVault(storage);
  assert.equal((await restarted.status()).locked, true);
  await assert.rejects(restarted.read(), /locked/);
  await assert.rejects(restarted.unlock('incorrect password'), /incorrect|damaged/);
  await restarted.unlock('correct horse battery staple');
  assert.equal((await restarted.read()).profiles[0].cookies[0].value, 'SUPER_SECRET_SESSION');
  await restarted.lock();
  await assert.rejects(restarted.read(), /locked/);
});

test('AES-GCM detects ciphertext tampering and fresh nonces protect every write', async () => {
  const storage = memoryStorage();
  const vault = createVault(storage);
  await vault.initialize('long enough passphrase');
  const before = storage.map.get('vault').iv;
  await vault.update(data => { data.snapshots.push({ id: '1' }); });
  assert.notEqual(storage.map.get('vault').iv, before);
  const damaged = storage.map.get('vault');
  damaged.ciphertext = `${damaged.ciphertext[0] === 'A' ? 'B' : 'A'}${damaged.ciphertext.slice(1)}`;
  await vault.lock();
  await assert.rejects(vault.unlock('long enough passphrase'), /incorrect|damaged/);
});

test('concurrent updates serialize without losing profiles; failed storage writes preserve previous data', async () => {
  const storage = memoryStorage();
  const vault = createVault(storage);
  await vault.initialize('long enough passphrase');
  await Promise.all(Array.from({ length: 10 }, (_, id) => vault.update(data => { data.profiles.push({ id }); })));
  assert.equal((await vault.read()).profiles.length, 10);
  storage.set = async () => { throw new Error('Quota exceeded'); };
  await assert.rejects(vault.update(data => { data.profiles.push({ id: 99 }); }), /Quota/);
  assert.equal((await vault.read()).profiles.length, 10);
  await vault.reset();
  assert.equal((await vault.status()).initialized, false);
});
