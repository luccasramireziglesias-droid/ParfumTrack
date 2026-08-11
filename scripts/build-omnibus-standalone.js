#!/usr/bin/env node
// Arma UN solo archivo HTML con la app de recorridos entera adentro:
// CSS, los 15 módulos JS, Leaflet y las imágenes como data URI.
//
// Para qué: poder mandar la app por WhatsApp o dejarla en el teléfono sin
// servidor, sin instalar nada y sin depender de un deploy.
//
// Qué se pierde en esta versión y por qué:
//   · El service worker no existe. No se puede registrar desde un único
//     archivo, y menos desde file://. Sin él no hay precache ni se sirven
//     los tiles guardados: la app necesita internet para el mapa.
//   · Abierto con file://, el navegador NO da geolocalización (Chrome exige
//     https o localhost). Grabar y manejar quedan sin GPS. Todo lo demás
//     —dibujar, importar, estudiar, ver recorridos— anda igual.
// La versión servida en /omnibus/ no tiene ninguna de las dos limitaciones.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OM = path.join(ROOT, 'omnibus');
const leer = (...p) => fs.readFileSync(path.join(OM, ...p), 'utf8');

const version = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;

/** Un archivo binario como data URI. */
function dataUri(rel, mime) {
  return `data:${mime};base64,${fs.readFileSync(path.join(OM, rel)).toString('base64')}`;
}

// ── CSS ────────────────────────────────────────────────────────
// leaflet.css apunta a images/*.png con rutas relativas que en un archivo
// suelto no existen. Se reemplazan por data URI (son cuatro PNG chicos).
let leafletCss = leer('vendor', 'leaflet.css');
for (const img of ['layers.png', 'layers-2x.png', 'marker-icon.png']) {
  leafletCss = leafletCss.split(`url(images/${img})`).join(`url(${dataUri(`vendor/images/${img}`, 'image/png')})`);
}
const css = leafletCss + '\n' + leer('css', 'app.css');

// ── JS ─────────────────────────────────────────────────────────
const modulos = fs.readdirSync(path.join(OM, 'js')).filter(f => f.endsWith('.js')).sort();
// El orden importa y es el del index.html: cada módulo usa los globales que
// definieron los anteriores. Ordenar alfabéticamente funciona porque están
// numerados justamente para eso; si alguien agrega un módulo sin número, acá
// se rompe y es mejor que se note en el build.
const sinNumero = modulos.filter(f => !/^\d\d-/.test(f));
if (sinNumero.length) {
  throw new Error(`build-omnibus-standalone: módulos sin número de orden: ${sinNumero.join(', ')}`);
}
const js = modulos.map(f => `\n/* ── ${f} ─────────────────────── */\n${leer('js', f)}`).join('\n');
const leafletJs = leer('vendor', 'leaflet.js');

// ── HTML ───────────────────────────────────────────────────────
// Se parte del index real para no mantener dos copias de la interfaz: se le
// sacan los <link> y los <script> con src, y se le meten los contenidos.
let html = leer('index.html');
const cuerpo = html.slice(html.indexOf('<body'), html.indexOf('</body>'));
const contenido = cuerpo
  .replace(/^<body[^>]*>/, '')
  .replace(/<script src="[^"]*"><\/script>\s*/g, '');

const salida = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, maximum-scale=1">
<title>Recorridos — guía GPS de líneas de ómnibus</title>
<meta name="theme-color" content="#0f0f1a">
<meta name="color-scheme" content="dark">
<meta name="app-version" content="${version}">
<link rel="icon" href="${'data:image/svg+xml;base64,' + Buffer.from(leer('icono.svg')).toString('base64')}">
<link rel="apple-touch-icon" href="${dataUri('icon-192.png', 'image/png')}">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<style>
${css}
</style>
</head>
<body data-pantalla="lista">
${contenido}
<script>
${leafletJs}
</script>
<script>
${js}
</script>
</body>
</html>
`;

const destino = path.join(OM, 'recorridos-standalone.html');
fs.writeFileSync(destino, salida);
const kb = (Buffer.byteLength(salida) / 1024).toFixed(0);
console.log(`build-omnibus-standalone: ${path.relative(ROOT, destino)} (${kb} KB, ${modulos.length} módulos) — versión ${version}`);
