import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { onRequestPost, onRequestOptions } = await import('../functions/send-email.js');

// ── Helpers ─────────────────────────────────────────────────────

const SECRET = 'test-email-secret';

async function generateToken(code, secret) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(code));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function emailHash(email) {
  const data = new TextEncoder().encode(email.toLowerCase().trim());
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function mockKV(store = {}) {
  return {
    get: vi.fn(async (key) => store[key] ?? null),
    put: vi.fn(async (key, val) => { store[key] = val; }),
  };
}

function makeEnv(overrides = {}) {
  return {
    LICENSE_SERVER_SECRET: SECRET,
    PT_LICENSES: mockKV(),
    BREVO_API_KEY: 'test-brevo-key',
    FROM_EMAIL: 'parfumtrack@gmail.com',
    FROM_NAME: 'Parfum Track',
    ...overrides,
  };
}

async function makeRequest(body) {
  const code = body.code || 'AUTH-CODE';
  const token = body.token || await generateToken(code, SECRET);
  return new Request('https://parfumtrack.luccasramireziglesias.workers.dev/send-email', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Origin': 'https://parfumtrack.luccasramireziglesias.workers.dev',
      'CF-Connecting-IP': '1.2.3.4',
    },
    body: JSON.stringify({ code, token, ...body }),
  });
}

// ── Tests ───────────────────────────────────────────────────────

