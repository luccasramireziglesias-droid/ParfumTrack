// ══════════════════════════════════════════════════════════════
// Parfum Track — Cloudflare Worker Entry Point
// Maneja rutas API y sirve assets estáticos
// ══════════════════════════════════════════════════════════════

import { onRequestPost as sendNotification } from './functions/send-notification.js';
import { onRequestPost as validateLicense } from './functions/validate-license.js';
import { onRequestPost as sendEmail } from './functions/send-email.js';

const API_ROUTES = ['/send-notification', '/validate-license', '/send-email'];

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    // Rutas de API
    if (API_ROUTES.includes(path)) {
      const context = { request, env, ctx };

      if (request.method === 'OPTIONS') {
        const origin = request.headers.get('Origin') || '';
        const allowed = /^https?:\/\/(localhost|127\.0\.0\.1|parfumtrack\.pages\.dev|parfumtrack\.workers\.dev)(:\d+)?$/.test(origin) ? origin : 'null';
        return new Response(null, {
          status: 204,
          headers: {
            'Access-Control-Allow-Origin': allowed,
            'Access-Control-Allow-Methods': 'POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
          },
        });
      }

      if (request.method !== 'POST') {
        return new Response('Method Not Allowed', { status: 405 });
      }

      if (path === '/send-notification') return sendNotification(context);
      if (path === '/validate-license')  return validateLicense(context);
      if (path === '/send-email')        return sendEmail(context);
    }

    // Todo lo demás → servir assets estáticos (index.html, sw.js, etc.)
    return env.ASSETS.fetch(request);
  },
};
