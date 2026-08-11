// ══════════════════════════════════════════════════════════════
// Service Worker — la app entera tiene que abrir sin señal.
//
// Dos cachés distintas y a propósito:
//   APP    — el código. Se reemplaza entero en cada versión.
//   TILES  — los pedacitos de mapa. Los baja el usuario a mano desde
//            "Mapa offline" y NO se borran al actualizar la app: son
//            megabytes que ya pagó con sus datos.
// ══════════════════════════════════════════════════════════════

// scripts/build-omnibus.js reescribe esta línea desde package.json.
// No editarla a mano: la versión vive en un solo lugar.
const APP_VERSION = '1.8.0'; // OM:VERSION
const CACHE_APP   = `recorridos-app-v${APP_VERSION}`;
const CACHE_TILES = 'tiles-v1';

const ESTATICOS = [
  './',
  './index.html',
  './manifest.json',
  './icono.svg',
  './icon-192.png',
  './icon-512.png',
  './css/app.css',
  './vendor/leaflet.js',
  './vendor/leaflet.css',
  './vendor/images/marker-icon.png',
  './vendor/images/marker-icon-2x.png',
  './vendor/images/marker-shadow.png',
  './vendor/images/layers.png',
  './vendor/images/layers-2x.png',
  './js/00-geo.js',
  './js/01-db.js',
  './js/02-ui.js',
  './js/03-mapa.js',
  './js/04-gps.js',
  './js/05-voz.js',
  './js/06-lista.js',
  './js/07-detalle.js',
  './js/08-manejar.js',
  './js/09-grabar.js',
  './js/10-editar.js',
  './js/11-importar.js',
  './js/12-estudio.js',
  './js/13-offline.js',
  './js/14-app.js',
];

// PNG de 1×1 con alfa 0, para los tiles que no se pueden traer ni de la red
// ni de la caché.
//
// 🔴 El píxel TIENE que ser invisible. Acá había pegado un base64 sacado de
// memoria que en realidad era RGBA(0,255,0,127): un verde a media
// transparencia. Como Leaflet estira el tile a 256×256, sin señal el mapa
// entero se pintaba de verde fosforescente y el recorrido desaparecía
// abajo. Se veía igual de "cargado" que uno bueno, así que nada fallaba —
// simplemente el mapa era verde. `tests/omnibus-sw.test.js` decodifica este
// blob y falla si el alfa no es 0.
const PIXEL_VACIO = () => Uint8Array.from(
  atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII='),
  c => c.charCodeAt(0));

const esTile = (url) =>
  /^https:\/\/[a-d]\.basemaps\.cartocdn\.com\//.test(url) ||
  /^https:\/\/tile\.openstreetmap\.org\//.test(url);

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_APP)
      // addAll es todo-o-nada: si un solo archivo da 404, no se cachea
      // NINGUNO y la app deja de abrir offline sin ninguna señal de por qué.
      // De a uno, un faltante se salta y el resto queda guardado.
      .then(c => Promise.all(ESTATICOS.map(u => c.add(u).catch(err => console.warn('[sw] no se pudo cachear', u, err)))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks
        .filter(k => k.startsWith('recorridos-app-') && k !== CACHE_APP)
        .map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = req.url;

  // Tiles: cache-first. Un tile de mapa no cambia nunca en la práctica, y
  // en la ruta es exactamente lo que no se puede ir a buscar.
  if (esTile(url)) {
    e.respondWith(
      caches.open(CACHE_TILES).then(async (c) => {
        const hit = await c.match(req);
        if (hit) return hit;
        try {
          const r = await fetch(req);
          if (r.ok) c.put(req, r.clone());
          return r;
        } catch {
          // Sin señal y sin tile guardado: un PNG de 1×1 totalmente
          // transparente en lugar del ícono de imagen rota. Se estira a
          // 256×256 y deja ver el fondo oscuro del mapa, con el recorrido
          // dibujado encima — que es lo único que de verdad importa ahí.
          return new Response(PIXEL_VACIO(), { headers: { 'Content-Type': 'image/png' } });
        }
      })
    );
    return;
  }

  // Nominatim y Overpass nunca se cachean: son consultas puntuales y una
  // respuesta vieja confundiría más de lo que ayuda.
  if (/nominatim\.openstreetmap\.org|overpass/.test(url)) return;
  if (!url.startsWith(self.location.origin)) return;

  // Navegación: red primero (para que una versión nueva llegue), caché de
  // respaldo. Sin el respaldo, abrir la app sin señal da la pantalla de
  // dinosaurio y todo lo demás es inútil.
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then(r => { const c = r.clone(); caches.open(CACHE_APP).then(k => k.put(req, c)); return r; })
        .catch(() => caches.match(req).then(r => r || caches.match('./index.html')))
    );
    return;
  }

  // Resto (js, css, imágenes propias): caché primero, y se refresca por
  // atrás para la próxima vez.
  e.respondWith(
    caches.match(req).then(hit => {
      const red = fetch(req).then(r => {
        if (r.ok) caches.open(CACHE_APP).then(c => c.put(req, r.clone()));
        return r;
      }).catch(() => hit);
      return hit || red;
    })
  );
});
