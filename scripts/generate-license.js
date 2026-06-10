#!/usr/bin/env node
// ══════════════════════════════════════════════════════════════
// Parfum Track — generador de licencias
//
// Uso:
//   node scripts/generate-license.js "Nombre Cliente"
//   node scripts/generate-license.js "Nombre Cliente" --expires=2026-12-31
//   node scripts/generate-license.js "Nombre Cliente" --max-uses=3
//   node scripts/generate-license.js "Nombre Cliente" --add        ← sube a KV automático
//
// Requiere wrangler autenticado: npx wrangler login
// ══════════════════════════════════════════════════════════════

const { execSync } = require('child_process');
const crypto = require('crypto');

// ── Parsear argumentos ────────────────────────────────────────
const args = process.argv.slice(2);

if (args.includes('--help') || args.length === 0) {
  console.log(`
Uso: node scripts/generate-license.js "Nombre" [opciones]

Opciones:
  --expires=YYYY-MM-DD   Fecha de vencimiento (default: sin vencimiento)
  --max-uses=N           Usos máximos (default: 1)
  --add                  Sube automáticamente a KV vía wrangler
  --list                 Lista todas las licencias en KV
  --revoke=PT-XXXX-YYYY  Elimina un código de KV

Ejemplos:
  node scripts/generate-license.js "María García"
  node scripts/generate-license.js "Tienda XYZ" --expires=2026-12-31 --add
  node scripts/generate-license.js --list
  node scripts/generate-license.js --revoke=PT-A1B2C3-D4E5F6
`);
  process.exit(0);
}

// ── Subcomandos ───────────────────────────────────────────────
const listArg = args.includes('--list');
const revokeArg = args.find(a => a.startsWith('--revoke='));

if (listArg) {
  console.log('\n📋 Listando licencias en KV...\n');
  try {
    const raw = execSync('npx wrangler kv key list --binding=PT_LICENSES --remote --prefix=license:', { encoding: 'utf8' });
    const keys = JSON.parse(raw);
    if (!keys.length) { console.log('   (ninguna todavía)\n'); process.exit(0); }
    for (const { name } of keys) {
      const val = execSync(`npx wrangler kv key get "${name}" --binding=PT_LICENSES --remote`, { encoding: 'utf8' });
      const lic = JSON.parse(val);
      const code = name.replace('license:', '');
      const uses = `${lic.usedCount || 0}/${lic.maxUses ?? '∞'}`;
      const exp = lic.expiresAt || 'sin vencimiento';
      const last = lic.lastActivatedAt ? new Date(lic.lastActivatedAt).toLocaleDateString('es') : 'nunca';
      console.log(`   ${code}  │  ${lic.clientName}  │  usos: ${uses}  │  expira: ${exp}  │  última activación: ${last}`);
    }
    console.log('');
  } catch (e) {
    console.error('❌ Error al listar. ¿Está wrangler autenticado? (npx wrangler login)\n');
    process.exit(1);
  }
  process.exit(0);
}

if (revokeArg) {
  const code = revokeArg.split('=')[1].trim().toUpperCase();
  console.log(`\n🗑  Revocando ${code}...`);
  try {
    execSync(`npx wrangler kv key delete "license:${code}" --binding=PT_LICENSES --remote`, { stdio: 'inherit' });
    console.log('✅ Licencia eliminada.\n');
  } catch (e) {
    console.error('❌ Error al revocar.\n');
    process.exit(1);
  }
  process.exit(0);
}

// ── Generar código nuevo ──────────────────────────────────────
const clientName = args.find(a => !a.startsWith('--')) || 'Cliente';
const expiresArg = args.find(a => a.startsWith('--expires='));
const maxUsesArg = args.find(a => a.startsWith('--max-uses='));
const autoAdd    = args.includes('--add');

function generateCode() {
  // Formato: PT-XXXXXX-YYYYYY (12 hex chars, mayúsculas, fácil de dictar por WA)
  const p1 = crypto.randomBytes(3).toString('hex').toUpperCase();
  const p2 = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `PT-${p1}-${p2}`;
}

const code = generateCode();
const license = {
  clientName,
  expiresAt:         expiresArg ? expiresArg.split('=')[1] : null,
  maxUses:           maxUsesArg ? parseInt(maxUsesArg.split('=')[1], 10) : 1,
  usedCount:         0,
  createdAt:         new Date().toISOString().split('T')[0],
  lastActivatedAt:   null,
};

const kvValue = JSON.stringify(license);
const wranglerCmd = `npx wrangler kv key put "license:${code}" '${kvValue}' --binding=PT_LICENSES --remote`;

console.log('\n✅ Licencia generada');
console.log(`   Código:    ${code}`);
console.log(`   Cliente:   ${clientName}`);
console.log(`   Expira:    ${license.expiresAt || 'Nunca'}`);
console.log(`   Usos máx:  ${license.maxUses}`);

if (autoAdd) {
  console.log('\n📤 Subiendo a KV...');
  try {
    execSync(wranglerCmd, { stdio: 'inherit' });
    console.log('\n✅ ¡Listo! El código ya está activo en producción.');
    console.log(`\n   Enviá este código a ${clientName}:\n`);
    console.log(`   ┌─────────────────────┐`);
    console.log(`   │   ${code}    │`);
    console.log(`   └─────────────────────┘\n`);
  } catch (e) {
    console.error('\n❌ Error al subir a KV. Ejecutá este comando manualmente:\n');
    console.log(`   ${wranglerCmd}\n`);
    process.exit(1);
  }
} else {
  console.log('\n📋 Para activar, ejecutá:\n');
  console.log(`   ${wranglerCmd}\n`);
  console.log('   O usá --add para subirlo automáticamente.\n');
}
