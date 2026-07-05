#!/usr/bin/env node

// Build script para landing.html
// Lee src/landing/landing.template.html y genera landing.html
// En el futuro: separar en sections/ y styles/

const fs = require('fs');
const path = require('path');

const templatePath = path.join(__dirname, '..', 'src', 'landing', 'landing.template.html');
const outputPath = path.join(__dirname, '..', 'landing.html');

try {
  // Lee el template
  const content = fs.readFileSync(templatePath, 'utf-8');

  // Por ahora: copia directa (estructura modular viene después)
  // TODO: separar en sections, estilos, scripts
  fs.writeFileSync(outputPath, content, 'utf-8');

  console.log('✅ landing.html regenerado desde src/landing/');
} catch (err) {
  console.error('❌ Error en build-landing.js:', err.message);
  process.exit(1);
}
