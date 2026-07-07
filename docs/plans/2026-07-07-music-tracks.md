# Additional Music Tracks Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a second procedural soundtrack ("DARKWAVE", an original industrial/EBM-style track) and a menu-driven custom local-audio-file picker ("CUSTOM"), alongside the existing soundtrack (now labeled "ORIGINAL"), selectable from a new MUSIC settings toggle.

**Architecture:** `src/audio.js` gains a `currentTrack` dispatch between two procedural step-sequencer patterns (reusing existing `tone`/`noise`/`kick`/`env` primitives, plus one new distortion helper) and a plain `<audio loop>` element for user-supplied files. `src/main.js` and `index.html` get a new `MUSIC` menu toggle wired the same way as the existing `TRAIL` toggle, plus a hidden file input for the custom option.

**Tech Stack:** Vanilla JS, Web Audio API, HTML5 `<audio>` + `File`/`Object URL`. No new dependencies. No automated tests are added — `audio.js`, `main.js`, and `index.html` are all browser-only/no-unit-test surfaces per `CLAUDE.md`; verification is a manual browser pass (Task 8) using the preview tools, plus a Node `require()` sanity check after every `audio.js` edit to catch syntax errors immediately.

Reference spec: `docs/superpowers/specs/2026-07-07-music-tracks-design.md`

---

### Task 1: Track dispatch scaffolding in `audio.js`

**Files:**
- Modify: `src/audio.js:6-11` (globals), `src/audio.js:63` (`stepInterval`), `src/audio.js:65-78` (`scheduleStep`), `src/audio.js:100-105` (`start`)

**Step 1: Add `currentTrack` and `TRACK_TEMPO` globals**

Edit `src/audio.js` — after line 11 (`const ARP = ...`), add:

```js
  let currentTrack = 'original';
  const TRACK_TEMPO = { original: 0.14, darkwave: 0.125 };
```

**Step 2: Make `stepInterval` track-aware**

Replace:
```js
  function stepInterval() { return (0.14 - intensity * 0.07); } // s per 16th note
```
with:
```js
  function stepInterval() {
    return (TRACK_TEMPO[currentTrack] || TRACK_TEMPO.original) - intensity * 0.07;
  }
```

**Step 3: Rename the existing sequencer body and add a dispatcher**

Rename the current `scheduleStep` function to `scheduleStepOriginal` (body unchanged — just the function name on the `function scheduleStep(t) {` line becomes `function scheduleStepOriginal(t) {`).

Then add a temporary stub for the darkwave pattern (real implementation lands in Task 2) and the dispatcher, right after `scheduleStepOriginal`'s closing brace:

```js
  function scheduleStepDarkwave(t) {
    scheduleStepOriginal(t); // placeholder until Task 2 fills in the real pattern
  }

  function scheduleStep(t) {
    (currentTrack === 'darkwave' ? scheduleStepDarkwave : scheduleStepOriginal)(t);
  }
```

**Step 4: Make `start` accept a track key**

Replace:
```js
  function start() {
    ensure(); if (ctx.state === 'suspended') ctx.resume();
    if (running) return; running = true; step = 0;
    nextTime = ctx.currentTime + 0.05;
    startDrone(); pump();
  }
```
with:
```js
  function start(track) {
    ensure(); if (ctx.state === 'suspended') ctx.resume();
    if (running) return; running = true;
    currentTrack = track || 'original';
    step = 0;
    nextTime = ctx.currentTime + 0.05;
    startDrone(); pump();
  }
```

**Step 5: Sanity-check the file still parses**

Run: `node -e "require('./src/audio.js'); console.log('ok')"`
Expected: prints `ok` with no errors.

**Step 6: Run the full test suite**

