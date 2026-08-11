// ══════════════════════════════════════════════════════════════
// Detalle — un recorrido: mapa, números y hoja de ruta.
// ══════════════════════════════════════════════════════════════

const Detalle = (() => {
  let _rec = null;
  const actual = () => _rec;

  /**
   * Mezcla paradas e hitos en una sola secuencia ordenada por avance, que
   * es como el chofer vive el recorrido: no le sirve "las paradas" por un
   * lado y "los giros" por otro, le sirve qué viene después de qué.
   * La usan el detalle, el modo estudio y el generador del test.
   */
  function pasos(rec) {
    if (!rec) return [];
    const items = [
      ...(rec.paradas || []).map((p, i) => ({
        clase: 'parada', metros: p.metros || 0, lat: p.lat, lng: p.lng,
        titulo: p.nombre || `Parada ${i + 1}`, ico: String(i + 1), ref: p.id,
      })),
      ...(rec.hitos || []).map(h => ({
        clase: 'giro', metros: h.metros || 0, lat: h.lat, lng: h.lng,
        titulo: h.texto || Geo.TEXTO_GIRO[h.tipo] || 'Seguí derecho',
        ico: Mapa.FLECHA[h.tipo] || '•', ref: h.id, tipo: h.tipo,
      })),
    ].sort((a, b) => a.metros - b.metros);

    let previo = 0;
    for (const it of items) { it.desdeElPrevio = it.metros - previo; previo = it.metros; }
    return items;
  }

  function _renderPasos(cont, lista, onClick) {
    if (!lista.length) {
      cont.innerHTML = '<p class="nota">Este recorrido no tiene paradas ni giros marcados todavía. Editalo para agregarlos.</p>';
      return;
    }
    cont.innerHTML = lista.map((p, i) => `
      <li>
        <button class="paso" data-i="${i}">
          <span class="paso-ico ${p.clase}">${UI.esc(p.ico)}</span>
          <span class="paso-cuerpo">
            <b>${UI.esc(p.titulo)}</b>
            <small>km ${(p.metros / 1000).toFixed(2)} · ${Geo.fmtDist(p.desdeElPrevio)} desde el anterior</small>
          </span>
        </button>
      </li>`).join('');
    cont.querySelectorAll('.paso').forEach(el => {
      el.onclick = () => {
        cont.querySelectorAll('.paso').forEach(o => o.classList.remove('activo'));
        el.classList.add('activo');
        onClick(lista[+el.dataset.i]);
      };
    });
  }

  async function abrir(id) {
    _rec = await DB.obtener(id);
    if (!_rec) return UI.toast('No se encontró el recorrido.', 'error');
    UI.irA('detalle');
    render();
  }

  function render() {
    const r = _rec;
    if (!r) return;
    UI.$('#titulo').textContent = r.nombre;
    UI.$('#det-nombre').textContent = r.nombre;
    UI.$('#det-sub').textContent = [
      r.linea ? `Línea ${r.linea}` : null,
      r.sentido,
      `${({ grabado: 'Grabado', dibujado: 'Dibujado', importado: 'Importado', osm: 'Desde OSM' })[r.origen] || 'Cargado'} el ${UI.fecha(r.creado)}`,
    ].filter(Boolean).join(' · ');

    UI.$('#det-stats').innerHTML = `
      <div><strong>${Geo.fmtDist(r.largo || 0)}</strong><small>largo</small></div>
      <div><strong>${(r.paradas || []).length}</strong><small>paradas</small></div>
      <div><strong>${(r.hitos || []).length}</strong><small>giros y avisos</small></div>`;

    const m = Mapa.crear('mapa-detalle');
    Mapa.refrescar('mapa-detalle');
    Mapa.dibujarRecorrido('mapa-detalle', r.puntos, { color: r.color || '#35c78a' });
    Mapa.dibujarParadas('mapa-detalle', r.paradas);
    Mapa.dibujarHitos('mapa-detalle', r.hitos);
    Mapa.encuadrar('mapa-detalle', r.puntos);

    _renderPasos(UI.$('#det-pasos'), pasos(r), p => m.map.setView([p.lat, p.lng], 17));
  }

  async function _menuMas() {
    const op = await UI.elegir('Más opciones', [
      { texto: '✏️ Renombrar',            valor: 'nombre' },
      { texto: '🏷️ Línea y sentido',      valor: 'linea' },
      { texto: '🛣️ Poner nombres de calles', valor: 'calles' },
      { texto: '📤 Exportar (GeoJSON)',    valor: 'exportar' },
      { texto: '📋 Duplicar',              valor: 'duplicar' },
      { texto: '🗑️ Borrar recorrido',      valor: 'borrar', clase: 'peligro' },
    ]);
    if (!op) return;

    if (op === 'nombre') {
      const n = await UI.pedirTexto('Nombre del recorrido', _rec.nombre);
      if (n) { _rec.nombre = n; await DB.guardar(_rec); render(); UI.toast('Listo', 'ok'); }
    }
    if (op === 'linea') {
      const l = await UI.pedirTexto('Número o nombre de la línea', _rec.linea || '', 'ej: 710');
      if (l !== null) {
        const s = await UI.pedirTexto('Sentido', _rec.sentido || '', 'ej: Solymar → Portones');
        _rec.linea = l; if (s !== null) _rec.sentido = s;
        await DB.guardar(_rec); render(); UI.toast('Listo', 'ok');
      }
    }
    if (op === 'calles')   return Importar.nombrarCalles(_rec, render);
    if (op === 'exportar') return Importar.exportar(_rec);
    if (op === 'duplicar') {
      const copia = { ..._rec, id: null, creado: null, nombre: `${_rec.nombre} (copia)` };
      await DB.guardar(copia);
      UI.toast('Recorrido duplicado', 'ok');
      UI.irA('lista');
    }
    if (op === 'borrar') {
      const ok = await UI.confirmar('¿Borrar el recorrido?', `Se borra "${_rec.nombre}" de este teléfono y no se puede deshacer. Si te costó grabarlo, exportalo antes.`, 'Borrar');
      if (ok) { await DB.borrar(_rec.id); UI.toast('Recorrido borrado'); UI.irA('lista'); }
    }
  }

  function init() {
    UI.$('#det-manejar').onclick  = () => Manejar.arrancar(_rec);
    UI.$('#det-estudiar').onclick = () => Estudio.abrir(_rec);
    UI.$('#det-editar').onclick   = () => Editar.abrir(_rec);
    UI.$('#det-offline').onclick  = () => Offline.descargarRecorrido(_rec);
    UI.$('#det-mas').onclick      = _menuMas;
    document.addEventListener('pantalla', e => {
      if (e.detail.id === 'detalle') Mapa.refrescar('mapa-detalle');
    });
  }

  return { init, abrir, render, pasos, actual, _renderPasos };
})();
