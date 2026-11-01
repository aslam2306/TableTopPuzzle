// Minimal zero-dependency game server: serves the pages and holds the shared game state
// so admin + participants on different devices (phones) stay in sync.
// Run:  node server.js        (HTTP  on port 3000)
// If cert.pem + key.pem exist next to this file it serves HTTPS instead (needed for phone mic).
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
let state = null; // authoritative game state (version-controlled)

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.png': 'image/png', '.ico': 'image/x-icon' };

function handler(req, res) {
  const url = new URL(req.url, 'http://x');

  if (url.pathname === '/api/state') {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'application/json');
    if (req.method === 'GET') {
      res.end(JSON.stringify({ state, serverTime: Date.now() }));
      return;
    }
    if (req.method === 'POST') {
      let body = '';
      req.on('data', c => { body += c; if (body.length > 5e6) req.destroy(); });
      req.on('end', () => {
        try {
          const { baseVersion, state: next } = JSON.parse(body);
          const currentVersion = state ? state.version : 0;
          if (currentVersion !== baseVersion) {
            res.statusCode = 409;
            res.end(JSON.stringify({ state, serverTime: Date.now() }));
            return;
          }
          state = next;
          res.end(JSON.stringify({ ok: true, serverTime: Date.now() }));
        } catch (e) {
          res.statusCode = 400;
          res.end(JSON.stringify({ error: 'bad request' }));
        }
      });
      return;
    }
    res.statusCode = 405;
    res.end('{}');
    return;
  }

  let rel = decodeURIComponent(url.pathname);
  if (rel === '/') rel = '/puzzle_envelope_relay_game.html';
  const file = path.join(ROOT, path.normalize(rel));
  if (!file.startsWith(ROOT)) { res.statusCode = 403; return res.end('Forbidden'); }
  fs.readFile(file, (err, data) => {
    if (err) { res.statusCode = 404; return res.end('Not found'); }
    res.setHeader('Content-Type', MIME[path.extname(file)] || 'application/octet-stream');
    res.end(data);
  });
}

const certPath = path.join(ROOT, 'cert.pem');
const keyPath = path.join(ROOT, 'key.pem');
const useHttps = fs.existsSync(certPath) && fs.existsSync(keyPath);
const server = useHttps
  ? https.createServer({ cert: fs.readFileSync(certPath), key: fs.readFileSync(keyPath) }, handler)
  : http.createServer(handler);

server.listen(PORT, '0.0.0.0', () => {
  const proto = useHttps ? 'https' : 'http';
  console.log(`\nKahoot Relay server running (${proto.toUpperCase()}).\n`);
  console.log(`  Admin (this computer):  ${proto}://localhost:${PORT}/admin.html`);
  for (const list of Object.values(os.networkInterfaces())) {
    for (const i of list) {
      if (i.family === 'IPv4' && !i.internal) {
        console.log(`  Phones (same Wi-Fi):    ${proto}://${i.address}:${PORT}/participant.html`);
      }
    }
  }
  console.log('');
});
