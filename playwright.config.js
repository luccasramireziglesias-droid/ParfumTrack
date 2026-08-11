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
  // Dos apps, dos servidores. El de ParfumTrack corre con `-s` (modo SPA),
  // que reescribe CUALQUIER ruta que no sea un archivo al index.html de la
  // raíz — incluido /omnibus/. Servido así, la app de recorridos recibía el
  // index.html de ParfumTrack y fallaba con "DB.todos is not a function",
  // que no se parece en nada al problema real. La app de recorridos se sirve
  // desde su propia carpeta y sin `-s`.
  projects: [
    {
      name: 'parfumtrack',
      testIgnore: /omnibus\.spec\.js/,
      use: { baseURL: 'http://localhost:8787' },
    },
    {
      name: 'omnibus',
      testMatch: /omnibus\.spec\.js/,
      use: { baseURL: 'http://localhost:8788' },
    },
  ],
  webServer: [
    {
      command: 'npx serve -l 8787 -s .',
      port: 8787,
      reuseExistingServer: true,
      timeout: 30000,
    },
    {
      command: 'npx serve -l 8788 omnibus',
      port: 8788,
      reuseExistingServer: true,
      timeout: 30000,
    },
  ],
});
