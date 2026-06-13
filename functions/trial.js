// ══════════════════════════════════════════════════════════════
// Parfum Track — Cloudflare Pages Function: /trial
// POST /trial
// Body: { deviceId: "uuid-v4" }
//
// Registers (or retrieves) the authoritative trial start timestamp
// for this device. Prevents trial reset via localStorage/IndexedDB
// clearing by anchoring the start time server-side.
//
// Two complementary keys in KV:
//   trial_dev:{sha256(deviceId)} → startAt (device-level)
//   trial_ip:{sha256(ip)}        → startAt (IP-level fallback)
//
// Returns the MINIMUM of device and IP timestamps, whichever is earlier.
// Client must use this value if it predates the local pt_trial_start.
//
// KV Binding (wrangler.jsonc → kv_namespaces):
//   binding: "PT_LICENSES"
// ══════════════════════════════════════════════════════════════

const TRIAL_DURATION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const KV_TTL_SECS = 90 * 24 * 60 * 60; // Keep record 90 days

export async function onRequestPost(context) {
  const { request, env } = context;
  const origin = request.headers.get("Origin") || "";
  const headers = corsHeaders(origin);

  if (!env.PT_LICENSES) {
    return new Response(
      JSON.stringify({ ok: false, error: "KV not configured" }),
      { status: 500, headers },
    );
  }

  // Rate limit: max 20 requests per IP per hour (prevents abuse)
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const ipLimitError = await checkRateLimit(env, `rl_trial_ip_${ip}`, 20, 3600);
  if (ipLimitError) {
    return new Response(JSON.stringify({ ok: false, error: ipLimitError }), {
      status: 429,
      headers,
    });
  }

  let deviceId;
  try {
    ({ deviceId } = await request.json());
  } catch {
    return new Response(JSON.stringify({ ok: false, error: "Bad request" }), {
      status: 400,
      headers,
    });
  }

  if (!deviceId || typeof deviceId !== "string" || deviceId.length > 128) {
    return new Response(
      JSON.stringify({ ok: false, error: "Invalid deviceId" }),
      { status: 400, headers },
    );
  }

  const now = Date.now();
  const encoder = new TextEncoder();

  // Hash the deviceId and IP before storing (avoid logging raw identifiers)
  const devHash = await sha256hex(encoder, deviceId);
  const ipHash = await sha256hex(encoder, ip);

  const devKey = `trial_dev:${devHash}`;
  const ipKey = `trial_ip:${ipHash}`;

  // Retrieve existing records (or register now as first use)
  const [devRaw, ipRaw] = await Promise.all([
    env.PT_LICENSES.get(devKey),
    env.PT_LICENSES.get(ipKey),
  ]);

  const devTs = devRaw ? parseInt(devRaw, 10) : null;
  const ipTs = ipRaw ? parseInt(ipRaw, 10) : null;

  // Store if not yet registered
  const saves = [];
  if (!devRaw)
    saves.push(
      env.PT_LICENSES.put(devKey, String(now), { expirationTtl: KV_TTL_SECS }),
    );
  if (!ipRaw)
    saves.push(
      env.PT_LICENSES.put(ipKey, String(now), { expirationTtl: KV_TTL_SECS }),
    );
  if (saves.length) await Promise.all(saves);

  // Return the earliest known start (server-authoritative)
  const candidates = [devTs, ipTs, now].filter(Boolean);
  const startAt = Math.min(...candidates);

  return new Response(JSON.stringify({ ok: true, startAt }), {
    status: 200,
    headers,
  });
}

export async function onRequestOptions(context) {
  const origin = context.request.headers.get("Origin") || "";
  return new Response(null, { status: 204, headers: corsHeaders(origin) });
}

// ── Helpers ───────────────────────────────────────────────────

async function sha256hex(encoder, str) {
  const buf = await crypto.subtle.digest("SHA-256", encoder.encode(str));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function checkRateLimit(env, key, max, windowSecs) {
  const now = Math.floor(Date.now() / 1000);
  const windowKey = `${key}_${Math.floor(now / windowSecs)}`;
  let count = 0;
  try {
    const stored = await env.PT_LICENSES.get(windowKey);
    count = stored ? parseInt(stored, 10) : 0;
  } catch {
    return null;
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
    /^https?:\/\/(localhost|127\.0\.0\.1|parfumtrack\.pages\.dev|parfumtrack\.workers\.dev)(:\d+)?$/.test(
      origin,
    );
  return {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": allowed ? origin : "null",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}
