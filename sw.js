// Parfum Track — Service Worker v5
// v5: app.js cacheado como asset estático (JS separado del HTML)
const CACHE_NAME = 'parfumtrack-v5';

const STATIC_ASSETS = [
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
  '/app.js',
];

// Librerías de CDN — se cachean en el primer uso y se sirven desde caché offline
const CDN_LIBS = [
  'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.0/chart.umd.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
];

// Instalar: cachear assets estáticos (NO el HTML — siempre queremos la última versión)
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(STATIC_ASSETS).catch(() => Promise.resolve()))
      .then(() => self.skipWaiting())
  );
});

// Activar: limpiar cachés viejos e inmediatamente tomar control
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // ── Librerías CDN — Cache First con fallback a red ──────────
  // Si está en caché: sirve inmediatamente (offline). Si no: fetch + guardar en caché.
  if (CDN_LIBS.includes(event.request.url)) {
    event.respondWith(
      caches.match(event.request).then(cached => {
        if (cached) return cached;
        return fetch(event.request).then(response => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          }
          return response;
        });
      })
    );
    return;
  }

  // ── Otros CDNs externos — dejar pasar sin interceptar ───────
  if (url.hostname !== self.location.hostname) return;

  // ── HTML (navegación) — Network First ───────────────────────
  // Siempre intenta la red para recibir actualizaciones. Caché como fallback offline.
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          return response;
        })
        .catch(() => caches.match('/index.html'))
    );
    return;
  }

  // ── app.js y assets estáticos propios — Cache First con revalidación ─
  // app.js: Cache First → el navegador sirve desde caché, se actualiza en background.
  // En el próximo deploy, el SW v-bump limpia el caché viejo y fuerza la descarga.
  event.respondWith(
    caches.match(event.request).then(cached => {
      const fetchPromise = fetch(event.request).then(response => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      });
      return cached || fetchPromise;
    })
  );
});
