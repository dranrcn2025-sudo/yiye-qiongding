const STORAGE_KEY = 'inspiration-vault-data';
const LIBRARY_KEY = 'ebook-library-data';

const DB_NAME = 'YiyeQiongdingDB';
const DB_VERSION = 1;
const TRASH_STORE = 'trashBooks';

const openDB = () => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(TRASH_STORE)) {
        db.createObjectStore(TRASH_STORE, { keyPath: 'id' });
      }
    };
  });
};

const saveTrashToIDB = async (trashBooks) => {
  try {
    const db = await openDB();
    const tx = db.transaction(TRASH_STORE, 'readwrite');
    const store = tx.objectStore(TRASH_STORE);
    store.clear();
    trashBooks.forEach((item, index) => {
      store.put({ id: item.book.id || `trash_${index}`, data: item });
    });
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => { db.close(); resolve(true); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    });
  } catch (e) {
    console.error('IndexedDB保存失败:', e);
    return false;
  }
};

const loadTrashFromIDB = async () => {
  try {
    const db = await openDB();
    const tx = db.transaction(TRASH_STORE, 'readonly');
    const store = tx.objectStore(TRASH_STORE);
    const request = store.getAll();
    return new Promise((resolve, reject) => {
      request.onsuccess = () => {
        db.close();
        const items = request.result.map(r => r.data).filter(Boolean);
        items.sort((a, b) => new Date(b.deletedAt) - new Date(a.deletedAt));
        resolve(items);
      };
      request.onerror = () => { db.close(); reject(request.error); };
    });
  } catch (e) {
    console.error('IndexedDB加载失败:', e);
    try {
      const saved = localStorage.getItem('trashBooks');
      return saved ? JSON.parse(saved) : [];
    } catch (e2) {
      return [];
    }
  }
};

const cleanupStorage = () => {
  const keysToRemove = ['versionHistory', 'trashBooks'];
  keysToRemove.forEach(key => {
    try { localStorage.removeItem(key); } catch (e) {}
  });
};

const saveToStorage = (data) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (e) {
    console.warn('保存失败，尝试清理空间:', e);
    cleanupStorage();
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e2) {
      console.error('保存仍然失败:', e2);
    }
  }
};

const loadFromStorage = () => { try { const saved = localStorage.getItem(STORAGE_KEY); return saved ? JSON.parse(saved) : null; } catch (e) { return null; } };
const saveLibrary = (data) => { try { localStorage.setItem(LIBRARY_KEY, JSON.stringify(data)); } catch (e) { console.error('保存图书馆失败:', e); } };
const loadLibrary = () => { try { const saved = localStorage.getItem(LIBRARY_KEY); return saved ? JSON.parse(saved) : { books: [] }; } catch (e) { return { books: [] }; } };

export { STORAGE_KEY, LIBRARY_KEY, DB_NAME, DB_VERSION, TRASH_STORE, openDB, saveTrashToIDB, loadTrashFromIDB, cleanupStorage, saveToStorage, loadFromStorage, saveLibrary, loadLibrary };
