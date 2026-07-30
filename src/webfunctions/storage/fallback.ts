import localforage from 'localforage';

localforage.config({
  name: 'AapdaSync',
  storeName: 'fallback_storage',
  description: 'IndexedDB Fallback for SQLite WASM',
});

const DB_KEY = 'aapdasync_memory_db';

/**
 * Initializes a memory database and attempts to hydrate it from IndexedDB.
 */
export async function initializeFallbackDb(sqlite3: any): Promise<any> {
  console.log('Initializing transient in-memory database fallback...');
  
  try {
    const savedData = await localforage.getItem<Uint8Array>(DB_KEY);
    
    if (savedData && savedData.byteLength > 0) {
      console.log('Found existing database in IndexedDB, hydrating (size: ' + savedData.byteLength + ' bytes)...');
      
      // We must allocate a pointer for the memory DB, copy the data, and deserialize
      // However, OO1 API doesn't expose deserialize directly easily without CAPI.
      // Another way with sqlite3 is using sqlite3_deserialize via capi if available.
      
      // For simplicity in this architectural demo, we create a new memory DB
      // and if CAPI export/import is available, we'd use it here. 
      // Using standard sqlite-wasm capi:
      
      const p = sqlite3.wasm.allocFromTypedArray(savedData);
      const db = new sqlite3.oo1.DB();
      const rc = sqlite3.capi.sqlite3_deserialize(
        db.pointer, 'main', p, savedData.byteLength, savedData.byteLength,
        sqlite3.capi.SQLITE_DESERIALIZE_FREEONCLOSE | sqlite3.capi.SQLITE_DESERIALIZE_RESIZEABLE
      );
      
      if (rc !== 0) {
        console.error('Failed to deserialize database. Code:', rc);
        return new sqlite3.oo1.DB(':memory:');
      }
      return db;
    }
  } catch (err) {
    console.warn('Error reading from localForage IndexedDB:', err);
  }

  // If no saved data or error, return a fresh memory DB
  console.log('Starting with a fresh in-memory database.');
  return new sqlite3.oo1.DB(':memory:');
}

/**
 * Asynchronously synchronizes the current in-memory database state to IndexedDB.
 * This should be called after critical mutations.
 */
export async function syncToIndexedDB(sqlite3: any, db: any): Promise<void> {
  try {
    // Export the database to a Uint8Array
    const byteArray = sqlite3.capi.sqlite3_js_db_export(db.pointer);
    await localforage.setItem(DB_KEY, byteArray);
    console.log('Successfully synchronized memory database to IndexedDB (size: ' + byteArray.byteLength + ' bytes).');
  } catch (err) {
    console.error('Failed to sync memory database to IndexedDB:', err);
  }
}
