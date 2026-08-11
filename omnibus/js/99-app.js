// ══════════════════════════════════════════════════════════════
// App — arranque, botón de atrás, ajustes y service worker.
// ══════════════════════════════════════════════════════════════

const App = (() => {
  const VERSION = document.querySelector('meta[name="app-version"]')?.content || '0';

  // De qué pantalla se vuelve a cuál. El modo manejo no está: de ahí se
  // sale por "Terminar", que además apaga el GPS.
  const VOLVER = {
    detalle: 'lista', editar: 'detalle', estudio: 'detalle',
    grabar: 'lista', importar: 'lista',
  };

  const TITULOS = {
    lista: 'Recorridos', grabar: 'Grabar recorrido', importar: 'Importar',
    detalle: 'Recorrido', editar: 'Editar', estudio: 'Estudiar', manejar: 'En viaje',
  };

  function _alCambiarPantalla(e) {
    const id = e.detail.id;
    UI.$('#btn-atras').classList.toggle('oculto', !VOLVER[id]);
    if (!['detalle', 'editar', 'estudio'].includes(id)) UI.$('#titulo').textContent = TITULOS[id] || 'Recorridos';
  }

  function _atras() {
    const destino = VOLVER[UI.pantallaActual()];
    if (!destino) return;
    if (destino === 'detalle' && Detalle.actual()) return Detalle.abrir(Detalle.actual().id);
    UI.irA(destino);
  }

  async function _ajustes() {
    const { tiles, mb } = await Offline.tamano();
    const op = await UI.elegir('Ajustes', [
      { texto: `${Voz.estaActiva() ? '🔊' : '🔇'} Avisos por voz: ${Voz.estaActiva() ? 'sí' : 'no'}`, valor: 'voz' },
      { texto: '🌗 Cambiar entre mapa de día y de noche', valor: 'capa' },
      { texto: '💾 Guardar copia de todos los recorridos', valor: 'backup' },
      { texto: '🎬 Probar un recorrido sin GPS (demo)', valor: 'demo' },
      { texto: `🗑️ Borrar mapas guardados (${tiles} · ${mb} MB)`, valor: 'tiles' },
    ]);
    if (op === 'backup') return Importar.exportarTodo();
    if (op === 'voz') {
      const on = Voz.activar(!Voz.estaActiva());
      UI.toast(on ? 'Avisos por voz activados' : 'Avisos por voz en silencio', 'ok');
    }
    if (op === 'capa') {
      const actual = (await DB.getConfig('capa', 'noche')) === 'noche' ? 'dia' : 'noche';
      ['mapa-detalle', 'mapa-manejar', 'mapa-grabar', 'mapa-editar', 'mapa-estudio', 'mapa-test']
        .forEach(id => Mapa.get(id) && Mapa.cambiarCapa(id, actual));
      await DB.setConfig('capa', actual);
      UI.toast(`Mapa de ${actual === 'noche' ? 'noche' : 'día'}`, 'ok');
    }
    if (op === 'demo') {
      const lista = Lista.todos();
      if (!lista.length) return UI.toast('Primero cargá un recorrido.', 'aviso');
      const rec = Detalle.actual() || lista[0];
      Manejar.simular(rec, 40);
    }
    if (op === 'tiles') await Offline.borrar();
  }

  function _registrarSw() {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('sw.js').catch(e => console.warn('[sw]', e));

    // Solo recargar si YA había un controller: sin esa condición, la
    // primera visita de cada usuario se recarga sola apenas instala el SW.
    let habia = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!habia) { habia = true; return; }
      // Nunca encima de una grabación o de un viaje en curso: recargar ahí
      // sería perder el recorrido que estás grabando.
      if (Grabar.grabando() || Manejar.activo()) return;
      window.location.reload();
    });
  }

  async function init() {
    try {
      await DB.abrir();

      Voz.activar(await DB.getConfig('voz', true));
      UI.$('#man-voz').setAttribute('aria-pressed', String(Voz.estaActiva()));
      UI.$('#man-voz').textContent = Voz.estaActiva() ? '🔊 Voz' : '🔇 Voz';

      Lista.init(); Detalle.init(); Manejar.init(); Grabar.init();
      Editar.init(); Importar.init(); Estudio.init();

      UI.$('#btn-atras').onclick = _atras;
      UI.$('#btn-ajustes').onclick = _ajustes;
      UI.$$('.tab').forEach(t => { t.onclick = () => UI.irA(t.dataset.ir); });
      document.addEventListener('pantalla', _alCambiarPantalla);

      // El botón físico de atrás de Android tiene que volver una pantalla,
      // no cerrar la app. Se empuja un estado al historial y se atiende el
      // popstate; si no hay a dónde volver, se deja salir.
      history.replaceState({ pt: 1 }, '');
      window.addEventListener('popstate', () => {
        if (VOLVER[UI.pantallaActual()]) { history.pushState({ pt: 1 }, ''); _atras(); }
      });

      await Lista.cargar();
      _registrarSw();

      if (GPS.contextoInseguro()) {
        // El caso típico: la app servida desde una PC de la red local por
        // http://192.168.x.x. Chrome exige https (o localhost) para dar
        // ubicación, y sin este aviso el error que ves es "no diste permiso",
        // que te manda a buscar el problema donde no está.
        UI.toast('Esta dirección no es https, así que el navegador no da ubicación. Podés dibujar, importar y estudiar; para guiar por GPS hace falta abrirla por https.', 'aviso', 11000);
      } else if (!GPS.disponible()) {
        UI.toast('Este navegador no tiene GPS: podés estudiar y editar, pero no guiar.', 'aviso', 6000);
      }
    } catch (e) {
      console.error('[init]', e);
      UI.toast(`No se pudo arrancar la app: ${e.message}`, 'error', 9000);
    } finally {
      // En el finally a propósito: si init() falla, el splash igual se
      // tiene que ir o el error queda tapado por la pantalla de carga.
      UI.$('#splash').classList.add('oculto');
    }
    // Después de bajar el splash, para que el diálogo no quede tapado.
    _ofrecerRecuperar();
  }

  /**
   * Si quedó una grabación a medio hacer, se ofrece recuperarla.
   *
   * Este es el caso que motivó todo el borrador: Android mata la pestaña con
   * la pantalla apagada y, sin esto, cuarenta minutos de manejo grabando se
   * evaporaban sin dejar rastro ni mensaje.
   */
  async function _ofrecerRecuperar() {
    try {
      const b = await Grabar.borradorPendiente();
      if (!b) return;
      const km = Geo.fmtDist(Geo.largo(b.puntos));
      const op = await UI.elegir(
        `Quedó una grabación sin terminar (${km}, del ${UI.fecha(b.ts)})`, [
          { texto: '↩️ Recuperarla', valor: 'si', clase: 'ok' },
          { texto: '🗑️ Descartarla', valor: 'no', clase: 'peligro' },
        ]);
      // Sin respuesta (tocó afuera del diálogo) NO se borra: en la duda, el
      // borrador se queda y se vuelve a ofrecer la próxima vez.
      if (op === 'si') Grabar.recuperar(b);
      else if (op === 'no') await Grabar._borrarBorrador();
    } catch (e) { console.warn('[recuperar]', e); }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  return { VERSION, init };
})();
