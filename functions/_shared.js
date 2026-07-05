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

// PH3-01: Burst detection — rechazar spikes anormales (5+ requests en <5 segundos)
export async function checkBurstRateLimit(env, key, burstThreshold = 5, burstWindowMs = 5000) {
  if (!env.PT_LICENSES) {
    log('error', 'burst-limit', 'PT_LICENSES KV not configured');
    return 'Service temporarily unavailable';
  }

  const now = Date.now();
  const historyKey = `burst_history:${key}`;
  let history = [];

  try {
    const stored = await env.PT_LICENSES.get(historyKey);
    if (stored) {
      const parsed = JSON.parse(stored);
      history = Array.isArray(parsed) ? parsed : [];
    }
  } catch {
    history = [];
  }

  // Mantener solo timestamps dentro de la ventana
  history = history.filter(ts => now - ts < burstWindowMs);

  // Si hay demasiados requests en ventana corta: burst detectado
  if (history.length >= burstThreshold) {
    log('warn', 'burst-limit', 'burst detected', { key, count: history.length, window: `${burstWindowMs}ms` });
    return 'Too many rapid requests, please slow down';
  }

  // Agregar timestamp actual
  history.push(now);

  try {
    await env.PT_LICENSES.put(historyKey, JSON.stringify(history), { expirationTtl: Math.ceil(burstWindowMs / 1000) + 1 });
  } catch {
    return 'Rate limit write failed';
  }

  return null;
}

// PH3-02: IP-based rate limiting — rechazar IPs con demasiados requests
export async function checkIPRateLimit(env, request, endpoint, maxPerWindow = 100, windowSecs = 60) {
  if (!env.PT_LICENSES) {
    log('error', 'ip-rate-limit', 'PT_LICENSES KV not configured');
    return 'Service temporarily unavailable';
  }

  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  if (ip === 'unknown') {
    log('warn', 'ip-rate-limit', 'Could not determine client IP');
    return null;
  }

  const now = Math.floor(Date.now() / 1000);
  const windowKey = `ip_rate:${endpoint}:${ip}:${Math.floor(now / windowSecs)}`;

  let count = 0;
  try {
    const stored = await env.PT_LICENSES.get(windowKey);
    count = stored ? (parseInt(stored, 10) || 0) : 0;
  } catch {
    return 'Rate limit check failed';
  }

  if (count >= maxPerWindow) {
    log('warn', 'ip-rate-limit', 'IP rate limit exceeded', { ip: '***', endpoint, count, maxPerWindow });
    return 'Too many requests from your IP, please try again later';
  }

  try {
    await env.PT_LICENSES.put(windowKey, String(count + 1), { expirationTtl: windowSecs * 2 });
  } catch {
    return 'Rate limit write failed';
  }

  return null;
}

// PH3-03: Adaptive throttling — rechaza progresivamente IPs que muestran patrones de ataque
export async function getAdaptiveThrottle(env, request, endpoint) {
  if (!env.PT_LICENSES) return 0;

  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  if (ip === 'unknown') return 0;

  const statusKey = `attack_status:${endpoint}:${ip}`;
  let attackScore = 0;

  try {
    const stored = await env.PT_LICENSES.get(statusKey);
    if (stored) {
      attackScore = parseInt(stored, 10) || 0;
    }
  } catch {
    return 0;
  }

  // Exponential backoff: score 0-2 = no delay, 3-5 = 100ms, 6-10 = 500ms, 11+ = 1000ms+
  if (attackScore >= 11) return 1000;
  if (attackScore >= 6) return 500;
  if (attackScore >= 3) return 100;
  return 0;
}

// Increment attack score when blocking a request (used internally by rate limiters)
export async function recordBlockedRequest(env, request, endpoint) {
  if (!env.PT_LICENSES) return;

  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  if (ip === 'unknown') return;

  const statusKey = `attack_status:${endpoint}:${ip}`;

  try {
    const stored = await env.PT_LICENSES.get(statusKey);
    let attackScore = stored ? (parseInt(stored, 10) || 0) : 0;
    attackScore = Math.min(attackScore + 1, 20); // Cap at 20
    await env.PT_LICENSES.put(statusKey, String(attackScore), { expirationTtl: 3600 });
  } catch {
    // Silently fail: non-critical
  }
}

