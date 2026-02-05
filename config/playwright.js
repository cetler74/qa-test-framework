require('dotenv').config();

/** Chrome args to avoid Local Network Access prompt when tests hit private IPs (e.g. 10.131.65.136). */
const defaultLaunchArgs = ['--disable-features=LocalNetworkAccessCheck'];

module.exports = {
  baseUrl: process.env.PLAYWRIGHT_BASE_URL || 'https://5gapisprint.meoempresas.pt/apis',
  timeoutMs: parseInt(process.env.PLAYWRIGHT_TIMEOUT_MS, 10) || 30000,
  /** false = browser opens and shows UI during tests; true = run in background without window */
  headless: process.env.PLAYWRIGHT_HEADLESS === 'true',
  /** Chrome/Chromium launch args (e.g. disable LNA prompt for local network). Override via PLAYWRIGHT_LAUNCH_ARGS (comma-separated). */
  launchArgs: process.env.PLAYWRIGHT_LAUNCH_ARGS ? process.env.PLAYWRIGHT_LAUNCH_ARGS.split(',').map(s => s.trim()).filter(Boolean) : defaultLaunchArgs
};
