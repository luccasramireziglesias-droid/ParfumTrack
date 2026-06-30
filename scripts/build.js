#!/usr/bin/env node
// Reconstructs index.html from the modular sources under src/.
// Pure string concatenation, in the exact order the original file had —
// no ES modules, no bundler, so every onclick="App.metodo()" in the
// generated HTML keeps working exactly as before.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');

function readOrdered(dir) {
  return fs.readdirSync(dir)
    .filter(f => !f.startsWith('.'))
    .sort()
    .map(f => fs.readFileSync(path.join(dir, f), 'utf8'));
}

let html = fs.readFileSync(path.join(SRC, 'index.template.html'), 'utf8');

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

const app = readOrdered(path.join(SRC, 'app')).join('');
html = html.replace('/*PT:APP*/', () => app);

if (/PT:(CSS|DB|APP)|PT:SCREEN:/.test(html)) {
  throw new Error('build.js: unresolved placeholder remains in generated output');
}

fs.writeFileSync(path.join(ROOT, 'index.html'), html);
console.log(`build.js: wrote index.html (${html.length} chars)`);
