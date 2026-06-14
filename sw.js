// Parfum Track — Service Worker v5 (OneSignal + PWA cache)
try {
  importScripts("https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.sw.js");
} catch (e) {
  console.warn("[SW] OneSignal no disponible:", e.message);
}

const CACHE_NAME = "parfumtrack-v4";
const STATIC_ASSETS = ["/manifest.json", "/icon-192.png", "/icon-512.png"];

// Instalar: cachear solo assets estáticos (NO el HTML)
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) =>
        cache.addAll(STATIC_ASSETS).catch(() => Promise.resolve()),
      )
      .then(() => self.skipWaiting()),
  );
});

// Activar: limpiar cachés viejos e inmediatamente tomar control
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // CDNs externos y OneSignal — dejar pasar sin interceptar
  if (url.hostname !== self.location.hostname) return;

  // Rutas API — dejar pasar sin interceptar (nunca cachear)
  if (
    [
      "/validate-license",
      "/send-notification",
      "/send-email",
      "/backup",
      "/trial",
      "/sync",
    ].includes(url.pathname)
  )
    return;

  // HTML (navegación) — Network First: siempre intenta la red primero
  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const clone = response.clone();
          caches
            .open(CACHE_NAME)
            .then((cache) => cache.put(event.request, clone));
          return response;
        })
        .catch(() => caches.match("/index.html")),
    );
    return;
  }

  // Assets estáticos (íconos, manifest) — Cache First
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches
            .open(CACHE_NAME)
            .then((cache) => cache.put(event.request, clone));
        }
        return response;
      });
    }),
  );
});

// Permite que el cliente fuerce la activación del nuevo SW
self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});
