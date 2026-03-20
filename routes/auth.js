const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const ldap = require('ldapjs');
const { User } = require('../models');

const ENABLE_LOCAL = process.env.ENABLE_LOCAL_AUTH !== 'false';
const ENABLE_AD = process.env.ENABLE_AD_AUTH === 'true';
const ENABLE_PAM = process.env.ENABLE_PAM_AUTH === 'true';
const PAM_AUTH_URL = (process.env.PAM_AUTH_URL || '').trim();

const AD_URL = process.env.AD_URL || '';
const AD_BASE_DN = process.env.AD_BASE_DN || '';
const AD_BIND_DN = process.env.AD_BIND_DN || '';
const AD_BIND_PASSWORD = process.env.AD_BIND_PASSWORD || '';
const AD_DOMAIN = process.env.AD_DOMAIN || '';

/**
 * POST /api/auth/login
 * Body: { strategy: 'local' | 'ad' | 'pam', username, password }
 */
router.post('/login', async (req, res) => {
  try {
    const { strategy, username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }
    let user;
    if (strategy === 'pam') {
      user = await loginPam(username, password);
    } else if (strategy === 'ad') {
      user = await loginAd(username, password);
    } else {
      user = await loginLocal(username, password);
    }
    if (!user) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }
    req.session.userId = user.id;
    req.session.save((err) => {
      if (err) return res.status(500).json({ error: 'Session save failed' });
      res.json({
        id: user.id,
        username: user.username,
        display_name: user.display_name,
        auth_source: user.auth_source,
        is_admin: user.is_admin
      });
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: err.message || 'Login failed' });
  }
});

async function loginLocal(username, password) {
  if (!ENABLE_LOCAL) return null;
  const user = await User.findOne({ where: { username, auth_source: 'local' } });
  if (!user || !user.password_hash || user.suspended) return null;
  const match = await bcrypt.compare(password, user.password_hash);
  return match ? user : null;
}

async function loginPam(username, password) {
  if (!ENABLE_PAM || !PAM_AUTH_URL) return null;
  const ok = await verifyPamCredentials(username, password);
  if (!ok) return null;
  return findOrCreatePamUser(username, ok.display_name);
}

function verifyPamCredentials(username, password) {
  return new Promise((resolve) => {
    const payload = JSON.stringify({ username, password });
    let url;
    try {
      url = new URL(PAM_AUTH_URL);
    } catch (_) {
      return resolve(null);
    }
    const isHttps = url.protocol === 'https:';
    const lib = isHttps ? require('https') : require('http');
    const path = url.pathname && url.pathname !== '/' ? url.pathname : '/verify';
    const options = {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload, 'utf8')
      },
      timeout: 5000
    };
    const req = lib.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        if (res.statusCode !== 200) return resolve(null);
        try {
          const data = JSON.parse(body);
          resolve({ display_name: data.display_name || null });
        } catch (_) {
          resolve({ display_name: null });
        }
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });
    req.setTimeout(5000);
    req.write(payload);
    req.end();
  });
}

async function findOrCreatePamUser(username, displayName) {
  let user = await User.findOne({ where: { username } });
  if (user) {
    if (user.auth_source !== 'pam') return null;
    if (user.suspended) return null;
    await user.update({
      display_name: displayName || user.display_name,
      updated_at: new Date()
    });
    return user;
  }
  user = await User.create({
    username,
    display_name: displayName || username,
    auth_source: 'pam',
    is_admin: false
  });
  return user;
}

