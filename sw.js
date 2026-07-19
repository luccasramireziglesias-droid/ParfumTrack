// Parfum Track — Service Worker v16
// v16: Versionado automático + invalidación inteligente de cache
// Cada versión tiene su propio cache, automáticamente limpia versiones antiguas

const APP_VERSION = "1.5.3";
const CACHE_NAME = `parfumtrack-v${APP_VERSION}`;
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
  "/fonts/dm-sans-latin-ext.woff2",
  "/fonts/material-symbols-rounded.woff2"
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
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((k) => {
          // Eliminar caches de versiones antiguas (que no sean la actual)
          if (k.startsWith("parfumtrack-v") && k !== CACHE_NAME) {
            console.log(`🗑️ Limpiando cache antiguo: ${k}`);
            return caches.delete(k);
          }
          return Promise.resolve();
        })
      );
    }).then(() => self.clients.claim())
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

  // HTML (navegación) — Network First con timeout de 5s + fallback a cache
  // v16: Invalidación automática de cache por versión
  if (event.request.mode === "navigate") {
    event.respondWith(
      Promise.race([
        fetch(event.request, { cache: "no-store" }).then((response) => {
          // Solo cachear si es 200 OK (no 304, no errores)
          if (response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        }),
        new Promise((_, reject) => setTimeout(reject, 5000)),
      ]).catch(() => caches.match("/").then((r) => r || caches.match("/index.html"))),
    );
    return;
  }

  // /version endpoint — siempre frescos del servidor (Network First)
  if (url.pathname === "/version") {
    event.respondWith(
      fetch(event.request).catch(() =>
        new Response(JSON.stringify({ error: "offline" }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' },
        })
      )
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

// OneSignal push: cargar SDK con SRI verification
const ONESIGNAL_SDK_URL = "https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.sw.js";
// SHA-384 hash of OneSignalSDK.sw.js v16 (verified 2026-07-02)
const ONESIGNAL_SDK_HASH = "sha384-KKvOBCVZhz7e2J/K3KBuqEy8mHwZvCWc9oOFsCe+8yZqwAaVNMQXGGmRFdDy0I7e";

self.addEventListener("push", (event) => {
  try {
    // Load OneSignal SDK with SRI verification
    event.waitUntil(
      fetch(ONESIGNAL_SDK_URL, {
        integrity: ONESIGNAL_SDK_HASH,
        crossOrigin: "anonymous"
      })
      .then(response => {
        if (!response.ok) throw new Error("OneSignal SDK fetch failed");
        return response.text();
      })
      .then(code => {
        // BUG #15 FIX: Usar Blob URL en lugar de eval() para mejor seguridad
        const blob = new Blob([code], { type: 'application/javascript' });
        const blobUrl = URL.createObjectURL(blob);
        importScripts(blobUrl);
        URL.revokeObjectURL(blobUrl);
      })
      .catch(e => {
        // Fallback: show notification without OneSignal
        const data = event.data ? event.data.json() : {};
        return self.registration.showNotification(data.title || "Parfum Track", {
          body: data.body || "",
          icon: "/icon-192.png",
        });
      })
    );
  } catch (e) {
    // Fallback notification
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
