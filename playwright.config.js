require('dotenv').config();
const shared = require('./config/playwright');

/** Root config for running full specs from Cursor, terminal, or Playwright Agents.
 *  Uses config/playwright.js for baseURL, timeout, headless, and launch args.
 */
module.exports = {
  testDir: 'e2e',
  testMatch: /.*\.spec\.(js|ts)/,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: shared.baseUrl,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'off',
    launchOptions: {
      headless: shared.headless,
      args: shared.launchArgs || []
    }
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  timeout: shared.timeoutMs || 30000,
  expect: { timeout: 10000 }
};
