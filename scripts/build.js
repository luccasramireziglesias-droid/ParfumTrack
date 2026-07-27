#!/usr/bin/env node
// Reconstructs index.html from the modular sources under src/.
// Pure string concatenation, in the exact order the original file had —
// no ES modules, no bundler, so every onclick="App.metodo()" in the
// generated HTML keeps working exactly as before.
const fs = require('fs');
const path = require('path');

// Read version from package.json
const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
const version = pkg.version;

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');

function readOrdered(dir) {
  return fs.readdirSync(dir)
    .filter(f => !f.startsWith('.'))
    .sort()
    .map(f => fs.readFileSync(path.join(dir, f), 'utf8'));
}

let html = fs.readFileSync(path.join(SRC, 'index.template.html'), 'utf8');

// Inyectar versión
html = html.replace('/*PT:VERSION*/', () => version);

const css = readOrdered(path.join(SRC, 'styles')).join('');
html = html.replace('/*PT:CSS*/', () => css);

const screensDir = path.join(SRC, 'screens');
for (const file of fs.readdirSync(screensDir)) {
  const id = file.replace(/\.html$/, '');
  const marker = `<!--PT:SCREEN:${id}-->`;
  if (!html.includes(marker)) throw new Error(`build.js: no placeholder for screen "${id}" in index.template.html`);
  const content = fs.readFileSync(path.join(screensDir, file), 'utf8');
  html = html.replace(marker, () => content);
}

const db = fs.readFileSync(path.join(SRC, 'db.js'), 'utf8');
html = html.replace('/*PT:DB*/', () => db);

const encryption = fs.readFileSync(path.join(SRC, 'app', '15-encryption.js'), 'utf8');
html = html.replace('/*PT:ENCRYPTION*/', () => encryption);

// Read all app files EXCEPT 15-encryption.js
const appFiles = fs.readdirSync(path.join(SRC, 'app'))
  .filter(f => !f.startsWith('.') && f !== '15-encryption.js')
  .sort()
  .map(f => fs.readFileSync(path.join(SRC, 'app', f), 'utf8'));
const app = appFiles.join('');
html = html.replace('/*PT:APP*/', () => app);

if (/PT:(CSS|DB|APP|ENCRYPTION|VERSION)|PT:SCREEN:/.test(html)) {
  throw new Error('build.js: unresolved placeholder remains in generated output');
}

fs.writeFileSync(path.join(ROOT, 'index.html'), html);
console.log(`build.js: wrote index.html (${html.length} chars) — version ${version}`);

// La versión vive en package.json y se propaga desde acá. Antes había tres
// copias a mano: sw.js decía 1.7.0, functions/version.js decía 1.1.0 (más
// vieja que la app, así que el chequeo de actualizaciones nunca disparaba).
function syncVersion(file, regex, replacement) {
  const full = path.join(ROOT, file);
  const before = fs.readFileSync(full, 'utf8');
  if (!regex.test(before)) throw new Error(`build.js: no encontré la versión en ${file}`);
  const after = before.replace(regex, replacement);
  if (after !== before) {
    fs.writeFileSync(full, after);
    console.log(`build.js: sincronizó ${file} a ${version}`);
  }
}

syncVersion('sw.js', /const APP_VERSION = "[^"]*";/, `const APP_VERSION = "${version}";`);
syncVersion('functions/version.js', /const version = '[^']*';/, `const version = '${version}';`);
