// ══════════════════════════════════════════════════════════════
// Grabar — el recorrido se registra manejándolo una vez.
//
// Es la fuente de datos más fiel que hay: sale exactamente por donde pasa
// el ómnibus, incluidos los desvíos por obra y los atajos que ningún mapa
// tiene cargados.
// ══════════════════════════════════════════════════════════════

const Grabar = (() => {
  const PRECISION_MAX = 40;   // metros: peor que esto, el fix no entra
  const PASO_MIN = 6;         // metros entre puntos guardados

  let _estado = 'listo';      // listo | grabando | pausa
  let _puntos = [], _paradas = [], _hitos = [];
  let _desuscribir = null, _inicio = 0, _pausadoMs = 0, _tPausa = 0;
  let _ultima = null, _descartados = 0;
  let _tick = null;

  const grabando = () => _estado === 'grabando';

  function _alFix(fix, error) {
    if (error) { UI.toast(error, 'error', 5000); return; }
    if (!fix) return;

    Mapa.ponerPosicion('mapa-grabar', [fix.lat, fix.lng], fix.rumbo, fix.precision);
    _ultima = fix;
    if (_estado !== 'grabando') return;

    // Un fix con 150 m de error mete un diente en la traza que después hay
    // que borrar a mano. Es preferible perder el punto: el siguiente bueno
    // reconstruye la recta igual.
    if (fix.precision != null && fix.precision > PRECISION_MAX) { _descartados++; _pintar(); return; }

    const p = [fix.lat, fix.lng];
    const anterior = _puntos[_puntos.length - 1];
    // Parado en un semáforo el GPS sigue "moviéndose" un par de metros por
    // fix. Sin el paso mínimo, dos minutos de espera dejan 120 puntos
    // apelotonados en la esquina y el detector de giros ve una rotonda.
    if (anterior && Geo.distancia(anterior, p) < PASO_MIN) return;

    _puntos.push(p);
    Mapa.dibujarRecorrido('mapa-grabar', _puntos, { color: '#e05252' });
    if (_puntos.length % 12 === 0) Mapa.get('mapa-grabar').map.panTo(p);
    _pintar();
  }

  function _transcurrido() {
    if (!_inicio) return 0;
    const hasta = _estado === 'pausa' ? _tPausa : Date.now();
    return hasta - _inicio - _pausadoMs;
  }

  function _pintar() {
    const est = UI.$('#grab-estado');
    est.className = `grabar-estado ${_estado === 'grabando' ? 'grabando' : _estado === 'pausa' ? 'pausa' : ''}`;
    est.textContent = {
      listo:    'Listo para grabar',
      grabando: '● Grabando…',
      pausa:    '⏸ En pausa',
    }[_estado];

    UI.$('#grab-stats').innerHTML = `
      <div><strong>${Geo.fmtDist(Geo.largo(_puntos))}</strong><small>recorridos</small></div>
      <div><strong>${UI.duracion(_transcurrido())}</strong><small>tiempo</small></div>
      <div><strong>${_paradas.length}</strong><small>paradas</small></div>
      <div><strong>${_ultima?.precision != null ? Math.round(_ultima.precision) + ' m' : '—'}</strong><small>precisión</small></div>`;

    UI.$('#grab-toggle').textContent = _estado === 'grabando' ? '⏸ Pausar' : _estado === 'pausa' ? '▶ Seguir' : '● Empezar a grabar';
    UI.$('#grab-fin').disabled     = _estado === 'listo';
    UI.$('#grab-parada').disabled  = _estado === 'listo';
    UI.$('#grab-aviso').disabled   = _estado === 'listo';
  }

  function _empezar() {
    _estado = 'grabando';
    _inicio = Date.now(); _pausadoMs = 0;
    _puntos = []; _paradas = []; _hitos = []; _descartados = 0;
    Mapa.limpiar('mapa-grabar', 'recorrido', 'paradas', 'hitos');
    GPS.mantenerPantalla(true);
    Voz.desbloquear();
    Voz.decir('Grabando el recorrido.');
    _tick = setInterval(_pintar, 1000);
    _pintar();
  }

  function _alternar() {
    if (_estado === 'listo')    return _empezar();
    if (_estado === 'grabando') { _estado = 'pausa'; _tPausa = Date.now(); Voz.decir('Grabación en pausa.'); }
    else                        { _estado = 'grabando'; _pausadoMs += Date.now() - _tPausa; Voz.decir('Seguimos grabando.'); }
    _pintar();
  }

  /** Marca un punto de interés en la posición actual. */
  function _marcar(clase) {
    const f = GPS.ultima();
    if (!f) return UI.toast('Todavía no hay señal de GPS.', 'error');
    const item = { id: DB.nuevoId(clase === 'parada' ? 'p' : 'h'), lat: f.lat, lng: f.lng };
    if (clase === 'parada') {
      item.nombre = `Parada ${_paradas.length + 1}`;
      _paradas.push(item);
      Mapa.dibujarParadas('mapa-grabar', _paradas);
      Voz.decir(`Parada ${_paradas.length} marcada.`, { repetible: true });
    } else {
      item.tipo = 'aviso'; item.texto = 'Aviso';
      _hitos.push(item);
      Mapa.dibujarHitos('mapa-grabar', _hitos);
      Voz.decir('Aviso marcado.', { repetible: true });
    }
    Voz.vibrar([60]);
    _pintar();
    UI.toast(clase === 'parada' ? 'Parada marcada' : 'Aviso marcado', 'ok', 1600);
  }

  async function _terminar() {
    if (_puntos.length < 2) {
      const tirar = await UI.confirmar('Casi no se grabó nada', 'Hay menos de dos puntos válidos. ¿Descartás la grabación?', 'Descartar');
      if (tirar) _resetear();
      return;
    }

    const original = _puntos.length;
    const puntos = Geo.simplificar(_puntos, 6);
    const nombre = await UI.pedirTexto('¿Cómo se llama el recorrido?', '', 'ej: 710 Solymar → Portones');
    if (nombre === null) return;   // cancelaste: la grabación NO se pierde

    const rec = await DB.guardar({
      nombre: nombre || `Grabado ${UI.fecha(Date.now())}`,
      origen: 'grabado',
      puntos,
      paradas: _paradas,
      hitos: _hitos,
      color: '#35c78a',
      notas: `Grabado en ${UI.duracion(_transcurrido())}. ${original} puntos crudos, ${puntos.length} después de simplificar${_descartados ? `, ${_descartados} descartados por baja precisión` : ''}.`,
    });

    _resetear();
    UI.toast(`Guardado con ${(rec.hitos || []).length} giros detectados`, 'ok', 4000);
    Detalle.abrir(rec.id);
  }

  function _resetear() {
    _estado = 'listo';
    _puntos = []; _paradas = []; _hitos = [];
    _inicio = 0; _pausadoMs = 0; _descartados = 0;
    clearInterval(_tick); _tick = null;
    GPS.mantenerPantalla(false);
    Mapa.limpiar('mapa-grabar', 'recorrido', 'paradas', 'hitos');
    _pintar();
  }

  function _abrirPantalla() {
    Mapa.crear('mapa-grabar');
    Mapa.refrescar('mapa-grabar');
    if (!_desuscribir) _desuscribir = GPS.seguir(_alFix);
    GPS.unaVez()
      .then(p => { if (!_puntos.length) Mapa.get('mapa-grabar').map.setView([p.lat, p.lng], 16); })
      .catch(() => { /* sin señal todavía; el watch la va a traer */ });
    _pintar();
  }

  function init() {
    UI.$('#grab-toggle').onclick = _alternar;
    UI.$('#grab-fin').onclick    = _terminar;
    UI.$('#grab-parada').onclick = () => _marcar('parada');
    UI.$('#grab-aviso').onclick  = () => _marcar('aviso');

    document.addEventListener('pantalla', e => { if (e.detail.id === 'grabar') _abrirPantalla(); });
    // Al irse de la pantalla se suelta el GPS SOLO si no hay nada grabando.
    // Cortar una grabación en curso por mirar la lista sería perder el viaje.
    UI.alSalir('grabar', () => {
      if (_estado === 'listo' && _desuscribir) { _desuscribir(); _desuscribir = null; }
    });

    // El aviso del navegador al cerrar la pestaña es lo único que frena un
    // cierre accidental con una grabación de 40 minutos adentro.
    window.addEventListener('beforeunload', e => {
      if (_estado !== 'listo' && _puntos.length > 5) { e.preventDefault(); e.returnValue = ''; }
    });
  }

  return { init, grabando, puntos: () => _puntos };
})();
