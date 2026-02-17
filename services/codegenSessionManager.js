/**
 * Codegen Session Manager
 *
 * Manages remote Playwright Codegen sessions using Xvfb (virtual display),
 * x11vnc, and websockify so that users can record UI tests from the browser
 * via noVNC without installing anything locally.
 *
 * Each session:
 *  1. Starts Xvfb on a unique display number (:99, :100, ...)
 *  2. Starts x11vnc exposing that display
 *  3. Starts websockify bridging a unique WebSocket port to x11vnc
 *  4. Spawns `npx playwright codegen --output <file> <url>` on that display
 *
 * Sessions auto-terminate after a configurable timeout.
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

// ---------------------------------------------------------------------------
// Configuration (from environment, with defaults)
// ---------------------------------------------------------------------------
const MAX_SESSIONS = parseInt(process.env.CODEGEN_MAX_SESSIONS, 10) || 3;
const SESSION_TIMEOUT_MS = parseInt(process.env.CODEGEN_SESSION_TIMEOUT_MS, 10) || 600000; // 10 min
const VNC_PORT_START = parseInt(process.env.CODEGEN_VNC_PORT_START, 10) || 6080;
const DISPLAY_START = 99; // Xvfb display numbers start at :99
const X11VNC_PORT_START = 5999; // internal VNC port per display (not exposed)
const NOVNC_PATH = process.env.NOVNC_PATH || '/usr/share/novnc';

// ---------------------------------------------------------------------------
// Session store  (in-memory; single-process is fine for this use case)
// ---------------------------------------------------------------------------
/** @type {Map<string, Session>} */
const sessions = new Map();

/**
 * @typedef {Object} Session
 * @property {string}  slug
 * @property {string}  url          - Target URL for codegen
 * @property {string}  outputPath   - Absolute path to the generated .spec.js
 * @property {number}  displayNum   - Xvfb display number
 * @property {number}  vncPort      - websockify WebSocket port
 * @property {number}  x11vncPort   - internal x11vnc TCP port
 * @property {import('child_process').ChildProcess|null} xvfbProc
 * @property {import('child_process').ChildProcess|null} x11vncProc
 * @property {import('child_process').ChildProcess|null} websockifyProc
 * @property {import('child_process').ChildProcess|null} codegenProc
 * @property {Date}    startedAt
 * @property {NodeJS.Timeout|null} timeoutHandle
 * @property {string}  status       - 'starting' | 'running' | 'stopped' | 'error'
 * @property {string|null} error
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Check if the required binaries are available on the system. */
function checkPrerequisites() {
  const bins = ['Xvfb', 'x11vnc', 'websockify'];
  const missing = [];
  for (const bin of bins) {
    try {
      const { execSync } = require('child_process');
      execSync(`which ${bin}`, { stdio: 'ignore' });
    } catch {
      missing.push(bin);
    }
  }
  return missing;
}

/** Find a free display number not currently in use. */
function allocateDisplayNum() {
  const used = new Set([...sessions.values()].map(s => s.displayNum));
  for (let n = DISPLAY_START; n < DISPLAY_START + MAX_SESSIONS + 10; n++) {
    if (!used.has(n)) return n;
  }
  return null;
}

/** Find a free websockify port not currently in use. */
function allocateVncPort() {
  const used = new Set([...sessions.values()].map(s => s.vncPort));
  for (let p = VNC_PORT_START; p < VNC_PORT_START + MAX_SESSIONS + 10; p++) {
    if (!used.has(p)) return p;
  }
  return null;
}

/** Find a free internal x11vnc port. */
function allocateX11VncPort() {
  const used = new Set([...sessions.values()].map(s => s.x11vncPort));
  for (let p = X11VNC_PORT_START; p < X11VNC_PORT_START + MAX_SESSIONS + 10; p++) {
    if (!used.has(p)) return p;
  }
  return null;
}

/** Kill a child process safely. */
function killProc(proc) {
  if (!proc || proc.killed) return;
  try {
    proc.kill('SIGTERM');
    // Force-kill after 3 s if still alive
    setTimeout(() => {
      try { if (!proc.killed) proc.kill('SIGKILL'); } catch { /* ignore */ }
    }, 3000);
  } catch { /* ignore */ }
}

/** Wait for a short delay (ms). */
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Check whether the remote codegen infrastructure is available.
 * Returns true on headless Linux with Xvfb + x11vnc + websockify installed.
 */
function isRemoteCodegenAvailable() {
  if (process.platform === 'win32') return false;
  const missing = checkPrerequisites();
  return missing.length === 0;
}

