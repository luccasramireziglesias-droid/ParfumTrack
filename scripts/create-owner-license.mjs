#!/usr/bin/env node
/**
 * Script to create an owner license in KV
 * Usage: node scripts/create-owner-license.mjs [--remote]
 *   (omit --remote for local dev, add --remote for production)
 */

import { execSync } from 'child_process';

const isRemote = process.argv.includes('--remote');

// Generate a unique license code
function generateLicenseCode() {
  const part1 = Math.random().toString(36).substr(2, 6).toUpperCase();
  const part2 = Math.random().toString(36).substr(2, 8).toUpperCase();
  return `PT-${part1}-${part2}`;
}

// Create the license object
const code = generateLicenseCode();
const licenseData = {
  clientName: 'Luccas Ramírez (Owner)',
  createdAt: new Date().toISOString(),
  expiresAt: new Date(new Date().setFullYear(new Date().getFullYear() + 10)).toISOString(), // 10 years
  maxUses: null, // unlimited
  usedCount: 0,
  lastActivatedAt: null,
  status: 'active',
  isOwner: true
};

// Create KV entry key
const kvKey = `license:${code}`;
const kvValue = JSON.stringify(licenseData);

console.log('🍶 ParfumTrack License Generator');
console.log('================================\n');
console.log(`📝 Generated License Code: ${code}`);
console.log(`⏰ Expires At: ${licenseData.expiresAt}`);
console.log(`♾️  Max Uses: Unlimited`);
console.log(`👤 Owner: ${licenseData.clientName}\n`);

console.log('📤 Attempting to insert into KV...\n');

try {
  // Use wrangler kv key put to insert the license
  const remoteFlag = isRemote ? ' --remote' : '';
  const location = isRemote ? 'REMOTE KV (production)' : 'LOCAL KV (dev)';
  const command = `npx wrangler kv key put "${kvKey}" '${kvValue}' --namespace-id=412577285b984e42a7e230dfabcd0a27${remoteFlag}`;

  console.log(`📍 Target: ${location}`);
  console.log(`Running: ${command}\n`);

  const output = execSync(command, {
    cwd: process.cwd(),
    stdio: 'inherit',
    encoding: 'utf-8'
  });

  console.log('\n✅ License created successfully!\n');
  console.log('==================================');
  console.log(`Your License Code: ${code}`);
  console.log('==================================\n');
  console.log('Next steps:');
  console.log('1. Open ParfumTrack app' + (isRemote ? ' (https://parfumtrack.luccasramireziglesias.workers.dev)' : ' (http://localhost:8787)'));
  console.log('2. Go to "Mi Cuenta" (Account)');
  console.log(`3. Paste the code: ${code}`);
  console.log('4. Click "Activar código" (Activate Code)\n');

  process.exit(0);
} catch (error) {
  console.error('❌ Error creating license:\n');
  console.error(error.message);
  console.error('\n⚠️  Make sure you have:');
  if (isRemote) {
    console.error('   1. Cloudflare account authenticated: run "wrangler login" first');
    console.error('   2. Wrangler installed (npm i -g wrangler)');
    console.error('   3. Access to the PT_LICENSES namespace');
  } else {
    console.error('   1. Wrangler installed (npm i -g wrangler)');
    console.error('   2. Running with: node scripts/create-owner-license.mjs');
    console.error('   3. For production (--remote flag), run: wrangler login');
  }
  console.error('');
  process.exit(1);
}
