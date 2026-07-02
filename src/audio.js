(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window[api.__name] = api;
})(this, function () {
  let ctx = null, master = null, seqTimer = null, step = 0, intensity = 0, running = false;
  const SCALE = [0, 3, 5, 7, 10, 12, 15]; // minor pentatonic-ish
  const ROOT = 220;

  function ensure() {
    if (ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.18;
    master.connect(ctx.destination);
  }

  function note(freq, dur, type = 'sawtooth', gain = 0.5) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(gain, ctx.currentTime + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
    o.connect(g); g.connect(master); o.start(); o.stop(ctx.currentTime + dur);
  }

  function stepInterval() { return 260 - intensity * 150; } // ms per arp step

  function tick() {
    const semis = SCALE[step % SCALE.length] + (step % 14 >= 7 ? 12 : 0);
    note(ROOT * Math.pow(2, semis / 12), 0.16, 'sawtooth', 0.35);
    if (step % 4 === 0) note(ROOT / 2, 0.12, 'square', 0.25); // bass pulse
    step++;
    seqTimer = setTimeout(tick, stepInterval());
  }

  function start() { ensure(); if (ctx.state === 'suspended') ctx.resume();
    if (running) return; running = true; step = 0; tick(); }
  function stop() { running = false; if (seqTimer) clearTimeout(seqTimer); seqTimer = null; }
  function setIntensity(v) { intensity = Math.max(0, Math.min(1, v)); }
  function crash() { ensure();
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sawtooth'; o.frequency.setValueAtTime(180, ctx.currentTime);
    o.frequency.exponentialRampToValueAtTime(40, ctx.currentTime + 0.4);
    g.gain.setValueAtTime(0.5, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.4);
    o.connect(g); g.connect(master); o.start(); o.stop(ctx.currentTime + 0.4);
  }

  return { __name: 'Audio', start, stop, setIntensity, crash };
});
