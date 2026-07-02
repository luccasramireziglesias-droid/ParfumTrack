#!/usr/bin/env node
/**
 * Script to create an owner license in KV
 * Usage: node scripts/create-owner-license.mjs
 */

import { execSync } from 'child_process';

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
  // Use wrangler kv key put to insert the license (use --remote flag for production, omit for local dev)
  const command = `npx wrangler kv key put "${kvKey}" '${kvValue}' --namespace-id=412577285b984e42a7e230dfabcd0a27`;

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
  console.log('1. Open ParfumTrack app');
  console.log('2. Go to "Mi Cuenta" (Account)');
  console.log(`3. Paste the code: ${code}`);
  console.log('4. Click "Activar código" (Activate Code)\n');

  process.exit(0);
} catch (error) {
  console.error('❌ Error creating license:\n');
  console.error(error.message);
  console.error('\n⚠️  Make sure you have:');
  console.error('   1. Cloudflare account authenticated');
  console.error('   2. Wrangler installed (npm i -g wrangler)');
  console.error('   3. Access to the PT_LICENSES namespace\n');
  process.exit(1);
}
