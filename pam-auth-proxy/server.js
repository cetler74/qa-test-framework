/**
 * PAM authentication proxy for QA Test Hub.
 * Run on the Linux host when the app runs in Docker; the app calls this over HTTP to verify OS user credentials.
 *
 * Usage: npm install && npm start
 * Env: PORT=9090 (default), PAM_SERVICE=login (optional)
 *
 * POST /verify
 * Body: { "username": "joe", "password": "secret" }
 * 200: { "display_name": "joe" } or { "display_name": "Full Name" } if available
 * 401: authentication failed
 */
const express = require('express');
const pam = require('authenticate-pam');

const PORT = parseInt(process.env.PORT || '9090', 10);
const PAM_SERVICE = process.env.PAM_SERVICE || 'login';

const app = express();
app.use(express.json({ limit: '1kb' }));

app.post('/verify', (req, res) => {
  const username = req.body && typeof req.body.username === 'string' ? req.body.username.trim() : '';
  const password = req.body && typeof req.body.password === 'string' ? req.body.password : '';

  if (!username || !password) {
    return res.status(400).json({ error: 'username and password required' });
  }

  const options = { serviceName: PAM_SERVICE };
  if (process.env.PAM_REMOTE_HOST) {
    options.remoteHost = process.env.PAM_REMOTE_HOST;
  }

  pam.authenticate(username, password, (err) => {
    if (err) {
      return res.status(401).json({ error: 'Authentication failed' });
    }
    res.status(200).json({ display_name: username });
  }, options);
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`PAM auth proxy listening on 0.0.0.0:${PORT}`);
});
