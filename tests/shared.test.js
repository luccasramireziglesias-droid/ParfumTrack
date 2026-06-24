import { describe, it, expect, vi } from 'vitest';
import {
  corsHeaders,
  json,
  checkRateLimit,
  timingSafeEqual,
  sha256,
  delay,
  log,
  isValidEmail,
  verifyToken,
  requireJson,
} from '../functions/_shared.js';

// ── corsHeaders ──────────────────────────────────────────────

describe('corsHeaders', () => {
  it('allows production origin', () => {
    const h = corsHeaders('https://parfumtrack.luccasramireziglesias.workers.dev');
    expect(h['Access-Control-Allow-Origin']).toBe('https://parfumtrack.luccasramireziglesias.workers.dev');
  });

  it('allows localhost', () => {
    const h = corsHeaders('http://localhost:3000');
    expect(h['Access-Control-Allow-Origin']).toBe('http://localhost:3000');
  });

  it('allows 127.0.0.1', () => {
    const h = corsHeaders('http://127.0.0.1:8788');
    expect(h['Access-Control-Allow-Origin']).toBe('http://127.0.0.1:8788');
  });

  it('rejects unknown origins', () => {
    const h = corsHeaders('https://evil.com');
    expect(h['Access-Control-Allow-Origin']).toBe('null');
  });

  it('rejects empty origin', () => {
    const h = corsHeaders('');
    expect(h['Access-Control-Allow-Origin']).toBe('null');
  });

  it('uses default methods and headers', () => {
    const h = corsHeaders('http://localhost');
    expect(h['Access-Control-Allow-Methods']).toBe('POST, OPTIONS');
    expect(h['Access-Control-Allow-Headers']).toBe('Content-Type');
  });

  it('accepts custom methods and headers', () => {
    const h = corsHeaders('http://localhost', { methods: 'GET, POST, OPTIONS', allowHeaders: 'Content-Type, X-PT-Code' });
    expect(h['Access-Control-Allow-Methods']).toBe('GET, POST, OPTIONS');
    expect(h['Access-Control-Allow-Headers']).toBe('Content-Type, X-PT-Code');
  });

  it('always sets Content-Type to application/json', () => {
    const h = corsHeaders('https://evil.com');
    expect(h['Content-Type']).toBe('application/json');
  });
});

// ── json ─────────────────────────────────────────────────────

describe('json', () => {
  it('returns a Response with JSON body', async () => {
    const resp = json({ ok: true }, 200, { 'Content-Type': 'application/json' });
    expect(resp.status).toBe(200);
    const body = await resp.json();
    expect(body).toEqual({ ok: true });
  });

  it('sets correct status code', () => {
    const resp = json({ error: 'not found' }, 404, {});
    expect(resp.status).toBe(404);
  });
});

// ── timingSafeEqual ──────────────────────────────────────────

describe('timingSafeEqual', () => {
  it('returns true for equal strings', () => {
    expect(timingSafeEqual('hello', 'hello')).toBe(true);
  });

  it('returns false for different strings', () => {
    expect(timingSafeEqual('hello', 'world')).toBe(false);
  });

  it('returns false for different lengths', () => {
    expect(timingSafeEqual('short', 'longer string')).toBe(false);
  });

  it('returns true for empty strings', () => {
    expect(timingSafeEqual('', '')).toBe(true);
  });

  it('returns false for empty vs non-empty', () => {
    expect(timingSafeEqual('', 'a')).toBe(false);
  });

  it('handles special characters', () => {
    expect(timingSafeEqual('p@$$w0rd!', 'p@$$w0rd!')).toBe(true);
    expect(timingSafeEqual('p@$$w0rd!', 'p@$$w0rd?')).toBe(false);
  });
});

// ── sha256 ───────────────────────────────────────────────────

