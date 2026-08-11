// ══════════════════════════════════════════════════════════════
// DB — IndexedDB local. Los recorridos no salen del teléfono.
//
// Un recorrido:
//   { id, nombre, linea, sentido, color, notas,
//     puntos:  [[lat,lng], ...],                       ← el trazado
//     paradas: [{ id, lat, lng, nombre, metros }],     ← dónde se para
//     hitos:   [{ id, lat, lng, tipo, texto, metros }],← giros y avisos
//     origen: 'grabado'|'dibujado'|'importado'|'osm',
//     largo, creado, actualizado }
//
// `metros` en paradas e hitos es el avance sobre el recorrido, no una
// distancia al usuario: se precalcula al guardar para que el modo manejo
// solo tenga que comparar números en cada fix del GPS.
// ══════════════════════════════════════════════════════════════

const DB = (() => {
  const NOMBRE = 'coetc-recorridos';
  const VERSION = 1;
  const STORES = ['recorridos', 'config'];
  let _db = null;

  function abrir() {
    if (_db) return Promise.resolve(_db);
    return new Promise((res, rej) => {
      const req = indexedDB.open(NOMBRE, VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        // Las migraciones son ADITIVAS: nunca deleteObjectStore. Un recorrido
        // perdido son horas de manejo grabándolo de nuevo.
        if (!db.objectStoreNames.contains('recorridos')) {
          const s = db.createObjectStore('recorridos', { keyPath: 'id' });
          s.createIndex('linea', 'linea', { unique: false });
        }
        if (!db.objectStoreNames.contains('config')) {
          db.createObjectStore('config', { keyPath: 'clave' });
        }
      };
      req.onsuccess = () => { _db = req.result; res(_db); };
      req.onerror = () => rej(req.error);
    });
  }

  function tx(store, modo, fn) {
    return abrir().then(db => new Promise((res, rej) => {
      const t = db.transaction(store, modo);
      const req = fn(t.objectStore(store));
      t.onerror = () => rej(t.error);
      t.onabort = () => rej(t.error);
      if (req) req.onsuccess = () => res(req.result);
      else t.oncomplete = () => res();
    }));
  }

  function nuevoId(prefijo = 'r') {
    return `${prefijo}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }

  /**
   * Rellena lo que se deriva del trazado: largo, avance de cada parada e
   * hito, y los giros automáticos si el recorrido todavía no tiene hitos.
   * Se llama en `guardar()` para que nadie pueda escribir un recorrido con
   * los derivados desincronizados de los puntos.
   */
  function recalcular(rec) {
    const puntos = rec.puntos || [];
    rec.largo = Geo.largo(puntos);
    if (!puntos.length) return rec;

    const acc = Geo.acumuladas(puntos);
    const ubicar = (item) => {
      const proy = Geo.proyectar([item.lat, item.lng], puntos, -1);
      item.metros = Geo.avance(proy, puntos, acc);
      return item;
    };

    rec.paradas = (rec.paradas || []).map(ubicar).sort((a, b) => a.metros - b.metros);

    const manuales = (rec.hitos || []).filter(h => !h.auto).map(ubicar);
    // Los giros detectados por geometría se regeneran siempre: si editaste
    // el trazado, los viejos apuntan a esquinas que ya no existen. Los que
    // escribiste a mano se respetan.
    const autos = Geo.detectarGiros(puntos).map(g => ({
      id: nuevoId('h'),
      lat: puntos[g.idx][0], lng: puntos[g.idx][1],
      tipo: g.tipo, texto: '', metros: g.metros, auto: true,
    }));
    // Un giro manual gana sobre el automático que cae encima (± 40 m).
    const filtrados = autos.filter(a => !manuales.some(m => Math.abs(m.metros - a.metros) < 40));
    rec.hitos = [...manuales, ...filtrados].sort((a, b) => a.metros - b.metros);
    return rec;
  }

  async function guardar(rec) {
    if (!rec.id) rec.id = nuevoId();
    if (!rec.creado) rec.creado = Date.now();
    rec.actualizado = Date.now();
    rec.nombre = (rec.nombre || '').trim() || 'Recorrido sin nombre';
    recalcular(rec);
    await tx('recorridos', 'readwrite', s => s.put(rec));
    return rec;
  }

  const obtener = (id) => tx('recorridos', 'readonly', s => s.get(id));
  const borrar  = (id) => tx('recorridos', 'readwrite', s => s.delete(id));

  async function todos() {
    const lista = await tx('recorridos', 'readonly', s => s.getAll());
    return (lista || []).sort((a, b) =>
      (a.linea || '').localeCompare(b.linea || '', 'es', { numeric: true }) ||
      (a.nombre || '').localeCompare(b.nombre || '', 'es', { numeric: true }));
  }

  async function getConfig(clave, porDefecto = null) {
    const row = await tx('config', 'readonly', s => s.get(clave));
    return row === undefined ? porDefecto : row.valor;
  }
  const setConfig = (clave, valor) => tx('config', 'readwrite', s => s.put({ clave, valor }));

  return { abrir, guardar, obtener, borrar, todos, getConfig, setConfig, nuevoId, recalcular, STORES };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = DB;
