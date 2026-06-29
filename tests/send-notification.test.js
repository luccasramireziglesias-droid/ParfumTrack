import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { onRequestPost, onRequestOptions } = await import('../functions/send-notification.js');

// ── Helpers ─────────────────────────────────────────────────────

const SECRET = 'test-notif-secret';

async function generateToken(code, secret) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(code));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
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
    ONESIGNAL_APP_ID: 'test-app-id',
    ONESIGNAL_REST_KEY: 'test-rest-key',
    ...overrides,
  };
}

async function makeRequest(body) {
  const code = body.code || 'AUTH-CODE';
  const token = body.token || await generateToken(code, SECRET);
  return new Request('https://test.com/send-notification', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '1.2.3.4' },
    body: JSON.stringify({ code, token, ...body }),
  });
}

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

// ── Tests ───────────────────────────────────────────────────────

describe('send-notification', () => {
  it('OPTIONS returns 204', async () => {
    const resp = await onRequestOptions({
      request: new Request('https://test.com/send-notification', {
        headers: { Origin: 'https://parfumtrack.luccasramireziglesias.workers.dev' },
      }),
    });
    expect(resp.status).toBe(204);
  });

  it('sends notification via OneSignal', async () => {
    const env = makeEnv();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ id: 'notif-123' }), { status: 200 })));

    const request = await makeRequest({
      subscriptionId: 'sub-abc123',
      title: 'Test',
      message: 'Hello',
      url: '/test',
    });
    const resp = await onRequestPost({ request, env });
    expect(resp.status).toBe(200);
    const body = await resp.json();
    expect(body.ok).toBe(true);
    expect(body.id).toBe('notif-123');

    vi.unstubAllGlobals();
  });

  it('rejects missing fields', async () => {
    const env = makeEnv();
    const request = await makeRequest({ subscriptionId: 'sub-1' });
    const resp = await onRequestPost({ request, env });
    expect(resp.status).toBe(400);
  });

  it('rejects invalid subscriptionId format', async () => {
    const env = makeEnv();
    const request = await makeRequest({
      subscriptionId: 'sub with spaces!@#',
      title: 'Test',
      message: 'Hello',
    });
    const resp = await onRequestPost({ request, env });
    expect(resp.status).toBe(400);
  });

  it('rejects title over 128 chars', async () => {
    const env = makeEnv();
    const request = await makeRequest({
      subscriptionId: 'sub-1',
      title: 'x'.repeat(129),
      message: 'Hello',
    });
    const resp = await onRequestPost({ request, env });
    expect(resp.status).toBe(400);
  });

  it('rejects missing auth', async () => {
    const env = makeEnv();
    const request = new Request('https://test.com/send-notification', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '1.2.3.4' },
      body: JSON.stringify({ subscriptionId: 'sub-1', title: 'T', message: 'M' }),
    });
    const resp = await onRequestPost({ request, env });
    expect(resp.status).toBe(401);
  });

  it('returns 500 when OneSignal keys missing', async () => {
    const env = makeEnv({ ONESIGNAL_APP_ID: undefined });
    const request = await makeRequest({
      subscriptionId: 'sub-1',
      title: 'Test',
      message: 'Hello',
    });
    const resp = await onRequestPost({ request, env });
    expect(resp.status).toBe(500);
  });

  it('sanitizes external URLs to root path', async () => {
    const env = makeEnv();
    vi.stubGlobal('fetch', vi.fn(async (url, opts) => {
      const body = JSON.parse(opts.body);
      expect(body.url).toBe('/');
      return new Response(JSON.stringify({ id: 'ok' }), { status: 200 });
    }));

    const request = await makeRequest({
      subscriptionId: 'sub-1',
      title: 'Test',
      message: 'Hello',
      url: 'https://evil.com/phishing',
    });
    await onRequestPost({ request, env });

    vi.unstubAllGlobals();
  });

  it('handles OneSignal errors gracefully', async () => {
    const env = makeEnv();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      errors: ['Invalid subscription'],
    }), { status: 200 })));

    const request = await makeRequest({
      subscriptionId: 'sub-invalid',
      title: 'Test',
      message: 'Hello',
    });
    const resp = await onRequestPost({ request, env });
    const body = await resp.json();
    expect(body.ok).toBe(false);
    expect(body.error).toContain('Invalid subscription');

    vi.unstubAllGlobals();
  });
});
