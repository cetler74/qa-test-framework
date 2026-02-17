const fs = require('fs');
const path = require('path');

const CONFIG_DIR = path.join(__dirname, '..', 'config');
const PROXIES_FILE = path.join(CONFIG_DIR, 'proxies.json');
const PROXIES_EXAMPLE = path.join(CONFIG_DIR, 'proxies.example.json');

let cachedConfig = null;

/**
 * Load proxy config from config/proxies.json or config/proxies.example.json.
 * Result is cached in memory.
 * @returns {{ activeProxy: string, proxies: Record<string, { http: string, https: string, bypass: string }> } | null}
 */
function loadProxyConfig() {
  if (cachedConfig) return cachedConfig;
  const pathToRead = fs.existsSync(PROXIES_FILE) ? PROXIES_FILE : PROXIES_EXAMPLE;
  if (!fs.existsSync(pathToRead)) {
    cachedConfig = { activeProxy: 'no-proxy', proxies: {} };
    return cachedConfig;
  }
  try {
    const raw = fs.readFileSync(pathToRead, 'utf8');
    const data = JSON.parse(raw);
    if (data && typeof data.proxies === 'object') {
      cachedConfig = {
        activeProxy: typeof data.activeProxy === 'string' ? data.activeProxy : 'no-proxy',
        proxies: data.proxies
      };
      return cachedConfig;
    }
  } catch (err) {
    console.error('[proxyConfig] Failed to load proxy config:', err.message);
  }
  cachedConfig = { activeProxy: 'no-proxy', proxies: {} };
  return cachedConfig;
}

/**
 * Get proxy entry by name (key in proxies object).
 * @param {string} name - Proxy name (e.g. 'proxy_DIT_Gestao', 'no-proxy')
 * @returns {{ http: string, https: string, bypass: string } | null}
 */
function getProxyByName(name) {
  if (!name || typeof name !== 'string') return null;
  const config = loadProxyConfig();
  const entry = config.proxies[name];
  if (!entry || typeof entry !== 'object') return null;
  return {
    http: typeof entry.http === 'string' ? entry.http : '',
    https: typeof entry.https === 'string' ? entry.https : '',
    bypass: typeof entry.bypass === 'string' ? entry.bypass : ''
  };
}

/**
 * Clear cached config (e.g. after file edit). Optional for dev.
 */
function clearProxyCache() {
  cachedConfig = null;
}

module.exports = {
  loadProxyConfig,
  getProxyByName,
  clearProxyCache,
  PROXIES_FILE,
  PROXIES_EXAMPLE
};
