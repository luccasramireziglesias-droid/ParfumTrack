import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { onRequestPost, onRequestGet, onRequestOptions } = await import('../functions/backup.js');

// ── Helpers ─────────────────────────────────────────────────────

const SECRET = 'test-backup-secret';

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
  // Generate token in new format: timestamp:nonce:signature
  const nonceBytes = crypto.getRandomValues(new Uint8Array(16));
  const nonce = Array.from(nonceBytes).map(b => b.toString(16).padStart(2, '0')).join('');
  const timestamp = Math.floor(Date.now() / 1000);
  const tokenPayload = `${code}:${timestamp}:${nonce}`;

  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(tokenPayload));
  const signature = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');

  return `${timestamp}:${nonce}:${signature}`;
}

function makeEnv(overrides = {}) {
  return {
    LICENSE_SERVER_SECRET: SECRET,
    PT_LICENSES: mockKV(),
    PT_BACKUP: mockR2(),
    ...overrides,
  };
}

function makePostRequest(body, origin = 'https://parfumtrack.luccasramireziglesias.workers.dev') {
  return new Request('https://parfumtrack.luccasramireziglesias.workers.dev/backup', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Origin': origin,
      'CF-Connecting-IP': '1.2.3.4',
      'X-CSRF-Token': '0'.repeat(64), // Valid 64-char hex token
    },
    body: JSON.stringify(body),
  });
}

function makeGetRequest(code, token, origin = 'https://parfumtrack.luccasramireziglesias.workers.dev') {
  return new Request('https://parfumtrack.luccasramireziglesias.workers.dev/backup', {
    method: 'GET',
    headers: {
      'Origin': origin,
      'CF-Connecting-IP': '1.2.3.4',
      'X-PT-Code': code,
      'X-PT-Token': token,
    },
  });
}

// ── Tests ───────────────────────────────────────────────────────

