// ══════════════════════════════════════════════════════════════
// Parfum Track — Cloudflare Worker Entry Point
// Maneja rutas API y sirve assets estáticos
// ══════════════════════════════════════════════════════════════

import { onRequestPost as sendNotification } from './functions/send-notification.js';
import { onRequestPost as validateLicense } from './functions/validate-license.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    // Rutas de API
    if (path === '/send-notification' || path === '/validate-license') {
      const context = { request, env, ctx };

      if (request.method === 'OPTIONS') {
        const origin = request.headers.get('Origin') || '';
        return new Response(null, {
          status: 204,
          headers: {
            'Access-Control-Allow-Origin': origin,
            'Access-Control-Allow-Methods': 'POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
          },
        });
      }

      if (request.method !== 'POST') {
        return new Response('Method Not Allowed', { status: 405 });
      }

      if (path === '/send-notification') return sendNotification(context);
      if (path === '/validate-license') return validateLicense(context);
    }

    // Todo lo demás → servir assets estáticos (index.html, sw.js, etc.)
    return env.ASSETS.fetch(request);
  },
};
