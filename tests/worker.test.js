import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../functions/send-notification.js', () => ({ onRequestPost: vi.fn(() => new Response('ok')) }));
vi.mock('../functions/validate-license.js', () => ({ onRequestPost: vi.fn(() => new Response('ok')) }));
vi.mock('../functions/send-email.js', () => ({ onRequestPost: vi.fn(() => new Response('ok')) }));
vi.mock('../functions/backup.js', () => ({ onRequestPost: vi.fn(() => new Response('ok')), onRequestGet: vi.fn(() => new Response('ok')) }));
vi.mock('../functions/trial.js', () => ({ onRequestPost: vi.fn(() => new Response('ok')) }));
vi.mock('../functions/sync.js', () => ({ onRequestPost: vi.fn(() => new Response('ok')), onRequestGet: vi.fn(() => new Response('ok')) }));
vi.mock('../functions/mp-create-preference.js', () => ({ onRequestPost: vi.fn(() => new Response('ok')) }));
vi.mock('../functions/mp-webhook.js', () => ({ onRequestPost: vi.fn(() => new Response('ok')), onRequestGet: vi.fn(() => new Response('ok')) }));
vi.mock('../functions/mp-subscription-status.js', () => ({ onRequestGet: vi.fn(() => new Response('ok')) }));
vi.mock('../functions/mp-payment-status.js', () => ({ onRequestPost: vi.fn(() => new Response('ok')), onRequestGet: vi.fn(() => new Response('ok')) }));

const { default: worker } = await import('../worker.js');

function makeRequest(method, path, headers = {}) {
  return new Request(`https://parfumtrack.luccasramireziglesias.workers.dev${path}`, {
    method,
    headers,
  });
}

const env = { ASSETS: { fetch: vi.fn(() => new Response('asset')) } };
const ctx = {};

describe('worker router', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('routes POST /trial to trial handler', async () => {
    const resp = await worker.fetch(makeRequest('POST', '/trial'), env, ctx);
    expect(resp.status).toBe(200);
  });

  it('routes GET /backup to backup handler', async () => {
    const resp = await worker.fetch(makeRequest('GET', '/backup'), env, ctx);
    expect(resp.status).toBe(200);
  });

  it('returns 405 for GET on POST-only route', async () => {
    const resp = await worker.fetch(makeRequest('GET', '/trial'), env, ctx);
    expect(resp.status).toBe(405);
    const body = await resp.json();
    expect(body.ok).toBe(false);
    expect(body.error).toBe('Method not allowed');
    expect(resp.headers.get('Allow')).toContain('POST');
  });

  it('routes POST /mp-payment-status to POST handler', async () => {
    const resp = await worker.fetch(makeRequest('POST', '/mp-payment-status'), env, ctx);
    expect(resp.status).toBe(200);
  });

  it('returns 204 for OPTIONS preflight on API route', async () => {
    const resp = await worker.fetch(
      makeRequest('OPTIONS', '/trial', { Origin: 'https://parfumtrack.luccasramireziglesias.workers.dev' }),
      env, ctx,
    );
    expect(resp.status).toBe(204);
    expect(resp.headers.get('Access-Control-Allow-Origin')).toBe('https://parfumtrack.luccasramireziglesias.workers.dev');
  });

  it('blocks CORS for unknown origins', async () => {
    const resp = await worker.fetch(
      makeRequest('OPTIONS', '/trial', { Origin: 'https://evil.com' }),
      env, ctx,
    );
    expect(resp.status).toBe(204);
    expect(resp.headers.get('Access-Control-Allow-Origin')).toBe('null');
  });

  it('falls through to ASSETS for non-API routes', async () => {
    await worker.fetch(makeRequest('GET', '/index.html'), env, ctx);
    expect(env.ASSETS.fetch).toHaveBeenCalled();
  });

  it('returns 500 JSON on unhandled error', async () => {
    const badEnv = {
      ASSETS: { fetch: () => { throw new Error('boom'); } },
    };
    const resp = await worker.fetch(makeRequest('GET', '/nonexistent'), badEnv, ctx);
    expect(resp.status).toBe(500);
    const body = await resp.json();
    expect(body.ok).toBe(false);
    expect(body.error).toBe('Internal server error');
  });

  it('GET /health returns 200 when KV is available', async () => {
    const kvEnv = { ...env, PT_LICENSES: { get: vi.fn(async () => null) } };
    const resp = await worker.fetch(makeRequest('GET', '/health'), kvEnv, ctx);
    expect(resp.status).toBe(200);
    const body = await resp.json();
    expect(body.ok).toBe(true);
    expect(body.kv).toBe(true);
  });

  it('GET /health returns 503 when KV is missing', async () => {
    const resp = await worker.fetch(makeRequest('GET', '/health'), env, ctx);
    expect(resp.status).toBe(503);
    const body = await resp.json();
    expect(body.ok).toBe(false);
    expect(body.kv).toBe(false);
  });

  // /version estaba implementado y sincronizado por build.js, pero nunca
  // ruteado: caía en ASSETS.fetch() y devolvía 404, así que el chequeo de
  // actualizaciones de 17-auto-update.js nunca disparaba.
  it('GET /version devuelve la versión y NO cae en los assets', async () => {
    const resp = await worker.fetch(makeRequest('GET', '/version'), env, ctx);
    expect(resp.status).toBe(200);
    expect(env.ASSETS.fetch).not.toHaveBeenCalled();
    const body = await resp.json();
    expect(body.ok).toBe(true);
    expect(body.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(body.minVersion).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('GET /version responde igual sin KV: no depende de nada', async () => {
    // Lo pollea cada cliente cada 5 min. Si dependiera de KV, una caída de
    // KV se llevaría puesto el canal de actualizaciones.
    const resp = await worker.fetch(makeRequest('GET', '/version'), { ASSETS: env.ASSETS }, ctx);
    expect(resp.status).toBe(200);
  });

  it('POST /version devuelve 405 con Allow: GET', async () => {
    const resp = await worker.fetch(makeRequest('POST', '/version'), env, ctx);
    expect(resp.status).toBe(405);
    expect(resp.headers.get('Allow')).toContain('GET');
  });

  it('OPTIONS /version responde el preflight de CORS', async () => {
    const resp = await worker.fetch(
      makeRequest('OPTIONS', '/version', { Origin: 'https://parfumtrack.luccasramireziglesias.workers.dev' }),
      env, ctx,
    );
    expect(resp.status).toBe(204);
    expect(resp.headers.get('Access-Control-Allow-Origin'))
      .toBe('https://parfumtrack.luccasramireziglesias.workers.dev');
  });
});
