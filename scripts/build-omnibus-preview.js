#!/usr/bin/env node
// Versión "vista previa" de la app de recorridos, para publicar como página
// y poder abrirla con un link, sin descargar ni instalar nada.
//
// Parte del standalone y le agrega tres cosas, todas por la misma razón: una
// página publicada corre bajo una política de seguridad que BLOQUEA cualquier
// pedido a otro dominio. Los tiles del mapa vienen de otro dominio, así que
// no hay forma de cargarlos. En vez de dejar que se vea como una app rota:
//
//   1. Se saca la capa de tiles. El fondo oscuro liso queda prolijo y el
//      recorrido, las paradas y los giros se leen igual de bien.
//   2. Se avisa en pantalla por qué no están las calles y dónde sí están.
//   3. Se cargan dos recorridos de muestra, para que la app no abra vacía y
//      se pueda ver el modo manejo funcionando con el demo.
//
// Los recorridos de muestra son INVENTADOS. Están sobre Ciudad de la Costa
// para que el mapa caiga en la zona correcta, pero no son líneas reales de
// ninguna empresa y el nombre y las notas lo dicen.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const origen = path.join(ROOT, 'omnibus', 'recorridos-standalone.html');
const destino = process.argv[2];

if (!destino) throw new Error('uso: build-omnibus-preview.js <archivo-de-salida.html>');
if (!fs.existsSync(origen)) {
  throw new Error('falta omnibus/recorridos-standalone.html — corré antes scripts/build-omnibus-standalone.js');
}

const EXTRA = `
<script>
/* ── Ajustes de la vista previa ─────────────────────────────── */
(() => {
  // Sin tiles: la política de la página los bloquea. Se reemplaza la capa
  // por un grupo vacío para que Leaflet siga funcionando igual, en lugar de
  // llenar la consola de errores y el mapa de imágenes rotas.
  L.tileLayer = function () {
    const g = L.layerGroup();
    g.setUrl = () => g;
    return g;
  };

  /** Recorrido de muestra: tramos rectos con esquinas, sobre Ciudad de la Costa. */
  function trazar(desde, tramos) {
    const puntos = [[desde[0], desde[1]]];
    let lat = desde[0], lng = desde[1];
    for (const [rumbo, metros] of tramos) {
      const rad = rumbo * Math.PI / 180;
      for (let d = 25; d <= metros; d += 25) {
        puntos.push([
          lat + (d * Math.cos(rad)) / 110574,
          lng + (d * Math.sin(rad)) / (111320 * Math.cos(lat * Math.PI / 180)),
        ]);
      }
      const u = puntos[puntos.length - 1];
      lat = u[0]; lng = u[1];
    }
    return puntos;
  }

  function paradasSobre(puntos, indices, nombres) {
    return indices.map((i, n) => ({
      id: 'p' + n, lat: puntos[i][0], lng: puntos[i][1], nombre: nombres[n],
    }));
  }

  async function sembrarMuestras() {
    try {
      if ((await DB.todos()).length) return;

      const a = trazar([-34.8420, -55.9750], [[0, 1400], [90, 1800], [0, 900], [90, 1200]]);
      const b = trazar([-34.8180, -55.9200], [[180, 1100], [270, 1600], [180, 800]]);

      await DB.guardar({
        nombre: 'Muestra 1 — ida', linea: 'A', sentido: 'Sur → Este',
        origen: 'dibujado', color: '#35c78a', puntos: a,
        paradas: paradasSobre(a, [10, 30, 62, 95, 130], [
          'Terminal', 'Plaza', 'Shopping', 'Policlínica', 'Escuela']),
        hitos: [],
        notas: 'Recorrido inventado para esta vista previa. No es una línea real.',
      });
      await DB.guardar({
        nombre: 'Muestra 2 — vuelta', linea: 'B', sentido: 'Norte → Oeste',
        origen: 'dibujado', color: '#f0b429', puntos: b,
        paradas: paradasSobre(b, [8, 40, 80, 120], [
          'Cruce', 'Feria', 'Liceo', 'Cabecera']),
        hitos: [],
        notas: 'Recorrido inventado para esta vista previa. No es una línea real.',
      });
      await Lista.cargar();
    } catch (e) { console.warn('[preview] no se pudieron sembrar las muestras', e); }
  }

  function avisar() {
    const lista = document.getElementById('p-lista');
    if (!lista || document.getElementById('aviso-preview')) return;
    const el = document.createElement('div');
    el.id = 'aviso-preview';
    el.className = 'tarjeta';
    el.style.cssText = 'border-left-color:var(--ambar);cursor:default;margin-bottom:12px';
    el.innerHTML =
      '<h3>Vista previa</h3>' +
      '<p class="nota" style="margin:6px 0 10px">' +
      'El fondo con las calles no carga en esta página: el navegador bloquea los mapas ' +
      'de otros sitios. Todo lo demás es la app de verdad — el trazado, las paradas, los ' +
      'giros detectados solos y los avisos. Los dos recorridos de abajo son inventados, ' +
      'para poder probarla.</p>' +
      '<button class="btn ok" id="preview-demo" style="width:100%">▶ Ver el modo manejo andando</button>';
    lista.insertBefore(el, lista.firstChild);
    el.querySelector('#preview-demo').onclick = async () => {
      const todos = await DB.todos();
      if (todos.length) Manejar.simular(todos[0], 45);
    };
  }

  window.addEventListener('DOMContentLoaded', () => {
    // Después del init de la app, que corre en su propio DOMContentLoaded.
    setTimeout(async () => { await sembrarMuestras(); avisar(); }, 700);
  });
})();
</script>
`;

let html = fs.readFileSync(origen, 'utf8');
html = html.replace('</body>', EXTRA + '</body>');
html = html.replace(
  '<title>Recorridos — guía GPS de líneas de ómnibus</title>',
  '<title>Recorridos — guía GPS de líneas de ómnibus</title>');

fs.mkdirSync(path.dirname(destino), { recursive: true });
fs.writeFileSync(destino, html);
console.log(`build-omnibus-preview: ${destino} (${(Buffer.byteLength(html) / 1024).toFixed(0)} KB)`);
