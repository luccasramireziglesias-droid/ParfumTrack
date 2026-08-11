// ══════════════════════════════════════════════════════════════
// GPS — un solo watchPosition para toda la app.
//
// Android corta el `watchPosition` de una pestaña en segundo plano y, si
// dos módulos abren cada uno el suyo, el segundo suele recibir el fix
// cacheado del primero con varios segundos de atraso. Con un único watch
// y suscriptores, grabar y manejar ven exactamente la misma posición.
// ══════════════════════════════════════════════════════════════

const GPS = (() => {
  let _watch = null;
  let _wakeLock = null;
  const _subs = new Set();
  let _ultima = null;

  /**
   * `'geolocation' in navigator` da true incluso donde el navegador no lo va
   * a permitir nunca: abriendo el HTML con file://, o por http sin TLS. Ahí
   * la llamada falla con PERMISSION_DENIED y la app decía "no diste permiso",
   * que manda a revisar los ajustes del teléfono para un problema que no está
   * ahí. Hace falta contexto seguro (https o localhost), y punto.
   */
  const disponible = () => 'geolocation' in navigator && window.isSecureContext;
  const contextoInseguro = () => 'geolocation' in navigator && !window.isSecureContext;

  /**
   * El rumbo que reporta el GPS (`coords.heading`) viene null en muchos
   * teléfonos y es puro ruido cuando estás frenado en un semáforo. Cuando
   * falta, lo deducimos del desplazamiento — pero solo si te moviste más
   * que el error de medición, o el ómnibus detenido "gira" solo.
   */
  function _rumboDe(pos, previa) {
    if (pos.coords.heading != null && !isNaN(pos.coords.heading) && (pos.coords.speed ?? 0) > 1.5) {
      return pos.coords.heading;
    }
    if (!previa) return null;
    const a = [previa.lat, previa.lng], b = [pos.coords.latitude, pos.coords.longitude];
    const d = Geo.distancia(a, b);
    if (d < Math.max(8, (pos.coords.accuracy || 20) * 0.5)) return previa.rumbo;
    return Geo.rumbo(a, b);
  }

  function _emitir(pos) {
    const fix = {
      lat: pos.coords.latitude,
      lng: pos.coords.longitude,
      precision: pos.coords.accuracy ?? null,
      velocidad: pos.coords.speed != null && pos.coords.speed >= 0 ? pos.coords.speed : null,
      rumbo: _rumboDe(pos, _ultima),
      ts: pos.timestamp || Date.now(),
    };
    _ultima = fix;
    _subs.forEach(fn => { try { fn(fix); } catch (e) { console.error('[gps]', e); } });
  }

  function _error(err) {
    const msg = {
      1: 'No diste permiso de ubicación. Habilitalo en los ajustes del navegador.',
      2: 'No se puede obtener la ubicación. Revisá que el GPS esté prendido.',
      3: 'El GPS está tardando demasiado en responder.',
    }[err.code] || 'Error de ubicación.';
    _subs.forEach(fn => { try { fn(null, msg); } catch (e) { console.error('[gps]', e); } });
  }

  /** Suscribe un callback (fix, error). Devuelve la función para desuscribirse. */
  function seguir(fn) {
    _subs.add(fn);
    if (_ultima) fn(_ultima);
    if (_watch == null && disponible()) {
      _watch = navigator.geolocation.watchPosition(_emitir, _error, {
        enableHighAccuracy: true,
        maximumAge: 1000,
        timeout: 20000,
      });
    }
    return () => {
      _subs.delete(fn);
      if (!_subs.size && _watch != null) {
        navigator.geolocation.clearWatch(_watch);
        _watch = null;
      }
    };
  }

  const ultima = () => _ultima;

  /** Un fix único, para centrar el mapa sin dejar el GPS prendido. */
  function unaVez() {
    return new Promise((res, rej) => {
      if (!disponible()) return rej(new Error('Este navegador no tiene GPS.'));
      navigator.geolocation.getCurrentPosition(
        p => res({ lat: p.coords.latitude, lng: p.coords.longitude, precision: p.coords.accuracy }),
        e => rej(new Error(e.message)),
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 });
    });
  }

  // ── Pantalla encendida ──────────────────────────────────────
  // Sin esto la pantalla se apaga a los 30 segundos y el modo manejo deja
  // de servir justo cuando lo necesitás. El navegador suelta el lock al
  // pasar a segundo plano, así que hay que volver a pedirlo al volver.
  async function mantenerPantalla(activar) {
    if (!('wakeLock' in navigator)) return false;
    try {
      if (activar && !_wakeLock) {
        _wakeLock = await navigator.wakeLock.request('screen');
        _wakeLock.addEventListener('release', () => { _wakeLock = null; });
      } else if (!activar && _wakeLock) {
        await _wakeLock.release();
        _wakeLock = null;
      }
      return true;
    } catch { return false; }
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && document.body.dataset.pantalla === 'manejar') {
      mantenerPantalla(true);
    }
  });

  return { disponible, contextoInseguro, seguir, ultima, unaVez, mantenerPantalla };
})();
