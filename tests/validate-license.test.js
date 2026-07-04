import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { onRequestPost, onRequestOptions } = await import('../functions/validate-license.js');

// ── Helpers ─────────────────────────────────────────────────────

const SECRET = 'test-license-secret';

// Generate a P-256 key pair for testing ECDSA signatures
let PRIVATE_KEY_B64;
{
  const keyPair = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify'],
  );
  const exported = await crypto.subtle.exportKey('pkcs8', keyPair.privateKey);
  PRIVATE_KEY_B64 = btoa(String.fromCharCode(...new Uint8Array(exported)));
}

function mockKV(store = {}) {
  return {
    get: vi.fn(async (key) => store[key] ?? null),
    put: vi.fn(async (key, val, opts) => { store[key] = val; }),
  };
}

function makeEnv(overrides = {}) {
  return {
    LICENSE_SERVER_SECRET: SECRET,
    LICENSE_SIGNING_PRIVATE_KEY: PRIVATE_KEY_B64,
    PT_LICENSES: mockKV(),
    ...overrides,
  };
}

function makeRequest(body) {
  return new Request('https://parfumtrack.luccasramireziglesias.workers.dev/validate-license', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Origin': 'https://parfumtrack.luccasramireziglesias.workers.dev',
      'CF-Connecting-IP': '1.2.3.4',
    },
    body: JSON.stringify(body),
  });
}

function activeLicense(overrides = {}) {
  const future = new Date();
  future.setDate(future.getDate() + 30);
  return JSON.stringify({
    clientName: 'Test',
    clientEmail: 'test@example.com',
    expiresAt: future.toISOString().split('T')[0],
    maxUses: null,
    usedCount: 0,
    createdAt: '2026-01-01',
    lastActivatedAt: null,
    plan: 'basic_monthly',
    status: 'active',
    ...overrides,
  });
}

// ── Tests ───────────────────────────────────────────────────────