// PH3-04: Double-submit CSRF validation — token en body + header deben coincidir
export function validateDoubleSubmitCSRF(request, body) {
  // CSRF token debe estar en dos lugares:
  // 1. En el body (POST data): csrf_token
  // 2. En header: X-CSRF-Token

  const headerToken = request.headers.get('x-csrf-token');
  const bodyToken = body?.csrf_token;

  // Ambos son requeridos
  if (!headerToken || !bodyToken) {
    return { valid: false, error: 'missing_csrf_token' };
  }

  // Tokens deben ser hexadecimales de 64 chars (SHA-256) — validar formato primero
  const csrfRegex = /^[0-9a-f]{64}$/;
  if (!csrfRegex.test(headerToken) || !csrfRegex.test(bodyToken)) {
    return { valid: false, error: 'invalid_token_format' };
  }

  // Deben coincidir (timing-safe)
  if (!timingSafeEqual(headerToken, bodyToken)) {
    return { valid: false, error: 'csrf_token_mismatch' };
  }

  return { valid: true };
}

// PH3-05: Referer/Origin validation — rechazar requests de origins no-whitelisted
export function validateOrigin(request, allowedOrigins = []) {
  // Obtener Origin (preferido) o Referer header
  const origin = request.headers.get('origin') || request.headers.get('referer');

  if (!origin) {
    // Sin origin/referer: rechazar (podría ser CSRF o mal-formado)
    return { valid: false, error: 'missing_origin' };
  }

  // Extraer origin de referer si es necesario (URL completa vs solo origin)
  let checkOrigin = origin;
  if (origin.includes('/')) {
    try {
      checkOrigin = new URL(origin).origin;
    } catch {
      return { valid: false, error: 'invalid_origin_format' };
    }
  }

  // Verificar si origin está en whitelist
  const isAllowed = allowedOrigins.some(allowed => {
    if (allowed instanceof RegExp) {
      return allowed.test(checkOrigin);
    }
    return checkOrigin === allowed;
  });

  if (!isAllowed) {
    return { valid: false, error: 'origin_not_allowed', origin: checkOrigin };
  }

  return { valid: true };
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

// PH4-01: Encrypt sensitive KV secrets (LICENSE_PRIVATE_KEY, MP_ACCESS_TOKEN, etc.)
export async function encryptSecret(secret, masterKey) {
  if (!masterKey) throw new Error('Master key required for encryption');
  if (typeof secret !== 'string') throw new Error('Secret must be string');

  // Generate random 96-bit IV
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const enc = new TextEncoder();
  const secretData = enc.encode(secret);

  // Derive key from master key (256-bit)
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(masterKey), { name: 'PBKDF2' }, false, ['deriveBits']);
  const derivedKey = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: iv, iterations: 100000 }, keyMaterial, 256);

  // Encrypt with AES-256-GCM
  const key = await crypto.subtle.importKey('raw', derivedKey, { name: 'AES-GCM' }, false, ['encrypt']);
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, secretData);

  // Return: IV (base64) + ciphertext (base64)
  const ivB64 = btoa(String.fromCharCode(...iv));
  const ctB64 = btoa(String.fromCharCode(...new Uint8Array(ciphertext)));
  return `${ivB64}.${ctB64}`;
}

// Decrypt encrypted secret
export async function decryptSecret(encrypted, masterKey) {
  if (!masterKey) throw new Error('Master key required for decryption');
  if (typeof encrypted !== 'string' || !encrypted.includes('.')) throw new Error('Invalid encrypted format');

  const [ivB64, ctB64] = encrypted.split('.');
  const iv = new Uint8Array(atob(ivB64).split('').map(c => c.charCodeAt(0)));
  const ciphertext = new Uint8Array(atob(ctB64).split('').map(c => c.charCodeAt(0)));
  const enc = new TextEncoder();

  // Derive same key as encryption
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(masterKey), { name: 'PBKDF2' }, false, ['deriveBits']);
  const derivedKey = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: iv, iterations: 100000 }, keyMaterial, 256);

  // Decrypt
  const key = await crypto.subtle.importKey('raw', derivedKey, { name: 'AES-GCM' }, false, ['decrypt']);
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);

  return new TextDecoder().decode(plaintext);
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
