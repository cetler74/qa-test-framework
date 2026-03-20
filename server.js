require('dotenv').config();
const express = require('express');
const session = require('express-session');
const cors = require('cors');
const path = require('path');
const http = require('http');
const { Pool } = require('pg');
const { attachUser, requireAuth } = require('./middleware/auth');

const app = express();
const PORT = process.env.PORT || 3000;

// Trust first proxy (e.g. Docker, reverse proxy). Needed so cookie.secure respects X-Forwarded-Proto.
app.set('trust proxy', 1);

// Only set cookie secure when actually using HTTPS (or a proxy that terminates TLS).
// In Docker with http://localhost:3000, leave COOKIE_SECURE unset so the session cookie is sent over HTTP.
const cookieSecure = process.env.COOKIE_SECURE === 'true';

// Session store: use PostgreSQL in production to avoid MemoryStore warning (leaks memory, single-process only).
const dbPassword = process.env.DB_PASSWORD !== undefined && process.env.DB_PASSWORD !== null
  ? String(process.env.DB_PASSWORD)
  : '';
const sessionStore = process.env.NODE_ENV === 'production'
  ? new (require('connect-pg-simple')(session))({
      pool: new Pool({
        host: process.env.DB_HOST || 'localhost',
        port: parseInt(process.env.DB_PORT, 10) || 5432,
        user: process.env.DB_USER || 'postgres',
        password: dbPassword,
        database: process.env.DB_NAME || 'qa_framework'
      }),
      createTableIfMissing: true
    })
  : undefined;

// Middleware
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-secret-change-in-production',
  resave: false,
  saveUninitialized: false,
  store: sessionStore,
  cookie: {
    httpOnly: true,
    secure: cookieSecure,
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000
  }
}));
app.use(express.static(path.join(__dirname, 'public')));

// Serve noVNC client files (from Debian package path in Docker, or custom path)
// so the Codegen iframe loads from the same origin (port 3000) and uses the WS proxy.
const NOVNC_PATH = process.env.NOVNC_PATH || '/usr/share/novnc';
const fsCheck = require('fs');
if (fsCheck.existsSync(NOVNC_PATH)) {
  app.use('/novnc', express.static(NOVNC_PATH));
  console.log(`noVNC client served from ${NOVNC_PATH} at /novnc`);
}

// API: attach user from session, then auth routes (public), then protected API
app.use('/api', attachUser);
app.use('/api/auth', require('./routes/auth'));
app.use('/api', requireAuth, require('./routes/api'));

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Create HTTP server (needed for WebSocket upgrade)
const server = http.createServer(app);

// Proxy WebSocket for remote Codegen noVNC so browser uses same origin (no direct host:6080)
const { attachCodegenWsProxy } = require('./services/codegenWsProxy');
attachCodegenWsProxy(server);

// Start server (bind to all interfaces so localhost and 127.0.0.1 work)
const HOST = process.env.HOST || '0.0.0.0';
server.listen(PORT, HOST, async () => {
  console.log(`Server running at http://localhost:${PORT} (and http://127.0.0.1:${PORT})`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  try {
    const scheduler = require('./services/scheduler');
    await scheduler.start();
  } catch (e) {
    console.warn('Scheduler failed to start:', e.message);
  }
});

module.exports = app;

