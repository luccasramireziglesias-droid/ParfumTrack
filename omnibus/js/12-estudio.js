// ══════════════════════════════════════════════════════════════
// Estudio — repasar el recorrido antes de subirse al ómnibus.
//
// El problema original es memorizar, no navegar: el GPS te salva arriba
// del coche, pero el objetivo es llegar a no necesitarlo. El test hace
// las preguntas que se hace uno solo en la calle: "después de esta, ¿cuál
// viene?" y "acá, ¿doblo o sigo?".
// ══════════════════════════════════════════════════════════════

const Estudio = (() => {
  let _rec = null, _pasos = [];
  let _preguntas = [], _i = 0, _aciertos = 0, _respondida = false;

  function abrir(rec) {
    _rec = rec;
    _pasos = Detalle.pasos(rec);
    UI.irA('estudio');
    UI.$('#titulo').textContent = `Estudiar: ${rec.nombre}`;
    _modo('repaso');
  }

  function _modo(m) {
    UI.$$('#est-modo .seg').forEach(b => b.classList.toggle('activo', b.dataset.modo === m));
    UI.$('#est-repaso').hidden = m !== 'repaso';
    UI.$('#est-test').hidden   = m !== 'test';
    if (m === 'repaso') _pintarRepaso(); else _arrancarTest();
  }

  function _pintarRepaso() {
    const m = Mapa.crear('mapa-estudio');
    Mapa.refrescar('mapa-estudio');
    Mapa.dibujarRecorrido('mapa-estudio', _rec.puntos, { color: _rec.color || '#35c78a' });
    Mapa.dibujarParadas('mapa-estudio', _rec.paradas);
    Mapa.dibujarHitos('mapa-estudio', _rec.hitos);
    Mapa.encuadrar('mapa-estudio', _rec.puntos);
    Detalle._renderPasos(UI.$('#est-pasos'), _pasos, p => m.map.setView([p.lat, p.lng], 17));
  }

  // ── Test ────────────────────────────────────────────────────
  const _mezclar = (a) => a.map(v => [Math.random(), v]).sort((x, y) => x[0] - y[0]).map(x => x[1]);

  /** Distractores: otros pasos del MISMO recorrido, que es lo que confunde de verdad. */
  function _opciones(correcta, universo, n = 4) {
    const otras = _mezclar(universo.filter(x => x !== correcta)).slice(0, n - 1);
    return _mezclar([correcta, ...otras]);
  }

  function _generar() {
    const preguntas = [];
    const titulos = _pasos.map(p => p.titulo);
    const paradas = _pasos.filter(p => p.clase === 'parada');
    const giros   = _pasos.filter(p => p.clase === 'giro');

    // "¿Qué viene después de X?" — con menos de cuatro pasos no hay de
    // dónde sacar distractores y la pregunta se contesta sola.
    for (let i = 0; titulos.length >= 4 && i < _pasos.length - 1; i++) {
      preguntas.push({
        texto: `Venís del recorrido y pasás por “${_pasos[i].titulo}”. ¿Qué viene justo después?`,
        correcta: _pasos[i + 1].titulo,
        opciones: _opciones(_pasos[i + 1].titulo, titulos),
        foco: _pasos[i + 1],
        pista: `Está ${Geo.fmtDist(_pasos[i + 1].desdeElPrevio)} más adelante.`,
      });
    }

    // "En esta esquina, ¿qué hacés?"
    const maniobras = ['girá a la izquierda', 'girá a la derecha', 'seguí derecho', 'giro en U'];
    for (const g of giros) {
      preguntas.push({
        texto: `Llegás a este punto del recorrido (km ${(g.metros / 1000).toFixed(2)}). ¿Qué hacés?`,
        correcta: g.titulo,
        opciones: _opciones(g.titulo, [...maniobras, ...giros.map(x => x.titulo)]),
        foco: g,
        pista: 'Fijate en el mapa de arriba: la flecha marca el punto exacto.',
      });
    }

    // "¿Cuál de estas paradas viene primero?"
    for (let i = 0; i < paradas.length - 3; i++) {
      const grupo = paradas.slice(i, i + 4);
      preguntas.push({
        texto: 'De estas cuatro paradas, ¿cuál viene primero en el recorrido?',
        correcta: grupo[0].titulo,
        opciones: _mezclar(grupo.map(p => p.titulo)),
        foco: grupo[0],
        pista: `Está en el km ${(grupo[0].metros / 1000).toFixed(2)}.`,
      });
    }

    return _mezclar(preguntas).slice(0, 15);
  }

  function _arrancarTest() {
    _preguntas = _generar();
    _i = 0; _aciertos = 0;
    if (_preguntas.length < 3) {
      UI.$('#test-pregunta').textContent =
        'Este recorrido tiene muy pocas paradas y giros como para armar un test. Agregale paradas desde el editor y volvé.';
      UI.$('#test-opciones').innerHTML = '';
      UI.$('#test-siguiente').hidden = true;
      UI.$('#test-feedback').textContent = '';
      UI.$('#test-puntaje').textContent = '0 / 0';
      return;
    }
    _pintarPregunta();
  }

  function _pintarPregunta() {
    const q = _preguntas[_i];
    _respondida = false;
    UI.$('#test-puntaje').textContent = `${_aciertos} / ${_i} · pregunta ${_i + 1} de ${_preguntas.length}`;
    UI.$('#test-pregunta').textContent = q.texto;
    UI.$('#test-feedback').textContent = '';
    UI.$('#test-siguiente').hidden = true;

    const m = Mapa.crear('mapa-test');
    Mapa.refrescar('mapa-test');
    Mapa.dibujarRecorrido('mapa-test', _rec.puntos, { color: '#4a4a68', peso: 5 });
    // Solo se marca el punto de la pregunta: mostrar todas las paradas con
    // sus nombres sería regalar la respuesta.
    Mapa.limpiar('mapa-test', 'paradas', 'hitos');
    const mk = L.circleMarker([q.foco.lat, q.foco.lng], {
      radius: 11, color: '#f0b429', weight: 3, fillColor: '#f0b429', fillOpacity: .4,
    });
    Mapa.limpiar('mapa-test', 'foco');
    m.capas.foco = L.layerGroup([mk]).addTo(m.map);
    m.map.setView([q.foco.lat, q.foco.lng], 16);

    const cont = UI.$('#test-opciones');
    cont.innerHTML = '';
    q.opciones.forEach(op => {
      const b = document.createElement('button');
      b.className = 'btn';
      b.textContent = op;
      b.onclick = () => _responder(b, op, q);
      cont.appendChild(b);
    });
  }

  function _responder(boton, elegida, q) {
    if (_respondida) return;      // sin esto, dos toques rápidos suman dos puntos
    _respondida = true;
    const bien = elegida === q.correcta;
    if (bien) _aciertos++;

    UI.$$('#test-opciones .btn').forEach(b => {
      if (b.textContent === q.correcta) b.classList.add('correcta');
      else if (b === boton) b.classList.add('incorrecta');
      b.disabled = true;
    });
    UI.$('#test-feedback').textContent = bien
      ? `Bien. ${q.pista}`
      : `Era “${q.correcta}”. ${q.pista}`;
    UI.$('#test-puntaje').textContent = `${_aciertos} / ${_i + 1} · pregunta ${_i + 1} de ${_preguntas.length}`;
    UI.$('#test-siguiente').hidden = false;
    UI.$('#test-siguiente').textContent = _i + 1 >= _preguntas.length ? 'Ver resultado' : 'Siguiente';
  }

  function _siguiente() {
    _i++;
    if (_i >= _preguntas.length) return _resultado();
    _pintarPregunta();
  }

  function _resultado() {
    const pct = Math.round((_aciertos / _preguntas.length) * 100);
    const juicio = pct >= 90 ? 'Te lo sabés. Andá tranquilo.'
                 : pct >= 70 ? 'Vas bien, pero repasá los que fallaste antes de salir.'
                 : 'Todavía no. Dale una vuelta más al repaso y volvé al test.';
    UI.$('#test-pregunta').textContent = `${_aciertos} de ${_preguntas.length} (${pct}%). ${juicio}`;
    UI.$('#test-opciones').innerHTML = '';
    UI.$('#test-feedback').textContent = '';
    UI.$('#test-puntaje').textContent = `${_aciertos} / ${_preguntas.length}`;
    const b = UI.$('#test-siguiente');
    b.hidden = false; b.textContent = 'Hacerlo de nuevo';
    b.onclick = () => { b.onclick = _siguiente; _arrancarTest(); };
  }

  function init() {
    UI.$$('#est-modo .seg').forEach(b => { b.onclick = () => _modo(b.dataset.modo); });
    UI.$('#test-siguiente').onclick = _siguiente;
    document.addEventListener('pantalla', e => {
      if (e.detail.id === 'estudio') { Mapa.refrescar('mapa-estudio'); Mapa.refrescar('mapa-test'); }
    });
  }

  return { init, abrir, _generar };
})();
