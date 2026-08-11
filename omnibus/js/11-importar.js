// ══════════════════════════════════════════════════════════════
// Importar — datos que vienen de afuera: OpenStreetMap, archivos
// (GPX / GeoJSON / KML) y nombres de calles vía Nominatim.
//
// Todo lo de acá puede fallar por red, por cobertura o porque el archivo
// venga raro. Ninguna de esas fallas puede tirar la app abajo: es una vía
// de entrada opcional, la que siempre funciona es grabar el recorrido.
// ══════════════════════════════════════════════════════════════

const Importar = (() => {

  // ── OpenStreetMap ─────────────────────────────────────────
  // Varios espejos: overpass-api.de es el oficial y el que más se satura.
  // Si devuelve 429 o 504 (pasa seguido), se prueba el siguiente.
  const ESPEJOS = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
    'https://overpass.private.coffee/api/interpreter',
  ];

  const ZONAS = {
    costa:      { bbox: [-34.95, -56.20, -34.55, -55.40], nombre: 'Ciudad de la Costa y Canelones' },
    montevideo: { bbox: [-34.95, -56.45, -34.70, -56.00], nombre: 'Montevideo' },
    uruguay:    { area: '"ISO3166-1"="UY"',                nombre: 'Uruguay' },
  };

  /** Escapa lo que va adentro de una expresión regular de Overpass QL. */
  const escRe = (s) => String(s).replace(/["\\]/g, '\\$&');

  async function _zonaElegida() {
    const val = UI.$('#osm-zona').value;
    if (val !== 'cerca') return ZONAS[val] || ZONAS.costa;
    const p = await GPS.unaVez();
    const dLat = 20000 / 110574;
    const dLon = 20000 / (111320 * Math.cos(p.lat * Math.PI / 180));
    return { bbox: [p.lat - dLat, p.lng - dLon, p.lat + dLat, p.lng + dLon], nombre: 'tu zona' };
  }

  function _consulta(zona, operador, linea) {
    const filtros = [
      '["type"="route"]["route"="bus"]',
      operador ? `["operator"~"${escRe(operador)}",i]` : '',
      linea    ? `["ref"~"^${escRe(linea)}$",i]` : '',
    ].join('');
    // `out geom` trae la geometría de cada way miembro en la misma
    // respuesta. Sin eso harían falta dos consultas más y el stitching
    // quedaría a ciegas.
    if (zona.area) {
      return `[out:json][timeout:60];area[${zona.area}][admin_level=2]->.a;rel(area.a)${filtros};out geom;`;
    }
    const [s, o, n, e] = zona.bbox;
    return `[out:json][timeout:60];rel(${s},${o},${n},${e})${filtros};out geom;`;
  }

  async function _pedirOverpass(query) {
    let ultimoError = null;
    for (const url of ESPEJOS) {
      try {
        const r = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: 'data=' + encodeURIComponent(query),
        });
        if (!r.ok) { ultimoError = new Error(`El servidor respondió ${r.status}`); continue; }
        return await r.json();
      } catch (e) { ultimoError = e; }
    }
    throw ultimoError || new Error('No se pudo contactar a OpenStreetMap.');
  }

  /**
   * Une los ways de una relación en una sola polilínea.
   *
   * Los miembros de una relación de OSM vienen en orden, pero cada way
   * puede estar digitalizado al revés (la calle se mapeó de norte a sur y
   * el recorrido va de sur a norte). Por eso no alcanza con concatenar:
   * hay que decidir la orientación de cada tramo mirando cuál de sus dos
   * puntas queda más cerca de donde terminó el tramo anterior. Sin esto,
   * el trazado sale con dientes de sierra de cuadras enteras.
   */
  function _unirWays(miembros) {
    const tramos = miembros
      .filter(m => m.type === 'way' && Array.isArray(m.geometry) && m.geometry.length > 1
                && !/^(stop|platform)/.test(m.role || ''))
      .map(m => m.geometry.map(g => [g.lat, g.lon]));
    if (!tramos.length) return [];

    const salida = tramos[0].slice();
    for (let i = 1; i < tramos.length; i++) {
      const t = tramos[i];
      const fin = salida[salida.length - 1];
      const aInicio = Geo.distancia(fin, t[0]);
      const aFin    = Geo.distancia(fin, t[t.length - 1]);
      const orientado = aFin < aInicio ? t.slice().reverse() : t;
      // Si la punta coincide (mismo nodo compartido) no se repite el punto.
      const salto = Geo.distancia(fin, orientado[0]);
      salida.push(...(salto < 1 ? orientado.slice(1) : orientado));
    }
    return salida;
  }

  function _paradasDe(miembros) {
    return miembros
      .filter(m => m.type === 'node' && /^(stop|platform)/.test(m.role || '') && m.lat != null)
      .map((m, i) => ({
        id: DB.nuevoId('p'), lat: m.lat, lng: m.lon,
        nombre: (m.tags && (m.tags.name || m.tags.ref)) || `Parada ${i + 1}`,
      }));
  }

  function _aRecorrido(rel) {
    const t = rel.tags || {};
    const puntos = _unirWays(rel.members || []);
    if (puntos.length < 2) return null;
    const nombre = t.name
      || [t.ref, t.from && t.to ? `${t.from} → ${t.to}` : null].filter(Boolean).join(' ')
      || `Relación ${rel.id}`;
    return {
      nombre, linea: t.ref || '', sentido: t.from && t.to ? `${t.from} → ${t.to}` : '',
      origen: 'osm', osmId: rel.id, color: t.colour || '#4ea8de',
      puntos, paradas: _paradasDe(rel.members || []), hitos: [],
      notas: `Importado de OpenStreetMap (relación ${rel.id})${t.operator ? `, operador ${t.operator}` : ''}.`,
    };
  }

  async function buscarOsm() {
    const btn = UI.$('#osm-buscar');
    const cont = UI.$('#osm-resultados');
    btn.disabled = true; btn.textContent = 'Buscando…';
    cont.innerHTML = '<p class="nota">Consultando OpenStreetMap, puede tardar hasta un minuto…</p>';
    try {
      const zona = await _zonaElegida();
      const operador = UI.$('#osm-operador').value.trim();
      const linea = UI.$('#osm-linea').value.trim();
      const datos = await _pedirOverpass(_consulta(zona, operador, linea));

      const recorridos = (datos.elements || [])
        .filter(el => el.type === 'relation')
        .map(_aRecorrido)
        .filter(Boolean);

      if (!recorridos.length) {
        cont.innerHTML = `<p class="nota">No apareció ningún recorrido con esos datos en ${UI.esc(zona.nombre)}.
          Puede que la línea no esté mapeada en OSM todavía — es lo más común. Probá sin el número de línea,
          o con otro nombre de empresa. Si no está, grabala o dibujala.</p>`;
        return;
      }
      _pintarResultados(cont, recorridos, 'osm');
    } catch (e) {
      cont.innerHTML = `<p class="nota">No se pudo consultar OpenStreetMap: ${UI.esc(e.message)}.
        Revisá la conexión y probá de nuevo en un rato.</p>`;
    } finally {
      btn.disabled = false; btn.textContent = 'Buscar';
    }
  }

  function _pintarResultados(cont, recorridos, fuente) {
    cont.innerHTML = recorridos.map((r, i) => `
      <button class="tarjeta" data-i="${i}" style="border-left-color:${UI.escAttr(r.color || '#4ea8de')}">
        <h3>${UI.esc(r.nombre)}</h3>
        <div class="meta">
          ${r.linea ? `<span class="chip">Línea ${UI.esc(r.linea)}</span>` : ''}
          <span>${Geo.fmtDist(Geo.largo(r.puntos))}</span>
          <span>${r.puntos.length} puntos</span>
          <span>${(r.paradas || []).length} paradas</span>
        </div>
      </button>`).join('');
    cont.querySelectorAll('.tarjeta').forEach(el => {
      el.onclick = async () => {
        const r = recorridos[+el.dataset.i];
        const guardado = await DB.guardar({ ...r, origen: r.origen || fuente });
        UI.toast(`"${guardado.nombre}" agregado`, 'ok');
        Detalle.abrir(guardado.id);
      };
    });
  }

  // ── Archivos ──────────────────────────────────────────────
  const _num = (v) => { const n = parseFloat(v); return isFinite(n) ? n : null; };

  function _leerGpx(doc, nombreArchivo) {
    const puntos = Array.from(doc.querySelectorAll('trkpt, rtept'))
      .map(p => [_num(p.getAttribute('lat')), _num(p.getAttribute('lon'))])
      .filter(p => p[0] != null && p[1] != null);
    const paradas = Array.from(doc.querySelectorAll('wpt')).map((w, i) => ({
      id: DB.nuevoId('p'),
      lat: _num(w.getAttribute('lat')), lng: _num(w.getAttribute('lon')),
      nombre: w.querySelector('name')?.textContent?.trim() || `Parada ${i + 1}`,
    })).filter(p => p.lat != null && p.lng != null);
    const nombre = doc.querySelector('trk > name, rte > name, metadata > name')?.textContent?.trim() || nombreArchivo;
    return puntos.length > 1 ? [{ nombre, puntos, paradas, hitos: [] }] : [];
  }

  function _leerKml(doc, nombreArchivo) {
    // KML guarda "lon,lat[,alt]" — al revés que todo el resto. Invertir el
    // par acá es la diferencia entre un recorrido en Canelones y uno en
    // medio del Atlántico.
    const coords = (txt) => txt.trim().split(/\s+/).map(par => {
      const [lon, lat] = par.split(',').map(_num);
      return lat != null && lon != null ? [lat, lon] : null;
    }).filter(Boolean);

    const salida = [];
    Array.from(doc.querySelectorAll('Placemark')).forEach((pm, i) => {
      const nombre = pm.querySelector('name')?.textContent?.trim() || `${nombreArchivo} ${i + 1}`;
      const linea = pm.querySelector('LineString > coordinates');
      if (linea) {
        const puntos = coords(linea.textContent);
        if (puntos.length > 1) salida.push({ nombre, puntos, paradas: [], hitos: [] });
      }
    });
    // Los Placemark de punto se reparten como paradas del primer trazado.
    const paradas = Array.from(doc.querySelectorAll('Placemark')).map((pm, i) => {
      const p = pm.querySelector('Point > coordinates');
      if (!p) return null;
      const c = coords(p.textContent)[0];
      return c ? { id: DB.nuevoId('p'), lat: c[0], lng: c[1], nombre: pm.querySelector('name')?.textContent?.trim() || `Parada ${i + 1}` } : null;
    }).filter(Boolean);
    if (salida.length && paradas.length) salida[0].paradas = paradas;
    return salida;
  }

  function _leerGeoJson(obj, nombreArchivo) {
    const feats = obj.type === 'FeatureCollection' ? (obj.features || [])
                : obj.type === 'Feature' ? [obj]
                : [{ type: 'Feature', geometry: obj, properties: {} }];
    const salida = [], paradas = [];

    for (const f of feats) {
      const g = f.geometry; if (!g) continue;
      const props = f.properties || {};
      const nombre = props.name || props.nombre || props.ref || nombreArchivo;

      if (g.type === 'LineString') {
        const puntos = g.coordinates.map(([lon, lat]) => [lat, lon]);
        if (puntos.length > 1) salida.push({ nombre, linea: props.ref || props.linea || '', puntos, paradas: [], hitos: [] });
      } else if (g.type === 'MultiLineString') {
        const puntos = g.coordinates.flat().map(([lon, lat]) => [lat, lon]);
        if (puntos.length > 1) salida.push({ nombre, linea: props.ref || '', puntos, paradas: [], hitos: [] });
      } else if (g.type === 'Point') {
        paradas.push({ id: DB.nuevoId('p'), lat: g.coordinates[1], lng: g.coordinates[0], nombre });
      }
    }
    if (salida.length && paradas.length) salida[0].paradas = paradas;
    return salida;
  }

  async function _leerArchivo(file) {
    const texto = await file.text();
    const base = file.name.replace(/\.[^.]+$/, '');
    const ext = (file.name.split('.').pop() || '').toLowerCase();

    if (ext === 'geojson' || ext === 'json') return _leerGeoJson(JSON.parse(texto), base);

    const doc = new DOMParser().parseFromString(texto, 'application/xml');
    if (doc.querySelector('parsererror')) throw new Error('el archivo no es XML válido');
    if (ext === 'kml' || doc.querySelector('kml')) return _leerKml(doc, base);
    return _leerGpx(doc, base);
  }

  async function _alElegirArchivos(e) {
    const cont = UI.$('#import-resultados');
    const archivos = Array.from(e.target.files || []);
    if (!archivos.length) return;
    const encontrados = [];
    const errores = [];

    for (const f of archivos) {
      try {
        const recs = await _leerArchivo(f);
        if (!recs.length) errores.push(`${f.name}: no tiene ningún trazado adentro`);
        encontrados.push(...recs.map(r => ({ ...r, origen: 'importado', color: '#e8c97e' })));
      } catch (err) {
        errores.push(`${f.name}: ${err.message}`);
      }
    }
    e.target.value = '';   // permite volver a elegir el mismo archivo

    cont.innerHTML = errores.map(x => `<p class="nota">⚠️ ${UI.esc(x)}</p>`).join('');
    if (encontrados.length) {
      const wrap = document.createElement('div');
      wrap.className = 'lista';
      cont.appendChild(wrap);
      _pintarResultados(wrap, encontrados, 'importado');
    }
  }

  // ── GTFS ──────────────────────────────────────────────────
  function _estadoGtfs(texto, mostrar = true) {
    const el = UI.$('#gtfs-estado');
    el.hidden = !mostrar;
    el.textContent = texto;
  }

  async function _alElegirGtfs(e) {
    const file = (e.target.files || [])[0];
    if (!file) return;
    e.target.value = '';
    const cont = UI.$('#gtfs-resultados');
    cont.innerHTML = '';
    _estadoGtfs('Leyendo el archivo…');

    try {
      if (typeof DecompressionStream === 'undefined') {
        throw new Error('este navegador es muy viejo para descomprimir el .zip acá adentro; probá con Chrome actualizado');
      }
      const buffer = await file.arrayBuffer();
      const { recorridos, agencias, totalRutas } = await GTFS.leer(buffer, {
        empresa: UI.$('#gtfs-empresa').value,
        avisar: _estadoGtfs,
      });

      if (!recorridos.length) {
        _estadoGtfs('', false);
        cont.innerHTML = `<p class="nota">El feed tiene ${totalRutas} líneas, pero ninguna coincide con ese filtro.
          ${agencias.length ? `Las empresas que trae son: ${UI.esc(agencias.slice(0, 25).join(', '))}.` : ''}
          Probá con uno de esos nombres, con el número de línea, o dejá el filtro vacío para ver todas.</p>`;
        return;
      }

      const sinShape = recorridos.filter(r => r._sinShape).length;
      _estadoGtfs(`${recorridos.length} recorrido(s) encontrados${sinShape ? ` · ⚠️ ${sinShape} sin geometría real` : ''}. Tocá uno para agregarlo.`);

      const todas = document.createElement('button');
      todas.className = 'btn bloque ok';
      todas.textContent = `Agregar los ${recorridos.length} de una vez`;
      todas.onclick = async () => {
        todas.disabled = true;
        for (let i = 0; i < recorridos.length; i++) {
          todas.textContent = `Agregando ${i + 1} de ${recorridos.length}…`;
          await DB.guardar({ ...recorridos[i] });
        }
        UI.toast(`${recorridos.length} recorridos agregados`, 'ok', 4000);
        UI.irA('lista');
      };
      cont.appendChild(todas);

      const lista = document.createElement('div');
      lista.className = 'lista';
      cont.appendChild(lista);
      _pintarResultados(lista, recorridos, 'importado');
    } catch (err) {
      _estadoGtfs('', false);
      cont.innerHTML = `<p class="nota">⚠️ No se pudo leer el GTFS: ${UI.esc(err.message)}</p>`;
      console.error('[gtfs]', err);
    }
  }

  // ── Exportar ──────────────────────────────────────────────
  function exportar(rec) {
    const geo = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: {
            name: rec.nombre, ref: rec.linea || '', sentido: rec.sentido || '',
            notas: rec.notas || '', app: 'recorridos',
          },
          geometry: { type: 'LineString', coordinates: rec.puntos.map(([lat, lng]) => [lng, lat]) },
        },
        ...(rec.paradas || []).map(p => ({
          type: 'Feature',
          properties: { name: p.nombre, tipo: 'parada' },
          geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
        })),
        ...(rec.hitos || []).filter(h => !h.auto).map(h => ({
          type: 'Feature',
          properties: { name: h.texto || h.tipo, tipo: 'aviso' },
          geometry: { type: 'Point', coordinates: [h.lng, h.lat] },
        })),
      ],
    };
    const blob = new Blob([JSON.stringify(geo, null, 2)], { type: 'application/geo+json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${rec.nombre.replace(/[^\w\sáéíóúñü-]/gi, '').trim() || 'recorrido'}.geojson`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    UI.toast('Archivo generado', 'ok');
  }

  // ── Copia de seguridad de TODO ────────────────────────────
  //
  // Exportar de a un recorrido no alcanza como respaldo: los recorridos
  // viven en el IndexedDB del teléfono, y eso se va entero si se pierde el
  // teléfono, si se limpian los datos del navegador o si se desinstala la
  // app. Son horas de manejo grabando.
  const FORMATO = 'recorridos-backup';

  function armarBackup(recorridos) {
    return {
      formato: FORMATO,
      version: 1,
      fecha: new Date().toISOString(),
      cantidad: recorridos.length,
      recorridos,
    };
  }

  /**
   * Valida y devuelve los recorridos de un backup.
   * Es estricto a propósito: restaurar basura silenciosamente es peor que
   * fallar con un mensaje.
   */
  function leerBackup(texto) {
    let obj;
    try { obj = JSON.parse(texto); }
    catch { throw new Error('el archivo no es un JSON válido'); }
    if (!obj || obj.formato !== FORMATO) {
      throw new Error('no es una copia de recorridos (si es un recorrido suelto, usá “Desde un archivo”)');
    }
    if (!Array.isArray(obj.recorridos)) throw new Error('la copia no trae la lista de recorridos');
    const validos = obj.recorridos.filter(r => r && Array.isArray(r.puntos) && r.puntos.length > 1);
    if (!validos.length) throw new Error('la copia no tiene ningún recorrido con trazado');
    return validos;
  }

  async function exportarTodo() {
    const recorridos = await DB.todos();
    if (!recorridos.length) return UI.toast('Todavía no hay recorridos para guardar.', 'aviso');

    const blob = new Blob([JSON.stringify(armarBackup(recorridos), null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const d = new Date();
    const p = n => String(n).padStart(2, '0');
    a.href = url;
    a.download = `recorridos-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    UI.toast(`Copia de ${recorridos.length} recorrido(s) generada. Guardala en Drive o mandátela por mail.`, 'ok', 6000);
  }

  /**
   * Restaura AGREGANDO, nunca reemplazando.
   *
   * Un id repetido recibe uno nuevo en vez de pisar el recorrido que ya
   * está. Si alguien restaura una copia vieja encima de la base actual, lo
   * peor que puede pasar es tener duplicados —que se borran en dos toques—
   * y no perder el trabajo de los últimos meses.
   */
  async function restaurarTodo(file) {
    let recorridos;
    try {
      recorridos = leerBackup(await file.text());
    } catch (e) {
      return UI.toast(`No se pudo restaurar: ${e.message}`, 'error', 7000);
    }

    const existentes = new Set((await DB.todos()).map(r => r.id));
    const ok = await UI.confirmar(
      `¿Restaurar ${recorridos.length} recorrido(s)?`,
      'Se AGREGAN a los que ya tenés; no se pisa ni se borra nada. Si alguno ya está, vas a quedar con dos copias.',
      'Restaurar');
    if (!ok) return;

    let agregados = 0;
    for (const r of recorridos) {
      const copia = { ...r };
      if (!copia.id || existentes.has(copia.id)) copia.id = null;   // DB.guardar le pone uno nuevo
      await DB.guardar(copia);
      agregados++;
    }
    UI.toast(`${agregados} recorrido(s) restaurados`, 'ok', 4000);
    await Lista.cargar();
    UI.irA('lista');
  }

  // ── Nombres de calles ─────────────────────────────────────
  const NOMINATIM = 'https://nominatim.openstreetmap.org/reverse';
  const TOPE_CONSULTAS = 80;

  /**
   * Le pone el nombre de la calle a cada giro: "girá a la derecha" pasa a
   * ser "girá a la derecha en Avenida Giannattasio", que es lo que hace
   * usable el aviso por voz.
   *
   * Nominatim es un servicio gratuito con una política de uso de máximo
   * una consulta por segundo. Respetarla no es opcional: pasarse hace que
   * bloqueen la IP. Por eso va en serie con una pausa, hay un tope de
   * consultas y se puede cancelar.
   */
  async function nombrarCalles(rec, alTerminar) {
    const giros = (rec.hitos || []).filter(h => !h.texto || /^(Aviso|)$/.test(h.texto));
    if (!giros.length) return UI.toast('Todos los giros ya tienen nombre.', 'ok');

    const cuantos = Math.min(giros.length, TOPE_CONSULTAS);
    const ok = await UI.confirmar(
      'Buscar los nombres de las calles',
      `Se van a consultar ${cuantos} esquina${cuantos === 1 ? '' : 's'} en OpenStreetMap, de a una por segundo para no abusar del servicio gratuito. Va a tardar cerca de ${UI.duracion(cuantos * 1100)}. Podés seguir usando la app.`,
      'Buscar');
    if (!ok) return;

    let hechos = 0, fallados = 0;
    for (const h of giros.slice(0, cuantos)) {
      try {
        const url = `${NOMINATIM}?format=jsonv2&zoom=17&addressdetails=1&lat=${h.lat}&lon=${h.lng}`;
        const r = await fetch(url, { headers: { 'Accept-Language': 'es' } });
        if (r.ok) {
          const d = await r.json();
          const calle = d?.address?.road || d?.address?.pedestrian || d?.address?.residential;
          if (calle) {
            h.texto = `${Geo.TEXTO_GIRO[h.tipo] || 'seguí'} en ${calle}`;
            h.auto = false;   // pasa a ser manual: ya no se regenera al guardar
            hechos++;
          }
        } else { fallados++; }
      } catch { fallados++; }
      UI.toast(`Buscando calles… ${hechos + fallados}/${cuantos}`, 'info', 1500);
      await new Promise(r => setTimeout(r, 1100));
    }

    await DB.guardar(rec);
    UI.toast(`${hechos} calle${hechos === 1 ? '' : 's'} con nombre${fallados ? `, ${fallados} sin resolver` : ''}`, hechos ? 'ok' : 'aviso', 4000);
    if (alTerminar) alTerminar();
  }

  function init() {
    UI.$('#osm-buscar').onclick = buscarOsm;
    UI.$('#backup-guardar').onclick = exportarTodo;
    UI.$('#archivo').addEventListener('change', _alElegirArchivos);
    UI.$('#gtfs-archivo').addEventListener('change', _alElegirGtfs);
    UI.$('#backup-archivo').addEventListener('change', (e) => {
      const f = (e.target.files || [])[0];
      e.target.value = '';
      if (f) restaurarTodo(f);
    });
  }

  return {
    init, buscarOsm, exportar, nombrarCalles,
    exportarTodo, restaurarTodo, armarBackup, leerBackup,
    _unirWays, _leerGeoJson, _leerGpx, _leerKml, _aRecorrido,
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Importar;
