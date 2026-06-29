import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { onRequestPost, onRequestOptions } = await import('../functions/trial.js');

// ── Helpers ─────────────────────────────────────────────────────

function mockKV(store = {}) {
  return {
    get: vi.fn(async (key) => store[key] ?? null),
    put: vi.fn(async (key, val, opts) => { store[key] = val; }),
    delete: vi.fn(async (key) => { delete store[key]; }),
  };
}

function makeEnv(overrides = {}) {
  return {
    PT_LICENSES: mockKV(),
    BREVO_API_KEY: 'test-brevo-key',
    FROM_EMAIL: 'parfumtrack@gmail.com',
    FROM_NAME: 'Parfum Track',
    LICENSE_SERVER_SECRET: 'test-secret',
    ...overrides,
  };
}

function makeRequest(body, headers = {}) {
  return new Request('https://parfumtrack.luccasramireziglesias.workers.dev/trial', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Origin': 'https://parfumtrack.luccasramireziglesias.workers.dev',
      'CF-Connecting-IP': '1.2.3.4',
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

function makeContext(body, envOverrides = {}, headers = {}) {
  return {
    request: makeRequest(body, headers),
    env: makeEnv(envOverrides),
  };
}

// ── Tests ───────────────────────────────────────────────────────

describe('trial', () => {
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
    consoleSpy.log.mockRestore();
    consoleSpy.warn.mockRestore();
    consoleSpy.error.mockRestore();
    vi.restoreAllMocks();
  });

  // ── OPTIONS ────────────────────────────────────────────────

  describe('onRequestOptions', () => {
    it('returns 204 with CORS headers', async () => {
      const resp = await onRequestOptions({
        request: new Request('https://test.com/trial', {
          method: 'OPTIONS',
          headers: { Origin: 'https://parfumtrack.luccasramireziglesias.workers.dev' },
        }),
      });
      expect(resp.status).toBe(204);
      expect(resp.headers.get('Access-Control-Allow-Origin')).toBe(
        'https://parfumtrack.luccasramireziglesias.workers.dev',
      );
    });
  });

  // ── KV not configured ──────────────────────────────────────

  describe('KV not configured', () => {
    it('returns 500 when PT_LICENSES is missing', async () => {
      const ctx = makeContext({ step: 'register', email: 'a@b.com' }, { PT_LICENSES: undefined });
      const resp = await onRequestPost(ctx);
      expect(resp.status).toBe(500);
      const body = await resp.json();
      expect(body.error).toBe('KV not configured');
    });
  });

  // ── Content-Type validation ────────────────────────────────

  describe('content-type validation', () => {
    it('rejects non-JSON content type', async () => {
      const request = new Request('https://test.com/trial', {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain', 'CF-Connecting-IP': '1.2.3.4' },
        body: 'not json',
      });
      const resp = await onRequestPost({ request, env: makeEnv() });
      expect(resp.status).toBe(415);
    });

    it('rejects oversized payloads', async () => {
      const request = new Request('https://test.com/trial', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': '10000',
          'CF-Connecting-IP': '1.2.3.4',
        },
        body: JSON.stringify({ step: 'register' }),
      });
      const resp = await onRequestPost({ request, env: makeEnv() });
      expect(resp.status).toBe(413);
    });
  });

  // ── Invalid requests ───────────────────────────────────────

  describe('invalid requests', () => {
    it('rejects request with no step and no deviceId', async () => {
      const ctx = makeContext({});
      const resp = await onRequestPost(ctx);
      expect(resp.status).toBe(400);
      const body = await resp.json();
      expect(body.error).toBe('Invalid request');
    });

    it('returns 410 for legacy deviceId-only requests', async () => {
      const ctx = makeContext({ deviceId: 'abc123' });
      const resp = await onRequestPost(ctx);
      expect(resp.status).toBe(410);
    });

    it('rejects invalid JSON body', async () => {
      const request = new Request('https://test.com/trial', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '1.2.3.4' },
        body: 'not-json{{{',
      });
      const resp = await onRequestPost({ request, env: makeEnv() });
      expect(resp.status).toBe(400);
      const body = await resp.json();
      expect(body.error).toBe('Bad request');
    });
  });

  // ── Register (Step 1) ──────────────────────────────────────

  describe('register', () => {
    it('rejects invalid email', async () => {
      const ctx = makeContext({ step: 'register', email: 'not-an-email' });
      const resp = await onRequestPost(ctx);
      expect(resp.status).toBe(400);
      const body = await resp.json();
      expect(body.error).toContain('Email');
    });

    it('rejects missing email', async () => {
      const ctx = makeContext({ step: 'register' });
      const resp = await onRequestPost(ctx);
      expect(resp.status).toBe(400);
    });

    it('sends OTP and returns sent:true on success', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => new Response('ok', { status: 201 })));

      const env = makeEnv();
      const ctx = makeContext({ step: 'register', email: 'test@example.com' }, env);
      // Override env since makeContext creates its own
      ctx.env = env;
      const resp = await onRequestPost(ctx);
      expect(resp.status).toBe(200);
      const body = await resp.json();
      expect(body.ok).toBe(true);
      expect(body.sent).toBe(true);

      // Should have stored OTP in KV
      const otpPut = env.PT_LICENSES.put.mock.calls.find(c => c[0].startsWith('trial_otp:'));
      expect(otpPut).toBeDefined();
      const otpData = JSON.parse(otpPut[1]);
      expect(otpData.otp).toMatch(/^\d{6}$/);
      expect(otpData.attempts).toBe(0);

      // Should have called Brevo
      expect(fetch).toHaveBeenCalledWith(
        'https://api.brevo.com/v3/smtp/email',
        expect.objectContaining({ method: 'POST' }),
      );

      vi.unstubAllGlobals();
    });

    it('returns 500 when email sending fails', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => new Response('Error', { status: 500 })));

      const ctx = makeContext({ step: 'register', email: 'test@example.com' });
      const resp = await onRequestPost(ctx);
      expect(resp.status).toBe(500);
      const body = await resp.json();
      expect(body.error).toContain('send email');

      vi.unstubAllGlobals();
    });

    it('returns 500 when BREVO_API_KEY is missing', async () => {
      vi.stubGlobal('fetch', vi.fn());
      const ctx = makeContext(
        { step: 'register', email: 'test@example.com' },
        { BREVO_API_KEY: undefined },
      );
      const resp = await onRequestPost(ctx);
      expect(resp.status).toBe(500);

      vi.unstubAllGlobals();
    });

    it('applies rate limit per IP', async () => {
      const kv = mockKV();
      // Simulate IP rate limit exceeded
      kv.get.mockResolvedValue('10');
      const env = makeEnv({ PT_LICENSES: kv });
      const ctx = { request: makeRequest({ step: 'register', email: 'test@example.com' }), env };
      const resp = await onRequestPost(ctx);
      expect(resp.status).toBe(429);
    });
  });

  // ── Verify (Step 2) ────────────────────────────────────────

  describe('verify', () => {
    it('rejects missing OTP', async () => {
      const ctx = makeContext({ step: 'verify', email: 'test@example.com' });
      const resp = await onRequestPost(ctx);
      expect(resp.status).toBe(400);
      const body = await resp.json();
      expect(body.error).toContain('inválidos');
    });

    it('rejects non-6-digit OTP', async () => {
      const ctx = makeContext({ step: 'verify', email: 'test@example.com', otp: '123' });
      const resp = await onRequestPost(ctx);
      expect(resp.status).toBe(400);
    });

    it('rejects expired OTP', async () => {
      const kv = mockKV();
      // OTP not found (expired)
      kv.get.mockResolvedValue(null);
      const env = makeEnv({ PT_LICENSES: kv });
      const ctx = { request: makeRequest({ step: 'verify', email: 'test@example.com', otp: '123456' }), env };
      const resp = await onRequestPost(ctx);
      expect(resp.status).toBe(400);
      const body = await resp.json();
      expect(body.error).toContain('expiró');
    });

    it('rejects wrong OTP and increments attempts', async () => {
      const kv = mockKV();
      const otpData = { otp: '654321', attempts: 0, createdAt: Date.now() };
      // Return OTP data for the otp key, null for everything else
      kv.get.mockImplementation(async (key) => {
        if (key.startsWith('trial_otp:')) return JSON.stringify(otpData);
        return null;
      });
      const env = makeEnv({ PT_LICENSES: kv });
      const ctx = { request: makeRequest({ step: 'verify', email: 'test@example.com', otp: '111111' }), env };
      const resp = await onRequestPost(ctx);
      expect(resp.status).toBe(400);
      const body = await resp.json();
      expect(body.error).toBe('Código incorrecto');
      expect(body.attemptsLeft).toBe(4);

      // Should have saved incremented attempts
      const otpPut = kv.put.mock.calls.find(c => c[0].startsWith('trial_otp:'));
      expect(otpPut).toBeDefined();
      const saved = JSON.parse(otpPut[1]);
      expect(saved.attempts).toBe(1);
    });

    it('blocks after 5 failed attempts', async () => {
      const kv = mockKV();
      const otpData = { otp: '654321', attempts: 5, createdAt: Date.now() };
      kv.get.mockImplementation(async (key) => {
        if (key.startsWith('trial_otp:')) return JSON.stringify(otpData);
        return null;
      });
      const env = makeEnv({ PT_LICENSES: kv });
      const ctx = { request: makeRequest({ step: 'verify', email: 'test@example.com', otp: '654321' }), env };
      const resp = await onRequestPost(ctx);
      expect(resp.status).toBe(400);
      const body = await resp.json();
      expect(body.error).toContain('bloqueado');
    });

    it('accepts correct OTP and returns trial data', async () => {
      const kv = mockKV();
      const otpData = { otp: '123456', attempts: 0, createdAt: Date.now() };
      kv.get.mockImplementation(async (key) => {
        if (key.startsWith('trial_otp:')) return JSON.stringify(otpData);
        return null;
      });
      const env = makeEnv({ PT_LICENSES: kv });
      const ctx = { request: makeRequest({ step: 'verify', email: 'test@example.com', otp: '123456', deviceId: 'dev1' }), env };
      const resp = await onRequestPost(ctx);
      expect(resp.status).toBe(200);
      const body = await resp.json();
      expect(body.ok).toBe(true);
      expect(body.verified).toBe(true);
      expect(body.startAt).toBeTypeOf('number');
      expect(body.syncCode).toBeTypeOf('string');
      expect(body.syncToken).toMatch(/^[0-9a-f]{64}$/);

      // Should delete the OTP after successful verification
      expect(kv.delete).toHaveBeenCalledWith(expect.stringContaining('trial_otp:'));

      // Should persist trial anchors (email, IP, device)
      const anchorPuts = kv.put.mock.calls.filter(
        c => c[0].startsWith('trial_email:') || c[0].startsWith('trial_ip:') || c[0].startsWith('trial_dev:'),
      );
      expect(anchorPuts.length).toBe(3);
    });

    it('uses earliest known start across anchors', async () => {
      const kv = mockKV();
      const oldTimestamp = Date.now() - 5 * 24 * 60 * 60 * 1000; // 5 days ago
      const otpData = { otp: '123456', attempts: 0, createdAt: Date.now() };
      kv.get.mockImplementation(async (key) => {
        if (key.startsWith('trial_otp:')) return JSON.stringify(otpData);
        if (key.startsWith('trial_email:')) return String(oldTimestamp);
        return null;
      });
      const env = makeEnv({ PT_LICENSES: kv });
      const ctx = { request: makeRequest({ step: 'verify', email: 'test@example.com', otp: '123456' }), env };
      const resp = await onRequestPost(ctx);
      const body = await resp.json();
      expect(body.startAt).toBe(oldTimestamp);
    });

    it('returns no syncToken when LICENSE_SERVER_SECRET is missing', async () => {
      const kv = mockKV();
      const otpData = { otp: '123456', attempts: 0, createdAt: Date.now() };
      kv.get.mockImplementation(async (key) => {
        if (key.startsWith('trial_otp:')) return JSON.stringify(otpData);
        return null;
      });
      const env = makeEnv({ PT_LICENSES: kv, LICENSE_SERVER_SECRET: undefined });
      const ctx = { request: makeRequest({ step: 'verify', email: 'test@example.com', otp: '123456' }), env };
      const resp = await onRequestPost(ctx);
      const body = await resp.json();
      expect(body.syncCode).toBeNull();
      expect(body.syncToken).toBeNull();
    });

    it('handles corrupted OTP data in KV', async () => {
      const kv = mockKV();
      kv.get.mockImplementation(async (key) => {
        if (key.startsWith('trial_otp:')) return 'NOT-VALID-JSON';
        return null;
      });
      const env = makeEnv({ PT_LICENSES: kv });
      const ctx = { request: makeRequest({ step: 'verify', email: 'test@example.com', otp: '123456' }), env };
      const resp = await onRequestPost(ctx);
      expect(resp.status).toBe(500);
      const body = await resp.json();
      expect(body.error).toBe('Error interno');
    });
  });
});
