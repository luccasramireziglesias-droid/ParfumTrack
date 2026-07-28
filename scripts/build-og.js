#!/usr/bin/env node
// Rasteriza scripts/og-image.html a og-image.png (1200x630).
//
// Se renderiza en Chromium en vez de convertir el SVG: el PNG anterior se
// había generado con un rasterizador que no resolvía las fuentes locales y
// terminó con las dos líneas del titular superpuestas.
//
// Uso: node scripts/build-og.js
const path = require('path');
const http = require('http');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const TIPOS = { '.html': 'text/html', '.css': 'text/css', '.woff2': 'font/woff2', '.png': 'image/png' };

// Servidor mínimo: las fuentes se piden con rutas absolutas (/fonts/…), así
// que file:// no alcanza.
function servir() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      const rel = decodeURIComponent(req.url.split('?')[0]);
      const full = path.join(ROOT, rel === '/' ? 'scripts/og-image.html' : rel);
      if (!full.startsWith(ROOT) || !fs.existsSync(full)) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'Content-Type': TIPOS[path.extname(full)] || 'application/octet-stream' });
      fs.createReadStream(full).pipe(res);
    });
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
}

(async () => {
  const { chromium } = require('@playwright/test');
  const srv = await servir();
  const puerto = srv.address().port;
  // Mismo binario que usa la config de Playwright del repo
  const cfg = require(path.join(ROOT, 'playwright.config.js'));
  const navegador = await chromium.launch({
    executablePath: cfg.use?.launchOptions?.executablePath,
  });
  try {
    const page = await navegador.newPage({
      viewport: { width: 1200, height: 630 },
      deviceScaleFactor: 1,
    });
    await page.goto(`http://127.0.0.1:${puerto}/scripts/og-image.html`, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    // JPEG y no PNG: son degradés, y WhatsApp deja de mostrar la preview
    // grande cuando la imagen se pasa de ~300 KB.
    const salida = path.join(ROOT, 'og-image.jpg');
    await page.screenshot({ path: salida, type: 'jpeg', quality: 92 });
    const kb = (fs.statSync(salida).size / 1024).toFixed(0);
    console.log(`build-og.js: og-image.jpg escrito (1200x630, ${kb} KB)`);
  } finally {
    await navegador.close();
    srv.close();
  }
})().catch((e) => { console.error('build-og.js falló:', e.message); process.exit(1); });
