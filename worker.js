// ══════════════════════════════════════════════════════════════
// Parfum Track — Cloudflare Worker Entry Point
// Maneja rutas API y sirve assets estáticos
// ══════════════════════════════════════════════════════════════

import { onRequestPost as sendNotification }     from './functions/send-notification.js';
import { onRequestPost as validateLicense }       from './functions/validate-license.js';
import { onRequestPost as sendEmail }             from './functions/send-email.js';
import { onRequestPost as backupPost, onRequestGet as backupGet } from './functions/backup.js';
import { onRequestPost as trial }                 from './functions/trial.js';
import { onRequestPost as syncPost, onRequestGet as syncGet } from './functions/sync.js';
import { onRequestPost as mpCreatePreference }    from './functions/mp-create-preference.js';
import { onRequestPost as mpWebhookPost, onRequestGet as mpWebhookGet } from './functions/mp-webhook.js';
import { onRequestGet  as mpSubscriptionStatus }  from './functions/mp-subscription-status.js';
import { onRequestGet  as mpPaymentStatus }        from './functions/mp-payment-status.js';

const POST_ROUTES = ['/send-notification', '/validate-license', '/send-email', '/backup', '/trial', '/sync', '/mp-create-preference', '/mp-webhook'];
const GET_ROUTES  = ['/backup', '/sync', '/mp-webhook', '/mp-subscription-status', '/mp-payment-status'];

export default {
  async fetch(request, env, ctx) {
    const url    = new URL(request.url);
    const path   = url.pathname;
    const method = request.method;
    const context = { request, env, ctx };

    const isApiRoute = POST_ROUTES.includes(path) || GET_ROUTES.includes(path);

    // CORS preflight
    if (method === 'OPTIONS' && isApiRoute) {
      const origin  = request.headers.get('Origin') || '';
      const allowed = /^(https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?|https:\/\/(parfumtrack\.luccasramireziglesias\.workers\.dev))$/.test(origin) ? origin : 'null';
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin':  allowed,
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, X-PT-Code, X-PT-Token',
        },
      });
    }

    if (method === 'POST') {
      if (path === '/send-notification')      return sendNotification(context);
      if (path === '/validate-license')       return validateLicense(context);
      if (path === '/send-email')             return sendEmail(context);
      if (path === '/backup')                 return backupPost(context);
      if (path === '/trial')                  return trial(context);
      if (path === '/sync')                   return syncPost(context);
      if (path === '/mp-create-preference')   return mpCreatePreference(context);
      if (path === '/mp-webhook')              return mpWebhookPost(context);

    }

    if (method === 'GET') {
      if (path === '/backup')                 return backupGet(context);
      if (path === '/sync')                   return syncGet(context);
      if (path === '/mp-webhook')             return mpWebhookGet(context);
      if (path === '/mp-subscription-status') return mpSubscriptionStatus(context);
      if (path === '/mp-payment-status')      return mpPaymentStatus(context);
    }

    // Todo lo demás → assets estáticos (index.html, sw.js, etc.)
    return env.ASSETS.fetch(request);
  },
};
