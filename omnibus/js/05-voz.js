// ══════════════════════════════════════════════════════════════
// Voz — avisos hablados.
//
// Manejando no mirás la pantalla, así que la voz no es un adorno: es la
// interfaz principal del modo manejo. La pantalla es el respaldo.
// ══════════════════════════════════════════════════════════════

const Voz = (() => {
  const soportada = () => 'speechSynthesis' in window;
  let _activa = true;
  let _vozEs = null;
  let _ultimoTexto = '';
  let _ultimoTs = 0;

  /**
   * Chrome carga las voces de forma asíncrona: el primer getVoices()
   * devuelve [] y recién después dispara voiceschanged. Si no se espera,
   * el primer aviso sale con la voz en inglés leyendo español.
   */
  function _elegirVoz() {
    if (!soportada()) return;
    const voces = speechSynthesis.getVoices();
    if (!voces.length) return;
    _vozEs = voces.find(v => /^es[-_](UY|AR)/i.test(v.lang))
          || voces.find(v => /^es[-_](CL|PY|BO|PE|MX|US|419)/i.test(v.lang))
          || voces.find(v => /^es/i.test(v.lang))
          || null;
  }
  if (soportada()) {
    _elegirVoz();
    speechSynthesis.addEventListener('voiceschanged', _elegirVoz);
  }

  /**
   * @param {string} texto
   * @param {object} opts
   *   prioridad: true corta lo que se esté diciendo (desvíos, frenadas).
   *   repetible: por defecto se descarta el mismo texto dentro de 8 s —
   *   sin eso, un fix de GPS por segundo repite "girá a la derecha" ocho
   *   veces seguidas y tapa el aviso siguiente.
   */
  function decir(texto, { prioridad = false, repetible = false } = {}) {
    if (!_activa || !soportada() || !texto) return;
    const ahora = Date.now();
    if (!repetible && texto === _ultimoTexto && ahora - _ultimoTs < 8000) return;
    _ultimoTexto = texto; _ultimoTs = ahora;

    if (prioridad) speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(texto);
    if (_vozEs) u.voice = _vozEs;
    u.lang = _vozEs ? _vozEs.lang : 'es-UY';
    u.rate = 1.05;
    u.pitch = 1;
    u.volume = 1;
    try { speechSynthesis.speak(u); } catch (e) { console.warn('[voz]', e); }
  }

  function callar() { if (soportada()) speechSynthesis.cancel(); }

  function activar(v) {
    _activa = !!v;
    if (!_activa) callar();
    DB.setConfig('voz', _activa).catch(() => {});
    return _activa;
  }
  const estaActiva = () => _activa;

  /**
   * iOS y Chrome solo dejan hablar después de un gesto del usuario. Se
   * llama al tocar "Empezar": suelta un utterance vacío para desbloquear
   * el motor, para que el primer aviso real no se pierda en silencio.
   */
  function desbloquear() {
    if (!soportada()) return;
    try {
      const u = new SpeechSynthesisUtterance(' ');
      u.volume = 0;
      speechSynthesis.speak(u);
    } catch { /* si falla, el primer aviso igual va a intentar sonar */ }
  }

  /** Vibración corta como respaldo cuando la voz está apagada o muteada. */
  function vibrar(patron = [120, 60, 120]) {
    if (navigator.vibrate) { try { navigator.vibrate(patron); } catch { /* no crítico */ } }
  }

  return { soportada, decir, callar, activar, estaActiva, desbloquear, vibrar };
})();