describe('backup', () => {
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

  describe('onRequestOptions', () => {
    it('returns 204 with CORS', async () => {
      const resp = await onRequestOptions({
        request: new Request('https://test.com/backup', {
          headers: { Origin: 'https://parfumtrack.luccasramireziglesias.workers.dev' },
        }),
      });
      expect(resp.status).toBe(204);
    });
  });

  // ── POST (save backup) ────────────────────────────────────

  describe('POST', () => {
    it('saves backup with valid auth', async () => {
      const code = 'PT-TEST-001';
      const token = await generateToken(code, SECRET);
      const env = makeEnv();
      const request = makePostRequest({ code, token, data: { perfumes: [] } });
      const resp = await onRequestPost({ request, env });
      expect(resp.status).toBe(200);
      const body = await resp.json();
      expect(body.ok).toBe(true);
      expect(body.savedAt).toBeTruthy();

      expect(env.PT_BACKUP.put).toHaveBeenCalledWith(
        'backup/PT-TEST-001',
        expect.any(String),
        expect.objectContaining({ httpMetadata: { contentType: 'application/json' } }),
      );
    });

    it('rejects missing fields', async () => {
      const env = makeEnv();
      const request = makePostRequest({ code: 'PT-TEST' });
      const resp = await onRequestPost({ request, env });
      expect(resp.status).toBe(400);
    });

    it('rejects invalid token', async () => {
      const env = makeEnv();
      const request = makePostRequest({ code: 'PT-TEST', token: 'a'.repeat(64), data: {} });
      const resp = await onRequestPost({ request, env });
      expect(resp.status).toBe(401);
    });

    it('rejects invalid code format', async () => {
      const code = 'invalid code!@#';
      const token = await generateToken(code.trim().toUpperCase(), SECRET);
      const env = makeEnv();
      const request = makePostRequest({ code, token, data: {} });
      const resp = await onRequestPost({ request, env });
      expect(resp.status).toBe(400);
    });

    it('normalizes code to uppercase', async () => {
      const code = 'pt-test-lower';
      const normalized = code.trim().toUpperCase();
      const token = await generateToken(normalized, SECRET);
      const env = makeEnv();
      const request = makePostRequest({ code, token, data: { test: true } });
      const resp = await onRequestPost({ request, env });
      expect(resp.status).toBe(200);
      expect(env.PT_BACKUP.put).toHaveBeenCalledWith(
        'backup/PT-TEST-LOWER',
        expect.any(String),
        expect.anything(),
      );
    });

    it('enforces rate limit per IP', async () => {
      const kv = mockKV();
      kv.get.mockResolvedValue('10');
      const env = makeEnv({ PT_LICENSES: kv });
      const code = 'PT-RL-TEST';
      const token = await generateToken(code, SECRET);
      const request = makePostRequest({ code, token, data: {} });
      const resp = await onRequestPost({ request, env });
      expect(resp.status).toBe(429);
    });

    it('enforces rate limit per code', async () => {
      const kv = mockKV();
      let callCount = 0;
      kv.get.mockImplementation(async (key) => {
        if (key.startsWith('rl_code_')) return '4';
        return null;
      });
      const env = makeEnv({ PT_LICENSES: kv });
      const code = 'PT-CODE-RL';
      const token = await generateToken(code, SECRET);
      const request = makePostRequest({ code, token, data: {} });
      const resp = await onRequestPost({ request, env });
      expect(resp.status).toBe(429);
    });

    it('rejects payload with actual body exceeding limit', async () => {
      const env = makeEnv();
      const bigData = 'x'.repeat(5_242_881);
      const request = new Request('https://test.com/backup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '1.2.3.4', 'X-CSRF-Token': '0'.repeat(64) },
        body: bigData,
      });
      const resp = await onRequestPost({ request, env });
      expect(resp.status).toBe(413);
    });

    it('returns 500 when PT_BACKUP not configured', async () => {
      const code = 'PT-NO-R2';
      const token = await generateToken(code, SECRET);
      const env = makeEnv({ PT_BACKUP: undefined });
      const request = makePostRequest({ code, token, data: {} });
      const resp = await onRequestPost({ request, env });
      expect(resp.status).toBe(500);
    });

    it('returns 500 when R2 write fails', async () => {
      const code = 'PT-R2-FAIL';
      const token = await generateToken(code, SECRET);
      const r2 = mockR2();
      r2.put.mockRejectedValue(new Error('R2 down'));
      const env = makeEnv({ PT_BACKUP: r2 });
      const request = makePostRequest({ code, token, data: {} });
      const resp = await onRequestPost({ request, env });
      expect(resp.status).toBe(500);
      const body = await resp.json();
      expect(body.error).toContain('write failed');
    });
  });

  // ── GET (restore backup) ──────────────────────────────────

  describe('GET', () => {
    it('restores backup with valid auth', async () => {
      const code = 'PT-RESTORE';
      const token = await generateToken(code, SECRET);
      const r2 = mockR2({
        'backup/PT-RESTORE': JSON.stringify({ data: { perfumes: [1, 2, 3] }, savedAt: '2026-01-01' }),
      });
      const env = makeEnv({ PT_BACKUP: r2 });
      const request = makeGetRequest(code, token);
      const resp = await onRequestGet({ request, env });
      expect(resp.status).toBe(200);
      const body = await resp.json();
      expect(body.ok).toBe(true);
      expect(body.data).toEqual({ perfumes: [1, 2, 3] });
      expect(body.savedAt).toBe('2026-01-01');
    });

    it('returns 404 when no backup exists', async () => {
      const code = 'PT-NOBACKUP';
      const token = await generateToken(code, SECRET);
      const env = makeEnv();
      const request = makeGetRequest(code, token);
      const resp = await onRequestGet({ request, env });
      expect(resp.status).toBe(404);
    });

    it('rejects missing auth headers', async () => {
      const env = makeEnv();
      const request = new Request('https://test.com/backup', {
        method: 'GET',
        headers: { 'CF-Connecting-IP': '1.2.3.4' },
      });
      const resp = await onRequestGet({ request, env });
      expect(resp.status).toBe(400);
    });

    it('rejects invalid token', async () => {
      const env = makeEnv();
      const request = makeGetRequest('PT-TEST', 'a'.repeat(64));
      const resp = await onRequestGet({ request, env });
      expect(resp.status).toBe(401);
    });

    it('returns 500 when R2 read fails', async () => {
      const code = 'PT-R2-RFAIL';
      const token = await generateToken(code, SECRET);
      const r2 = mockR2();
      r2.get.mockRejectedValue(new Error('R2 down'));
      const env = makeEnv({ PT_BACKUP: r2 });
      const request = makeGetRequest(code, token);
      const resp = await onRequestGet({ request, env });
      expect(resp.status).toBe(500);
    });

    it('returns 500 for corrupted backup data', async () => {
      const code = 'PT-CORRUPT';
      const token = await generateToken(code, SECRET);
      const r2 = mockR2({ 'backup/PT-CORRUPT': 'NOT-JSON{{{' });
      const env = makeEnv({ PT_BACKUP: r2 });
      const request = makeGetRequest(code, token);
      const resp = await onRequestGet({ request, env });
      expect(resp.status).toBe(500);
    });
  });
});
