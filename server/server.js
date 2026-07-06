// Thin shell: static files over HTTP, lockstep relay over WebSocket.
// All pairing decisions live in rooms.js; nothing in here parses game state.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { WebSocketServer } = require('ws');
const Net = require('../src/net.js'); // UMD modules load fine under CommonJS
const { createRooms } = require('./rooms.js');

const PORT = process.env.PORT || 8735;
const ROOT = path.join(__dirname, '..');
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.png': 'image/png', '.ico': 'image/x-icon', '.md': 'text/plain',
};

function createGameServer() {
  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const filePath = path.normalize(path.join(ROOT, urlPath === '/' ? 'index.html' : urlPath));
    if (!filePath.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
    fs.readFile(filePath, (err, data) => {
      if (err) { res.writeHead(404); res.end('not found'); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
      res.end(data);
    });
  });

  const wss = new WebSocketServer({ server });
  const rooms = createRooms();
  const sockets = new Map(); // id -> ws
  let nextId = 1;
  const send = (id, obj) => {
    const ws = sockets.get(id);
    if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj));
  };

  wss.on('connection', (ws) => {
    const id = nextId++;
    sockets.set(id, ws);
    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }
      if (msg.type === 'hello') {
        if (msg.v !== Net.PROTOCOL_VERSION) send(id, { type: 'versionMismatch' });
      } else if (msg.type === 'host') {
        send(id, { type: 'hosted', code: rooms.host(id, msg.settings).code });
      } else if (msg.type === 'join') {
        const res = rooms.join(msg.code, id);
        if (res.error) { send(id, { type: 'joinError', reason: res.error }); return; }
        send(res.hostId, res.start[0]);
        send(id, res.start[1]);
      } else if (msg.type === 'input' || msg.type === 'ready') {
        const opponent = rooms.opponentOf(id);
        if (opponent !== null) send(opponent, msg);
      }
    });
    ws.on('close', () => {
      sockets.delete(id);
      const opponent = rooms.leave(id);
      if (opponent !== null) send(opponent, { type: 'opponentLeft' });
    });
  });

  return server;
}

if (require.main === module) {
  createGameServer().listen(PORT, () => console.log(`neon-cycles online server on :${PORT}`));
}

module.exports = { createGameServer };
