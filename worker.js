// ══════════════════════════════════════════════════════════════
// Parfum Track — Cloudflare Worker Entry Point
// Maneja rutas API y sirve assets estáticos
// ══════════════════════════════════════════════════════════════

import { ORIGIN_RE }                              from './functions/_shared.js';
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
import { onRequestPost as generateOwnerLicense }   from './functions/generate-owner-license.js';
import { onRequestGet  as debugLicense }            from './functions/debug-license.js';

const POST_ROUTES = ['/send-notification', '/validate-license', '/send-email', '/backup', '/trial', '/sync', '/mp-create-preference', '/mp-webhook', '/generate-owner-license'];
const GET_ROUTES  = ['/backup', '/sync', '/mp-webhook', '/mp-subscription-status', '/mp-payment-status', '/health', '/generate-owner-license', '/debug-license'];

export default {
  async fetch(request, env, ctx) {
    try {
      return await handleRequest(request, env, ctx);
    } catch (e) {
      console.error(JSON.stringify({ ts: Date.now(), level: 'error', src: 'worker', msg: 'Unhandled error', data: { error: e.message, path: new URL(request.url).pathname } }));
      const origin = request.headers.get('Origin') || '';
      const allowed = ORIGIN_RE.test(origin) ? origin : 'null';
      return new Response(JSON.stringify({ ok: false, error: 'Internal server error' }), {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': allowed,
        },
      });
    }
  },
};

async function handleRequest(request, env, ctx) {
    const url    = new URL(request.url);
    const path   = url.pathname;
    const method = request.method;
    const context = { request, env, ctx };

    const isApiRoute = POST_ROUTES.includes(path) || GET_ROUTES.includes(path);

    // CORS preflight
    if (method === 'OPTIONS' && isApiRoute) {
      const origin  = request.headers.get('Origin') || '';
      const allowed = ORIGIN_RE.test(origin) ? origin : 'null';
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin':  allowed,
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, X-PT-Code, X-PT-Token',
          'Access-Control-Max-Age': '86400',
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
      if (path === '/generate-owner-license') return generateOwnerLicense(context);

    }

    if (method === 'GET') {
      if (path === '/backup')                 return backupGet(context);
      if (path === '/sync')                   return syncGet(context);
      if (path === '/mp-webhook')             return mpWebhookGet(context);
      if (path === '/mp-subscription-status') return mpSubscriptionStatus(context);
      if (path === '/mp-payment-status')      return mpPaymentStatus(context);
      if (path === '/generate-owner-license') return generateOwnerLicense(context);
      if (path === '/debug-license')          return debugLicense(context);

      if (path === '/health') {
        const checks = { kv: false, timestamp: Date.now() };
        try {
          if (env.PT_LICENSES) {
            await env.PT_LICENSES.get('_health_ping');
            checks.kv = true;
          }
        } catch { /* kv unreachable */ }
        const ok = checks.kv;
        return new Response(JSON.stringify({ ok, ...checks }), {
          status: ok ? 200 : 503,
          headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
        });
      }

      if (path === '/force-update') {
        return new Response(
          '<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Actualizando...</title></head>' +
          '<body style="background:#0f0f1a;color:#f0ece4;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;text-align:center;">' +
          '<div><div style="font-size:48px;margin-bottom:16px;">✨</div>' +
          '<h2 style="color:#e8c97e;">Parfum Track actualizado</h2>' +
          '<p style="color:#999;font-size:14px;">Los caches fueron limpiados.<br>Cerrá esta pestaña y abrí la app de nuevo.</p>' +
          '<a href="/" style="display:inline-block;margin-top:20px;padding:12px 32px;background:linear-gradient(135deg,#c9a84c,#e8c97e);color:#1a1a2e;border-radius:10px;text-decoration:none;font-weight:600;">Abrir Parfum Track</a>' +
          '</div></body></html>',
          {
            status: 200,
            headers: {
              'Content-Type': 'text/html; charset=utf-8',
              'Clear-Site-Data': '"cache", "storage"',
              'Cache-Control': 'no-store',
            },
          },
        );
      }
    }

    if (isApiRoute) {
      const hasPost = POST_ROUTES.includes(path);
      const hasGet  = GET_ROUTES.includes(path);
      const allow = [hasGet && 'GET', hasPost && 'POST', 'OPTIONS'].filter(Boolean).join(', ');
      return new Response(JSON.stringify({ ok: false, error: 'Method not allowed' }), {
        status: 405,
        headers: { 'Content-Type': 'application/json', Allow: allow },
      });
    }

    // Assets estáticos — forzar no-cache en sw.js e index.html
    const assetResp = await env.ASSETS.fetch(request);
    if (path === '/sw.js') {
      const resp = new Response(assetResp.body, assetResp);
      resp.headers.set('Cache-Control', 'no-cache, no-store, must-revalidate');
      resp.headers.set('Service-Worker-Allowed', '/');
      return resp;
    }
    if (path === '/' || path === '/index.html') {
      const resp = new Response(assetResp.body, assetResp);
      resp.headers.set('Cache-Control', 'no-cache, must-revalidate');
      return resp;
    }
    return assetResp;
}
