// ══════════════════════════════════════════════════════════════
// GTFS — importar recorridos desde los datos abiertos oficiales.
//
// GTFS es el formato estándar de transporte público: un .zip con varios
// CSV. Es LA fuente buena para esta app, mejor que OpenStreetMap y mejor
// que sacarle los datos a una app de terceros, porque trae exactamente lo
// que necesitamos y viene del organismo que administra las líneas:
//
//   shapes.txt      → la geometría real del recorrido, punto por punto
//   stops.txt       → las paradas con su nombre
//   stop_times.txt  → qué paradas toca cada viaje y en qué orden
//   routes.txt      → el número de línea y su nombre
//   trips.txt       → une todo y da el sentido (ida / vuelta)
//
// Se descomprime sin ninguna librería: `DecompressionStream('deflate-raw')`
// viene en el navegador. Meter JSZip por CDN habría roto la CSP y el
// funcionamiento offline, que son dos cosas que esta app no negocia.
// ══════════════════════════════════════════════════════════════

const GTFS = (() => {

  // ── Lector de ZIP ───────────────────────────────────────────
  const FIRMA_EOCD = 0x06054b50;
  const FIRMA_CENTRAL = 0x02014b50;
  const FIRMA_LOCAL = 0x04034b50;

  /**
   * Índice del ZIP: nombre de archivo → dónde están sus bytes.
   *
   * Se lee el directorio central (al final del archivo), no los encabezados
   * locales uno tras otro. Es lo que permite sacar un solo CSV sin recorrer
   * los 200 MB de stop_times.txt que suele traer un feed metropolitano.
   */
  function abrirZip(buffer) {
    const dv = new DataView(buffer);
    const bytes = new Uint8Array(buffer);

    // El EOCD está al final, pero puede tener hasta 65 KB de comentario
    // detrás, así que se busca hacia atrás.
    let eocd = -1;
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
      if (dv.getUint32(i, true) === FIRMA_EOCD) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('el archivo no parece un .zip válido');

    const cantidad = dv.getUint16(eocd + 10, true);
    let off = dv.getUint32(eocd + 16, true);
    if (off === 0xffffffff) throw new Error('el .zip usa formato ZIP64, que este lector no soporta');

    const entradas = new Map();
    for (let i = 0; i < cantidad; i++) {
      if (dv.getUint32(off, true) !== FIRMA_CENTRAL) break;
      const metodo   = dv.getUint16(off + 10, true);
      const compSize = dv.getUint32(off + 20, true);
      const largoN   = dv.getUint16(off + 28, true);
      const largoE   = dv.getUint16(off + 30, true);
      const largoC   = dv.getUint16(off + 32, true);
      const local    = dv.getUint32(off + 42, true);
      const nombre   = new TextDecoder().decode(bytes.subarray(off + 46, off + 46 + largoN));
      // Solo interesa el nombre del archivo, no la carpeta: algunos feeds
      // vienen con todo adentro de un directorio.
      entradas.set(nombre.split('/').pop(), { metodo, compSize, local });
      off += 46 + largoN + largoE + largoC;
    }
    return { dv, bytes, entradas };
  }

  /** Los bytes crudos (todavía comprimidos) de una entrada. */
  function _crudo(zip, nombre) {
    const e = zip.entradas.get(nombre);
    if (!e) return null;
    // El encabezado local repite los largos de nombre y extra, y NO siempre
    // coinciden con los del directorio central. Hay que leerlos de acá.
    if (zip.dv.getUint32(e.local, true) !== FIRMA_LOCAL) throw new Error(`${nombre}: encabezado corrupto`);
    const largoN = zip.dv.getUint16(e.local + 26, true);
    const largoE = zip.dv.getUint16(e.local + 28, true);
    const ini = e.local + 30 + largoN + largoE;
    return { metodo: e.metodo, datos: zip.bytes.subarray(ini, ini + e.compSize) };
  }

  /** Un archivo del zip como ReadableStream de texto. */
  function _flujo(zip, nombre) {
    const crudo = _crudo(zip, nombre);
    if (!crudo) return null;
    const origen = new Blob([crudo.datos]).stream();
    const binario = crudo.metodo === 8
      ? origen.pipeThrough(new DecompressionStream('deflate-raw'))
      : origen;   // método 0 = guardado sin comprimir
    return binario.pipeThrough(new TextDecoderStream('utf-8'));
  }

  async function _texto(zip, nombre) {
    const f = _flujo(zip, nombre);
    if (!f) return null;
    let out = '';
    const lector = f.getReader();
    for (;;) {
      const { done, value } = await lector.read();
      if (done) break;
      out += value;
    }
    return out;
  }

  // ── CSV ─────────────────────────────────────────────────────
  /**
   * Parte una línea de CSV respetando las comillas.
   * En GTFS los nombres de parada traen comas de verdad
   * ("Giannattasio esq. Av. Racine, Lagomar"): partir por coma a secas
   * corre todas las columnas de esa fila y el recorrido sale mal.
   */
  function partirCsv(linea) {
    const campos = [];
    let actual = '', enComillas = false;
    for (let i = 0; i < linea.length; i++) {
      const c = linea[i];
      if (enComillas) {
        if (c === '"') {
          if (linea[i + 1] === '"') { actual += '"'; i++; }   // comilla escapada
          else enComillas = false;
        } else actual += c;
      } else if (c === '"') enComillas = true;
      else if (c === ',') { campos.push(actual); actual = ''; }
      else actual += c;
    }
    campos.push(actual);
    return campos;
  }

  const _limpiar = (s) => s.replace(/^﻿/, '').trim();   // BOM y \r

  /** CSV entero a array de objetos. Para los archivos chicos. */
  function parsearCsv(texto) {
    if (!texto) return [];
    const lineas = texto.split('\n');
    const cabecera = partirCsv(_limpiar(lineas[0])).map(_limpiar);
    const filas = [];
    for (let i = 1; i < lineas.length; i++) {
      const l = lineas[i].replace(/\r$/, '');
      if (!l.trim()) continue;
      const campos = partirCsv(l);
      const fila = {};
      for (let j = 0; j < cabecera.length; j++) fila[cabecera[j]] = campos[j] ?? '';
      filas.push(fila);
    }
    return filas;
  }

  /**
   * Recorre un CSV grande fila por fila SIN cargarlo entero en memoria.
   *
   * `stop_times.txt` de un feed metropolitano son millones de filas y
   * cientos de MB descomprimido. Cargarlo con `parsearCsv` cuelga un
   * teléfono. Acá se lee por pedazos, se cortan las líneas completas y se
   * descarta cada fila apenas se decide que no interesa.
   */
  async function recorrerCsv(zip, nombre, alLeerFila) {
    const flujo = _flujo(zip, nombre);
    if (!flujo) return 0;
    const lector = flujo.getReader();
    let resto = '', cabecera = null, total = 0;
    for (;;) {
      const { done, value } = await lector.read();
      if (done) break;
      resto += value;
      let nl;
      while ((nl = resto.indexOf('\n')) >= 0) {
        const linea = resto.slice(0, nl).replace(/\r$/, '');
        resto = resto.slice(nl + 1);
        if (!cabecera) { cabecera = partirCsv(_limpiar(linea)).map(_limpiar); continue; }
        if (!linea.trim()) continue;
        const campos = partirCsv(linea);
        const fila = {};
        for (let j = 0; j < cabecera.length; j++) fila[cabecera[j]] = campos[j] ?? '';
        alLeerFila(fila);
        total++;
      }
    }
    if (cabecera && resto.trim()) {
      const campos = partirCsv(resto.replace(/\r$/, ''));
      const fila = {};
      for (let j = 0; j < cabecera.length; j++) fila[cabecera[j]] = campos[j] ?? '';
      alLeerFila(fila);
      total++;
    }
    return total;
  }

  // ── GTFS → recorridos ───────────────────────────────────────
  const _num = (v) => { const n = parseFloat(v); return isFinite(n) ? n : null; };

  /**
   * @param {ArrayBuffer} buffer  el .zip del feed
   * @param {object} opts
   *   empresa: filtra por nombre de agencia o de línea (ej "COETC")
   *   avisar:  callback de progreso, para que la pantalla no parezca colgada
   */
  async function leer(buffer, { empresa = '', avisar = () => {} } = {}) {
    avisar('Abriendo el archivo…');
    const zip = abrirZip(buffer);

    const falta = ['routes.txt', 'trips.txt'].filter(f => !zip.entradas.has(f));
    if (falta.length) throw new Error(`al .zip le faltan ${falta.join(' y ')}; no parece un GTFS`);

    avisar('Leyendo líneas y agencias…');
    const agencias = parsearCsv(await _texto(zip, 'agency.txt'));
    const rutas    = parsearCsv(await _texto(zip, 'routes.txt'));
    const viajes   = parsearCsv(await _texto(zip, 'trips.txt'));

    // Filtro por empresa: primero por agencia, y si el feed no separa
    // agencias (pasa seguido: una sola agencia "STM" para todas las
    // empresas), se cae al nombre de la línea.
    const buscado = empresa.trim().toLowerCase();
    let rutasFiltradas = rutas;
    if (buscado) {
      const idsAgencia = new Set(agencias
        .filter(a => (a.agency_name || '').toLowerCase().includes(buscado))
        .map(a => a.agency_id));
      const porAgencia = rutas.filter(r => idsAgencia.has(r.agency_id));
      rutasFiltradas = porAgencia.length ? porAgencia : rutas.filter(r =>
        `${r.route_long_name || ''} ${r.route_short_name || ''} ${r.route_desc || ''}`
          .toLowerCase().includes(buscado));
    }
    if (!rutasFiltradas.length) {
      return { recorridos: [], agencias: agencias.map(a => a.agency_name).filter(Boolean), totalRutas: rutas.length };
    }

    const idsRuta = new Set(rutasFiltradas.map(r => r.route_id));
    const porId = new Map(rutasFiltradas.map(r => [r.route_id, r]));

    // Un viaje representativo por línea y sentido. Un feed tiene cientos de
    // viajes por línea (uno por horario) y todos comparten el mismo trazado:
    // importarlos todos daría cientos de recorridos idénticos.
    avisar('Eligiendo un viaje por línea y sentido…');
    const elegidos = new Map();   // "ruta|sentido" → viaje
    for (const v of viajes) {
      if (!idsRuta.has(v.route_id)) continue;
      const clave = `${v.route_id}|${v.direction_id || '0'}`;
      const previo = elegidos.get(clave);
      // Gana el que tenga shape: sin shape hay que reconstruir el trazado
      // uniendo paradas, que sale con líneas rectas entre esquinas.
      if (!previo || (!previo.shape_id && v.shape_id)) elegidos.set(clave, v);
    }
    if (!elegidos.size) throw new Error('las líneas encontradas no tienen viajes en el feed');

    // ── shapes.txt: solo los que hacen falta ──────────────────
    const shapesQueridos = new Set([...elegidos.values()].map(v => v.shape_id).filter(Boolean));
    const shapes = new Map();
    if (shapesQueridos.size && zip.entradas.has('shapes.txt')) {
      avisar(`Leyendo la geometría de ${shapesQueridos.size} recorrido(s)…`);
      await recorrerCsv(zip, 'shapes.txt', (f) => {
        if (!shapesQueridos.has(f.shape_id)) return;
        const lat = _num(f.shape_pt_lat), lon = _num(f.shape_pt_lon);
        if (lat == null || lon == null) return;
        if (!shapes.has(f.shape_id)) shapes.set(f.shape_id, []);
        shapes.get(f.shape_id).push([_num(f.shape_pt_sequence) ?? 0, lat, lon]);
      });
      // El orden de las filas en el archivo no está garantizado; el que
      // manda es shape_pt_sequence.
      for (const arr of shapes.values()) arr.sort((a, b) => a[0] - b[0]);
    }

    // ── paradas de cada viaje elegido ─────────────────────────
    const viajesQueridos = new Set([...elegidos.values()].map(v => v.trip_id));
    const paradasPorViaje = new Map();
    if (zip.entradas.has('stop_times.txt') && zip.entradas.has('stops.txt')) {
      avisar('Leyendo las paradas… (es el archivo más grande, aguantá)');
      await recorrerCsv(zip, 'stop_times.txt', (f) => {
        if (!viajesQueridos.has(f.trip_id)) return;
        if (!paradasPorViaje.has(f.trip_id)) paradasPorViaje.set(f.trip_id, []);
        paradasPorViaje.get(f.trip_id).push([_num(f.stop_sequence) ?? 0, f.stop_id]);
      });
      for (const arr of paradasPorViaje.values()) arr.sort((a, b) => a[0] - b[0]);
    }

    const stops = new Map();
    if (paradasPorViaje.size) {
      const necesarios = new Set();
      for (const arr of paradasPorViaje.values()) for (const [, id] of arr) necesarios.add(id);
      await recorrerCsv(zip, 'stops.txt', (f) => {
        if (!necesarios.has(f.stop_id)) return;
        const lat = _num(f.stop_lat), lon = _num(f.stop_lon);
        if (lat != null && lon != null) stops.set(f.stop_id, { lat, lon, nombre: f.stop_name || '' });
      });
    }

    // ── Armado final ──────────────────────────────────────────
    avisar('Armando los recorridos…');
    const recorridos = [];
    for (const [clave, viaje] of elegidos) {
      const ruta = porId.get(viaje.route_id);
      const linea = ruta.route_short_name || ruta.route_id;

      const paradas = (paradasPorViaje.get(viaje.trip_id) || [])
        .map(([, id]) => stops.get(id))
        .filter(Boolean)
        .map((s, i) => ({ id: DB.nuevoId('p'), lat: s.lat, lng: s.lon, nombre: s.nombre || `Parada ${i + 1}` }));

      // Con shape se usa el trazado real. Sin shape, la única geometría que
      // queda son las paradas: da un recorrido en líneas rectas de esquina a
      // esquina, sirve para ubicarse pero NO para guiar. Se avisa en las notas.
      const conShape = shapes.get(viaje.shape_id);
      const puntos = conShape && conShape.length > 1
        ? conShape.map(([, lat, lon]) => [lat, lon])
        : paradas.map(p => [p.lat, p.lng]);
      if (puntos.length < 2) continue;

      const sentido = viaje.trip_headsign
        || (ruta.route_long_name || '')
        || (viaje.direction_id === '1' ? 'Vuelta' : 'Ida');

      recorridos.push({
        nombre: `${linea} — ${sentido}`.trim(),
        linea,
        sentido,
        origen: 'importado',
        color: ruta.route_color ? `#${ruta.route_color}` : '#4ea8de',
        puntos,
        paradas,
        hitos: [],
        notas: conShape
          ? `Importado de un GTFS oficial (línea ${linea}, viaje ${viaje.trip_id}).`
          : `Importado de un GTFS oficial (línea ${linea}). ⚠️ El feed no traía la geometría del recorrido: el trazado se armó uniendo las paradas con líneas rectas, así que NO sigue las calles. Corregilo en el editor o grabá el recorrido antes de usarlo para guiar.`,
        _sinShape: !conShape,
        _clave: clave,
      });
    }

    recorridos.sort((a, b) =>
      String(a.linea).localeCompare(String(b.linea), 'es', { numeric: true }) ||
      a.sentido.localeCompare(b.sentido, 'es'));

    return { recorridos, agencias: agencias.map(a => a.agency_name).filter(Boolean), totalRutas: rutas.length };
  }

  return { leer, abrirZip, parsearCsv, partirCsv, recorrerCsv };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = GTFS;
