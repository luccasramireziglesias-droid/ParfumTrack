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

export async function onRequestPost(context) {
  const { request, env } = context;
  const origin = request.headers.get("Origin") || "";
  const headers = corsHeaders(origin);

  // Rate limit by IP: max 10 requests/hour
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const ipLimitError = await checkRateLimit(env, `rl_notif_ip_${ip}`, 10, 3600);
  if (ipLimitError)
    return new Response(JSON.stringify({ ok: false, error: ipLimitError }), {
      status: 429,
      headers,
    });

  let subscriptionId, title, message, url, authCode, authToken;
  try {
    ({ subscriptionId, title, message, url, code: authCode, token: authToken } = await request.json());
  } catch {
    return new Response(JSON.stringify({ ok: false }), {
      status: 400,
      headers,
    });
  }

  if (!subscriptionId || !title || !message) {
    return new Response(
      JSON.stringify({ ok: false, error: "Missing fields" }),
      { status: 400, headers },
    );
  }

  // Input length guards
  if (typeof subscriptionId !== "string" || subscriptionId.length > 256) {
    return new Response(
      JSON.stringify({ ok: false, error: "Invalid subscriptionId" }),
      { status: 400, headers },
    );
  }
  if (typeof title !== "string" || title.length > 128) {
    return new Response(
      JSON.stringify({ ok: false, error: "title too long" }),
      { status: 400, headers },
    );
  }
  if (typeof message !== "string" || message.length > 512) {
    return new Response(
      JSON.stringify({ ok: false, error: "message too long" }),
      { status: 400, headers },
    );
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
    return new Response(JSON.stringify({ ok: false, error: subLimitError }), {
      status: 429,
      headers,
    });

  // Auth: verificar token HMAC — obligatorio
  if (!authCode || !authToken) {
    return new Response(JSON.stringify({ ok: false, error: 'Authentication required' }), { status: 401, headers });
  }
  const tokenErr = await verifyToken(authCode, authToken, env);
  if (tokenErr) {
    return new Response(JSON.stringify({ ok: false, error: 'Unauthorized' }), { status: 401, headers });
  }

  const appId = env.ONESIGNAL_APP_ID;
  const apiKey = env.ONESIGNAL_REST_KEY;

  if (!appId || !apiKey) {
    console.error(
      "[send-notification] Faltan variables ONESIGNAL_APP_ID o ONESIGNAL_REST_KEY",
    );
    return new Response(
      JSON.stringify({ ok: false, error: "Server config error" }),
      { status: 500, headers },
    );
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
      console.error("[send-notification] OneSignal error:", data.errors);
      return new Response(JSON.stringify({ ok: false, errors: data.errors }), {
        status: 200,
        headers,
      });
    }

    return new Response(JSON.stringify({ ok: true, id: data.id }), {
      status: 200,
      headers,
    });
  } catch (e) {
    console.error("[send-notification] Fetch error:", e.message);
    return new Response(JSON.stringify({ ok: false }), {
      status: 500,
      headers,
    });
  }
}

export async function onRequestOptions(context) {
  const origin = context.request.headers.get("Origin") || "";
  return new Response(null, { status: 204, headers: corsHeaders(origin) });
}

async function verifyToken(code, token, env) {
  const secret = env.LICENSE_SERVER_SECRET;
  if (!secret) return 'Server misconfigured';
  if (typeof code !== 'string' || code.length > 128) return 'Invalid code';
  if (typeof token !== 'string' || !/^[0-9a-f]{64}$/.test(token)) return 'Invalid token';
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(code));
  const expected = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
  let diff = 0;
  if (expected.length !== token.length) return 'Invalid token';
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ token.charCodeAt(i);
  return diff === 0 ? null : 'Invalid token';
}

// KV-based rate limiter: allows `max` requests per `windowSecs` seconds
async function checkRateLimit(env, key, max, windowSecs) {
  if (!env.PT_LICENSES) {
    console.error('[rate-limit] CRITICAL: PT_LICENSES KV no configurado — requests blocked');
    return 'Service temporarily unavailable';
  }

  const now = Math.floor(Date.now() / 1000);
  const windowKey = `${key}_${Math.floor(now / windowSecs)}`;

  let count = 0;
  try {
    const stored = await env.PT_LICENSES.get(windowKey);
    count = stored ? parseInt(stored, 10) : 0;
  } catch {
    return 'Rate limit check failed, please try again later';
  }

  if (count >= max) return "Too many requests, please try again later";

  try {
    await env.PT_LICENSES.put(windowKey, String(count + 1), {
      expirationTtl: windowSecs * 2,
    });
  } catch {
    /* non-blocking */
  }

  return null;
}

function corsHeaders(origin) {
  const allowed =
    /^(https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?|https:\/\/(parfumtrack\.pages\.dev|parfumtrack\.luccasramireziglesias\.workers\.dev))$/.test(
      origin,
    );
  return {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": allowed ? origin : "null",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}
