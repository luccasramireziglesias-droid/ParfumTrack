#!/usr/bin/env node
/**
 * Generate owner license in production
 * Usage: node scripts/generate-owner-prod.mjs
 */

const APP_URL = 'https://parfumtrack.luccasramireziglesias.workers.dev';
const OWNER_SECRET = 'temp-owner-setup';

console.log('🍶 ParfumTrack Owner License Generator (Production)\n');
console.log(`Llamando a: ${APP_URL}/generate-owner-license\n`);

try {
  const response = await fetch(`${APP_URL}/generate-owner-license`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ secret: OWNER_SECRET })
  });

  const data = await response.json();

  if (data.ok && data.code) {
    console.log('✅ Licencia de owner generada exitosamente!\n');
    console.log('==================================');
    console.log(`Tu código: ${data.code}`);
    console.log('==================================\n');
    console.log('Ahora en la app (desde celular):\n');
    console.log('1. Ve a "Mi Cuenta"');
    console.log(`2. Pega: ${data.code}`);
    console.log('3. Haz clic en "Activar código"\n');
  } else {
    console.error('❌ Error:', data.error || 'Unknown error');
    process.exit(1);
  }
} catch (error) {
  console.error('❌ Error de conexión:', error.message);
  process.exit(1);
}
