// Qué queda accesible desde el dominio público.
//
// Contexto (BUG-27): `assets.directory` es "." — la raíz del repo — así que por defecto
// wrangler sube TODO. La lista `assets.exclude` de wrangler.jsonc no es un campo válido:
// wrangler la ignoraba avisando "Unexpected fields found in assets field: exclude" en cada
// deploy, y nadie leía el log. Durante meses estuvieron públicos `AI/` (que documenta
// hallazgos de seguridad ABIERTOS), los reportes de auditoría, `tests/`, `CLAUDE.md` y toda
// la estrategia de marketing.
//
// El único mecanismo que funciona es `.assetsignore`. Este test reimplementa la lógica
// exacta de wrangler 3.90 (`createAssetIgnoreFunction` → paquete `ignore`) y exige que
// cada archivo que se subiría esté en la lista blanca de abajo. Si alguien agrega un
// documento interno a la raíz y se olvida de `.assetsignore`, este test falla.

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import path from 'path';
import ignoreFactory from 'ignore';

const root = path.join(import.meta.dirname, '..');

// Lo que el sitio necesita de verdad. Sale de las referencias reales en index.html,
// landing.html, manifest.json, STATIC_ASSETS de sw.js y los redirects de Mercado Pago.
const PUBLICO_ESPERADO = new Set([
  // App y landing
  'index.html', 'landing.html', 'sw.js', 'manifest.json', '_headers',
  // Legales (linkeados desde la app y la landing)
  'terminos.html', 'privacidad.html', 'dpa.html',
  // Post-pago: Mercado Pago redirige acá
  'checkout-success.html', 'checkout-pending.html',
  // Iconos y favicons (manifest + STATIC_ASSETS)
  'favicon.ico', 'favicon.svg', 'favicon-32.png', 'icon-192.png', 'icon-512.png',
  // Imágenes de la landing y Open Graph
  'og-image.jpg', 'bg-perfumes.jpg', 'demo.mp4',
  'screenshot-app.jpg', 'screenshot-app.webp',
  'screenshot-catalogo.jpg', 'screenshot-estadisticas.jpg',
  // Android App Links
  '.well-known/assetlinks.json',
]);

// Carpetas cuyo contenido entero es público a propósito.
// `omnibus/` es la app de recorridos: otra PWA servida por el mismo Worker
// en /omnibus/. Es pública entera a propósito — código de cliente, iconos y
// Leaflet vendorizado. No guarda nada sensible: los recorridos viven en el
// IndexedDB del teléfono y no hay endpoint de backend detrás.
const CARPETAS_PUBLICAS = ['fonts/', 'img/', 'omnibus/'];

/** Replica `createAssetIgnoreFunction()` de wrangler: lee .assetsignore y le suma su propio nombre. */
function matcherDeWrangler() {
  const p = path.join(root, '.assetsignore');
  const patrones = existsSync(p) ? readFileSync(p, 'utf8').split('\n') : [];
  patrones.push('.assetsignore');
  const ig = ignoreFactory().add(patrones);
  return (rel) => ig.test(rel).ignored;
}

/** Los archivos que wrangler subiría con la config actual. */
function archivosQueSeSuben() {
  const ignorado = matcherDeWrangler();
  const out = [];
  (function walk(dir) {
    for (const e of readdirSync(dir)) {
      const abs = path.join(dir, e);
      const rel = path.relative(root, abs);
      if (statSync(abs).isDirectory()) {
        if (ignorado(rel) || ignorado(rel + '/')) continue;
        walk(abs);
      } else if (!ignorado(rel)) {
        out.push(rel);
      }
    }
  })(root);
  return out;
}

const subidos = archivosQueSeSuben();
const esPublicoPermitido = (f) =>
  PUBLICO_ESPERADO.has(f) || CARPETAS_PUBLICAS.some((c) => f.startsWith(c));

describe('lo que se sirve públicamente', () => {
  it('no sube ningún archivo fuera de la lista blanca', () => {
    const inesperados = subidos.filter((f) => !esPublicoPermitido(f));
    expect(
      inesperados,
      'Estos archivos quedarían públicos en el dominio. Si es a propósito, agregalos a ' +
        'PUBLICO_ESPERADO; si no, sumalos a .assetsignore:\n  ' + inesperados.join('\n  ')
    ).toEqual([]);
  });

  it.each([
    ['AI/', 'documenta hallazgos de seguridad abiertos'],
    ['tests/', 'describe los vectores de ataque y los invariantes'],
    ['src/', 'fuente de la app'],
    ['functions/', 'código del backend'],
    ['scripts/', 'scripts de build'],
    ['android/', 'proyecto Android'],
    ['PLAYSTORE/', 'material de la ficha de Play Store'],
    ['standalone/', 'reportes y planes internos'],
  ])('no sube %s (%s)', (prefijo) => {
    expect(subidos.filter((f) => f.startsWith(prefijo))).toEqual([]);
  });

  it.each([
    'CLAUDE.md',
    'wrangler.jsonc',
    'wrangler.staging.jsonc',
    'package.json',
    'worker.js',
    'test-payment-flow.mjs',
    'MARKETING-PLAN.md',
    'MARKETING-SEMANA-1.md',
    'ADS-META-IG.json',
    'ADS-META-IG-BRIEF.md',
    'MASTER_CREATIVE_BRIEF_PARFUMTRACK.md',
    'PLANES_FINALES.md',
    'AUDIT_LEGAL.html',
    'AUDITORIA_LEGAL_V2.html',
    'COBERTURA_LEGAL.html',
    'plan-lanzamiento-30dias.html',
    'planes-para-cliente.html',
  ])('no sube %s', (f) => {
    expect(subidos).not.toContain(f);
  });

  it('sí sube lo que la app necesita', () => {
    for (const f of ['index.html', 'landing.html', 'sw.js', 'manifest.json',
                     'terminos.html', 'privacidad.html', '_headers',
                     'checkout-success.html', 'icon-192.png']) {
      expect(subidos, `${f} tiene que ser público`).toContain(f);
    }
  });

  it('sí sube las fuentes que precachea el Service Worker', () => {
    const sw = readFileSync(path.join(root, 'sw.js'), 'utf8');
    const bloque = sw.slice(sw.indexOf('STATIC_ASSETS'), sw.indexOf(']', sw.indexOf('STATIC_ASSETS')));
    for (const m of bloque.matchAll(/"\/([^"]+\.(?:woff2|css|png|ico|svg|json|html))"/g)) {
      expect(subidos, `${m[1]} está en STATIC_ASSETS pero no se sube`).toContain(m[1]);
    }
  });
});

describe('la config no vuelve a confiar en un campo que no existe', () => {
  it.each(['wrangler.jsonc', 'wrangler.staging.jsonc'])(
    '%s no usa assets.exclude (wrangler lo ignora en silencio)',
    (archivo) => {
      const cfg = readFileSync(path.join(root, archivo), 'utf8');
      const i = cfg.indexOf('"assets"');
      const bloque = cfg.slice(i, cfg.indexOf('}', i));
      expect(bloque).not.toMatch(/"exclude"\s*:/);
    }
  );

  it('.assetsignore existe y explica por qué es el único mecanismo', () => {
    const txt = readFileSync(path.join(root, '.assetsignore'), 'utf8');
    expect(txt).toMatch(/exclude/);
    expect(txt).toMatch(/AI\//);
  });
});
