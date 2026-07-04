// Utilidades compartidas entre Worker functions

export const ORIGIN_RE = /^(https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?|https:\/\/parfumtrack\.(luccasramireziglesias\.workers\.dev|pages\.dev))$/;

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
    count = stored ? (parseInt(stored, 10) || 0) : 0;
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

// New: Verify token with timestamp + nonce (prevent replay attacks)
// Token format: "timestamp:nonce:signature"
export async function verifyTokenWithExpiry(code, token, env, maxAgeSecs = 900) {
  const secret = env.LICENSE_SERVER_SECRET;
  if (!secret) return { valid: false, error: 'Server misconfigured' };

  if (typeof code !== 'string' || code.length > 128) return { valid: false, error: 'Invalid code' };
  if (typeof token !== 'string') return { valid: false, error: 'Invalid token' };

  // Parse token: timestamp:nonce:signature
  const parts = token.split(':');
  if (parts.length !== 3) return { valid: false, error: 'Invalid token format' };

  const [timestampStr, nonce, signature] = parts;
  const timestamp = parseInt(timestampStr, 10);

  if (!Number.isFinite(timestamp) || !/^[0-9a-f]{32}$/.test(nonce) || !/^[0-9a-f]{64}$/.test(signature)) {
    return { valid: false, error: 'Invalid token format' };
  }

  // Validate timestamp is within acceptable window (default 15 minutes)
  const now = Math.floor(Date.now() / 1000);
  const age = now - timestamp;
  if (age < 0 || age > maxAgeSecs) {
    return { valid: false, error: 'Token expired or from future' };
  }

  // Verify signature: HMAC-SHA256(secret, code:timestamp:nonce)
  const tokenPayload = `${code}:${timestamp}:${nonce}`;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(tokenPayload));
  const expected = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');

  // Timing-safe comparison
  let diff = 0;
  const maxLen = Math.max(expected.length, signature.length);
  const a = expected.padEnd(maxLen, '\0');
  const b = signature.padEnd(maxLen, '\0');
  for (let i = 0; i < maxLen; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);

  if (diff !== 0) {
    return { valid: false, error: 'Invalid signature' };
  }

  return { valid: true, nonce, timestamp };
}

export async function sha256(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

export function delay(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// Sanitize sensitive data before logging
function sanitizeData(data) {
  if (!data || typeof data !== 'object') return data;

  const sanitized = JSON.parse(JSON.stringify(data));
  const sensitiveKeys = ['email', 'otp', 'password', 'token', 'code', 'secret', 'ip'];

  const sanitizeValue = (value, key) => {
    const keyLower = String(key).toLowerCase();

    // Email: show only domain
    if (keyLower === 'email' && typeof value === 'string') {
      const [local, domain] = value.split('@');
      return domain ? `***@${domain}` : '***';
    }

    // OTP: show only length
    if (keyLower === 'otp' && typeof value === 'string') {
      return `OTP[${value.length}]`;
    }

    // License codes: show first 7 chars + asterisks
    if ((keyLower === 'code' || keyLower === 'license') && typeof value === 'string' && value.length > 7) {
      return value.substring(0, 7) + '***';
    }

    // Tokens: show only length
    if (keyLower === 'token' && typeof value === 'string' && value.length > 20) {
      return `Token[${value.length}]`;
    }

    // Passwords/Secrets: never log
    if ((keyLower === 'password' || keyLower === 'secret') && typeof value === 'string') {
      return '[REDACTED]';
    }

    return value;
  };

  const traverse = (obj) => {
    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        if (typeof obj[key] === 'object' && obj[key] !== null) {
          traverse(obj[key]);
        } else {
          obj[key] = sanitizeValue(obj[key], key);
        }
      }
    }
  };

  traverse(sanitized);
  return sanitized;
}

export function log(level, source, message, data) {
  const entry = { ts: Date.now(), level, src: source, msg: message };
  if (data) entry.data = sanitizeData(data);
  console[level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log'](JSON.stringify(entry));
}

export async function hashIp(request) {
  const raw = request.headers.get('CF-Connecting-IP') || 'unknown';
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
  return Array.from(new Uint8Array(buf)).slice(0, 8).map(b => b.toString(16).padStart(2, '0')).join('');
}

export function requireJson(request) {
  const ct = request.headers.get('content-type') || '';
  if (!ct.includes('application/json')) return 'Content-Type must be application/json';
  return null;
}

export async function parseJsonBody(request, maxBytes = 1_048_576) {
  const text = await request.text();
  if (text.length > maxBytes) return { error: 'Payload too large' };
  try {
    return { data: JSON.parse(text) };
  } catch {
    return { error: 'Invalid JSON' };
  }
}

export function requestId() {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

export function isValidEmail(email) {
  return (
    typeof email === 'string' &&
    email.length <= 254 &&
    /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/.test(email)
  );
}

export function validateCsrfToken(request, opts = {}) {
  const csrfToken = request.headers.get('X-CSRF-Token') || '';
  const { optional = false } = opts;
  if (!csrfToken && optional) return null;
  if (typeof csrfToken !== 'string' || !/^[0-9a-f]{64}$/.test(csrfToken)) {
    return 'Invalid or missing CSRF token';
  }
  return null;
}
