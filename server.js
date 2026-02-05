require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Routes
const apiRoutes = require('./routes/api');
app.use('/api', apiRoutes);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Start server (bind to all interfaces so localhost and 127.0.0.1 work)
const HOST = process.env.HOST || '0.0.0.0';
app.listen(PORT, HOST, async () => {
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

