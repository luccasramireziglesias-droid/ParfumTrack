// Parfum Track — Service Worker v14
// v14: precachear STATIC_ASSETS en install (antes solo se declaraban sin usarse)

const CACHE_NAME = "parfumtrack-v14";
const STATIC_ASSETS = [
  "/", "/index.html", "/manifest.json", "/icon-192.png", "/icon-512.png",
  "/favicon.ico", "/favicon.svg", "/favicon-32.png",
  "/fonts/fonts.css",
  "/fonts/cormorant-garamond-latin.woff2",
  "/fonts/cormorant-garamond-latin-ext.woff2",
  "/fonts/cormorant-garamond-cyrillic.woff2",
  "/fonts/cormorant-garamond-cyrillic-ext.woff2",
  "/fonts/cormorant-garamond-vietnamese.woff2",
  "/fonts/dm-sans-latin.woff2",
  "/fonts/dm-sans-latin-ext.woff2"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Cache Google Fonts for offline use
  if (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com") {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) return cached;
        return fetch(event.request).then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        });
      }),
    );
    return;
  }

  if (url.hostname !== self.location.hostname) return;

  if (
    [
      "/validate-license",
      "/send-notification",
      "/send-email",
      "/backup",
      "/trial",
      "/sync",
      "/mp-create-preference",
      "/mp-webhook",
      "/mp-subscription-status",
      "/mp-payment-status",
      "/force-update",
      "/health",
    ].includes(url.pathname)
  )
    return;

  // HTML (navegación) — Network First con timeout de 3s
  if (event.request.mode === "navigate") {
    event.respondWith(
      Promise.race([
        fetch(event.request).then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          return response;
        }),
        new Promise((_, reject) => setTimeout(reject, 3000)),
      ]).catch(() => caches.match("/").then((r) => r || caches.match("/index.html"))),
    );
    return;
  }

  // Assets estáticos — Cache First
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      });
    }),
  );
});

// OneSignal push: cargar SDK solo cuando llega una notificación
self.addEventListener("push", (event) => {
  try {
    importScripts("https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.sw.js");
  } catch (e) {
    const data = event.data ? event.data.json() : {};
    event.waitUntil(
      self.registration.showNotification(data.title || "Parfum Track", {
        body: data.body || "",
        icon: "/icon-192.png",
      }),
    );
  }
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window" }).then((clients) => {
      if (clients.length > 0) return clients[0].focus();
      return self.clients.openWindow("/");
    }),
  );
});

self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});
