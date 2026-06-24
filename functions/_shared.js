// Utilidades compartidas entre Worker functions

export const ORIGIN_RE = /^(https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?|https:\/\/parfumtrack\.luccasramireziglesias\.workers\.dev)$/;

export function corsHeaders(origin, { methods = 'POST, OPTIONS', allowHeaders = 'Content-Type' } = {}) {
  const ok = ORIGIN_RE.test(origin);
  return {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': ok ? origin : 'null',
    'Access-Control-Allow-Methods': methods,
    'Access-Control-Allow-Headers': allowHeaders,
  };
}

export function json(body, status, headers) {
  return new Response(JSON.stringify(body), { status, headers });
}

export async function checkRateLimit(env, key, max, windowSecs) {
  if (!env.PT_LICENSES) {
    log('error', 'rate-limit', 'PT_LICENSES KV not configured — requests blocked');
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
  if (count >= max) return 'Too many requests, please try again later';
  try {
    await env.PT_LICENSES.put(windowKey, String(count + 1), { expirationTtl: windowSecs * 2 });
  } catch {
    return 'Rate limit write failed';
  }
  return null;
}

export function timingSafeEqual(a, b) {
  const len = Math.max(a.length, b.length);
  const paddedA = a.padEnd(len, '\0');
  const paddedB = b.padEnd(len, '\0');
  let diff = 0;
  for (let i = 0; i < len; i++) diff |= paddedA.charCodeAt(i) ^ paddedB.charCodeAt(i);
  return diff === 0;
}

export async function verifyToken(code, token, env) {
  const secret = env.LICENSE_SERVER_SECRET;
  if (!secret) return 'Server misconfigured';
  if (typeof code !== 'string' || code.length > 128) return 'Invalid code';
  if (typeof token !== 'string' || !/^[0-9a-f]{64}$/.test(token)) return 'Invalid token';
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(code));
  const expected = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
  let diff = 0;
  const maxLen = Math.max(expected.length, token.length);
  const a = expected.padEnd(maxLen, '\0');
  const b = token.padEnd(maxLen, '\0');
  for (let i = 0; i < maxLen; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0 ? null : 'Invalid token';
}

export async function sha256(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

export function delay(ms) {
  return new Promise(r => setTimeout(r, ms));
}

export function log(level, source, message, data) {
  const entry = { ts: Date.now(), level, src: source, msg: message };
  if (data) entry.data = data;
  console[level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log'](JSON.stringify(entry));
}

export function requireJson(request, maxBytes = 1_048_576) {
  const ct = request.headers.get('content-type') || '';
  if (!ct.includes('application/json')) return 'Content-Type must be application/json';
  const cl = request.headers.get('content-length');
  if (cl && parseInt(cl, 10) > maxBytes) return 'Payload too large';
  return null;
}

export function isValidEmail(email) {
  return (
    typeof email === 'string' &&
    email.length <= 254 &&
    /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/.test(email)
  );
}
