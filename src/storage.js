export function createStorage(indexedDB = globalThis.indexedDB) {
  let connection;
  async function open() {
    if (connection) return connection;
    connection = await new Promise((resolve, reject) => {
      const req = indexedDB.open('cookiebase', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('records');
      req.onsuccess = () => { req.result.onversionchange = () => { req.result.close(); connection = null; }; resolve(req.result); };
      req.onerror = () => reject(new Error('Local database could not open. Check browser storage availability.'));
      req.onblocked = () => reject(new Error('Database upgrade blocked. Close other Cookiebase windows and retry.'));
    });
    return connection;
  }
  async function run(mode, action) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('records', mode);
      const request = action(tx.objectStore('records'));
      let value;
      request.onsuccess = () => { value = request.result; };
      tx.oncomplete = () => resolve(value);
      tx.onabort = tx.onerror = () => reject(new Error('Local storage write/read failed. Storage quota or browser policy may block it.'));
    });
  }
  return { get: key => run('readonly', s => s.get(key)), set: (key, value) => run('readwrite', s => s.put(value, key)), delete: key => run('readwrite', s => s.delete(key)), clear: () => run('readwrite', s => s.clear()) };
}