describe('sha256', () => {
  it('returns 64 character hex string', async () => {
    const hash = await sha256('test');
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('returns consistent hash for same input', async () => {
    const h1 = await sha256('hello');
    const h2 = await sha256('hello');
    expect(h1).toBe(h2);
  });

  it('returns different hash for different input', async () => {
    const h1 = await sha256('hello');
    const h2 = await sha256('world');
    expect(h1).not.toBe(h2);
  });

  it('produces correct SHA-256 for known input', async () => {
    const hash = await sha256('');
    expect(hash).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });
});

// ── isValidEmail ─────────────────────────────────────────────

describe('isValidEmail', () => {
  it('accepts standard emails', () => {
    expect(isValidEmail('user@example.com')).toBe(true);
    expect(isValidEmail('user.name@example.com')).toBe(true);
    expect(isValidEmail('user+tag@example.co.uk')).toBe(true);
  });

  it('rejects invalid emails', () => {
    expect(isValidEmail('')).toBe(false);
    expect(isValidEmail('not-an-email')).toBe(false);
    expect(isValidEmail('@example.com')).toBe(false);
    expect(isValidEmail('user@')).toBe(false);
    expect(isValidEmail('user@.com')).toBe(false);
  });

  it('rejects non-string inputs', () => {
    expect(isValidEmail(null)).toBe(false);
    expect(isValidEmail(undefined)).toBe(false);
    expect(isValidEmail(123)).toBe(false);
  });

  it('rejects emails over 254 chars', () => {
    const longEmail = 'a'.repeat(246) + '@test.com';
    expect(longEmail.length).toBeGreaterThan(254);
    expect(isValidEmail(longEmail)).toBe(false);
  });
});

// ── delay ────────────────────────────────────────────────────

describe('delay', () => {
  it('resolves after given ms', async () => {
    const start = Date.now();
    await delay(50);
    expect(Date.now() - start).toBeGreaterThanOrEqual(40);
  });
});

// ── log ──────────────────────────────────────────────────────

describe('log', () => {
  it('outputs JSON to console.log for info', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    log('info', 'test', 'hello');
    expect(spy).toHaveBeenCalledOnce();
    const parsed = JSON.parse(spy.mock.calls[0][0]);
    expect(parsed.level).toBe('info');
    expect(parsed.src).toBe('test');
    expect(parsed.msg).toBe('hello');
    expect(parsed.ts).toBeTypeOf('number');
    spy.mockRestore();
  });

  it('outputs to console.error for errors', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    log('error', 'test', 'fail', { code: 500 });
    expect(spy).toHaveBeenCalledOnce();
    const parsed = JSON.parse(spy.mock.calls[0][0]);
    expect(parsed.level).toBe('error');
    expect(parsed.data).toEqual({ code: 500 });
    spy.mockRestore();
  });

  it('outputs to console.warn for warnings', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    log('warn', 'test', 'caution');
    expect(spy).toHaveBeenCalledOnce();
    spy.mockRestore();
  });

  it('omits data field when not provided', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    log('info', 'test', 'no-data');
    const parsed = JSON.parse(spy.mock.calls[0][0]);
    expect(parsed).not.toHaveProperty('data');
    spy.mockRestore();
  });
});

// ── checkRateLimit ───────────────────────────────────────────

