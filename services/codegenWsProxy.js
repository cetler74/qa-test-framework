/**
 * WebSocket proxy for remote Codegen noVNC sessions.
 * Proxies browser WebSocket connections to the session's websockify port
 * so the iframe can stay on the same origin (port 3000) and avoid
 * "localhost didn't send any data" from direct host:6080 access.
 */

const WebSocket = require('ws');
const codegenSessionManager = require('./codegenSessionManager');

const CODGEN_WS_PATH_PREFIX = '/api/playwright-recorded-tests/codegen-ws/';

/**
 * Attach WebSocket upgrade handler to the HTTP server.
 * @param {import('http').Server} server
 */
function attachCodegenWsProxy(server) {
  const wss = new WebSocket.Server({ noServer: true });

  server.on('upgrade', (request, socket, head) => {
    const pathname = (request.url && request.url.split('?')[0]) || '';
    if (!pathname.startsWith(CODGEN_WS_PATH_PREFIX)) {
      return;
    }
    const slug = pathname.slice(CODGEN_WS_PATH_PREFIX.length).replace(/\/$/, '').trim();
    if (!slug) {
      console.warn('[codegen-ws] missing slug in path:', pathname);
      socket.destroy();
      return;
    }
    // Complete the upgrade so we can send a proper close code/reason (avoids generic 1005)
    wss.handleUpgrade(request, socket, head, (clientWs) => {
      const session = codegenSessionManager.getSession(slug);
      if (!session) {
        console.warn('[codegen-ws] no session for slug:', slug);
        clientWs.close(1011, 'Session not found');
        return;
      }
      if (session.status !== 'running' && session.status !== 'starting') {
        console.warn('[codegen-ws] session not ready:', slug, session.status);
        clientWs.close(1011, 'Session not ready: ' + session.status);
        return;
      }
      const targetUrl = `ws://127.0.0.1:${session.vncPort}`;
      console.log('[codegen-ws] proxying', slug, '->', targetUrl);
      const upstream = new WebSocket(targetUrl);
      upstream.on('open', () => {
        console.log('[codegen-ws] upstream connected:', slug);
        clientWs.on('message', (data) => upstream.send(data));
        clientWs.on('close', () => upstream.close());
        upstream.on('message', (data) => clientWs.send(data));
        upstream.on('close', () => clientWs.close());
        upstream.on('error', () => clientWs.close(1011, 'VNC server closed'));
      });
      upstream.on('error', (err) => {
        console.warn('[codegen-ws] upstream error:', slug, err.message);
        clientWs.close(1011, 'VNC server unavailable');
      });
      clientWs.on('error', () => upstream.close());
    });
  });
}

module.exports = { attachCodegenWsProxy, CODGEN_WS_PATH_PREFIX };
