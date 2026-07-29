// ══════════════════════════════════════════════════════════════
// Parfum Track — Cloudflare Function: /version
// GET /version → { ok, version, hash, timestamp, minVersion }
//
// Lo consulta 17-auto-update.js al arrancar y cada 5 minutos: si la versión
// que devuelve es mayor a la del meta app-version, la app se recarga sola.
//
// La versión NO se edita acá. Vive en package.json y scripts/build.js la
// propaga a index.html, sw.js y a este archivo. La línea `const version`
// tiene que mantener ese formato exacto o el build falla.
//
// Sin rate limit propio a propósito: no lee KV ni toca secretos, y lo
// pollea cada cliente cada 5 minutos. Un contador en KV costaría más que
// la respuesta y se comería la cuota de escrituras. Queda cubierto por el
// límite global por IP de worker.js.
// ══════════════════════════════════════════════════════════════

import { corsHeaders, json } from './_shared.js';

export async function onRequestGet(context) {
  const { request } = context;
  const origin  = request.headers.get('Origin') || '';
  const headers = corsHeaders(origin, { methods: 'GET, OPTIONS' });

  const version = '1.8.0';

  return json(
    {
      ok: true,
      version,
      hash: 'default',            // placeholder para integridad futura
      timestamp: new Date().toISOString(),
      minVersion: '1.0.0',        // por debajo de esto, forzar actualización
    },
    200,
    {
      ...headers,
      // 60 s en el CDN: alcanza para que una versión nueva llegue rápido y
      // evita que el poll de cada cliente pegue siempre en el origen
      'Cache-Control': 'public, max-age=60',
    },
  );
}