describe('checkRateLimit', () => {
  function mockKV(store = {}) {
    return {
      get: vi.fn(async (key) => store[key] ?? null),
      put: vi.fn(async (key, val) => { store[key] = val; }),
    };
  }

  it('returns null when under limit', async () => {
    const env = { PT_LICENSES: mockKV() };
    const result = await checkRateLimit(env, 'test', 5, 3600);
    expect(result).toBeNull();
  });

  it('returns error when KV not configured', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await checkRateLimit({}, 'test', 5, 3600);
    expect(result).toBe('Service temporarily unavailable');
    spy.mockRestore();
  });

  it('returns error when at limit', async () => {
    const kv = mockKV();
    const env = { PT_LICENSES: kv };
    kv.get.mockResolvedValue('5');
    const result = await checkRateLimit(env, 'test', 5, 3600);
    expect(result).toBe('Too many requests, please try again later');
  });

  it('increments counter on success', async () => {
    const kv = mockKV();
    const env = { PT_LICENSES: kv };
    kv.get.mockResolvedValue('3');
    await checkRateLimit(env, 'test', 5, 3600);
    expect(kv.put).toHaveBeenCalledOnce();
    const putArgs = kv.put.mock.calls[0];
    expect(putArgs[1]).toBe('4');
  });

  it('returns error when KV read throws', async () => {
    const kv = mockKV();
    kv.get.mockRejectedValue(new Error('KV down'));
    const env = { PT_LICENSES: kv };
    const result = await checkRateLimit(env, 'test', 5, 3600);
    expect(result).toBe('Rate limit check failed, please try again later');
  });

  it('returns error when KV write throws', async () => {
    const kv = mockKV();
    kv.put.mockRejectedValue(new Error('KV write fail'));
    const env = { PT_LICENSES: kv };
    const result = await checkRateLimit(env, 'test', 5, 3600);
    expect(result).toBe('Rate limit write failed');
  });
});

// ── verifyToken ──────────────────────────────────────────────

describe('verifyToken', () => {
  const SECRET = 'test-secret-key-for-testing';

  async function generateToken(code, secret) {
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const sig = await crypto.subtle.sign('HMAC', key, enc.encode(code));
    return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  it('returns null for valid token', async () => {
    const code = 'PT-TEST-CODE';
    const token = await generateToken(code, SECRET);
    const result = await verifyToken(code, token, { LICENSE_SERVER_SECRET: SECRET });
    expect(result).toBeNull();
  });

  it('returns error for invalid token', async () => {
    const result = await verifyToken('PT-TEST', 'a'.repeat(64), { LICENSE_SERVER_SECRET: SECRET });
    expect(result).toBe('Invalid token');
  });

  it('returns error when secret not set', async () => {
    const result = await verifyToken('code', 'a'.repeat(64), {});
    expect(result).toBe('Server misconfigured');
  });

  it('returns error for non-hex token', async () => {
    const result = await verifyToken('code', 'not-a-hex-token', { LICENSE_SERVER_SECRET: SECRET });
    expect(result).toBe('Invalid token');
  });

  it('returns error for code too long', async () => {
    const result = await verifyToken('x'.repeat(200), 'a'.repeat(64), { LICENSE_SERVER_SECRET: SECRET });
    expect(result).toBe('Invalid code');
  });
});

// ── requireJson ─────────────────────────────────────────────

describe('requireJson', () => {
  it('returns null for application/json', () => {
    const req = { headers: { get: (k) => k === 'content-type' ? 'application/json' : null } };
    expect(requireJson(req)).toBeNull();
  });

  it('returns null for application/json with charset', () => {
    const req = { headers: { get: (k) => k === 'content-type' ? 'application/json; charset=utf-8' : null } };
    expect(requireJson(req)).toBeNull();
  });

  it('returns error for text/plain', () => {
    const req = { headers: { get: (k) => k === 'content-type' ? 'text/plain' : null } };
    expect(requireJson(req)).toBe('Content-Type must be application/json');
  });

  it('returns error for missing content-type', () => {
    const req = { headers: { get: () => null } };
    expect(requireJson(req)).toBe('Content-Type must be application/json');
  });

  it('returns error when content-length exceeds maxBytes', () => {
    const req = { headers: { get: (k) => k === 'content-type' ? 'application/json' : k === 'content-length' ? '10000' : null } };
    expect(requireJson(req, 4096)).toBe('Payload too large');
  });

  it('allows content-length within maxBytes', () => {
    const req = { headers: { get: (k) => k === 'content-type' ? 'application/json' : k === 'content-length' ? '2000' : null } };
    expect(requireJson(req, 4096)).toBeNull();
  });
});
