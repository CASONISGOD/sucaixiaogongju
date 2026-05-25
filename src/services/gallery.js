const DB_NAME = 'sucai-tool-gallery';
const DB_VERSION = 1;
const STORE_NAME = 'generated-images';

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('createdAt', 'createdAt', { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('无法打开本地图库'));
  });
  return dbPromise;
}

function runStore(mode, handler) {
  return openDb().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, mode);
    const store = tx.objectStore(STORE_NAME);
    const result = handler(store);

    tx.oncomplete = () => resolve(result?.result ?? result);
    tx.onerror = () => reject(tx.error || new Error('本地图库操作失败'));
    tx.onabort = () => reject(tx.error || new Error('本地图库操作已中止'));
  }));
}

export function saveGalleryRecord(record) {
  return runStore('readwrite', store => store.put(record));
}

export function deleteGalleryRecord(id) {
  return runStore('readwrite', store => store.delete(id));
}

export function clearGalleryRecords() {
  return runStore('readwrite', store => store.clear());
}

export function listGalleryRecords() {
  return openDb().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const request = store.getAll();

    request.onsuccess = () => {
      const records = request.result || [];
      records.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      resolve(records);
    };
    request.onerror = () => reject(request.error || new Error('读取本地图库失败'));
  }));
}