/**
 * Create and start a new Codegen session.
 *
 * @param {string} slug - Unique session identifier
 * @param {string} url  - Target URL for Playwright Codegen
 * @param {{ proxy?: { http?: string, https?: string, bypass?: string } }} [options] - Optional proxy for codegen browser
 * @returns {Promise<{slug: string, vncPort: number, noVncUrl: string, status: string}>}
 */
async function createSession(slug, url, options = {}) {
  // Guard: max sessions
  const active = [...sessions.values()].filter(s => s.status === 'running' || s.status === 'starting');
  if (active.length >= MAX_SESSIONS) {
    throw new Error(`Maximum concurrent Codegen sessions reached (${MAX_SESSIONS}). Please wait for an existing session to finish.`);
  }

  // Allocate resources
  const displayNum = allocateDisplayNum();
  const vncPort = allocateVncPort();
  const x11vncPort = allocateX11VncPort();
  if (displayNum === null || vncPort === null || x11vncPort === null) {
    throw new Error('No available display/port for a new Codegen session.');
  }

  const e2eRecorded = path.join(__dirname, '..', 'e2e', 'recorded');
  if (!fs.existsSync(e2eRecorded)) {
    fs.mkdirSync(e2eRecorded, { recursive: true });
  }
  const outputPath = path.join(e2eRecorded, `${slug}.spec.js`);

  /** @type {Session} */
  const session = {
    slug,
    url,
    outputPath,
    displayNum,
    vncPort,
    x11vncPort,
    xvfbProc: null,
    x11vncProc: null,
    websockifyProc: null,
    codegenProc: null,
    startedAt: new Date(),
    timeoutHandle: null,
    status: 'starting',
    error: null,
  };
  sessions.set(slug, session);

  try {
    // 1. Start Xvfb
    const display = `:${displayNum}`;
    session.xvfbProc = spawn('Xvfb', [display, '-screen', '0', '1280x900x24', '-ac'], {
      stdio: 'ignore',
      detached: true,
    });
    session.xvfbProc.unref();
    session.xvfbProc.on('error', (err) => {
      console.error(`[codegen:${slug}] Xvfb error:`, err.message);
      session.error = 'Xvfb failed: ' + err.message;
      session.status = 'error';
    });
    await delay(500); // give Xvfb time to start

    // 2. Start x11vnc
    session.x11vncProc = spawn('x11vnc', [
      '-display', display,
      '-rfbport', String(x11vncPort),
      '-nopw',
      '-forever',
      '-shared',
      '-noxdamage',
    ], {
      stdio: 'ignore',
      detached: true,
      env: { ...process.env, DISPLAY: display },
    });
    session.x11vncProc.unref();
    session.x11vncProc.on('error', (err) => {
      console.error(`[codegen:${slug}] x11vnc error:`, err.message);
      session.error = 'x11vnc failed: ' + err.message;
      session.status = 'error';
    });
    await delay(300);

    // 3. Start websockify (bridges WebSocket port -> x11vnc TCP port)
    //    noVNC in the browser connects to this WebSocket.
    session.websockifyProc = spawn('websockify', [
      '--web', NOVNC_PATH,
      String(vncPort),
      `localhost:${x11vncPort}`,
    ], {
      stdio: 'ignore',
      detached: true,
    });
    session.websockifyProc.unref();
    session.websockifyProc.on('error', (err) => {
      console.error(`[codegen:${slug}] websockify error:`, err.message);
      session.error = 'websockify failed: ' + err.message;
      session.status = 'error';
    });
    await delay(300);

    // 4. Spawn Playwright Codegen (use --proxy-server so the browser uses the proxy; env vars are not used by codegen's browser)
    const proxy = options.proxy && (options.proxy.http || options.proxy.https) ? options.proxy : null;
    const codegenEnv = { ...process.env, DISPLAY: display };
    const codegenArgs = ['playwright', 'codegen', '--output', outputPath];
    if (proxy) {
      const u = proxy.http || proxy.https || '';
      codegenArgs.push('--proxy-server', u);
      if (proxy.bypass && proxy.bypass.trim()) {
        codegenArgs.push('--proxy-bypass', proxy.bypass.trim());
      }
    }
    codegenArgs.push(url);
    session.codegenProc = spawn('npx', codegenArgs, {
      stdio: 'ignore',
      detached: true,
      env: codegenEnv,
      cwd: path.join(__dirname, '..'),
    });
    session.codegenProc.unref();
    session.codegenProc.on('error', (err) => {
      console.error(`[codegen:${slug}] Codegen error:`, err.message);
      session.error = 'Codegen failed: ' + err.message;
      session.status = 'error';
    });
    session.codegenProc.on('exit', (code) => {
      console.log(`[codegen:${slug}] Codegen exited with code ${code}`);
      // If user didn't explicitly stop, mark as stopped
      if (session.status === 'running') {
        session.status = 'stopped';
      }
    });

    session.status = 'running';

    // 5. Auto-timeout
    session.timeoutHandle = setTimeout(() => {
      console.log(`[codegen:${slug}] Session timed out after ${SESSION_TIMEOUT_MS}ms`);
      stopSession(slug).catch(() => {});
    }, SESSION_TIMEOUT_MS);

    const noVncUrl = `/novnc/vnc.html?autoconnect=true&resize=scale&port=${vncPort}`;
    console.log(`[codegen:${slug}] Session started — display=${display} vncPort=${vncPort} url=${url}`);

    return {
      slug,
      vncPort,
      noVncUrl,
      status: session.status,
    };
  } catch (err) {
    // Clean up on failure
    session.status = 'error';
    session.error = err.message;
    await _cleanup(session);
    throw err;
  }
}

