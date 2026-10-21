"use strict";

(() => {
  const DB_NAME = "OrderOrganizer_1_0";
  const DB_VERSION = 1;
  const STORES = ["clients", "orders", "payments", "settings"];

  let dbPromise;

  function openDB() {
    if (dbPromise) return dbPromise;

    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = () => {
        const db = request.result;

        for (const name of STORES) {
          if (!db.objectStoreNames.contains(name)) {
            db.createObjectStore(name, { keyPath: "id" });
          }
        }
      };

      request.onsuccess = () => {
        const db = request.result;

        db.onversionchange = () => {
          db.close();
          dbPromise = null;
        };

        resolve(db);
      };

      request.onerror = () => {
        dbPromise = null;
        reject(request.error || new Error("No se pudo abrir la base de datos."));
      };

      request.onblocked = () => {
        console.warn("La base de datos está bloqueada por otra pestaña abierta.");
      };
    });

    return dbPromise;
  }

  async function run(storeName, mode, operation) {
    if (!STORES.includes(storeName)) {
      throw new Error("Almacén de datos desconocido: " + storeName);
    }

    const db = await openDB();

    if (!db.objectStoreNames.contains(storeName)) {
      throw new Error("Falta el almacén de datos: " + storeName);
    }

    return new Promise((resolve, reject) => {
      let result;
      const tx = db.transaction(storeName, mode);
      const store = tx.objectStore(storeName);

      try {
        result = operation(store);
      } catch (error) {
        reject(error);
        return;
      }

      tx.oncomplete = () => resolve(result && result.result);
      tx.onerror = () => reject(tx.error || new Error("Error al guardar los datos."));
      tx.onabort = () => reject(tx.error || new Error("La operación fue cancelada."));
    });
  }

  function getAll(storeName) {
    return run(storeName, "readonly", store => store.getAll());
  }

  function get(storeName, id) {
    return run(storeName, "readonly", store => store.get(id));
  }

  function save(storeName, record) {
    return run(storeName, "readwrite", store => store.put(record));
  }

  function remove(storeName, id) {
    return run(storeName, "readwrite", store => store.delete(id));
  }

  async function exportAll() {
    const data = { app: "OrderOrganizer", version: 1, exportedAt: new Date().toISOString() };

    for (const name of STORES) {
      data[name] = await getAll(name);
    }

    return data;
  }

  async function importAll(data) {
    if (!data || data.app !== "OrderOrganizer" || !Array.isArray(data.clients) ||
        !Array.isArray(data.orders) || !Array.isArray(data.payments) ||
        !Array.isArray(data.settings)) {
      throw new Error("El archivo no es un respaldo válido de OrderOrganizer.");
    }

    const db = await openDB();

    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORES, "readwrite");

      for (const name of STORES) {
        const store = tx.objectStore(name);
        store.clear();

        for (const record of data[name]) {
          if (record && typeof record.id === "string") {
            store.put(record);
          }
        }
      }

      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error || new Error("No se pudo importar el respaldo."));
      tx.onabort = () => reject(tx.error || new Error("La importación fue cancelada."));
    });
  }

  window.OrderDB = {
    openDB,
    getAll,
    get,
    save,
    remove,
    exportAll,
    importAll
  };
})();