Run: `node --test`
Expected: `# pass 188`, `# fail 0` (unchanged from baseline — `audio.js` isn't exercised by any test file, this just confirms nothing else broke).

**Step 7: Commit**

```bash
git add src/audio.js
git commit -m "feat: add per-track tempo dispatch scaffolding in audio.js"
```

---

### Task 2: DARKWAVE procedural pattern

**Files:**
- Modify: `src/audio.js` (add distortion helper + darkwave voices, replace the Task 1 stub)

**Step 1: Add the distortion helper and darkwave bass riff constant**

Add near the top, after the `TRACK_TEMPO` line added in Task 1:

```js
  const DARK_BASS = [0, 0, 0, 0, 3, 3, 0, 0]; // pounding root pulse with a minor-third stab

  let distortionCurve = null;
  function distortionShaper(amount = 40) {
    if (!distortionCurve) {
      distortionCurve = new Float32Array(256);
      for (let i = 0; i < 256; i++) {
        const x = (i / 128) - 1;
        distortionCurve[i] = Math.tanh(amount * x) / Math.tanh(amount);
      }
    }
    const ws = ctx.createWaveShaper();
    ws.curve = distortionCurve;
    return ws;
  }
```

**Step 2: Add the darkwave bass voice, a harder kick, and a siren stab**

Add these functions right after `kick(t)` (which stays unchanged and is still used by the original track):

```js
  function hardKick(t) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(35, t + 0.07);
    env(g, t, 1.0, 0.13);
    o.connect(g); g.connect(master); o.start(t); o.stop(t + 0.18);
  }

  function darkBassTone(t, freq, dur, peak, cutoff) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sawtooth'; o.frequency.value = freq;
    const ws = distortionShaper();
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = cutoff; f.Q.value = 4;
    env(g, t, peak, dur);
    o.connect(ws); ws.connect(f); f.connect(g); g.connect(master);
    o.start(t); o.stop(t + dur + 0.05);
  }

  function sirenStab(t) {
    const f = noise(t, 0.5, 0.3, 'bandpass', 600);
    f.frequency.setValueAtTime(600, t);
    f.frequency.exponentialRampToValueAtTime(3200, t + 0.25);
    f.frequency.exponentialRampToValueAtTime(600, t + 0.5);
  }
```

**Step 3: Replace the Task 1 stub with the real DARKWAVE step pattern**

Replace:
```js
  function scheduleStepDarkwave(t) {
    scheduleStepOriginal(t); // placeholder until Task 2 fills in the real pattern
  }
```
with:
```js
  function scheduleStepDarkwave(t) {
    const cutoff = 500 + intensity * 3000;
    darkBassTone(t, ROOT * 2 * Math.pow(2, DARK_BASS[step % 8] / 12), 0.1, 0.55, cutoff);
    // busier 16th-note hats than the original track, for a driving rave feel
    noise(t, 0.025, step % 2 === 0 ? 0.15 : 0.09, 'highpass', 7000);
    if (step % 4 === 0) hardKick(t);
    if (step % 32 === 16) sirenStab(t);
    step++;
  }
```

**Step 4: Sanity-check and test**

Run: `node -e "require('./src/audio.js'); console.log('ok')"`
Expected: prints `ok`.

Run: `node --test`
Expected: `# pass 188`, `# fail 0`.

**Step 5: Commit**

```bash
git add src/audio.js
git commit -m "feat: add DARKWAVE procedural track pattern"
```

---

### Task 3: Custom audio file playback

**Files:**
- Modify: `src/audio.js` (custom-track state, `loadCustomTrack`/`playCustomTrack`/`stopCustomTrack`/`duckCustomTrack`, `start`/`stop`/`crash` branching, exports)

**Step 1: Add custom-track state**

Add after the `TRACK_TEMPO`/`DARK_BASS` constants block:

```js
  let customEl = null, customUrl = null;
  const CUSTOM_VOLUME = 0.5, CUSTOM_DUCK = CUSTOM_VOLUME * 0.2;
```

**Step 2: Add the custom-track functions**

Add these near `startDrone`/`stop` (anywhere in the file after `ensure` is defined, since they reference `ctx` indirectly only via globals — no direct `ctx` use except through `URL`/`Audio`, which are browser globals):

```js
  function loadCustomTrack(file) {
    if (customUrl) URL.revokeObjectURL(customUrl);
    customUrl = URL.createObjectURL(file);
    if (!customEl) { customEl = new Audio(); customEl.loop = true; }
    customEl.src = customUrl;
    customEl.volume = CUSTOM_VOLUME;
  }

  function playCustomTrack() {
    if (!customEl || !customEl.src) return;
    customEl.currentTime = 0;
    customEl.volume = CUSTOM_VOLUME;
    customEl.play().catch(() => {});
  }

  function duckCustomTrack() {
    if (!customEl) return;
    customEl.volume = CUSTOM_DUCK;
    const t0 = performance.now();
    (function rampBack() {
      const p = Math.min(1, (performance.now() - t0) / 1600);
      customEl.volume = CUSTOM_DUCK + (CUSTOM_VOLUME - CUSTOM_DUCK) * p;
      if (p < 1) requestAnimationFrame(rampBack);
    })();
  }
```

**Step 3: Branch `start` for the custom track**

Replace the `start` function written in Task 1:
```js
  function start(track) {
    ensure(); if (ctx.state === 'suspended') ctx.resume();
    if (running) return; running = true;
    currentTrack = track || 'original';
    step = 0;
    nextTime = ctx.currentTime + 0.05;
    startDrone(); pump();
  }
```
with:
```js
  function start(track) {
    ensure(); if (ctx.state === 'suspended') ctx.resume();
    if (running) return; running = true;
    currentTrack = track || 'original';
    if (currentTrack === 'custom') {
      playCustomTrack();
    } else {
      step = 0;
      nextTime = ctx.currentTime + 0.05;
      startDrone(); pump();
    }
  }
```

**Step 4: Pause the custom element in `stop`**

Replace:
```js
  function stop() {
    running = false; if (seqTimer) clearTimeout(seqTimer); seqTimer = null;
    if (drone) {
      const t = ctx.currentTime;
      drone.gain.gain.setTargetAtTime(0.0001, t, 0.1);
      drone.oscs.forEach((o) => o.stop(t + 0.6));
      drone = null;
    }
  }
```
with:
```js
  function stop() {
    running = false; if (seqTimer) clearTimeout(seqTimer); seqTimer = null;
    if (drone) {
      const t = ctx.currentTime;
      drone.gain.gain.setTargetAtTime(0.0001, t, 0.1);
      drone.oscs.forEach((o) => o.stop(t + 0.6));
      drone = null;
    }
    if (customEl) customEl.pause();
  }
```

**Step 5: Branch the duck/swell in `crash`**

Replace the top of `crash`:
```js
  function crash() {
    ensure(); const t = ctx.currentTime;
    // duck the music so the blast lands, then swell back in
    master.gain.cancelScheduledValues(t);
    master.gain.setValueAtTime(0.04, t);
    master.gain.linearRampToValueAtTime(0.2, t + 1.6);
```
with:
```js
  function crash() {
    ensure(); const t = ctx.currentTime;
    // duck the music so the blast lands, then swell back in
    if (currentTrack === 'custom' && customEl) {
      duckCustomTrack();
    } else {
      master.gain.cancelScheduledValues(t);
      master.gain.setValueAtTime(0.04, t);
      master.gain.linearRampToValueAtTime(0.2, t + 1.6);
    }
```
(The rest of `crash` — the boom/sub-impact/noise-sweep/debris-crackle SFX — is unchanged.)

**Step 6: Export `loadCustomTrack`**

Replace:
```js
  return { __name: 'Audio', start, stop, setIntensity, crash, fireSfx, derezSfx, bounceSfx, pickupSfx };
```
with:
```js
  return { __name: 'Audio', start, stop, setIntensity, crash, fireSfx, derezSfx, bounceSfx, pickupSfx, loadCustomTrack };
```

**Step 7: Sanity-check and test**

Run: `node -e "require('./src/audio.js'); console.log('ok')"`
Expected: prints `ok`.

Run: `node --test`
Expected: `# pass 188`, `# fail 0`.

**Step 8: Commit**

```bash
git add src/audio.js
git commit -m "feat: support a user-supplied custom audio track"
```

---

### Task 4: MUSIC menu markup in `index.html`

**Files:**
- Modify: `index.html:91-99` (insert new toggle between the existing `.trail-toggle` and `.color-toggle` groups)

**Step 1: Insert the new settings group**

Find:
```html
      <div class="trail-toggle settings-group hidden" role="group" aria-label="Trail mode">
        <span class="hint">TRAIL</span>
        <button data-trail="tron" class="wall-btn active">TRON</button>
        <button data-trail="fade" class="wall-btn">FADE</button>
        <button data-trail="classic" class="wall-btn">CLASSIC</button>
      </div>
      <div class="color-toggle settings-group hidden" id="color-toggle" role="group" aria-label="Cycle color">
```
Replace with:
```html
      <div class="trail-toggle settings-group hidden" role="group" aria-label="Trail mode">
        <span class="hint">TRAIL</span>
        <button data-trail="tron" class="wall-btn active">TRON</button>
        <button data-trail="fade" class="wall-btn">FADE</button>
        <button data-trail="classic" class="wall-btn">CLASSIC</button>
      </div>
      <div class="music-toggle settings-group hidden" role="group" aria-label="Music track">
        <span class="hint">MUSIC</span>
        <button data-music="original" class="wall-btn active">ORIGINAL</button>
        <button data-music="darkwave" class="wall-btn">DARKWAVE</button>
        <button data-music="custom" id="music-custom-btn" class="wall-btn">CUSTOM…</button>
        <input type="file" id="music-file-input" accept="audio/*" class="hidden" />
      </div>
      <div class="color-toggle settings-group hidden" id="color-toggle" role="group" aria-label="Cycle color">
```

This reuses the existing `.wall-btn` button styling and the `.settings-group` show/hide rule already wired to the SETTINGS button — no CSS changes needed.

**Step 2: Commit**

```bash
git add index.html
git commit -m "feat: add MUSIC settings group to the menu"
```

---

### Task 5: Wire the MUSIC menu in `src/main.js`

**Files:**
- Modify: `src/main.js:45` (state), `src/main.js:184` (`Audio.start()` call site), `src/main.js:652-656` (insert wiring block after `trailButtons`)

**Step 1: Add `musicTrack` to initial state**

Replace:
```js
    trailMode: 'tron',
```
with:
```js
    trailMode: 'tron',
    musicTrack: 'original',
```

**Step 2: Pass the selected track into `Audio.start`**

Replace:
```js
      if (n <= 0) { clearInterval(iv); show(null); hud.classList.remove('hidden');
        state.phase = 'playing'; state.last = performance.now(); Audio.start(); }
```
with:
```js
      if (n <= 0) { clearInterval(iv); show(null); hud.classList.remove('hidden');
        state.phase = 'playing'; state.last = performance.now(); Audio.start(state.musicTrack); }
```

**Step 3: Add the MUSIC button + file-input wiring**

Replace:
```js
  const trailButtons = document.querySelectorAll('[data-trail]');
  trailButtons.forEach((btn) => btn.addEventListener('click', () => {
    state.trailMode = btn.dataset.trail;
    trailButtons.forEach((b) => b.classList.toggle('active', b === btn));
  }));
```
with:
```js
  const trailButtons = document.querySelectorAll('[data-trail]');
  trailButtons.forEach((btn) => btn.addEventListener('click', () => {
    state.trailMode = btn.dataset.trail;
    trailButtons.forEach((b) => b.classList.toggle('active', b === btn));
  }));

  const musicButtons = document.querySelectorAll('[data-music]');
  const musicFileInput = el('music-file-input');
  const musicCustomBtn = el('music-custom-btn');
  musicButtons.forEach((btn) => btn.addEventListener('click', () => {
    if (btn.dataset.music === 'custom') { musicFileInput.click(); return; }
    state.musicTrack = btn.dataset.music;
    musicButtons.forEach((b) => b.classList.toggle('active', b === btn));
  }));
  musicFileInput.addEventListener('change', () => {
    const file = musicFileInput.files[0];
    if (!file) return;
    Audio.loadCustomTrack(file);
    state.musicTrack = 'custom';
    musicButtons.forEach((b) => b.classList.toggle('active', b === musicCustomBtn));
    musicCustomBtn.textContent = `CUSTOM: ${file.name.slice(0, 18)}`;
  });
```

**Step 4: Run the test suite**

Run: `node --test`
Expected: `# pass 188`, `# fail 0` (`main.js` is browser-only and untested directly, this confirms no other module regressed).

**Step 5: Commit**

```bash
git add src/main.js
git commit -m "feat: wire MUSIC menu toggle and custom file picker into main.js"
```

---

### Task 6: Document the change in `CLAUDE.md`

**Files:**
- Modify: `CLAUDE.md` (the `audio.js` mention in the "Browser-only modules" list)

**Step 1: Update the module description**

Find:
```
`audio.js` (procedural Web Audio soundtrack that intensifies over time, crash SFX)
```
Replace with:
```
`audio.js` (two selectable procedural Web Audio soundtracks — ORIGINAL and DARKWAVE — that intensify over time, plus a user-supplied custom audio file track and crash SFX)
```

**Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: note multi-track audio support in CLAUDE.md"
```

---

### Task 7: Version bump

**Files:**
- Modify: `package.json:3`, `index.html` (all `?v=0.16.0` occurrences and the `#version` element)

**Step 1: Bump `package.json`**

Replace:
```json
  "version": "0.16.0",
```
with:
```json
  "version": "0.17.0",
```

**Step 2: Bump every `?v=0.16.0` in `index.html`, including the stylesheet link and every script tag, to `?v=0.17.0`**

This is a global find-and-replace of the literal string `v=0.16.0` → `v=0.17.0` across `index.html` (18 occurrences: 1 stylesheet + 17 scripts).

**Step 3: Bump the visible version string**

Replace:
```html
      <p class="hint" id="version">v0.16.0</p>
```
with:
```html
      <p class="hint" id="version">v0.17.0</p>
```

**Step 4: Verify no stale references remain**

Run: `grep -c "0.16.0" index.html package.json`
Expected: `index.html:0` and `package.json:0` (or the grep reports no matches at all).

**Step 5: Commit**

```bash
git add package.json index.html
git commit -m "chore: bump version to 0.17.0 for additional music tracks"
```

---

### Task 8: Manual browser verification

**Files:** none (verification only)

**Step 1: Start the static preview server**

Use `preview_start` with the `neon-cycles-static` config from `.claude/launch.json` (port 8734).

**Step 2: Load the game and open Settings**

`preview_snapshot` to confirm the MUSIC toggle group (ORIGINAL/DARKWAVE/CUSTOM…) appears after clicking SETTINGS, with ORIGINAL active by default.

**Step 3: Verify ORIGINAL is unchanged**

Start a 1P Survival round with MUSIC left on ORIGINAL. Use `preview_console_logs` to confirm no errors. This is the pre-existing soundtrack — behavior should be identical to before this change.

**Step 4: Verify DARKWAVE**

Return to the menu (`Audio.stop()` fires automatically), switch MUSIC to DARKWAVE, start another round. Confirm via `preview_console_logs` there are no errors, and via `preview_eval` that `window.Audio` is running (e.g. check no thrown exceptions from `ensure()`/`start()`). Let it play a few seconds, then trigger a crash (drive into a wall) and confirm the game's crash flow completes normally (round-over overlay shows).

**Step 5: Verify CUSTOM**

Click `CUSTOM…`, use `preview_fill` or direct DOM interaction to supply a small local test audio file to the `#music-file-input` element (any short local `.mp3`/`.wav` — a system sound file is fine for verification purposes). Confirm the button label updates to `CUSTOM: <filename>`, start a round, and confirm via `preview_console_logs` there are no errors and via `preview_network`/`preview_eval` that the `<audio>` element is playing (`document.querySelector` isn't available for a dynamically created `Audio()` — instead check via `preview_eval` that calling into the module doesn't throw; e.g. evaluate a small script that confirms `state.musicTrack === 'custom'` if `state` is reachable, or rely on absence of console errors plus the visual round proceeding normally).

**Step 6: Verify crash duck on CUSTOM**

While a CUSTOM round is playing, trigger a crash and confirm the round-over flow completes without console errors (the volume ramp itself isn't observable via these tools, but a clean crash/duck/stop cycle with no exceptions is the signal that `duckCustomTrack`/`crash` branching didn't break anything).

**Step 7: Clean up**

Per `CLAUDE.md`'s browser-preview-testing note: call `window.Audio.stop()` via `preview_eval` (or navigate back to the menu, which calls it too) before ending the session, so no soundtrack keeps playing in the background.

**Step 8: Final full test-suite run**

Run: `node --test`
Expected: `# pass 188`, `# fail 0`.

No commit for this task (verification only) — if any issue is found, fix it in the relevant earlier task's files and commit a follow-up fix.
