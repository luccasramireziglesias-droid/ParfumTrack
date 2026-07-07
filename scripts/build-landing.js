#!/usr/bin/env node

// Build script para landing.html
// Concatena sections/ + styles/ desde src/landing/ y genera landing.html

const fs = require('fs');
const path = require('path');

const srcDir = path.join(__dirname, '..', 'src', 'landing');
const outputPath = path.join(__dirname, '..', 'landing.html');

const stylesDir = path.join(srcDir, 'styles');
const sectionsDir = path.join(srcDir, 'sections');

// CSS order
const cssFiles = [
  '00-base.css',
  '01-announce-bar.css',
  '02-nav.css',
  '03-hero.css',
  '04-demo.css',
  '05-sections-common.css',
  '06-problem-solution.css',
  '07-feature-catalog.css',
  '08-how-it-works.css',
  '09-comparison.css',
  '10-testimonials.css',
  '11-pricing.css',
  '12-faq.css',
  '13-cta-footer.css',
  '14-animations.css',
  '15-responsive.css',
];

// HTML sections order
const sectionFiles = [
  '01-header.html',
  '02-hero.html',
  '03-demo.html',
  '04-problem.html',
  '05-beneficios.html',
  '06-funciones.html',
  '07-features.html',
  '08-howitworks.html',
  '09-pricing.html',
  '10-faq.html',
  '11-cta.html',
  '12-footer.html',
  '13-modals.html',
  '14-scripts.html',
];

try {
  // DOCTYPE + html opening
  let html = '<!DOCTYPE html>\n<html lang="es">\n<head>\n<meta charset="UTF-8">\n';
  html += '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n';
  html += '<title>Parfum Track — Organizá tu negocio de perfumes desde el celular</title>\n';
  html += '<meta name="description" content="App gratis para revendedores de perfumes en Argentina, Uruguay, Colombia y México. Controlá ventas, cuotas, stock y ganancia real desde el celular. Sin descargar, funciona offline.">\n';
  html += '<meta property="og:title" content="Parfum Track — Dejá de adivinar cuánto ganás">\n';
  html += '<meta property="og:description" content="Parfum Track calcula tu ganancia real, avisa de cobros pendientes y organiza tu negocio de perfumes. Empezá gratis, sin tarjeta, sin compromiso.">\n';
  html += '<meta property="og:image" content="https://parfumtrack.luccasramireziglesias.workers.dev/icon-512.png">\n';
  html += '<meta property="og:type" content="website">\n';
  html += '<meta property="og:url" content="https://parfumtrack.luccasramireziglesias.workers.dev/landing.html">\n';
  html += '<meta name="twitter:card" content="summary_large_image">\n';
  html += '<meta name="twitter:title" content="Parfum Track — Dejá de adivinar cuánto ganás">\n';
  html += '<meta name="twitter:description" content="App para revendedores de perfumes. Ventas, cuotas, stock y cobros en tu celular. Gratis para siempre.">\n';
  html += '<meta name="twitter:image" content="https://parfumtrack.luccasramireziglesias.workers.dev/icon-512.png">\n';
  html += '<link rel="canonical" href="https://parfumtrack.luccasramireziglesias.workers.dev/landing.html">\n';
  html += '<link rel="icon" href="/favicon.ico" sizes="16x16 32x32 48x48">\n';
  html += '<link rel="icon" type="image/svg+xml" href="/favicon.svg">\n';
  html += '<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png">\n';
  html += '<link rel="icon" type="image/png" sizes="192x192" href="/icon-192.png">\n';
  html += '<link rel="apple-touch-icon" href="/icon-192.png">\n';
  html += '<script type="application/ld+json">{"@context":"https://schema.org","@type":"SoftwareApplication","name":"Parfum Track","applicationCategory":"BusinessApplication","operatingSystem":"Any","offers":{"@type":"Offer","price":"0","priceCurrency":"USD","availability":"https://schema.org/InStock"},"description":"App para revendedores de perfumes. Control de ventas, cuotas, stock y estadísticas desde el celular.","url":"https://parfumtrack.luccasramireziglesias.workers.dev/"}</script>\n';
  html += '<script type="application/ld+json">{"@context":"https://schema.org","@type":"FAQPage","mainEntity":[{"@type":"Question","name":"¿Necesito descargar algo?","acceptedAnswer":{"@type":"Answer","text":"No. Parfum Track es una PWA que funciona desde el navegador. Entrás al link y en segundos estás usando la app."}},{"@type":"Question","name":"¿Funciona sin internet?","acceptedAnswer":{"@type":"Answer","text":"Sí. Podés registrar ventas, ver estadísticas y gestionar cobros sin conexión."}},{"@type":"Question","name":"¿El plan Free es realmente gratis para siempre?","acceptedAnswer":{"@type":"Answer","text":"Sí, completamente. Sin vencimiento ni tarjeta de crédito. Ventas ilimitadas, stock, ganancia y cobros por WhatsApp."}},{"@type":"Question","name":"¿Mis datos están seguros?","acceptedAnswer":{"@type":"Answer","text":"Sí. Tus datos se guardan en tu dispositivo. Tu información comercial queda en tu celular."}}]}</script>\n';
  html += '<link href="/fonts/fonts.css" rel="stylesheet">\n';
  html += '<script defer data-domain="parfumtrack.luccasramireziglesias.workers.dev" src="https://plausible.io/js/script.js"></script>\n';
  html += '<style>\n';

  // Concatenate all CSS files
  for (const cssFile of cssFiles) {
    const cssPath = path.join(stylesDir, cssFile);
    if (fs.existsSync(cssPath)) {
      const css = fs.readFileSync(cssPath, 'utf-8');
      html += css + '\n\n';
    }
  }

  html += '</style>\n</head>\n<body>\n';

  // Concatenate all HTML sections
  for (const sectionFile of sectionFiles) {
    const sectionPath = path.join(sectionsDir, sectionFile);
    if (fs.existsSync(sectionPath)) {
      const section = fs.readFileSync(sectionPath, 'utf-8');
      html += section + '\n';
    }
  }

  // Write output
  fs.writeFileSync(outputPath, html, 'utf-8');

  console.log('✅ landing.html regenerado desde src/landing/styles/ + sections/');
} catch (err) {
  console.error('❌ Error en build-landing.js:', err.message);
  process.exit(1);
}
