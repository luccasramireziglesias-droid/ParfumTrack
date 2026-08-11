#!/usr/bin/env node
// Arma `dist-recorridos/` y su .zip: la app de recorridos lista para arrastrar
// a Netlify Drop, Cloudflare Pages o cualquier hosting estático.
//
// Por qué existe además del standalone: acá la app queda servida por https con
// su propio origen, así que recupera las dos cosas que el archivo suelto no
// puede tener — service worker (precache y mapas offline) y geolocalización
// confiable. Es la versión para usar arriba del ómnibus.
//
// La carpeta sale con la app en la RAÍZ (no bajo /omnibus/), porque en un
// hosting propio no hay nada más de qué separarla.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const OM = path.join(ROOT, 'omnibus');
const DIST = path.join(ROOT, 'dist-recorridos');

// Lo que NO va al hosting: documentación interna y el bundle de un archivo,
// que es un producto aparte y pesa 300 KB al pedo dentro de la carpeta.
const EXCLUIR = new Set(['README.md', 'recorridos-standalone.html']);

fs.rmSync(DIST, { recursive: true, force: true });

function copiar(desde, hasta) {
  fs.mkdirSync(hasta, { recursive: true });
  for (const entrada of fs.readdirSync(desde, { withFileTypes: true })) {
    if (EXCLUIR.has(entrada.name)) continue;
    const o = path.join(desde, entrada.name);
    const d = path.join(hasta, entrada.name);
    if (entrada.isDirectory()) copiar(o, d);
    else fs.copyFileSync(o, d);
  }
}
copiar(OM, DIST);

// Cabeceras para el hosting. Netlify y Cloudflare Pages leen `_headers` de la
// raíz del sitio.
//
// 🔴 Acá NO se restringe `geolocation`. En el Worker de ParfumTrack hay que
// reescribirlo porque el `_headers` global lo apaga; en un hosting propio el
// default ya permite el propio origen y lo único que se puede hacer es
// romperlo. Si alguien agrega `geolocation=()` "por prolijidad", la app deja
// de funcionar entera.
fs.writeFileSync(path.join(DIST, '_headers'), `/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  X-Frame-Options: DENY
  Permissions-Policy: geolocation=(self), screen-wake-lock=(self), camera=(), microphone=(), payment=()
  Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://tile.openstreetmap.org https://a.basemaps.cartocdn.com https://b.basemaps.cartocdn.com https://c.basemaps.cartocdn.com https://d.basemaps.cartocdn.com; connect-src 'self' https://tile.openstreetmap.org https://a.basemaps.cartocdn.com https://b.basemaps.cartocdn.com https://c.basemaps.cartocdn.com https://d.basemaps.cartocdn.com https://overpass-api.de https://overpass.kumi.systems https://overpass.private.coffee https://nominatim.openstreetmap.org; font-src 'self'; worker-src 'self'; manifest-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; object-src 'none'

/sw.js
  Cache-Control: no-cache, no-store, must-revalidate
  Service-Worker-Allowed: /

/index.html
  Cache-Control: no-cache, must-revalidate
`);

fs.writeFileSync(path.join(DIST, 'LEEME.txt'), `Recorridos — guía GPS de líneas de ómnibus

CÓMO PUBLICARLA (30 segundos, gratis, sin cuenta ni tarjeta)

  1. Entrá a  https://app.netlify.com/drop
  2. Arrastrá esta carpeta entera (o el .zip) a la página.
  3. Te da una dirección https. Esa es tu app.

  Alternativa: Cloudflare Pages → Create a project → Upload assets.

EN EL TELÉFONO

  Abrí la dirección en Chrome y elegí "Agregar a pantalla de inicio".
  Queda como una app: ícono propio, sin barra del navegador.

  La primera vez te va a pedir permiso de ubicación. Dale que sí, o el modo
  manejo no puede guiarte.

ANTES DE SALIR A LA CALLE

  · Cargá un recorrido (grabalo manejando, dibujalo o importalo).
  · Entrá al recorrido y tocá "Mapa offline" con wifi: baja las calles para
    que funcione sin señal.
  · Probalo con Ajustes → "Probar un recorrido sin GPS (demo)": recorre el
    trazado solo y vas a escuchar los avisos donde van a sonar de verdad.

Los recorridos se guardan en el teléfono, no en ningún servidor. Si cambiás de
teléfono, exportalos desde Detalle → Más → Exportar.
`);

// Zip, para poder mandarla por WhatsApp o subirla de una.
const zip = path.join(ROOT, 'recorridos-para-subir.zip');
fs.rmSync(zip, { force: true });
execFileSync('zip', ['-r', '-q', zip, path.basename(DIST)], { cwd: ROOT });

function pesar(dir) {
  let n = 0, bytes = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { const r = pesar(p); n += r.n; bytes += r.bytes; }
    else { n++; bytes += fs.statSync(p).size; }
  }
  return { n, bytes };
}
const { n, bytes } = pesar(DIST);
console.log(`build-omnibus-dist: ${n} archivos, ${(bytes / 1024).toFixed(0)} KB`);
console.log(`  carpeta → ${path.relative(ROOT, DIST)}/`);
console.log(`  zip     → ${path.relative(ROOT, zip)} (${(fs.statSync(zip).size / 1024).toFixed(0)} KB)`);
