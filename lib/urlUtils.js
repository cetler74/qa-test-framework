/**
 * URL utilities for proxy inference (internal vs external).
 */
const dns = require('dns');
const { promisify } = require('util');
const dnsLookup = promisify(dns.lookup);

/**
 * Check if an IPv4 address string is in a private range (no DNS).
 * @param {string} ip - IPv4 address e.g. "10.18.114.35"
 * @returns {boolean}
 */
function isPrivateIPv4(ip) {
  if (!ip || typeof ip !== 'string') return false;
  const m = ip.trim().match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const a = parseInt(m[1], 10);
  const b = parseInt(m[2], 10);
  const c = parseInt(m[3], 10);
  const d = parseInt(m[4], 10);
  if (a > 255 || b > 255 || c > 255 || d > 255) return false;
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
}

/**
 * Check if a URL or host should be treated as "internal" (no proxy).
 * Supports full URLs (http/https) or host-only strings (e.g. "10.0.0.1", "localhost").
 * Does NOT resolve hostnames; use isInternalUrlAsync for DNS resolution.
 * @param {string} urlOrHost - Full URL or hostname
 * @returns {boolean} - true if internal (localhost, 127.0.0.1, 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16)
 */
function isInternalUrl(urlOrHost) {
  if (!urlOrHost || typeof urlOrHost !== 'string') return false;
  const s = urlOrHost.trim();
  if (!s) return false;

  let host;
  try {
    if (/^https?:\/\//i.test(s)) {
      host = new URL(s).hostname;
    } else {
      host = s.replace(/^\[|\]$/g, '').split(':')[0];
    }
  } catch (_) {
    host = s.split(':')[0];
  }
  if (!host) return false;

  const lower = host.toLowerCase();
  if (lower === 'localhost') return true;

  if (lower === '127.0.0.1' || lower === '::1') return true;

  const ipv4Match = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4Match) {
    const a = parseInt(ipv4Match[1], 10);
    const b = parseInt(ipv4Match[2], 10);
    const c = parseInt(ipv4Match[3], 10);
    const d = parseInt(ipv4Match[4], 10);
    if (a > 255 || b > 255 || c > 255 || d > 255) return false;
    if (a === 10) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
  }
  return false;
}

/**
 * Async version: resolve hostname via DNS and treat as internal if resolved IP is private.
 * Use for hostnames like bop-uat.m2m.telecom.pt that resolve to 10.x.x.x.
 * If resolution fails or is not a private IP, returns false (use proxy).
 * @param {string} urlOrHost - Full URL or hostname
 * @returns {Promise<boolean>}
 */
async function isInternalUrlAsync(urlOrHost) {
  if (!urlOrHost || typeof urlOrHost !== 'string') return false;
  const s = urlOrHost.trim();
  if (!s) return false;

  let host;
  try {
    if (/^https?:\/\//i.test(s)) {
      host = new URL(s).hostname;
    } else {
      host = s.replace(/^\[|\]$/g, '').split(':')[0];
    }
  } catch (_) {
    host = s.split(':')[0];
  }
  if (!host) return false;

  const lower = host.toLowerCase();
  if (lower === 'localhost') return true;
  if (lower === '127.0.0.1' || lower === '::1') return true;

  // Already an IPv4 address – no DNS needed
  if (host.match(/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/)) {
    return isInternalUrl(urlOrHost);
  }

  // Resolve hostname; if resolved IP is private, treat as internal
  try {
    const { address } = await dnsLookup(host, { family: 4 });
    return isPrivateIPv4(address);
  } catch (_) {
    return false;
  }
}

/**
 * Derive a representative URL from env vars for proxy inference.
 * Prefer keys: endpoint, base_url, BASE_URL, baseUrl; else first value that looks like http(s) URL.
 * @param {Record<string, string>} envVars
 * @returns {string}
 */
function deriveUrlFromEnvVars(envVars) {
  if (!envVars || typeof envVars !== 'object') return '';
  const keys = ['endpoint', 'base_url', 'BASE_URL', 'baseUrl'];
  for (const k of keys) {
    const v = envVars[k];
    if (typeof v === 'string' && /^https?:\/\//i.test(v.trim())) return v.trim();
  }
  for (const v of Object.values(envVars)) {
    if (typeof v === 'string' && /^https?:\/\//i.test(v.trim())) return v.trim();
  }
  return '';
}

module.exports = {
  isInternalUrl,
  isInternalUrlAsync,
  isPrivateIPv4,
  deriveUrlFromEnvVars
};
