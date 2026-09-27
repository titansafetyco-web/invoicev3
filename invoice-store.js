(function () {
  const DB_NAME = "aaa-invoices";
  const STORE = "invoices";

  function openDb() {
    return new Promise(function (resolve, reject) {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = function () {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: "id" });
        }
      };
      request.onsuccess = function () { resolve(request.result); };
      request.onerror = function () { reject(request.error); };
    });
  }

  function run(mode, fn) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        const tx = db.transaction(STORE, mode);
        const result = fn(tx.objectStore(STORE));
        tx.oncomplete = function () { resolve(result); };
        tx.onerror = function () { reject(tx.error); };
      });
    });
  }

  function requestToPromise(request) {
    return new Promise(function (resolve, reject) {
      request.onsuccess = function () { resolve(request.result); };
      request.onerror = function () { reject(request.error); };
    });
  }

  window.InvoiceStore = {
    list: function () {
      return openDb().then(function (db) {
        return new Promise(function (resolve, reject) {
          const tx = db.transaction(STORE, "readonly");
          const request = tx.objectStore(STORE).getAll();
          request.onsuccess = function () {
            const rows = request.result || [];
            rows.sort(function (a, b) { return (b.updatedAt || 0) - (a.updatedAt || 0); });
            resolve(rows);
          };
          request.onerror = function () { reject(request.error); };
        });
      });
    },
    get: function (id) {
      return openDb().then(function (db) {
        return requestToPromise(db.transaction(STORE, "readonly").objectStore(STORE).get(id));
      });
    },
    save: function (record) {
      record.updatedAt = Date.now();
      return run("readwrite", function (store) {
        store.put(record);
        return record;
      });
    },
    remove: function (id) {
      return run("readwrite", function (store) {
        store.delete(id);
      });
    }
  };
})();
