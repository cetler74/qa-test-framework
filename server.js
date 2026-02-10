require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const http = require('http');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Serve noVNC client files (from Debian package path in Docker, or custom path)
// so the Codegen iframe loads from the same origin (port 3000) and uses the WS proxy.
const NOVNC_PATH = process.env.NOVNC_PATH || '/usr/share/novnc';
const fsCheck = require('fs');
if (fsCheck.existsSync(NOVNC_PATH)) {
  app.use('/novnc', express.static(NOVNC_PATH));
  console.log(`noVNC client served from ${NOVNC_PATH} at /novnc`);
}

// Routes
const apiRoutes = require('./routes/api');
app.use('/api', apiRoutes);

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

