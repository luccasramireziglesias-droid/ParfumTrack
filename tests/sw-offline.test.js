// Ciclo 5 Omega — protege la promesa "funciona sin internet" a nivel de
// configuración del Service Worker. Corre en CI (Vitest) y falla si una
// regresión rompe el precache o el fallback offline de navegación.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

const sw = readFileSync(path.join(import.meta.dirname, '..', 'sw.js'), 'utf8');

describe('Service Worker — garantía offline', () => {
  it('precachea los assets críticos del app-shell', () => {
    // Extraer el array STATIC_ASSETS
    const m = sw.match(/const STATIC_ASSETS\s*=\s*\[([\s\S]*?)\]/);
    expect(m, 'STATIC_ASSETS debe existir').toBeTruthy();
    const lista = m[1];
    for (const critico of ['"/"', '"/index.html"', '/manifest.json', 'fonts.css']) {
      expect(lista, `STATIC_ASSETS debe incluir ${critico}`).toContain(critico);
    }
  });

  it('instala precacheando (addAll) y toma control (skipWaiting)', () => {
    expect(sw).toMatch(/addEventListener\(["']install["']/);
    expect(sw).toContain('addAll(STATIC_ASSETS)');
    expect(sw).toContain('skipWaiting');
  });

  it('limpia caches de versiones viejas en activate', () => {
    expect(sw).toMatch(/addEventListener\(["']activate["']/);
    expect(sw).toContain('caches.delete');
    expect(sw).toContain('clients.claim');
  });

  it('sirve la navegación desde cache cuando la red falla (offline)', () => {
    // El handler de navigate existe y hay un fallback a cache ante fallo de red
    expect(sw).toMatch(/request\.mode\s*===\s*["']navigate["']/);
    // .catch(...) que recurre a caches.match("/") o "/index.html"
    expect(sw).toMatch(/\.catch\([\s\S]{0,40}caches\.match\(["']\//);
  });

  it('el cache está versionado (invalida al cambiar de versión)', () => {
    expect(sw).toMatch(/CACHE_NAME\s*=\s*`parfumtrack-v\$\{APP_VERSION\}`/);
  });
});
