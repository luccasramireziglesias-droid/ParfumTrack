// ══════════════════════════════════════════════════════════════
// Editar — dibujar y corregir un recorrido sobre el mapa.
//
// Sirve para las dos cosas: cargar una línea desde casa mirando la hoja
// de ruta, y arreglarle a una grabación el pedazo donde el GPS se fue a
// la loma del orto entre dos edificios.
// ══════════════════════════════════════════════════════════════

const Editar = (() => {
  let _rec = null, _modo = 'trazado';
  const _deshacer = [];

  const AYUDA = {
    trazado: 'Tocá el mapa para ir agregando puntos al trazado. Arrastrá un punto para moverlo; tocalo dos veces para borrarlo.',
    paradas: 'Tocá el mapa donde hay una parada. Tocá una parada existente para renombrarla o borrarla.',
    hitos:   'Tocá el mapa para poner un aviso propio (“cuidado con el badén”, “acá cambia el sentido”). Los giros los detecta la app sola.',
  };

  function nuevo() {
    abrir({
      nombre: '', linea: '', sentido: '', origen: 'dibujado',
      puntos: [], paradas: [], hitos: [], color: '#35c78a',
    });
  }

  function abrir(rec) {
    // Copia profunda: si cancelás, el recorrido guardado tiene que quedar
    // como estaba. Editar el objeto de la base directamente hacía que un
    // "no guardar" igual dejara los cambios aplicados en memoria.
    _rec = JSON.parse(JSON.stringify(rec));
    _rec.paradas = _rec.paradas || [];
    _rec.hitos = _rec.hitos || [];
    _deshacer.length = 0;
    UI.irA('editar');
    UI.$('#titulo').textContent = _rec.id ? 'Editar recorrido' : 'Nuevo recorrido';
    _montar();
  }

  function _montar() {
    const m = Mapa.crear('mapa-editar');
    Mapa.refrescar('mapa-editar');
    m.map.off('click').on('click', _alTocarMapa);
    if (_rec.puntos.length) Mapa.encuadrar('mapa-editar', _rec.puntos);
    else GPS.unaVez().then(p => m.map.setView([p.lat, p.lng], 16)).catch(() => {});
    _pintar();
  }

  function _instantanea() {
    _deshacer.push(JSON.stringify({ puntos: _rec.puntos, paradas: _rec.paradas, hitos: _rec.hitos }));
    if (_deshacer.length > 60) _deshacer.shift();
  }

  function _alTocarMapa(e) {
    const p = [e.latlng.lat, e.latlng.lng];
    _instantanea();
    if (_modo === 'trazado') {
      _rec.puntos.push(p);
    } else if (_modo === 'paradas') {
      _rec.paradas.push({ id: DB.nuevoId('p'), lat: p[0], lng: p[1], nombre: `Parada ${_rec.paradas.length + 1}` });
    } else {
      _rec.hitos.push({ id: DB.nuevoId('h'), lat: p[0], lng: p[1], tipo: 'aviso', texto: 'Aviso', auto: false });
    }
    _pintar();
  }

  function _pintar() {
    const m = Mapa.get('mapa-editar');
    Mapa.dibujarRecorrido('mapa-editar', _rec.puntos, { color: _rec.color || '#35c78a' });

    // Los vértices solo se muestran en modo trazado: con 400 puntos y las
    // paradas encima, el mapa se vuelve ilegible y no le pegás a nada.
    if (_modo === 'trazado') {
      const vertices = _rec.puntos.map((p, i) => {
        const mk = L.circleMarker(p, { radius: 6, color: '#e8c97e', weight: 2, fillColor: '#0f0f1a', fillOpacity: 1 });
        mk.on('click', ev => { L.DomEvent.stop(ev); _tocarVertice(i); });
        return mk;
      });
      Mapa.limpiar('mapa-editar', 'vertices');
      m.capas.vertices = L.layerGroup(vertices).addTo(m.map);
    } else {
      Mapa.limpiar('mapa-editar', 'vertices');
    }

    Mapa.dibujarParadas('mapa-editar', _rec.paradas, {
      onClick: _modo === 'paradas' ? (p, i) => _editarParada(i) : null,
    });
    Mapa.dibujarHitos('mapa-editar', _rec.hitos.filter(h => !h.auto), {
      onClick: _modo === 'hitos' ? (h, i) => _editarHito(i) : null,
    });

    UI.$('#edit-ayuda').textContent = AYUDA[_modo];
    UI.$('#edit-stats').innerHTML = `
      <div><strong>${Geo.fmtDist(Geo.largo(_rec.puntos))}</strong><small>largo</small></div>
      <div><strong>${_rec.puntos.length}</strong><small>puntos</small></div>
      <div><strong>${_rec.paradas.length}</strong><small>paradas</small></div>`;
    UI.$('#edit-deshacer').disabled = !_deshacer.length;
  }

  let _ultimoVertice = { i: -1, ts: 0 };
  function _tocarVertice(i) {
    const ahora = Date.now();
    // Doble toque = borrar. Un toque solo no puede borrar: con el dedo
    // sobre un mapa lleno de vértices, borrarías medio trazado sin querer.
    if (_ultimoVertice.i === i && ahora - _ultimoVertice.ts < 600) {
      _instantanea();
      _rec.puntos.splice(i, 1);
      _ultimoVertice = { i: -1, ts: 0 };
      _pintar();
      return;
    }
    _ultimoVertice = { i, ts: ahora };
    UI.toast('Tocalo otra vez para borrar este punto', 'aviso', 1800);
  }

  async function _editarParada(i) {
    const p = _rec.paradas[i];
    const op = await UI.elegir(p.nombre || 'Parada', [
      { texto: '✏️ Renombrar', valor: 'nombre' },
      { texto: '🗑️ Borrar', valor: 'borrar', clase: 'peligro' },
    ]);
    if (op === 'nombre') {
      const n = await UI.pedirTexto('Nombre de la parada', p.nombre || '', 'ej: Shopping Costa Urbana');
      if (n) { _instantanea(); p.nombre = n; _pintar(); }
    }
    if (op === 'borrar') { _instantanea(); _rec.paradas.splice(i, 1); _pintar(); }
  }

  async function _editarHito(i) {
    const manuales = _rec.hitos.filter(h => !h.auto);
    const h = manuales[i];
    const op = await UI.elegir(h.texto || 'Aviso', [
      { texto: '✏️ Cambiar el texto', valor: 'texto' },
      { texto: '↰ Es un giro a la izquierda', valor: 'izq' },
      { texto: '↱ Es un giro a la derecha', valor: 'der' },
      { texto: '🗑️ Borrar', valor: 'borrar', clase: 'peligro' },
    ]);
    if (op === 'texto') {
      const t = await UI.pedirTexto('¿Qué tiene que avisar?', h.texto || '', 'ej: badén hondo, pasá despacio');
      if (t) { _instantanea(); h.texto = t; _pintar(); }
    }
    if (op === 'izq' || op === 'der') { _instantanea(); h.tipo = op; _pintar(); }
    if (op === 'borrar') {
      _instantanea();
      _rec.hitos = _rec.hitos.filter(x => x.id !== h.id);
      _pintar();
    }
  }

  function _deshacerUno() {
    const prev = _deshacer.pop();
    if (!prev) return;
    Object.assign(_rec, JSON.parse(prev));
    _pintar();
  }

  function _invertir() {
    _instantanea();
    _rec.puntos.reverse();
    // Los hitos automáticos apuntan al sentido viejo: al invertir, una
    // derecha pasa a ser izquierda. Se tiran y se recalculan al guardar.
    _rec.hitos = _rec.hitos.filter(h => !h.auto);
    _pintar();
    UI.toast('Sentido invertido', 'ok');
  }

  function _simplificar() {
    const antes = _rec.puntos.length;
    _instantanea();
    _rec.puntos = Geo.simplificar(_rec.puntos, 8);
    _pintar();
    UI.toast(`${antes} → ${_rec.puntos.length} puntos`, 'ok');
  }

  async function _guardar() {
    if (_rec.puntos.length < 2) return UI.toast('El recorrido necesita al menos dos puntos.', 'error');
    if (!_rec.nombre) {
      const n = await UI.pedirTexto('¿Cómo se llama el recorrido?', '', 'ej: 710 Solymar → Portones');
      if (n === null) return;
      _rec.nombre = n;
    }
    const guardado = await DB.guardar(_rec);
    UI.toast('Recorrido guardado', 'ok');
    Detalle.abrir(guardado.id);
  }

  function init() {
    UI.$$('#edit-modo .seg').forEach(b => {
      b.onclick = () => {
        UI.$$('#edit-modo .seg').forEach(o => o.classList.toggle('activo', o === b));
        _modo = b.dataset.modo;
        _pintar();
      };
    });
    UI.$('#edit-deshacer').onclick   = _deshacerUno;
    UI.$('#edit-invertir').onclick   = _invertir;
    UI.$('#edit-simplificar').onclick = _simplificar;
    UI.$('#edit-guardar').onclick    = _guardar;
    document.addEventListener('pantalla', e => { if (e.detail.id === 'editar') Mapa.refrescar('mapa-editar'); });
  }

  return { init, abrir, nuevo, actual: () => _rec };
})();