/**
 * Stop a Codegen session and return the generated spec content (if any).
 *
 * @param {string} slug
 * @returns {Promise<{slug: string, status: string, specContent: string|null}>}
 */
async function stopSession(slug) {
  const session = sessions.get(slug);
  if (!session) {
    throw new Error(`Session "${slug}" not found.`);
  }

  // Kill processes in reverse order
  killProc(session.codegenProc);
  await delay(500); // give codegen a moment to write the output file
  killProc(session.websockifyProc);
  killProc(session.x11vncProc);
  killProc(session.xvfbProc);

  if (session.timeoutHandle) {
    clearTimeout(session.timeoutHandle);
    session.timeoutHandle = null;
  }

  session.status = 'stopped';

  // Read generated spec
  let specContent = null;
  try {
    if (fs.existsSync(session.outputPath)) {
      specContent = fs.readFileSync(session.outputPath, 'utf8');
    }
  } catch (err) {
    console.warn(`[codegen:${slug}] Could not read output file:`, err.message);
  }

  console.log(`[codegen:${slug}] Session stopped — specContent=${specContent ? specContent.length + ' chars' : 'none'}`);
  return { slug, status: 'stopped', specContent };
}

/**
 * Get the current status of a session.
 *
 * @param {string} slug
 * @returns {{slug: string, status: string, elapsedMs: number, vncPort: number, noVncUrl: string, error: string|null}|null}
 */
function getSession(slug) {
  const session = sessions.get(slug);
  if (!session) return null;
  const elapsedMs = Date.now() - session.startedAt.getTime();
  const timeoutMs = SESSION_TIMEOUT_MS;
  const remainingMs = Math.max(0, timeoutMs - elapsedMs);
  return {
    slug: session.slug,
    status: session.status,
    elapsedMs,
    remainingMs,
    timeoutMs,
    vncPort: session.vncPort,
    noVncUrl: `/novnc/vnc.html?autoconnect=true&resize=scale&port=${session.vncPort}`,
    error: session.error,
  };
}

/**
 * List all sessions (active and stopped).
 *
 * @returns {Array}
 */
function listSessions() {
  return [...sessions.values()].map(s => ({
    slug: s.slug,
    status: s.status,
    elapsedMs: Date.now() - s.startedAt.getTime(),
    vncPort: s.vncPort,
  }));
}

/**
 * Clean up stale/stopped sessions from memory.
 */
function cleanupStale() {
  const now = Date.now();
  for (const [slug, session] of sessions) {
    if (session.status === 'stopped' || session.status === 'error') {
      const age = now - session.startedAt.getTime();
      // Remove stopped sessions older than 5 minutes
      if (age > 5 * 60 * 1000) {
        _cleanup(session);
        sessions.delete(slug);
      }
    }
  }
}

/** Internal: kill all processes for a session. */
async function _cleanup(session) {
  killProc(session.codegenProc);
  killProc(session.websockifyProc);
  killProc(session.x11vncProc);
  killProc(session.xvfbProc);
  if (session.timeoutHandle) {
    clearTimeout(session.timeoutHandle);
    session.timeoutHandle = null;
  }
}

// Periodic cleanup every 2 minutes
setInterval(cleanupStale, 2 * 60 * 1000);

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------
module.exports = {
  isRemoteCodegenAvailable,
  createSession,
  stopSession,
  getSession,
  listSessions,
  cleanupStale,
  MAX_SESSIONS,
  SESSION_TIMEOUT_MS,
};
