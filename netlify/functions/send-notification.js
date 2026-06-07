// ══════════════════════════════════════════════════════════════
// Parfum Track — Netlify Function: send-notification
// POST /.netlify/functions/send-notification
// Body: { subscriptionId, title, message, url }
//
// Variables de entorno requeridas en Netlify → Site Settings → Env Variables:
//   ONESIGNAL_APP_ID   = "4b037409-ce19-48b9-932c-3021b31b2a33"
//   ONESIGNAL_REST_KEY = "tu-rest-api-key-de-onesignal"
//
// Dónde conseguir ONESIGNAL_REST_KEY:
//   OneSignal Dashboard → Settings → Keys & IDs → REST API Key
// ══════════════════════════════════════════════════════════════

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders(event) };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const headers = corsHeaders(event);

  let subscriptionId, title, message, url;
  try {
    ({ subscriptionId, title, message, url } = JSON.parse(event.body || '{}'));
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ ok: false }) };
  }

  if (!subscriptionId || !title || !message) {
    return { statusCode: 400, headers, body: JSON.stringify({ ok: false, error: 'Missing fields' }) };
  }

  const appId  = process.env.ONESIGNAL_APP_ID;
  const apiKey = process.env.ONESIGNAL_REST_KEY;

  if (!appId || !apiKey) {
    console.error('[send-notification] Faltan variables de entorno ONESIGNAL_APP_ID o ONESIGNAL_REST_KEY');
    return { statusCode: 500, headers, body: JSON.stringify({ ok: false, error: 'Server config error' }) };
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
      return { statusCode: 200, headers, body: JSON.stringify({ ok: false, errors: data.errors }) };
    }

    return { statusCode: 200, headers, body: JSON.stringify({ ok: true, id: data.id }) };
  } catch (e) {
    console.error('[send-notification] Fetch error:', e.message);
    return { statusCode: 500, headers, body: JSON.stringify({ ok: false }) };
  }
};

function corsHeaders(event) {
  const origin = event.headers?.origin || '';
  const allowed = /^https:\/\/(localhost|127\.0\.0\.1|.*\.netlify\.app)(:\d+)?$/.test(origin);
  return {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': allowed ? origin : 'null',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}
