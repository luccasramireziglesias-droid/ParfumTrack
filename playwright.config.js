const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  testMatch: /.*\.spec\.js/,
  timeout: 30000,
  retries: 0,
  use: {
    baseURL: 'http://localhost:8787',
    headless: true,
    launchOptions: {
      executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    },
  },
  webServer: {
    command: 'npx serve -l 8787 -s .',
    port: 8787,
    reuseExistingServer: true,
    timeout: 10000,
  },
});
