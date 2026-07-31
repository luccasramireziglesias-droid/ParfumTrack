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
    // /trial está en CSRF_ROUTES: sin el header devuelve 403 antes de llegar
    // al handler
    const resp = await worker.fetch(
      makeRequest('POST', '/trial', { 'X-CSRF-Token': 'a'.repeat(64) }), env, ctx,
    );
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

  // ── CSRF ──────────────────────────────────────────────────────────────
  // La infraestructura estaba desde julio pero el router no bloqueaba nada:
  // "validation enforced at application level, not blocking requests yet"
  const TOKEN_OK = 'a'.repeat(64);

  it('POST /trial sin X-CSRF-Token devuelve 403', async () => {
    const resp = await worker.fetch(makeRequest('POST', '/trial'), env, ctx);
    expect(resp.status).toBe(403);
  });

  it('POST /trial con un token bien formado pasa', async () => {
    const resp = await worker.fetch(
      makeRequest('POST', '/trial', { 'X-CSRF-Token': TOKEN_OK }), env, ctx,
    );
    expect(resp.status).toBe(200);
  });

  it('un token con formato inválido no alcanza', async () => {
    const resp = await worker.fetch(
      makeRequest('POST', '/validate-license', { 'X-CSRF-Token': 'no-soy-hex' }), env, ctx,
    );
    expect(resp.status).toBe(403);
  });

  it.each(['/trial', '/validate-license', '/backup', '/sync'])(
    'POST %s exige CSRF', async (path) => {
      expect((await worker.fetch(makeRequest('POST', path), env, ctx)).status).toBe(403);
    },
  );

  it('POST /mp-create-preference NO exige CSRF: lo llama la landing', async () => {
    // La landing es una página estática sin el token. Exigirlo ahí rompe el
    // checkout, que es el camino de conversión principal.
    const resp = await worker.fetch(makeRequest('POST', '/mp-create-preference'), env, ctx);
    expect(resp.status).toBe(200);
  });

  it('el webhook de Mercado Pago no exige CSRF: no lo llama un browser', async () => {
    const resp = await worker.fetch(makeRequest('POST', '/mp-webhook'), env, ctx);
    expect(resp.status).toBe(200);
  });

  // ── KV real: rechaza expirationTtl < 60 ───────────────────────────────
  // El mock de antes aceptaba cualquier TTL, así que nadie vio que el
  // limitador de concurrencia usaba 5 y lanzaba en TODAS las requests. Con
  // el catch fail-closed, eso devolvía 503 y tumbaba registro, licencias y
  // pagos. Este mock se comporta como el KV de verdad.
  const kvRealista = () => {
    const store = new Map();
    return {
      ASSETS: env.ASSETS,
      PT_LICENSES: {
        get: vi.fn(async (k) => store.get(k) ?? null),
        put: vi.fn(async (k, v, opts) => {
          if (opts && opts.expirationTtl !== undefined && opts.expirationTtl < 60) {
            throw new Error(`Invalid expiration_ttl of ${opts.expirationTtl}. Expiration TTL must be at least 60.`);
          }
          store.set(k, v);
        }),
        delete: vi.fn(async (k) => { store.delete(k); }),
      },
    };
  };

  it.each(['/trial', '/validate-license', '/backup', '/sync'])(
    'con un KV que valida el TTL, %s sigue respondiendo', async (path) => {
      const e = kvRealista();
      const resp = await worker.fetch(
        makeRequest('POST', path, { 'X-CSRF-Token': TOKEN_OK }), e, { waitUntil: () => {} },
      );
      expect(resp.status, `${path} devolvió ${resp.status}`).toBe(200);
    },
  );

  it('ningún put del router usa un TTL que KV rechace', async () => {
    const e = kvRealista();
    await worker.fetch(
      makeRequest('POST', '/trial', { 'X-CSRF-Token': TOKEN_OK }), e, { waitUntil: () => {} },
    );
    for (const [, , opts] of e.PT_LICENSES.put.mock.calls) {
      if (opts && opts.expirationTtl !== undefined) {
        expect(opts.expirationTtl, 'KV exige expirationTtl >= 60').toBeGreaterThanOrEqual(60);
      }
    }
  });

  it('un fallo del limitador de concurrencia NO tumba la ruta', async () => {
    // Fail-open a propósito: es un extra sobre el límite global. Un bug acá
    // no puede dejar a nadie sin registrarse ni sin pagar.
    const e = {
      ASSETS: env.ASSETS,
      PT_LICENSES: {
        get: vi.fn(async (k) => (k.startsWith('conn_') ? (() => { throw new Error('boom'); })() : null)),
        put: vi.fn(async () => {}),
        delete: vi.fn(async () => {}),
      },
    };
    const resp = await worker.fetch(
      makeRequest('POST', '/trial', { 'X-CSRF-Token': TOKEN_OK }), e, { waitUntil: () => {} },
    );
    expect(resp.status).toBe(200);
  });

  // ── Fail-closed cuando KV se cae ──────────────────────────────────────
  const kvRoto = {
    ...env,
    PT_LICENSES: { get: vi.fn(async () => { throw new Error('KV down'); }), put: vi.fn(), delete: vi.fn() },
  };

  it('con KV caído, una ruta crítica corta con 503 (fail-closed)', async () => {
    const resp = await worker.fetch(
      makeRequest('POST', '/trial', { 'X-CSRF-Token': TOKEN_OK }), kvRoto, ctx,
    );
    expect(resp.status).toBe(503);
    expect(resp.headers.get('Retry-After')).toBe('30');
  });

  it('con KV caído, una ruta NO crítica sigue funcionando (fail-open)', async () => {
    // Fail-closed global convertiría cualquier caída de KV en una caída
    // total de la app
    const resp = await worker.fetch(makeRequest('POST', '/send-email'), kvRoto, ctx);
    expect(resp.status).toBe(200);
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

// ── /force-update ─────────────────────────────────────────────────────────────
// Escotilla de emergencia para assets viejos o un SW envenenado. Tuvo
// `Clear-Site-Data: "cache", "storage"`, y "storage" borra IndexedDB (todo el historial
// de ventas) y localStorage (licencia, sal del cifrado, perfil, PIN) — mientras la página
// decía solo "Los caches fueron limpiados". Ver AI/BUG_HISTORY.md §BUG-29.
describe('/force-update no puede borrar los datos del usuario', () => {
  const pedir = () => worker.fetch(makeRequest('GET', '/force-update'), env, ctx);

  it('🔴 el Clear-Site-Data NO incluye "storage"', async () => {
    const csd = (await pedir()).headers.get('Clear-Site-Data');
    expect(
      csd,
      '"storage" borra IndexedDB Y localStorage: historial de ventas, licencia y la sal ' +
        'del cifrado. Y no se puede advertir en esa página, porque la cabecera se ejecuta ' +
        'al recibirla. IndexedDB no guarda assets: borrarlo nunca arregló un cache viejo.'
    ).not.toMatch(/storage/);
  });

  it('sigue limpiando el cache, que es para lo que existe', async () => {
    expect((await pedir()).headers.get('Clear-Site-Data')).toMatch(/"cache"/);
  });

  it('desregistra el Service Worker desde el cliente (eso sí destraba un SW envenenado)', async () => {
    const html = await (await pedir()).text();
    expect(html).toContain('serviceWorker.getRegistrations');
    expect(html).toContain('unregister');
    expect(html).toContain('caches.delete');
  });

  it('le dice al usuario que sus datos siguen ahí', async () => {
    const html = await (await pedir()).text();
    expect(html).toMatch(/no se tocaron/i);
  });

  it('no se cachea', async () => {
    expect((await pedir()).headers.get('Cache-Control')).toMatch(/no-store/);
  });
});
