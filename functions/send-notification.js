// ══════════════════════════════════════════════════════════════
// Parfum Track — Cloudflare Pages Function: send-notification
// POST /send-notification
// Body: { subscriptionId, title, message, url }
//
// Variables de entorno en Cloudflare Pages → Settings → Environment variables:
//   ONESIGNAL_APP_ID   = "<tu-app-id-de-onesignal>"
//   ONESIGNAL_REST_KEY = "<tu-rest-api-key-de-onesignal>"
// ══════════════════════════════════════════════════════════════

export async function onRequestPost(context) {
  const { request, env } = context;
  const origin = request.headers.get('Origin') || '';
  const headers = corsHeaders(origin);

  let subscriptionId, title, message, url;
  try {
    ({ subscriptionId, title, message, url } = await request.json());
  } catch {
    return new Response(JSON.stringify({ ok: false }), { status: 400, headers });
  }

  if (!subscriptionId || !title || !message) {
    return new Response(JSON.stringify({ ok: false, error: 'Missing fields' }), { status: 400, headers });
  }

  const appId  = env.ONESIGNAL_APP_ID;
  const apiKey = env.ONESIGNAL_REST_KEY;

  if (!appId || !apiKey) {
    console.error('[send-notification] Faltan variables ONESIGNAL_APP_ID o ONESIGNAL_REST_KEY');
    return new Response(JSON.stringify({ ok: false, error: 'Server config error' }), { status: 500, headers });
  }

  const payload = {
    app_id: appId,
    include_subscription_ids: [subscriptionId],
    headings: { en: title, es: title },
    contents: { en: message, es: message },
    url: url || '/',
    chrome_web_icon: '/icon-192.png',
    firefox_icon: '/icon-192.png',
  };

  try {
    const resp = await fetch('https://onesignal.com/api/v1/notifications', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${apiKey}`,
      },
      body: JSON.stringify(payload),
    });

    const data = await resp.json();

    if (data.errors) {
      console.error('[send-notification] OneSignal error:', data.errors);
      return new Response(JSON.stringify({ ok: false, errors: data.errors }), { status: 200, headers });
    }

    return new Response(JSON.stringify({ ok: true, id: data.id }), { status: 200, headers });
  } catch (e) {
    console.error('[send-notification] Fetch error:', e.message);
    return new Response(JSON.stringify({ ok: false }), { status: 500, headers });
  }
}

export async function onRequestOptions(context) {
  const origin = context.request.headers.get('Origin') || '';
  return new Response(null, { status: 204, headers: corsHeaders(origin) });
}

function corsHeaders(origin) {
  const allowed = /^https?:\/\/(localhost|127\.0\.0\.1|.*\.netlify\.app|.*\.pages\.dev|.*\.workers\.dev)(:\d+)?$/.test(origin);
  return {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': allowed ? origin : 'null',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}
