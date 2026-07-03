(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window[api.__name] = api;
})(this, function () {
  let ctx = null, master = null, noiseBuf = null;
  let seqTimer = null, step = 0, nextTime = 0, intensity = 0, running = false;
  let drone = null;
  const ROOT = 55; // A1 — everything sits low and dark
  const BASS_RIFF = [0, 0, 12, 0, 1, 1, 10, 8]; // phrygian ostinato (b2 for menace)
  const ARP = [0, 3, 7, 8, 12, 8, 7, 3];        // minor with b6

  function ensure() {
    if (ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.2;
    master.connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = noiseBuf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }

  function env(g, t, peak, dur) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  }

  function tone(t, freq, dur, type, peak, cutoff, dest) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.value = freq;
    env(g, t, peak, dur);
    let head = o;
    if (cutoff) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass'; f.frequency.value = cutoff; f.Q.value = 5;
      o.connect(f); head = f;
    }
    head.connect(g); g.connect(dest || master);
    o.start(t); o.stop(t + dur + 0.05);
  }

  function noise(t, dur, peak, type, freq, dest) {
    const src = ctx.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq;
    const g = ctx.createGain();
    env(g, t, peak, dur);
    src.connect(f); f.connect(g); g.connect(dest || master);
    src.start(t); src.stop(t + dur + 0.05);
    return f;
  }

  function kick(t) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.setValueAtTime(130, t);
    o.frequency.exponentialRampToValueAtTime(38, t + 0.1);
    env(g, t, 0.9, 0.15);
    o.connect(g); g.connect(master); o.start(t); o.stop(t + 0.2);
  }

  function stepInterval() { return (0.14 - intensity * 0.07); } // s per 16th note

  function scheduleStep(t) {
    const cutoff = 400 + intensity * 2400; // filter opens as the game speeds up
    // driving bass ostinato on every 16th
    tone(t, ROOT * 2 * Math.pow(2, BASS_RIFF[step % 8] / 12), 0.11, 'sawtooth', 0.5, cutoff);
    // constant hat ticks, accented off the beat, for relentless forward motion
    noise(t, 0.03, step % 4 === 2 ? 0.16 : 0.07, 'highpass', 6000);
    if (step % 4 === 0) kick(t);
    // sparse dark lead an octave up, alternating 16ths
    if (step % 2 === 1) {
      const semis = ARP[(step >> 1) % 8] + (step % 32 >= 16 ? 12 : 0);
      tone(t, ROOT * 4 * Math.pow(2, semis / 12), 0.09, 'square', 0.1, cutoff + 800);
    }
    step++;
  }

  // lookahead scheduler: queue steps slightly ahead on the audio clock for tight timing
  function pump() {
    while (nextTime < ctx.currentTime + 0.12) {
      scheduleStep(nextTime);
      nextTime += stepInterval();
    }
    seqTimer = setTimeout(pump, 25);
  }

  function startDrone() {
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 160; f.Q.value = 8;
    const g = ctx.createGain(); g.gain.value = 0.12;
    const oscs = [ROOT, ROOT * 1.007, ROOT * 0.5].map((fr) => {
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = fr;
      o.connect(f); o.start(); return o;
    });
    f.connect(g); g.connect(master);
    drone = { oscs, filter: f, gain: g };
  }

  function start() {
    ensure(); if (ctx.state === 'suspended') ctx.resume();
    if (running) return; running = true; step = 0;
    nextTime = ctx.currentTime + 0.05;
    startDrone(); pump();
  }

  function stop() {
    running = false; if (seqTimer) clearTimeout(seqTimer); seqTimer = null;
    if (drone) {
      const t = ctx.currentTime;
      drone.gain.gain.setTargetAtTime(0.0001, t, 0.1);
      drone.oscs.forEach((o) => o.stop(t + 0.6));
      drone = null;
    }
  }

  function setIntensity(v) {
    intensity = Math.max(0, Math.min(1, v));
    if (drone) drone.filter.frequency.value = 160 + intensity * 360;
  }

  function crash() {
    ensure(); const t = ctx.currentTime;
    // duck the music so the blast lands, then swell back in
    master.gain.cancelScheduledValues(t);
    master.gain.setValueAtTime(0.04, t);
    master.gain.linearRampToValueAtTime(0.2, t + 1.6);
    const boom = ctx.createGain(); boom.gain.value = 0.55; boom.connect(ctx.destination);
    // sub impact: deep pitch drop
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.setValueAtTime(110, t);
    o.frequency.exponentialRampToValueAtTime(24, t + 1.1);
    g.gain.setValueAtTime(1, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.2);
    o.connect(g); g.connect(boom); o.start(t); o.stop(t + 1.3);
    // broadband blast sweeping down as the shockwave dissipates
    const f = noise(t, 1.4, 1, 'lowpass', 3500, boom);
    f.frequency.setValueAtTime(3500, t);
    f.frequency.exponentialRampToValueAtTime(80, t + 1.4);
    // debris crackle
    for (let i = 0; i < 6; i++) {
      noise(t + 0.12 + i * 0.09 + Math.random() * 0.05, 0.04, 0.25,
        'bandpass', 1500 + Math.random() * 2500, boom);
    }
  }

  function fireSfx() {
    ensure(); const t = ctx.currentTime;
    tone(t, 1400, 0.08, 'square', 0.3, 4000);
  }

  function derezSfx() {
    ensure(); const t = ctx.currentTime;
    noise(t, 0.12, 0.4, 'bandpass', 2200);
    tone(t, 220, 0.1, 'sawtooth', 0.25, 900);
  }

  return { __name: 'Audio', start, stop, setIntensity, crash, fireSfx, derezSfx };
});
