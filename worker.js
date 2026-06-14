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
import { onRequestPost as mpCreateSubscription }  from './functions/mp-create-subscription.js';
import { onRequestPost as mpWebhookPost, onRequestGet as mpWebhookGet } from './functions/mp-webhook.js';
import { onRequestGet  as mpSubscriptionStatus }  from './functions/mp-subscription-status.js';
import { onRequestPost as stripeCreateCheckout }  from './functions/stripe-create-checkout.js';
import { onRequestPost as stripeWebhook }         from './functions/stripe-webhook.js';

const POST_ROUTES = ['/send-notification', '/validate-license', '/send-email', '/backup', '/trial', '/sync', '/mp-create-subscription', '/mp-webhook', '/stripe-create-checkout', '/stripe-webhook'];
const GET_ROUTES  = ['/backup', '/sync', '/mp-webhook', '/mp-subscription-status'];

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
      const allowed = /^https?:\/\/(localhost|127\.0\.0\.1|parfumtrack\.pages\.dev|[a-z0-9-]+\.workers\.dev)(:\d+)?$/.test(origin) ? origin : 'null';
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin':  allowed,
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
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
      if (path === '/mp-create-subscription')  return mpCreateSubscription(context);
      if (path === '/mp-webhook')              return mpWebhookPost(context);
      if (path === '/stripe-create-checkout') return stripeCreateCheckout(context);
      if (path === '/stripe-webhook')         return stripeWebhook(context);
    }

    if (method === 'GET') {
      if (path === '/backup')                 return backupGet(context);
      if (path === '/sync')                   return syncGet(context);
      if (path === '/mp-webhook')             return mpWebhookGet(context);
      if (path === '/mp-subscription-status') return mpSubscriptionStatus(context);
    }

    // Todo lo demás → assets estáticos (index.html, sw.js, etc.)
    return env.ASSETS.fetch(request);
  },
};
