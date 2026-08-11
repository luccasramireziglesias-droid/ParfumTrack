#!/usr/bin/env node
// Propaga la versión de package.json a la app de recorridos.
//
// Igual que en ParfumTrack, la versión vive en UN solo lugar. Acá hay dos
// consumidores: el <meta app-version> del index y el APP_VERSION del
// service worker — ese último es el que nombra la caché, así que si no se
// actualiza, un usuario con la app instalada se queda con el código viejo
// para siempre.
//
// Los reemplazos son idempotentes (regex sobre la línea marcada), así que
// correr el script dos veces seguidas no rompe nada.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OMNIBUS = path.join(ROOT, 'omnibus');
const version = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;

const REEMPLAZOS = [
  {
    archivo: 'index.html',
    re: /<meta name="app-version" content="[^"]*"><!-- OM:VERSION -->/,
    nuevo: `<meta name="app-version" content="${version}"><!-- OM:VERSION -->`,
  },
  {
    archivo: 'sw.js',
    re: /const APP_VERSION = '[^']*'; \/\/ OM:VERSION/,
    nuevo: `const APP_VERSION = '${version}'; // OM:VERSION`,
  },
];

for (const { archivo, re, nuevo } of REEMPLAZOS) {
  const p = path.join(OMNIBUS, archivo);
  const antes = fs.readFileSync(p, 'utf8');
  if (!re.test(antes)) {
    throw new Error(`build-omnibus: no se encontró la marca de versión en omnibus/${archivo}`);
  }
  const despues = antes.replace(re, nuevo);
  if (despues !== antes) fs.writeFileSync(p, despues);
}

// El service worker precachea una lista fija de archivos. Si alguien
// agrega un módulo a omnibus/js/ y se olvida de sumarlo a ESTATICOS, la
// app abre bien online y explota sin señal — el peor momento posible para
// enterarse. Que falle el build es mucho más barato.
const sw = fs.readFileSync(path.join(OMNIBUS, 'sw.js'), 'utf8');
const enDisco = fs.readdirSync(path.join(OMNIBUS, 'js')).filter(f => f.endsWith('.js')).sort();
const faltantes = enDisco.filter(f => !sw.includes(`./js/${f}`));
if (faltantes.length) {
  throw new Error(`build-omnibus: faltan en ESTATICOS de omnibus/sw.js: ${faltantes.join(', ')}`);
}

// Y al revés: un archivo listado que ya no existe hace que su c.add() falle
// silenciosamente en cada install.
const listados = [...sw.matchAll(/'\.\/js\/([^']+)'/g)].map(m => m[1]);
const sobrantes = listados.filter(f => !enDisco.includes(f));
if (sobrantes.length) {
  throw new Error(`build-omnibus: omnibus/sw.js lista archivos que no existen: ${sobrantes.join(', ')}`);
}

console.log(`build-omnibus: versión ${version} propagada, ${enDisco.length} módulos en el precache`);
