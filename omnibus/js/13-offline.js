// ══════════════════════════════════════════════════════════════
// Offline — bajar los tiles del mapa antes de salir.
//
// En la ruta a la costa hay tramos sin datos, y un mapa gris en el
// momento justo es peor que no tener mapa. Esto guarda en la Cache API
// los tiles de la franja por donde pasa el recorrido, para que el modo
// manejo funcione con el teléfono en avión.
// ══════════════════════════════════════════════════════════════

const Offline = (() => {
  const CACHE = 'tiles-v1';
  const ZOOMS = [13, 14, 15, 16];   // 16 alcanza para ver la esquina; 17 cuadruplica el peso
  const MUESTREO = 120;             // metros entre puntos al recorrer la traza
  const TOPE = 4000;                // tiles: arriba de esto se avisa antes de bajar
  const PARALELO = 6;

  const _lon2x = (lon, z) => Math.floor((lon + 180) / 360 * 2 ** z);
  const _lat2y = (lat, z) => {
    const r = lat * Math.PI / 180;
    return Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * 2 ** z);
  };

  /** Puntos cada ~MUESTREO metros sobre la traza, para no depender de cómo esté vertexada. */
  function _muestrear(puntos) {
    if (puntos.length < 2) return puntos.slice();
    const salida = [puntos[0]];
    let resto = 0;
    for (let i = 1; i < puntos.length; i++) {
      const a = puntos[i - 1], b = puntos[i];
      const d = Geo.distancia(a, b);
      if (d === 0) continue;
      let t = (MUESTREO - resto) / d;
      while (t <= 1) {
        salida.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
        t += MUESTREO / d;
      }
      resto = (resto + d) % MUESTREO;
    }
    salida.push(puntos[puntos.length - 1]);
    return salida;
  }

  /**
   * Tiles que tocan el corredor del recorrido, no el rectángulo que lo
   * contiene: una línea diagonal de 20 km tiene una bbox enorme y casi
   * todo adentro es campo por donde el ómnibus no pasa. Con el corredor
   * bajan unos pocos cientos de tiles en lugar de decenas de miles.
   */
  function _tilesDeRecorrido(puntos) {
    const muestras = _muestrear(puntos);
    const set = new Set();
    for (const z of ZOOMS) {
      for (const [lat, lng] of muestras) {
        const x = _lon2x(lng, z), y = _lat2y(lat, z);
        // ±1 tile alrededor: cubre el margen que se ve a los costados de
        // la calle cuando el mapa está centrado en el ómnibus.
        for (let dx = -1; dx <= 1; dx++) {
          for (let dy = -1; dy <= 1; dy++) set.add(`${z}/${x + dx}/${y + dy}`);
        }
      }
    }
    return Array.from(set);
  }

  function _url(tipo, clave) {
    const [z, x, y] = clave.split('/');
    return Mapa.CAPAS[tipo].url
      .replace('{s}', 'a').replace('{r}', '')
      .replace('{z}', z).replace('{x}', x).replace('{y}', y);
  }

  function _progreso(texto) {
    let ov = document.getElementById('ov-descarga');
    if (!ov) {
      ov = document.createElement('div');
      ov.id = 'ov-descarga';
      ov.className = 'overlay';
      ov.innerHTML = `<div class="dialogo">
        <h3>Bajando el mapa</h3>
        <p id="ov-txt"></p>
        <div class="hud-barra"><div id="ov-barra" class="hud-progreso"></div></div>
        <div class="dialogo-acciones"><button class="btn gris" id="ov-cancelar">Cancelar</button></div>
      </div>`;
      document.body.appendChild(ov);
    }
    return {
      set: (hechos, total) => {
        ov.querySelector('#ov-txt').textContent = texto(hechos, total);
        ov.querySelector('#ov-barra').style.width = `${(hechos / total) * 100}%`;
      },
      alCancelar: (fn) => { ov.querySelector('#ov-cancelar').onclick = fn; },
      cerrar: () => ov.remove(),
    };
  }

  async function descargarRecorrido(rec) {
    if (!rec || !(rec.puntos || []).length) return UI.toast('Ese recorrido no tiene trazado.', 'error');
    if (!('caches' in window)) return UI.toast('Este navegador no puede guardar mapas offline.', 'error');

    const claves = _tilesDeRecorrido(rec.puntos);
    const mb = (claves.length * 0.022).toFixed(0);   // ~22 KB por tile, medido sobre CARTO dark
    const ok = await UI.confirmar(
      'Bajar el mapa de este recorrido',
      `Son ${claves.length} pedacitos de mapa, cerca de ${mb} MB. Conviene hacerlo con wifi. Después el recorrido funciona sin señal.` +
      (claves.length > TOPE ? ' Ojo que este recorrido es largo y va a tardar bastante.' : ''),
      'Bajar');
    if (!ok) return;

    const cache = await caches.open(CACHE);
    const tipo = Mapa.get('mapa-detalle')?.tipoCapa || 'noche';
    const ui = _progreso((h, t) => `${h} de ${t} · ${Math.round((h / t) * 100)}%`);
    let cancelado = false, hechos = 0, fallados = 0;
    ui.alCancelar(() => { cancelado = true; });
    ui.set(0, claves.length);

    // De a PARALELO: en serie tarda una eternidad y de golpe los servidores
    // de tiles cortan por abuso. Seis simultáneas es el punto medio.
    const cola = claves.slice();
    async function trabajador() {
      while (cola.length && !cancelado) {
        const clave = cola.pop();
        const url = _url(tipo, clave);
        try {
          if (!(await cache.match(url))) {
            const r = await fetch(url, { mode: 'cors' });
            if (r.ok) await cache.put(url, r.clone()); else fallados++;
          }
        } catch { fallados++; }
        hechos++;
        if (hechos % 5 === 0 || hechos === claves.length) ui.set(hechos, claves.length);
      }
    }
    await Promise.all(Array.from({ length: PARALELO }, trabajador));
    ui.cerrar();

    if (cancelado) return UI.toast(`Cancelado. Quedaron ${hechos} pedacitos guardados igual.`, 'aviso', 4000);
    UI.toast(fallados
      ? `Mapa guardado, ${fallados} pedacitos no bajaron (se van a pedir por red).`
      : 'Mapa guardado. Este recorrido ya funciona sin señal.', fallados ? 'aviso' : 'ok', 5000);
  }

  async function tamano() {
    if (!('caches' in window)) return { tiles: 0, mb: 0 };
    const c = await caches.open(CACHE);
    const n = (await c.keys()).length;
    return { tiles: n, mb: +(n * 0.022).toFixed(1) };
  }

  async function borrar() {
    const { tiles, mb } = await tamano();
    if (!tiles) return UI.toast('No hay mapas guardados.');
    const ok = await UI.confirmar('¿Borrar los mapas guardados?', `Se liberan cerca de ${mb} MB. Los recorridos NO se borran, solo los pedacitos de mapa.`, 'Borrar');
    if (!ok) return;
    await caches.delete(CACHE);
    UI.toast('Mapas offline borrados', 'ok');
  }

  return { descargarRecorrido, tamano, borrar, CACHE, _tilesDeRecorrido, _muestrear };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Offline;