function loginAd(username, password) {
  return new Promise((resolve) => {
    if (!ENABLE_AD || !AD_URL || !AD_BASE_DN) {
      return resolve(null);
    }
    const client = ldap.createClient({ url: AD_URL, reconnect: false });
    const onDone = (user) => {
      try { client.unbind(); } catch (_) {}
      resolve(user);
    };
    const searchThenBind = () => {
      const searchOpts = {
        filter: `(sAMAccountName=${escapeLdap(username)})`,
        scope: 'sub',
        attributes: ['dn', 'userPrincipalName', 'displayName']
      };
      client.search(AD_BASE_DN, searchOpts, (err, searchRes) => {
        if (err) return onDone(null);
        let found = null;
        searchRes.on('searchEntry', (entry) => { found = entry; });
        searchRes.on('error', () => onDone(null));
        searchRes.on('end', () => {
          if (!found) {
            const upn = AD_DOMAIN ? `${username}@${AD_DOMAIN}` : username;
            client.bind(upn, password, (bindErr) => {
              if (bindErr) return onDone(null);
              findOrCreateAdUser(username, null, null).then(onDone);
            });
            return;
          }
          const userDn = found.dn ? (typeof found.dn === 'string' ? found.dn : found.dn.toString()) : (found.object && found.object.dn);
          const displayName = (found.object && found.object.displayName) ? (Array.isArray(found.object.displayName) ? found.object.displayName[0] : found.object.displayName) : username;
          if (!userDn) return onDone(null);
          client.bind(userDn, password, (bindErr) => {
            if (bindErr) return onDone(null);
            findOrCreateAdUser(username, displayName, userDn).then(onDone);
          });
        });
      });
    };
    if (AD_BIND_DN && AD_BIND_PASSWORD) {
      client.bind(AD_BIND_DN, AD_BIND_PASSWORD, (bindErr) => {
        if (bindErr) return onDone(null);
        searchThenBind();
      });
    } else {
      const upn = AD_DOMAIN ? `${username}@${AD_DOMAIN}` : username;
      client.bind(upn, password, (bindErr) => {
        if (bindErr) return onDone(null);
        findOrCreateAdUser(username, null, null).then(onDone);
      });
    }
  });
}

function escapeLdap(str) {
  return String(str).replace(/[*\\()\x00]/g, (c) => '\\' + c.charCodeAt(0).toString(16));
}

async function findOrCreateAdUser(username, displayName, adDn) {
  let user = await User.findOne({ where: { username } });
  if (user) {
    if (user.auth_source !== 'ad') return null;
    if (user.suspended) return null;
    await user.update({
      display_name: displayName || user.display_name,
      ad_dn: adDn || user.ad_dn,
      updated_at: new Date()
    });
    return user;
  }
  user = await User.create({
    username,
    display_name: displayName || username,
    auth_source: 'ad',
    ad_dn: adDn,
    is_admin: false
  });
  return user;
}

/**
 * POST /api/auth/logout
 */
router.post('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) return res.status(500).json({ error: 'Logout failed' });
    res.json({ ok: true });
  });
});

/**
 * GET /api/auth/me - current user (401 if not logged in)
 */
router.get('/me', async (req, res) => {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  try {
    const user = await User.findByPk(req.session.userId, {
      attributes: ['id', 'username', 'display_name', 'auth_source', 'is_admin']
    });
    if (!user) {
      req.session.destroy(() => {});
      return res.status(401).json({ error: 'Not authenticated' });
    }
    res.json({
      id: user.id,
      username: user.username,
      display_name: user.display_name,
      auth_source: user.auth_source,
      is_admin: user.is_admin
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/auth/me/change-password - change own password (local users only)
 * Body: { current_password, new_password }
 */
router.post('/me/change-password', async (req, res) => {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  try {
    const user = await User.findByPk(req.session.userId, {
      attributes: ['id', 'auth_source', 'password_hash']
    });
    if (!user) return res.status(401).json({ error: 'Not authenticated' });
    if (user.auth_source !== 'local') {
      return res.status(400).json({ error: 'Password change is only available for local accounts' });
    }
    const { current_password, new_password } = req.body || {};
    if (!current_password || !new_password) {
      return res.status(400).json({ error: 'Current password and new password are required' });
    }
    const newPwd = String(new_password);
    if (newPwd.length < 6) {
      return res.status(400).json({ error: 'New password must be at least 6 characters' });
    }
    if (!user.password_hash) {
      return res.status(400).json({ error: 'Account has no password set' });
    }
    const match = await bcrypt.compare(String(current_password), user.password_hash);
    if (!match) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }
    const hash = await bcrypt.hash(newPwd, 10);
    await user.update({ password_hash: hash });
    res.json({ ok: true });
  } catch (err) {
    console.error('Change password error:', err);
    res.status(500).json({ error: err.message || 'Failed to change password' });
  }
});

module.exports = router;
