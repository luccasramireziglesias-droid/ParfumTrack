const { defineConfig } = require('@playwright/test');
const fs = require('fs');

// El entorno de desarrollo remoto trae Chromium preinstalado en una ruta fija;
// en CI (y en cualquier máquina normal) hay que dejar que Playwright use el
// suyo, o el binario no existe y falla todo antes de arrancar.
const CHROME_DEV = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH
  || (fs.existsSync(CHROME_DEV) ? CHROME_DEV : undefined);

module.exports = defineConfig({
  testDir: './tests',
  testMatch: /.*\.spec\.js/,
  timeout: 30000,
  // En CI un fallo puede ser por lentitud del runner, no por el código
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? 'line' : 'list',
  use: {
    baseURL: 'http://localhost:8787',
    headless: true,
    launchOptions: executablePath ? { executablePath } : {},
    trace: process.env.CI ? 'retain-on-failure' : 'off',
  },
  webServer: {
    command: 'npx serve -l 8787 -s .',
    port: 8787,
    reuseExistingServer: true,
    timeout: 30000,
  },
});
