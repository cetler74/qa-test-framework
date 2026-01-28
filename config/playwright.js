require('dotenv').config();

module.exports = {
  baseUrl: process.env.PLAYWRIGHT_BASE_URL || 'https://5gapisprint.meoempresas.pt/apis',
  timeoutMs: parseInt(process.env.PLAYWRIGHT_TIMEOUT_MS, 10) || 30000,
  /** false = browser opens and shows UI during tests; true = run in background without window */
  headless: process.env.PLAYWRIGHT_HEADLESS === 'true'
};