describe('send-email', () => {
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

  it('OPTIONS returns 204', async () => {
    const resp = await onRequestOptions({
      request: new Request('https://test.com/send-email', {
        headers: { Origin: 'https://parfumtrack.luccasramireziglesias.workers.dev' },
      }),
    });
    expect(resp.status).toBe(204);
  });

  // ── Auth ───────────────────────────────────────────────────

  describe('authentication', () => {
    it('rejects missing auth code/token', async () => {
      const env = makeEnv();
      const request = new Request('https://test.com/send-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '1.2.3.4' },
        body: JSON.stringify({ to: 'a@b.com', template: 'trial_welcome' }),
      });
      const resp = await onRequestPost({ request, env });
      expect(resp.status).toBe(401);
    });

    it('rejects invalid token', async () => {
      const env = makeEnv();
      const request = new Request('https://test.com/send-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '1.2.3.4' },
        body: JSON.stringify({ code: 'X', token: 'a'.repeat(64), to: 'a@b.com', template: 'trial_welcome' }),
      });
      const resp = await onRequestPost({ request, env });
      expect(resp.status).toBe(401);
    });
  });

  // ── Input validation ───────────────────────────────────────

  describe('input validation', () => {
    it('rejects missing template', async () => {
      const hash = await emailHash('test@example.com');
      const kv = mockKV({ [`trial_email:${hash}`]: '1234567890' });
      const env = makeEnv({ PT_LICENSES: kv });
      const request = await makeRequest({ to: 'test@example.com' });
      const resp = await onRequestPost({ request, env });
      expect(resp.status).toBe(400);
    });

    it('rejects invalid template name', async () => {
      const hash = await emailHash('test@example.com');
      const kv = mockKV({ [`trial_email:${hash}`]: '1234567890' });
      const env = makeEnv({ PT_LICENSES: kv });
      const request = await makeRequest({ to: 'test@example.com', template: 'nonexistent' });
      const resp = await onRequestPost({ request, env });
      expect(resp.status).toBe(400);
    });

    it('rejects invalid email address', async () => {
      const env = makeEnv();
      const request = await makeRequest({ to: 'not-an-email', template: 'trial_welcome' });
      const resp = await onRequestPost({ request, env });
      expect(resp.status).toBe(400);
    });
  });

  // ── Anti-phishing check ────────────────────────────────────

  describe('anti-phishing (recipient check)', () => {
    it('rejects email to unregistered recipient', async () => {
      const env = makeEnv();
      const request = await makeRequest({ to: 'unknown@evil.com', template: 'trial_welcome' });
      const resp = await onRequestPost({ request, env });
      expect(resp.status).toBe(403);
      const body = await resp.json();
      expect(body.error).toContain('not registered');
    });

    it('allows email to registered trial user', async () => {
      const hash = await emailHash('registered@test.com');
      const kv = mockKV({ [`trial_email:${hash}`]: '1234567890' });
      const env = makeEnv({ PT_LICENSES: kv });
      vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ messageId: 'abc' }), { status: 201 })));

      const request = await makeRequest({ to: 'registered@test.com', template: 'trial_welcome', data: { name: 'Test' } });
      const resp = await onRequestPost({ request, env });
      expect(resp.status).toBe(200);

      vi.unstubAllGlobals();
    });

    it('allows email to licensed user', async () => {
      const hash = await emailHash('licensed@test.com');
      const kv = mockKV({ [`email_license:${hash}`]: 'PT-LIC-CODE' });
      const env = makeEnv({ PT_LICENSES: kv });
      vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ messageId: 'abc' }), { status: 201 })));

      const request = await makeRequest({ to: 'licensed@test.com', template: 'trial_expired', data: { name: 'Test' } });
      const resp = await onRequestPost({ request, env });
      expect(resp.status).toBe(200);

      vi.unstubAllGlobals();
    });
  });

  // ── Sending ────────────────────────────────────────────────

  describe('email sending', () => {
    it('sends email via Brevo with correct payload', async () => {
      const hash = await emailHash('user@test.com');
      const kv = mockKV({ [`trial_email:${hash}`]: '1234567890' });
      const env = makeEnv({ PT_LICENSES: kv });
      const fetchMock = vi.fn(async () => new Response(JSON.stringify({ messageId: 'msg-123' }), { status: 201 }));
      vi.stubGlobal('fetch', fetchMock);

      const request = await makeRequest({ to: 'user@test.com', toName: 'Test User', template: 'trial_welcome', data: { name: 'Test' } });
      const resp = await onRequestPost({ request, env });
      expect(resp.status).toBe(200);
      const body = await resp.json();
      expect(body.ok).toBe(true);
      expect(body.messageId).toBe('msg-123');

      const brevoCall = fetchMock.mock.calls.find(c => c[0].includes('brevo'));
      expect(brevoCall).toBeDefined();
      const brevoPayload = JSON.parse(brevoCall[1].body);
      expect(brevoPayload.to[0].email).toBe('user@test.com');
      expect(brevoPayload.headers['List-Unsubscribe']).toBeTruthy();

      vi.unstubAllGlobals();
    });

    it('returns 502 when Brevo fails', async () => {
      const hash = await emailHash('user@test.com');
      const kv = mockKV({ [`trial_email:${hash}`]: '1234567890' });
      const env = makeEnv({ PT_LICENSES: kv });
      vi.stubGlobal('fetch', vi.fn(async () => new Response('Bad Request', { status: 400 })));

      const request = await makeRequest({ to: 'user@test.com', template: 'trial_welcome', data: { name: 'Test' } });
      const resp = await onRequestPost({ request, env });
      expect(resp.status).toBe(502);

      vi.unstubAllGlobals();
    });

    it('returns 500 when BREVO_API_KEY missing', async () => {
      const hash = await emailHash('user@test.com');
      const kv = mockKV({ [`trial_email:${hash}`]: '1234567890' });
      const env = makeEnv({ PT_LICENSES: kv, BREVO_API_KEY: undefined });
      const request = await makeRequest({ to: 'user@test.com', template: 'trial_welcome', data: {} });
      const resp = await onRequestPost({ request, env });
      expect(resp.status).toBe(500);
    });

    it('sanitizes XSS in template data', async () => {
      const hash = await emailHash('user@test.com');
      const kv = mockKV({ [`trial_email:${hash}`]: '1234567890' });
      const env = makeEnv({ PT_LICENSES: kv });
      const fetchMock = vi.fn(async () => new Response(JSON.stringify({ messageId: 'ok' }), { status: 201 }));
      vi.stubGlobal('fetch', fetchMock);

      const request = await makeRequest({
        to: 'user@test.com',
        toName: '<script>alert("xss")</script>',
        template: 'trial_welcome',
        data: { name: '<img src=x onerror=alert(1)>' },
      });
      await onRequestPost({ request, env });

      const brevoCall = fetchMock.mock.calls.find(c => c[0].includes('brevo'));
      const payload = JSON.parse(brevoCall[1].body);
      expect(payload.htmlContent).not.toContain('<script>');
      expect(payload.htmlContent).not.toContain('<img src=x');

      vi.unstubAllGlobals();
    });
  });

  // ── Rate limiting ──────────────────────────────────────────

  describe('rate limiting', () => {
    it('enforces IP rate limit', async () => {
      const kv = mockKV();
      kv.get.mockResolvedValue('5');
      const env = makeEnv({ PT_LICENSES: kv });
      const request = await makeRequest({ to: 'a@b.com', template: 'trial_welcome' });
      const resp = await onRequestPost({ request, env });
      expect(resp.status).toBe(429);
    });
  });
});
