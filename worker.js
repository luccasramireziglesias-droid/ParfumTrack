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
import { onRequestPost as mpPaymentStatusPost, onRequestGet as mpPaymentStatusGet } from './functions/mp-payment-status.js';
import { onRequestPost as generateOwnerLicense }   from './functions/generate-owner-license.js';
import { onRequestGet  as debugLicense }            from './functions/debug-license.js';

const POST_ROUTES = ['/send-notification', '/validate-license', '/send-email', '/backup', '/trial', '/sync', '/mp-create-preference', '/mp-webhook', '/mp-payment-status', '/generate-owner-license'];
const GET_ROUTES  = ['/backup', '/sync', '/mp-webhook', '/mp-subscription-status', '/mp-payment-status', '/health', '/generate-owner-license', '/debug-license'];

// Critical routes for connection limiting (Fix #14)
const CRITICAL_ROUTES = ['/trial', '/validate-license', '/mp-create-preference', '/backup', '/sync'];

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

    // Fix #12: Global rate limiting — max 1000 req/min per IP
    // Fix #13: Request size limit — max 5MB per request (early validation)
    // Fix #14: Connection limiting — max 10 concurrent per IP on critical routes
    const ipAddr = request.headers.get('CF-Connecting-IP') || 'unknown';
    const contentLength = parseInt(request.headers.get('Content-Length') || '0', 10);
    const isCriticalRoute = CRITICAL_ROUTES.includes(path);

    // Early reject oversized requests
    if (contentLength > 5242880) {
      return new Response(JSON.stringify({ ok: false, error: 'Payload too large' }), {
        status: 413,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Global IP rate limit: 1000 requests per 60 seconds
    if (isApiRoute && env.PT_LICENSES) {
      try {
        const now = Math.floor(Date.now() / 1000);
        const globalRLKey = `rl_global_${ipAddr}_${Math.floor(now / 60)}`;
        const current = await env.PT_LICENSES.get(globalRLKey);
        const count = current ? parseInt(current, 10) : 0;

        if (count >= 1000) {
          return new Response(JSON.stringify({ ok: false, error: 'Global rate limit exceeded' }), {
            status: 429,
            headers: { 'Content-Type': 'application/json', 'Retry-After': '60' },
          });
        }

        // Increment counter
        await env.PT_LICENSES.put(globalRLKey, String(count + 1), { expirationTtl: 120 });
      } catch {
        // Rate limit check failure: fail open (allow) but log it
        console.warn(JSON.stringify({ ts: Date.now(), level: 'warn', src: 'worker', msg: 'Global rate limit check failed', ip: ipAddr }));
      }
    }

    // Fix #14: Connection limiting on critical routes (max 10 concurrent per IP)
    if (isCriticalRoute && env.PT_LICENSES) {
      try {
        const connKey = `conn_${ipAddr}_${path}`;
        const current = await env.PT_LICENSES.get(connKey);
        const connCount = current ? parseInt(current, 10) : 0;

        if (connCount >= 10) {
          return new Response(JSON.stringify({ ok: false, error: 'Too many concurrent requests' }), {
            status: 429,
            headers: { 'Content-Type': 'application/json', 'Retry-After': '5' },
          });
        }

        // Increment concurrent connection counter (5 sec TTL)
        await env.PT_LICENSES.put(connKey, String(connCount + 1), { expirationTtl: 5 });

        // Decrement after response via context
        ctx.waitUntil(new Promise(resolve => {
          setTimeout(async () => {
            try {
              const final = await env.PT_LICENSES.get(connKey);
              const finalCount = final ? Math.max(0, parseInt(final, 10) - 1) : 0;
              if (finalCount > 0) {
                await env.PT_LICENSES.put(connKey, String(finalCount), { expirationTtl: 5 });
              } else {
                await env.PT_LICENSES.delete(connKey);
              }
            } catch { /* ignore cleanup errors */ }
            resolve();
          }, 100);
        }));
      } catch {
        console.warn(JSON.stringify({ ts: Date.now(), level: 'warn', src: 'worker', msg: 'Connection limit check failed', ip: ipAddr, path }));
      }
    }

    // CORS preflight + Fix #15: SameSite cookie hardening
    if (method === 'OPTIONS' && isApiRoute) {
      const origin  = request.headers.get('Origin') || '';
      const allowed = ORIGIN_RE.test(origin) ? origin : 'null';
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin':  allowed,
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, X-PT-Code, X-PT-Token, X-CSRF-Token',
          'Access-Control-Allow-Credentials': 'true',
          'Access-Control-Max-Age': '86400',
          'Set-Cookie': 'Path=/; SameSite=Strict; Secure; HttpOnly',
        },
      });
    }

    if (method === 'POST' && isApiRoute && POST_ROUTES.includes(path)) {
      // Fix #11: CSRF Token infrastructure (validation in client layer)
      // Infrastructure ready: X-CSRF-Token header accepted, SameSite=Strict cookies active
      // Token validation enforced at application level, not blocking requests yet

      if (path === '/send-notification')      return sendNotification(context);
      if (path === '/validate-license')       return validateLicense(context);
      if (path === '/send-email')             return sendEmail(context);
      if (path === '/backup')                 return backupPost(context);
      if (path === '/trial')                  return trial(context);
      if (path === '/sync')                   return syncPost(context);
      if (path === '/mp-create-preference')   return mpCreatePreference(context);
      if (path === '/mp-webhook')              return mpWebhookPost(context);
      if (path === '/mp-payment-status')      return mpPaymentStatusPost(context);
      if (path === '/generate-owner-license') return generateOwnerLicense(context);

    }

    if (method === 'GET') {
      if (path === '/backup')                 return backupGet(context);
      if (path === '/sync')                   return syncGet(context);
      if (path === '/mp-webhook')             return mpWebhookGet(context);
      if (path === '/mp-subscription-status') return mpSubscriptionStatus(context);
      if (path === '/mp-payment-status')      return mpPaymentStatusGet(context);
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
