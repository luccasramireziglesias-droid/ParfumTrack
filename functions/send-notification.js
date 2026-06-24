// ══════════════════════════════════════════════════════════════
// Parfum Track — Cloudflare Pages Function: send-notification
// POST /send-notification
// Body: { subscriptionId, title, message, url }
//
// Variables de entorno en Cloudflare Pages → Settings → Environment variables:
//   ONESIGNAL_APP_ID   = "<tu-app-id-de-onesignal>"
//   ONESIGNAL_REST_KEY = "<tu-rest-api-key-de-onesignal>"
//
// KV Binding (compartido con validate-license):
//   binding: "PT_LICENSES" — reutilizado para rate limiting
// ══════════════════════════════════════════════════════════════

import { corsHeaders, json, checkRateLimit, verifyToken, log, requireJson } from './_shared.js';

export async function onRequestPost(context) {
  const { request, env } = context;
  const origin = request.headers.get("Origin") || "";
  const headers = corsHeaders(origin);

  // Rate limit by IP: max 10 requests/hour
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const ipLimitError = await checkRateLimit(env, `rl_notif_ip_${ip}`, 10, 3600);
  if (ipLimitError)
    return json({ ok: false, error: ipLimitError }, 429, headers);

  const ctError = requireJson(request, 4096);
  if (ctError) return json({ ok: false, error: ctError }, ctError === 'Payload too large' ? 413 : 415, headers);

  let subscriptionId, title, message, url, authCode, authToken;
  try {
    ({ subscriptionId, title, message, url, code: authCode, token: authToken } = await request.json());
  } catch {
    return json({ ok: false, error: "Bad request" }, 400, headers);
  }

  if (!subscriptionId || !title || !message) {
    return json({ ok: false, error: "Missing fields" }, 400, headers);
  }

  // Input guards
  if (typeof subscriptionId !== "string" || subscriptionId.length > 256 || !/^[a-zA-Z0-9_-]+$/.test(subscriptionId)) {
    return json({ ok: false, error: "Invalid subscriptionId" }, 400, headers);
  }
  if (typeof title !== "string" || title.length > 128) {
    return json({ ok: false, error: "title too long" }, 400, headers);
  }
  if (typeof message !== "string" || message.length > 512) {
    return json({ ok: false, error: "message too long" }, 400, headers);
  }

  // Rate limit by subscriptionId: max 20 notifications/day
  const subId = subscriptionId.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 128);
  const subLimitError = await checkRateLimit(
    env,
    `rl_notif_sub_${subId}`,
    20,
    86400,
  );
  if (subLimitError)
    return json({ ok: false, error: subLimitError }, 429, headers);

  // Auth: verificar token HMAC — obligatorio
  if (!authCode || !authToken) {
    return json({ ok: false, error: 'Authentication required' }, 401, headers);
  }
  const tokenErr = await verifyToken(authCode, authToken, env);
  if (tokenErr) {
    return json({ ok: false, error: 'Unauthorized' }, 401, headers);
  }

  const appId = env.ONESIGNAL_APP_ID;
  const apiKey = env.ONESIGNAL_REST_KEY;

  if (!appId || !apiKey) {
    log('error', 'send-notification', 'missing ONESIGNAL_APP_ID or ONESIGNAL_REST_KEY');
    return json({ ok: false, error: "Server config error" }, 500, headers);
  }

  const safeUrl = (typeof url === 'string' && /^\//.test(url)) ? url : '/';
  const payload = {
    app_id: appId,
    include_subscription_ids: [subscriptionId],
    headings: { en: title, es: title },
    contents: { en: message, es: message },
    url: safeUrl,
    chrome_web_icon: "/icon-192.png",
    firefox_icon: "/icon-192.png",
  };

  try {
    const resp = await fetch("https://onesignal.com/api/v1/notifications", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${apiKey}`,
      },
      body: JSON.stringify(payload),
    });

    const data = await resp.json();

    if (data.errors) {
      log('error', 'send-notification', 'OneSignal error', { errors: data.errors });
      return json({ ok: false, error: Array.isArray(data.errors) ? data.errors.join('; ') : String(data.errors) }, 200, headers);
    }

    return json({ ok: true, id: data.id }, 200, headers);
  } catch (e) {
    log('error', 'send-notification', 'fetch error', { error: e.message });
    return json({ ok: false, error: "Notification service unavailable" }, 500, headers);
  }
}

export async function onRequestOptions(context) {
  const origin = context.request.headers.get("Origin") || "";
  return new Response(null, { status: 204, headers: corsHeaders(origin) });
}

