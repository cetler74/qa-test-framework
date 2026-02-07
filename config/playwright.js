require('dotenv').config();

/** Chrome args to avoid Local Network Access prompt when tests hit private IPs (e.g. 10.131.65.136). */
const defaultLaunchArgs = ['--disable-features=LocalNetworkAccessCheck'];

/** User-Agent sent by the browser. Many sites return 403 for headless/automation; a normal Chrome UA reduces this. Override via PLAYWRIGHT_USER_AGENT. */
const defaultUserAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

module.exports = {
  baseUrl: process.env.PLAYWRIGHT_BASE_URL || 'https://5gapisprint.meoempresas.pt/apis',
  timeoutMs: parseInt(process.env.PLAYWRIGHT_TIMEOUT_MS, 10) || 60000,
  /** false = browser opens and shows UI during tests; true = run in background without window */
  headless: process.env.PLAYWRIGHT_HEADLESS === 'true',
  /** Chrome/Chromium launch args (e.g. disable LNA prompt for local network). Override via PLAYWRIGHT_LAUNCH_ARGS (comma-separated). */
  launchArgs: process.env.PLAYWRIGHT_LAUNCH_ARGS ? process.env.PLAYWRIGHT_LAUNCH_ARGS.split(',').map(s => s.trim()).filter(Boolean) : defaultLaunchArgs,
  /** User-Agent for browser context. Reduces 403 Forbidden from sites that block headless/automation. Override via PLAYWRIGHT_USER_AGENT. */
  userAgent: process.env.PLAYWRIGHT_USER_AGENT || defaultUserAgent
};
