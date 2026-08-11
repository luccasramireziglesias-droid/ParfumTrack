// ══════════════════════════════════════════════════════════════
// Manejar — guía GPS sobre un recorrido ya cargado.
//
// Esta pantalla se mira de reojo, en movimiento y con el sol de frente.
// El diseño sale de ahí: un solo dato grande arriba (qué hago ahora), la
// voz como canal principal y el mapa como confirmación.
//
// El mapa NO rota: queda siempre con el norte arriba y lo que gira es la
// flecha de posición. Rotar el contenedor en Leaflet desalinea los tiles
// y las etiquetas quedan cabeza abajo — peor que no rotarlo.
// ══════════════════════════════════════════════════════════════

const Manejar = (() => {
  // Umbrales, todos en metros salvo donde se aclare.
  const DESVIO_FUERA   = 45;   // más lejos que esto de la traza = sospecha
  const DESVIO_VUELTA  = 22;   // más cerca que esto = volviste
  const FIXES_PARA_ALERTAR = 3; // fixes seguidos afuera antes de avisar
  const AVISOS_GIRO   = [400, 150, 40];
  const AVISOS_PARADA = [250, 60];
  const LLEGADA = 35;

  let _rec = null, _puntos = [], _acc = null, _total = 0;
  let _pasos = [], _idx = 0;
  let _desuscribir = null, _simulacion = null;
  let _seguirAuto = true;
  let _desviado = false, _fixesFuera = 0;
  let _avisados = new Map();      // id del paso → Set de distancias ya avisadas
  let _historialAvance = [];
  let _avisoContramano = 0;
  let _llego = false;
  let _ultimoAvance = 0;

  const activo = () => !!_rec;

  // ── Arranque y salida ───────────────────────────────────────
  async function arrancar(rec) {
    if (!rec || !(rec.puntos || []).length) return UI.toast('Ese recorrido no tiene trazado.', 'error');
    if (!GPS.disponible()) return UI.toast('Este navegador no tiene GPS.', 'error');

    _rec = rec;
    _puntos = rec.puntos;
    _acc = Geo.acumuladas(_puntos);
    _total = _acc[_acc.length - 1];
    _pasos = Detalle.pasos(rec);
    _idx = 0; _desviado = false; _fixesFuera = 0; _llego = false;
    _avisados = new Map(); _historialAvance = []; _avisoContramano = 0; _ultimoAvance = 0;
    _seguirAuto = true;

    UI.irA('manejar');
    // Sin un gesto previo el navegador no deja hablar. Este es el gesto:
    // el toque en "Manejar" que nos trajo hasta acá.
    Voz.desbloquear();
    GPS.mantenerPantalla(true);

    const m = Mapa.crear('mapa-manejar', { zoomControl: false });
    Mapa.refrescar('mapa-manejar');
    Mapa.limpiar('mapa-manejar');
    Mapa.dibujarRecorrido('mapa-manejar', _puntos, { color: rec.color || '#35c78a', peso: 7 });
    Mapa.dibujarParadas('mapa-manejar', rec.paradas);
    Mapa.dibujarHitos('mapa-manejar', rec.hitos);
    Mapa.encuadrar('mapa-manejar', _puntos);
    m.map.off('dragstart').on('dragstart', () => { _seguirAuto = false; });

    _pintarBanner('↑', '—', 'Esperando el GPS…', '');
    UI.$('#man-alerta').hidden = true;

    _desuscribir = GPS.seguir(_alFix);
    Voz.decir(`Recorrido ${rec.nombre}. Buscando señal.`);
  }

  /**
   * Apaga la guía SIN navegar. La separación importa: `salir()` navega, y
   * navegar dispara el `alSalir` de esta pantalla, que vuelve a llamar a
   * apagar. Si el apagado navegara, serían llamadas en círculo.
   */
  function _apagar() {
    if (_desuscribir) { _desuscribir(); _desuscribir = null; }
    if (_simulacion) { clearInterval(_simulacion); _simulacion = null; }
    Voz.callar();
    GPS.mantenerPantalla(false);
    const rec = _rec;
    _rec = null;
    return rec;
  }

  async function salir(preguntar = true) {
    if (preguntar) {
      const ok = await UI.confirmar('¿Terminar el viaje?', 'Se apaga la guía y volvés al recorrido.', 'Terminar');
      if (!ok) return;
    }
    const rec = _apagar();
    if (rec) Detalle.abrir(rec.id); else UI.irA('lista');
  }

  // ── Cada fix del GPS ────────────────────────────────────────
  function _alFix(fix, error) {
    if (!_rec) return;
    if (error) { _pintarBanner('⚠', '—', error, 'peligro'); return; }
    if (!fix) return;

    const pos = [fix.lat, fix.lng];

    // Estando desviado se busca en TODO el recorrido, no en la ventana: si
    // te fuiste 15 cuadras, el tramo por el que vas a volver puede estar
    // muy lejos del último índice conocido y con ventana nunca lo encuentra.
    const proy = Geo.proyectar(pos, _puntos, _desviado ? -1 : _idx);
    if (!proy || !proy.punto) return;

    _evaluarDesvio(proy, pos);
    if (!_desviado) _idx = proy.idx;

    const avance = Geo.avance(proy, _puntos, _acc);
    _detectarContramano(avance, fix);
    _ultimoAvance = avance;

    _actualizarMapa(pos, fix, proy);
    _actualizarHud(avance, fix);

    if (_desviado) return;   // desviado, los avisos de giro no aplican
    if (_revisarLlegada(avance)) return;
    _actualizarProximoPaso(avance);
  }

  /**
   * Un solo fix malo no es un desvío: la precisión del GPS entre edificios
   * salta 60 m sin que el ómnibus se haya movido. Hacen falta varios fixes
   * seguidos afuera para alertar, y hay histéresis (45 m para salir, 22 m
   * para volver) para que la alerta no titile en el borde.
   */
  function _evaluarDesvio(proy, pos) {
    if (!_desviado) {
      if (proy.dist > DESVIO_FUERA) {
        _fixesFuera++;
        if (_fixesFuera >= FIXES_PARA_ALERTAR) {
          _desviado = true;
          Voz.decir('Atención, te saliste del recorrido.', { prioridad: true });
          Voz.vibrar([250, 100, 250]);
        }
      } else {
        _fixesFuera = 0;
      }
    } else if (proy.dist < DESVIO_VUELTA) {
      _desviado = false; _fixesFuera = 0;
      // Se limpian los avisos ya dados: volviste en otro punto y los giros
      // de este tramo hay que volver a cantarlos.
      _avisados = new Map();
      Voz.decir('Volviste al recorrido.', { prioridad: true });
    }

    const alerta = UI.$('#man-alerta');
    alerta.hidden = !_desviado;
    if (_desviado) {
      UI.$('#man-alerta-txt').textContent =
        `El recorrido está a ${Geo.fmtDist(proy.dist)}. Volvé cuando puedas.`;
      _pintarBanner('⚠', Geo.fmtDist(proy.dist), 'Volvé al recorrido', 'peligro');
    }
  }

  /**
   * Si el avance sobre la traza baja de forma sostenida mientras te movés,
   * o agarraste la calle al revés o estás haciendo el sentido opuesto. Se
   * mide sobre 6 fixes para no confundirlo con el ruido del GPS parado.
   */
  function _detectarContramano(avance, fix) {
    _historialAvance.push(avance);
    if (_historialAvance.length > 6) _historialAvance.shift();
    if (_historialAvance.length < 6) return;
    if ((fix.velocidad ?? 0) < 2.5) return;              // frenado: no concluye nada
    const caida = _historialAvance[0] - _historialAvance[_historialAvance.length - 1];
    if (caida > 60 && Date.now() - _avisoContramano > 45000) {
      _avisoContramano = Date.now();
      Voz.decir('Ojo, estás yendo en sentido contrario al recorrido.', { prioridad: true });
      Voz.vibrar([120, 80, 120, 80, 120]);
      UI.toast('Vas en sentido contrario al recorrido', 'aviso', 5000);
    }
  }

  function _revisarLlegada(avance) {
    if (_llego || _total - avance > LLEGADA) return false;
    _llego = true;
    _pintarBanner('🏁', '', 'Llegaste al final del recorrido', '');
    Voz.decir('Llegaste al final del recorrido.', { prioridad: true });
    Voz.vibrar([200, 100, 200]);
    return true;
  }

  // ── Próximo paso y avisos ───────────────────────────────────
  function _proximo(clase, avance) {
    // El -8 perdona el error del GPS: sin eso, un paso queda "pasado"
    // cuando todavía lo tenés adelante y el aviso nunca sale.
    return _pasos.find(p => p.metros > avance - 8 && (!clase || p.clase === clase));
  }

  function _actualizarProximoPaso(avance) {
    const paso = _proximo(null, avance);
    if (!paso) return;
    const falta = Math.max(0, paso.metros - avance);
    const esGiro = paso.clase === 'giro';
    const ico = esGiro ? (Mapa.FLECHA[paso.tipo] || '↑') : '🛑';
    const tono = falta < 60 ? 'aviso' : '';

    _pintarBanner(ico, Geo.fmtDist(falta), paso.titulo, tono);
    _avisar(paso, falta, esGiro);
  }

  /**
   * Avisa una sola vez por umbral y por paso. El Set por id es lo que
   * evita que un fix por segundo repita "en 150 metros" quince veces.
   */
  function _avisar(paso, falta, esGiro) {
    const umbrales = esGiro ? AVISOS_GIRO : AVISOS_PARADA;
    if (!_avisados.has(paso.ref)) _avisados.set(paso.ref, new Set());
    const dados = _avisados.get(paso.ref);

    for (const u of umbrales) {
      if (falta > u || dados.has(u)) continue;
      dados.add(u);
      // Los umbrales más grandes que este ya pasaron sin cantarse (venías
      // rápido o el GPS tardó): marcarlos evita que suenen tarde y fuera
      // de orden, "en 400 metros" después de "en 150".
      umbrales.filter(x => x > u).forEach(x => dados.add(x));

      const cerca = u === umbrales[umbrales.length - 1];
      if (esGiro) {
        Voz.decir(cerca ? `Ahora, ${paso.titulo}` : `En ${Geo.fmtDist(u)}, ${paso.titulo}`);
      } else {
        Voz.decir(cerca ? `Parada: ${paso.titulo}` : `En ${Geo.fmtDist(u)}, parada ${paso.titulo}`);
      }
      if (cerca) Voz.vibrar([100, 50, 100]);
      break;
    }
  }

  // ── Pintado ─────────────────────────────────────────────────
  function _pintarBanner(ico, dist, accion, tono) {
    UI.$('#man-ico').textContent = ico;
    UI.$('#man-dist').textContent = dist;
    UI.$('#man-accion').textContent = accion;
    UI.$('#man-banner').className = `banner ${tono || ''}`;
  }

  function _actualizarMapa(pos, fix, proy) {
    Mapa.ponerPosicion('mapa-manejar', pos, fix.rumbo, fix.precision);
    Mapa.dibujarHecho('mapa-manejar', _puntos.slice(0, proy.idx + 1).concat([proy.punto]));
    if (_seguirAuto) {
      const m = Mapa.get('mapa-manejar');
      m.map.setView(pos, Math.max(m.map.getZoom(), 16), { animate: true, duration: .4 });
    }
  }

  function _actualizarHud(avance, fix) {
    const pct = _total ? Math.min(100, Math.max(0, (avance / _total) * 100)) : 0;
    UI.$('#man-progreso').style.width = `${pct}%`;
    UI.$('#man-vel').textContent = fix.velocidad == null ? '—' : Math.round(fix.velocidad * 3.6);
    UI.$('#man-falta').textContent = Geo.fmtDist(Math.max(0, _total - avance));
    const parada = _proximo('parada', avance);
    UI.$('#man-parada').textContent = parada
      ? `${parada.titulo} · ${Geo.fmtDist(parada.metros - avance)}`
      : 'sin paradas';
  }

  // ── Modo demo ───────────────────────────────────────────────
  /**
   * Recorre la traza sin GPS, para probar los avisos en casa. No es un
   * juguete: es la única forma de verificar que un recorrido recién
   * cargado canta los giros donde tiene que cantarlos, antes de depender
   * de él arriba del ómnibus.
   */
  function simular(rec, kmh = 40) {
    arrancar(rec).then(() => {
      if (_desuscribir) { _desuscribir(); _desuscribir = null; }
      let metros = 0;
      const paso = (kmh / 3.6);   // metros por segundo, un tick por segundo
      UI.toast('Modo demo: recorrido simulado sin GPS', 'aviso', 4000);
      _simulacion = setInterval(() => {
        if (!_rec) return clearInterval(_simulacion);
        metros += paso;
        if (metros > _total + 20) { clearInterval(_simulacion); _simulacion = null; return; }
        let i = 0; while (i < _acc.length - 2 && _acc[i + 1] < metros) i++;
        const seg = _acc[i + 1] - _acc[i] || 1;
        const t = Math.min(1, (metros - _acc[i]) / seg);
        const a = _puntos[i], b = _puntos[i + 1] || a;
        _alFix({
          lat: a[0] + (b[0] - a[0]) * t,
          lng: a[1] + (b[1] - a[1]) * t,
          precision: 8, velocidad: paso, rumbo: Geo.rumbo(a, b), ts: Date.now(),
        });
      }, 1000);
    });
  }

  function init() {
    UI.$('#man-salir').onclick   = () => salir(true);
    UI.$('#man-centrar').onclick = () => {
      _seguirAuto = true;
      const u = GPS.ultima();
      if (u) Mapa.get('mapa-manejar').map.setView([u.lat, u.lng], 17);
    };
    UI.$('#man-voz').onclick = (e) => {
      const on = Voz.activar(!Voz.estaActiva());
      e.currentTarget.setAttribute('aria-pressed', String(on));
      e.currentTarget.textContent = on ? '🔊 Voz' : '🔇 Voz';
      UI.toast(on ? 'Avisos por voz activados' : 'Avisos por voz en silencio');
    };
    // Salir por el botón de atrás o por una tab también tiene que soltar el
    // GPS y el wake lock: si no, el teléfono sigue con la pantalla prendida
    // y el GPS a full quemando batería en segundo plano.
    UI.alSalir('manejar', _apagar);
  }

  return { init, arrancar, salir, simular, activo, _alFix };
})();
