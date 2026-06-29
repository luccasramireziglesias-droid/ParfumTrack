import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { onRequestPost, onRequestGet, onRequestOptions } = await import('../functions/sync.js');

// ── Helpers ─────────────────────────────────────────────────────

const SECRET = 'test-sync-secret';

function mockKV(store = {}) {
  return {
    get: vi.fn(async (key) => store[key] ?? null),
    put: vi.fn(async (key, val) => { store[key] = val; }),
  };
}

function mockR2(store = {}) {
  return {
    put: vi.fn(async (key, val, opts) => { store[key] = val; }),
    get: vi.fn(async (key) => {
      if (!store[key]) return null;
      return { text: async () => store[key] };
    }),
  };
}

async function generateToken(code, secret) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(code));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function makeEnv(overrides = {}) {
  return {
    LICENSE_SERVER_SECRET: SECRET,
    PT_LICENSES: mockKV(),
    PT_BACKUP: mockR2(),
    ...overrides,
  };
}

// ── Tests ───────────────────────────────────────────────────────

describe('sync', () => {
  let consoleSpy;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleSpy = {
      log: vi.spyOn(console, 'log').mockImplementation(() => {}),
      warn: vi.spyOn(console, 'warn').mockImplementation(() => {}),
      error: vi.spyOn(console, 'error').mockImplementation(() => {}),
    };
  });

  afterEach(() => {
    Object.values(consoleSpy).forEach(s => s.mockRestore());
    vi.restoreAllMocks();
  });

  // ── OPTIONS ────────────────────────────────────────────────

  it('OPTIONS returns 204', async () => {
    const resp = await onRequestOptions({
      request: new Request('https://test.com/sync', {
        headers: { Origin: 'https://parfumtrack.luccasramireziglesias.workers.dev' },
      }),
    });
    expect(resp.status).toBe(204);
  });

  // ── POST (save) ────────────────────────────────────────────

  describe('POST', () => {
    it('saves data with valid auth', async () => {
      const code = 'SYNC-TEST-01';
      const token = await generateToken(code, SECRET);
      const env = makeEnv();
      const request = new Request('https://test.com/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '1.2.3.4' },
        body: JSON.stringify({ code, token, data: { ventas: [1] } }),
      });
      const resp = await onRequestPost({ request, env });
      expect(resp.status).toBe(200);
      const body = await resp.json();
      expect(body.ok).toBe(true);
      expect(body.savedAt).toBeTruthy();

      expect(env.PT_BACKUP.put).toHaveBeenCalledWith(
        'sync/SYNC-TEST-01',
        expect.any(String),
        expect.anything(),
      );
    });

    it('rejects missing fields', async () => {
      const env = makeEnv();
      const request = new Request('https://test.com/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '1.2.3.4' },
        body: JSON.stringify({ code: 'X' }),
      });
      const resp = await onRequestPost({ request, env });
      expect(resp.status).toBe(400);
    });

    it('rejects invalid token', async () => {
      const env = makeEnv();
      const request = new Request('https://test.com/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '1.2.3.4' },
        body: JSON.stringify({ code: 'SYNC-X', token: 'a'.repeat(64), data: {} }),
      });
      const resp = await onRequestPost({ request, env });
      expect(resp.status).toBe(401);
    });

    it('rejects invalid code format', async () => {
      const env = makeEnv();
      const request = new Request('https://test.com/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '1.2.3.4' },
        body: JSON.stringify({ code: 'invalid!@#', token: 'a'.repeat(64), data: {} }),
      });
      const resp = await onRequestPost({ request, env });
      expect(resp.status).toBe(400);
    });

    it('enforces IP rate limit', async () => {
      const kv = mockKV();
      kv.get.mockResolvedValue('120');
      const env = makeEnv({ PT_LICENSES: kv });
      const code = 'SYNC-RL';
      const token = await generateToken(code, SECRET);
      const request = new Request('https://test.com/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '1.2.3.4' },
        body: JSON.stringify({ code, token, data: {} }),
      });
      const resp = await onRequestPost({ request, env });
      expect(resp.status).toBe(429);
    });

    it('returns 500 when PT_BACKUP not configured', async () => {
      const code = 'SYNC-NOR2';
      const token = await generateToken(code, SECRET);
      const env = makeEnv({ PT_BACKUP: undefined });
      const request = new Request('https://test.com/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '1.2.3.4' },
        body: JSON.stringify({ code, token, data: {} }),
      });
      const resp = await onRequestPost({ request, env });
      expect(resp.status).toBe(500);
    });
  });

  // ── GET (load) ─────────────────────────────────────────────

  describe('GET', () => {
    it('loads data with valid auth', async () => {
      const code = 'SYNC-LOAD';
      const token = await generateToken(code, SECRET);
      const r2 = mockR2({
        'sync/SYNC-LOAD': JSON.stringify({ data: { ventas: [1, 2] }, savedAt: '2026-06-01' }),
      });
      const env = makeEnv({ PT_BACKUP: r2 });
      const request = new Request('https://test.com/sync', {
        method: 'GET',
        headers: { 'CF-Connecting-IP': '1.2.3.4', 'X-PT-Code': code, 'X-PT-Token': token },
      });
      const resp = await onRequestGet({ request, env });
      expect(resp.status).toBe(200);
      const body = await resp.json();
      expect(body.ok).toBe(true);
      expect(body.data).toEqual({ ventas: [1, 2] });
    });

    it('returns 404 when no data found', async () => {
      const code = 'SYNC-NODATA';
      const token = await generateToken(code, SECRET);
      const env = makeEnv();
      const request = new Request('https://test.com/sync', {
        method: 'GET',
        headers: { 'CF-Connecting-IP': '1.2.3.4', 'X-PT-Code': code, 'X-PT-Token': token },
      });
      const resp = await onRequestGet({ request, env });
      expect(resp.status).toBe(404);
    });

    it('rejects missing headers', async () => {
      const env = makeEnv();
      const request = new Request('https://test.com/sync', {
        method: 'GET',
        headers: { 'CF-Connecting-IP': '1.2.3.4' },
      });
      const resp = await onRequestGet({ request, env });
      expect(resp.status).toBe(400);
    });

    it('rejects invalid token', async () => {
      const env = makeEnv();
      const request = new Request('https://test.com/sync', {
        method: 'GET',
        headers: { 'CF-Connecting-IP': '1.2.3.4', 'X-PT-Code': 'SYNC-X', 'X-PT-Token': 'a'.repeat(64) },
      });
      const resp = await onRequestGet({ request, env });
      expect(resp.status).toBe(401);
    });

    it('returns 500 for corrupted data', async () => {
      const code = 'SYNC-CORRUPT';
      const token = await generateToken(code, SECRET);
      const r2 = mockR2({ 'sync/SYNC-CORRUPT': 'NOT-JSON' });
      const env = makeEnv({ PT_BACKUP: r2 });
      const request = new Request('https://test.com/sync', {
        method: 'GET',
        headers: { 'CF-Connecting-IP': '1.2.3.4', 'X-PT-Code': code, 'X-PT-Token': token },
      });
      const resp = await onRequestGet({ request, env });
      expect(resp.status).toBe(500);
    });
  });
});
