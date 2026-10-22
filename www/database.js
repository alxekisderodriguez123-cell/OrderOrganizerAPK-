"use strict";

(() => {
  const LEGACY_DB_NAME = "OrderOrganizer_1_0";
  const DB_VERSION = 1;
  const STORES = ["clients", "orders", "payments", "settings"];
  const REGISTRY_DB = "OrderOrganizer_ProfileRegistry";
  const REGISTRY_STORE = "profiles";
  let dbPromise = null;
  let activeProfileId = "default";

  function safeId(value) { return String(value || "default").replace(/[^a-zA-Z0-9_-]/g, "_"); }
  function dataDbName() { return activeProfileId === "default" ? LEGACY_DB_NAME : `${LEGACY_DB_NAME}_profile_${safeId(activeProfileId)}`; }

  function openRegistry() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(REGISTRY_DB, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(REGISTRY_STORE)) request.result.createObjectStore(REGISTRY_STORE, { keyPath: "id" });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("No se pudo abrir el registro de perfiles."));
    });
  }
  async function registryRun(mode, operation) {
    const db = await openRegistry();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(REGISTRY_STORE, mode);
      const store = tx.objectStore(REGISTRY_STORE);
      let result;
      try { result = operation(store); } catch (error) { db.close(); reject(error); return; }
      tx.oncomplete = () => { db.close(); resolve(result && "result" in result ? result.result : result); };
      tx.onerror = () => { db.close(); reject(tx.error || new Error("No se pudo guardar el perfil.")); };
      tx.onabort = () => { db.close(); reject(tx.error || new Error("La operación de perfil fue cancelada.")); };
    });
  }
  async function listProfiles() {
    let profiles = await registryRun("readonly", store => store.getAll());
    if (!profiles.length) {
      const first = { id: "default", name: "Mi perfil", createdAt: new Date().toISOString(), isDefault: true };
      await registryRun("readwrite", store => store.put(first));
      profiles = [first];
    }
    return profiles.sort((a, b) => (a.createdAt || "").localeCompare(b.createdAt || ""));
  }
  async function createProfile(name) {
    const cleanName = String(name || "").trim().slice(0, 50);
    if (!cleanName) throw new Error("Escribe un nombre para el perfil.");
    const profiles = await listProfiles();
    if (profiles.some(p => p.name.toLocaleLowerCase() === cleanName.toLocaleLowerCase())) throw new Error("Ya existe un perfil con ese nombre.");
    const profile = { id: (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2)), name: cleanName, createdAt: new Date().toISOString() };
    await registryRun("readwrite", store => store.put(profile));
    return profile;
  }
  async function updateProfile(id, name) {
    const cleanName = String(name || "").trim().slice(0, 50);
    if (!cleanName) throw new Error("Escribe un nombre para el perfil.");
    const profiles = await listProfiles();
    if (profiles.some(p => p.id !== id && p.name.toLocaleLowerCase() === cleanName.toLocaleLowerCase())) throw new Error("Ya existe un perfil con ese nombre.");
    const profile = profiles.find(p => p.id === id);
    if (!profile) throw new Error("No se encontró ese perfil.");
    profile.name = cleanName;
    await registryRun("readwrite", store => store.put(profile));
    return profile;
  }
  async function deleteProfile(id) {
    const profiles = await listProfiles();
    if (profiles.length <= 1) throw new Error("Debe quedar al menos un perfil.");
    const profile = profiles.find(p => p.id === id);
    if (!profile) throw new Error("No se encontró ese perfil.");
    if (id === activeProfileId) throw new Error("No puedes eliminar el perfil que está abierto.");
    await registryRun("readwrite", store => store.delete(id));
    const dbName = id === "default" ? LEGACY_DB_NAME : `${LEGACY_DB_NAME}_profile_${safeId(id)}`;
    await new Promise((resolve, reject) => {
      const request = indexedDB.deleteDatabase(dbName);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error || new Error("El perfil se quitó, pero no se pudo limpiar su almacenamiento."));
      request.onblocked = () => reject(new Error("Cierra otras ventanas de OrderOrganizer antes de eliminar este perfil."));
    });
  }
  async function setActiveProfile(id) {
    const profiles = await listProfiles();
    if (!profiles.some(p => p.id === id)) throw new Error("Selecciona un perfil válido.");
    if (dbPromise) { const old = await dbPromise.catch(() => null); if (old) old.close(); }
    dbPromise = null;
    activeProfileId = id;
    try { localStorage.setItem("OrderOrganizer_activeProfile", id); } catch {}
    return profiles.find(p => p.id === id);
  }
  async function getActiveProfile() {
    const profiles = await listProfiles();
    let saved = "default";
    try { saved = localStorage.getItem("OrderOrganizer_activeProfile") || "default"; } catch {}
    if (!profiles.some(p => p.id === saved)) saved = profiles[0].id;
    activeProfileId = saved;
    return profiles.find(p => p.id === saved) || profiles[0];
  }
  function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(dataDbName(), DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        for (const name of STORES) if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: "id" });
      };
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => { db.close(); dbPromise = null; };
        resolve(db);
      };
      request.onerror = () => { dbPromise = null; reject(request.error || new Error("No se pudo abrir la base de datos.")); };
      request.onblocked = () => console.warn("La base de datos está bloqueada por otra pestaña abierta.");
    });
    return dbPromise;
  }
  async function run(storeName, mode, operation) {
    if (!STORES.includes(storeName)) throw new Error("Almacén de datos desconocido: " + storeName);
    const db = await openDB();
    if (!db.objectStoreNames.contains(storeName)) throw new Error("Falta el almacén de datos: " + storeName);
    return new Promise((resolve, reject) => {
      let result;
      let request = null;
      let settled = false;
      const tx = db.transaction(storeName, mode);
      try { result = operation(tx.objectStore(storeName)); } catch (error) { try { tx.abort(); } catch {} reject(error); return; }
      if (result && typeof result === "object" && "result" in result) {
        request = result;
        request.onsuccess = () => { result = request.result; };
        request.onerror = () => { if (!settled) { settled = true; reject(request.error || new Error("Error en la base de datos.")); } };
      }
      tx.oncomplete = () => { if (!settled) { settled = true; resolve(result); } };
      tx.onerror = () => { if (!settled) { settled = true; reject(tx.error || new Error("Error al guardar los datos.")); } };
      tx.onabort = () => { if (!settled) { settled = true; reject(tx.error || new Error("La operación fue cancelada.")); } };
    });
  }
  const getAll = name => run(name, "readonly", store => store.getAll());
  const get = (name, id) => run(name, "readonly", store => store.get(id));
  function save(name, record) {
    if (!record || typeof record.id !== "string" || !record.id) return Promise.reject(new Error("El registro debe tener un identificador válido."));
    return run(name, "readwrite", store => store.put(record));
  }
  const remove = (name, id) => run(name, "readwrite", store => store.delete(id));
  async function removeOrderWithPayments(orderId) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(["orders", "payments"], "readwrite");
      const request = tx.objectStore("payments").openCursor();
      let deletedPayments = 0;
      request.onsuccess = () => { const cursor = request.result; if (!cursor) return; if (cursor.value && cursor.value.orderId === orderId) { cursor.delete(); deletedPayments++; } cursor.continue(); };
      tx.objectStore("orders").delete(orderId);
      tx.oncomplete = () => resolve({ orderId, deletedPayments });
      tx.onerror = () => reject(tx.error || new Error("No se pudo eliminar el pedido y sus pagos."));
      tx.onabort = () => reject(tx.error || new Error("La eliminación fue cancelada."));
    });
  }
  function validateBackup(data) {
    if (!data || typeof data !== "object" || data.app !== "OrderOrganizer" || !Array.isArray(data.clients) || !Array.isArray(data.orders) || !Array.isArray(data.payments) || !Array.isArray(data.settings)) throw new Error("El archivo no es un respaldo válido de OrderOrganizer.");
    for (const name of STORES) for (const record of data[name]) if (!record || typeof record !== "object" || typeof record.id !== "string" || !record.id) throw new Error(`El respaldo contiene un registro inválido en «${name}». No se modificó ningún dato.`);
    return data;
  }
  async function exportAll() {
    const data = { app: "OrderOrganizer", version: 1, exportedAt: new Date().toISOString() };
    for (const name of STORES) data[name] = await getAll(name);
    return data;
  }
  async function importAll(data) {
    validateBackup(data);
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORES, "readwrite");
      for (const name of STORES) { const store = tx.objectStore(name); store.clear(); for (const record of data[name]) store.put(record); }
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error || new Error("No se pudo importar el respaldo."));
      tx.onabort = () => reject(tx.error || new Error("La importación fue cancelada."));
    });
  }
  window.OrderDB = { openDB, getAll, get, save, remove, removeOrderWithPayments, validateBackup, exportAll, importAll, listProfiles, createProfile, updateProfile, deleteProfile, setActiveProfile, getActiveProfile };
})();
