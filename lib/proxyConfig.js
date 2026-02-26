const fs = require('fs');
const path = require('path');
const { isInternalUrl, isInternalUrlAsync } = require('./urlUtils');

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
 * Get proxy for a given URL: internal URLs get null, external get activeProxy from config.
 * Uses DNS resolution for hostnames so that e.g. bop-uat.m2m.telecom.pt → 10.18.114.35 is treated as internal.
 * @param {string} url - Full URL or host (e.g. run baseUrl, serverUrl, env endpoint)
 * @returns {Promise<{ http: string, https: string, bypass: string } | null>}
 */
async function getProxyForUrlAsync(url) {
  if (!url || typeof url !== 'string') return null;
  const internal = await isInternalUrlAsync(url);
  if (internal) return null;
  const config = loadProxyConfig();
  const name = config.activeProxy;
  if (!name || name === 'no-proxy') return null;
  return getProxyByName(name);
}

/**
 * Sync version (no DNS): only treats literal IPs and localhost as internal.
 * Use getProxyForUrlAsync when the URL may be a hostname that resolves to a private IP.
 * @param {string} url - Full URL or host
 * @returns {{ http: string, https: string, bypass: string } | null}
 */
function getProxyForUrl(url) {
  if (!url || typeof url !== 'string') return null;
  if (isInternalUrl(url)) return null;
  const config = loadProxyConfig();
  const name = config.activeProxy;
  if (!name || name === 'no-proxy') return null;
  return getProxyByName(name);
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
  getProxyForUrl,
  getProxyForUrlAsync,
  clearProxyCache,
  PROXIES_FILE,
  PROXIES_EXAMPLE
};