describe('validate-license', () => {
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
      request: new Request('https://test.com/validate-license', {
        headers: { Origin: 'https://parfumtrack.luccasramireziglesias.workers.dev' },
      }),
    });
    expect(resp.status).toBe(204);
  });

  // ── Input validation ───────────────────────────────────────

  describe('input validation', () => {
    it('rejects non-JSON content type', async () => {
      const env = makeEnv();
      const request = new Request('https://test.com/validate-license', {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain', 'CF-Connecting-IP': '1.2.3.4' },
        body: 'text',
      });
      const resp = await onRequestPost({ request, env });
      expect(resp.status).toBe(415);
    });

    it('rejects missing code', async () => {
      const env = makeEnv();
      const resp = await onRequestPost({ request: makeRequest({}), env });
      expect(resp.status).toBe(400);
    });

    it('rejects code longer than 64 chars', async () => {
      const env = makeEnv();
      const resp = await onRequestPost({ request: makeRequest({ code: 'X'.repeat(65) }), env });
      expect(resp.status).toBe(400);
    });

    it('rejects invalid JSON body', async () => {
      const env = makeEnv();
      const request = new Request('https://test.com/validate-license', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '1.2.3.4' },
        body: 'NOT-JSON',
      });
      const resp = await onRequestPost({ request, env });
      expect(resp.status).toBe(400);
    });
  });

  // ── Server configuration ───────────────────────────────────

  describe('server configuration', () => {
    it('returns 500 when SECRET not set', async () => {
      const env = makeEnv({ LICENSE_SERVER_SECRET: undefined });
      const resp = await onRequestPost({ request: makeRequest({ code: 'PT-TEST' }), env });
      expect(resp.status).toBe(500);
    });

    it('returns 429 when KV not configured (rate limit fail-closed)', async () => {
      const env = makeEnv({ PT_LICENSES: undefined });
      const resp = await onRequestPost({ request: makeRequest({ code: 'PT-TEST' }), env });
      expect(resp.status).toBe(429);
    });

    it('returns 500 when ECDSA key not set', async () => {
      const kv = mockKV({ 'license:PT-NOKEY': activeLicense() });
      const env = makeEnv({ PT_LICENSES: kv, LICENSE_SIGNING_PRIVATE_KEY: undefined });
      const resp = await onRequestPost({ request: makeRequest({ code: 'PT-NOKEY' }), env });
      expect(resp.status).toBe(500);
    });
  });

  // ── License validation ─────────────────────────────────────

  describe('license validation', () => {
    it('returns valid:true for active license', async () => {
      const kv = mockKV({ 'license:PT-ACTIVE-01': activeLicense() });
      const env = makeEnv({ PT_LICENSES: kv });
      const resp = await onRequestPost({ request: makeRequest({ code: 'PT-ACTIVE-01' }), env });
      expect(resp.status).toBe(200);
      const body = await resp.json();
      expect(body.ok).toBe(true);
      expect(body.valid).toBe(true);
      // New token format: timestamp:nonce:signature
      expect(body.token).toMatch(/^\d+:[0-9a-f]{32}:[0-9a-f]{64}$/);
      expect(body.sig).toBeTruthy();
    });

    it('returns valid:false for unknown code', async () => {
      const env = makeEnv();
      const resp = await onRequestPost({ request: makeRequest({ code: 'PT-UNKNOWN' }), env });
      const body = await resp.json();
      expect(body.ok).toBe(true);
      expect(body.valid).toBe(false);
    });

    it('returns valid:false for expired license', async () => {
      const expired = activeLicense({ expiresAt: '2020-01-01' });
      const kv = mockKV({ 'license:PT-EXPIRED': expired });
      const env = makeEnv({ PT_LICENSES: kv });
      const resp = await onRequestPost({ request: makeRequest({ code: 'PT-EXPIRED' }), env });
      const body = await resp.json();
      expect(body.valid).toBe(false);
      expect(body.error).toBe('expired');
    });

    it('returns valid:false for payment_failed status', async () => {
      const failed = activeLicense({ status: 'payment_failed' });
      const kv = mockKV({ 'license:PT-FAILED': failed });
      const env = makeEnv({ PT_LICENSES: kv });
      const resp = await onRequestPost({ request: makeRequest({ code: 'PT-FAILED' }), env });
      const body = await resp.json();
      expect(body.valid).toBe(false);
      expect(body.error).toBe('payment_failed');
    });

    it('returns valid:false when maxUses exceeded', async () => {
      const maxed = activeLicense({ maxUses: 3, usedCount: 3 });
      const kv = mockKV({ 'license:PT-MAXED': maxed });
      const env = makeEnv({ PT_LICENSES: kv });
      const resp = await onRequestPost({ request: makeRequest({ code: 'PT-MAXED' }), env });
      const body = await resp.json();
      expect(body.valid).toBe(false);
      expect(body.error).toBe('limit_reached');
    });

    it('increments usedCount on successful activation', async () => {
      const kv = mockKV({ 'license:PT-COUNT': activeLicense({ usedCount: 5 }) });
      const env = makeEnv({ PT_LICENSES: kv });
      await onRequestPost({ request: makeRequest({ code: 'PT-COUNT' }), env });
      const putCall = kv.put.mock.calls.find(c => c[0] === 'license:PT-COUNT');
      expect(putCall).toBeDefined();
      const saved = JSON.parse(putCall[1]);
      expect(saved.usedCount).toBe(6);
      expect(saved.lastActivatedAt).toBeTruthy();
    });

    it('normalizes code to uppercase', async () => {
      const kv = mockKV({ 'license:PT-LOWER': activeLicense() });
      const env = makeEnv({ PT_LICENSES: kv });
      const resp = await onRequestPost({ request: makeRequest({ code: 'pt-lower' }), env });
      const body = await resp.json();
      expect(body.valid).toBe(true);
    });

    it('returns 500 for corrupted license JSON', async () => {
      const kv = mockKV({ 'license:PT-BAD': 'NOT-JSON{{{' });
      const env = makeEnv({ PT_LICENSES: kv });
      const resp = await onRequestPost({ request: makeRequest({ code: 'PT-BAD' }), env });
      expect(resp.status).toBe(500);
    });
  });

  // ── Owner code ─────────────────────────────────────────────

  describe('owner code', () => {
    it('validates owner code without license KV lookup', async () => {
      const kv = mockKV();
      const env = makeEnv({ LICENSE_OWNER_CODE: 'PT-OWNER-MASTER', PT_LICENSES: kv });
      const resp = await onRequestPost({ request: makeRequest({ code: 'PT-OWNER-MASTER' }), env });
      const body = await resp.json();
      expect(body.valid).toBe(true);
      expect(body.token).toBeTruthy();
      // KV is called for rate limiting, but NOT for license lookup
      const licenseGet = kv.get.mock.calls.find(c => c[0].startsWith('license:'));
      expect(licenseGet).toBeUndefined();
    });
  });

  // ── Rate limiting ──────────────────────────────────────────

  describe('rate limiting', () => {
    it('enforces IP rate limit', async () => {
      const kv = mockKV();
      kv.get.mockResolvedValue('10');
      const env = makeEnv({ PT_LICENSES: kv });
      const resp = await onRequestPost({ request: makeRequest({ code: 'PT-RL' }), env });
      expect(resp.status).toBe(429);
    });
  });
});
