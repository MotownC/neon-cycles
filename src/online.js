(function (root, factory) {
  const api = factory(typeof require === 'function' ? require('./net') : window.Net);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window[api.__name] = api;
})(this, function (Net) {
  // Browser-only shell bridging main.js to the WebSocket server. All lockstep
  // logic lives in net.js; this file only moves messages.
  let ws = null;
  let handlers = {};

  const ROUTES = {
    hosted: 'onHosted', start: 'onStart', input: 'onInput', ready: 'onReady',
    joinError: 'onJoinError', opponentLeft: 'onOpponentLeft', versionMismatch: 'onVersionMismatch',
  };

  function connect(h) {
    handlers = h;
    return new Promise((resolve, reject) => {
      if (ws && ws.readyState === 1) return resolve();
      if (window.location.protocol === 'file:') {
        return reject(new Error('ONLINE NEEDS THE HOSTED URL, NOT A LOCAL FILE'));
      }
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const socket = new WebSocket(proto + '//' + window.location.host);
      ws = socket;
      socket.onopen = () => { send({ type: 'hello', v: Net.PROTOCOL_VERSION }); resolve(); };
      socket.onerror = () => { if (ws === socket) { ws = null; reject(new Error('COULD NOT REACH SERVER')); } };
      socket.onclose = () => {
        if (ws !== socket) return; // deliberate disconnect() already cleaned up
        ws = null;
        if (handlers.onClosed) handlers.onClosed();
      };
      socket.onmessage = (ev) => {
        let msg;
        try { msg = JSON.parse(ev.data); } catch { return; }
        const fn = handlers[ROUTES[msg.type]];
        if (fn) fn(msg);
      };
    });
  }

  function send(msg) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg)); }

  function disconnect() {
    const socket = ws;
    ws = null;          // clear first so onclose doesn't fire onClosed
    handlers = {};
    if (socket) socket.close();
  }

  function connected() { return !!ws && ws.readyState === 1; }

  return { __name: 'Online', connect, send, disconnect, connected };
});
