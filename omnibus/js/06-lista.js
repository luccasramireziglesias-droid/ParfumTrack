// ══════════════════════════════════════════════════════════════
// Lista — pantalla de inicio: todos los recorridos guardados.
// ══════════════════════════════════════════════════════════════

const Lista = (() => {
  let _todos = [];
  let _filtro = '';

  async function cargar() {
    _todos = await DB.todos();
    render();
  }

  function _coincide(r) {
    if (!_filtro) return true;
    const t = `${r.nombre} ${r.linea || ''} ${r.sentido || ''} ${r.notas || ''}`.toLowerCase();
    return _filtro.split(/\s+/).every(p => t.includes(p));
  }

  function render() {
    const cont = UI.$('#lista-recorridos');
    const visibles = _todos.filter(_coincide);
    UI.$('#lista-vacia').hidden = _todos.length > 0;

    if (!visibles.length) {
      cont.innerHTML = _todos.length
        ? `<p class="nota">Ningún recorrido coincide con “${UI.esc(_filtro)}”.</p>`
        : '';
      return;
    }

    cont.innerHTML = visibles.map(r => {
      const paradas = (r.paradas || []).length;
      const giros = (r.hitos || []).length;
      return `
        <button class="tarjeta" data-id="${UI.escAttr(r.id)}" style="border-left-color:${UI.escAttr(r.color || '#35c78a')}">
          <h3>${UI.esc(r.nombre)}</h3>
          <div class="meta">
            ${r.linea ? `<span class="chip">Línea ${UI.esc(r.linea)}</span>` : ''}
            ${r.sentido ? `<span class="chip">${UI.esc(r.sentido)}</span>` : ''}
            <span>${Geo.fmtDist(r.largo || 0)}</span>
            <span>${paradas} parada${paradas === 1 ? '' : 's'}</span>
            <span>${giros} giro${giros === 1 ? '' : 's'}</span>
          </div>
        </button>`;
    }).join('');

    cont.querySelectorAll('.tarjeta').forEach(el => {
      el.onclick = () => Detalle.abrir(el.dataset.id);
    });
  }

  async function menuNuevo() {
    const op = await UI.elegir('¿Cómo cargás el recorrido?', [
      { texto: '⏺️ Grabarlo manejando', valor: 'grabar', clase: 'ok' },
      { texto: '✏️ Dibujarlo en el mapa', valor: 'dibujar' },
      { texto: '📂 Importar un archivo',  valor: 'archivo' },
      { texto: '🌍 Buscar en OpenStreetMap', valor: 'osm' },
    ]);
    if (op === 'grabar')  return UI.irA('grabar');
    if (op === 'dibujar') return Editar.nuevo();
    if (op === 'archivo') { UI.irA('importar'); setTimeout(() => UI.$('#archivo').click(), 250); return; }
    if (op === 'osm')     return UI.irA('importar');
  }

  function init() {
    UI.$('#buscar').addEventListener('input', e => {
      _filtro = e.target.value.trim().toLowerCase();
      render();
    });
    UI.$('#fab-nuevo').addEventListener('click', menuNuevo);
    document.addEventListener('pantalla', e => { if (e.detail.id === 'lista') cargar(); });
  }

  return { init, cargar, render, menuNuevo, todos: () => _todos };
})();
