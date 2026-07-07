# Additional Music Tracks — Design Spec

Date: 2026-07-07
Status: Approved, ready for implementation planning

## Summary

`src/audio.js` currently generates one hardcoded procedural soundtrack (a
dark phrygian bass ostinato with a sparse arp lead). Add:

1. A second, original procedural track ("DARKWAVE") in an industrial/EBM
   rave style — inspired by the vibe of aggressive dark techno, not a
   transcription of any copyrighted recording — selectable alongside the
   original.
2. A menu-driven way to load a user-supplied local audio file as the
   gameplay track ("CUSTOM"), so a player can play their own legally-owned
   music (e.g. a purchased copy of a specific song) instead of either
   procedural track.

Track choice is a single menu-level setting (like WALLS/TRAIL/RIVAL today):
picked before a round starts, applied for that round, not persisted across
reloads. Default remains the current track, now called "ORIGINAL" — default
behavior is unchanged for anyone who never opens Settings.

## Goals

- Add real musical variety without touching the existing ORIGINAL track's
  sound or code path.
- Let players use their own audio files without the project ever bundling,
  fetching, or referencing copyrighted third-party audio.
- Reuse the existing step-sequencer primitives (`tone`, `noise`, `kick`,
  `env`) for DARKWAVE rather than building a second audio engine.

## Non-goals

- Persisting the chosen track or custom file across page reloads (no menu
  setting persists today; this doesn't start).
- Mixing/crossfading between tracks, or changing tracks mid-round.
- Applying the intensity-ramp lowpass sweep or Web-Audio-graph effects to
  the custom file — it's a simple background loop (per approved design),
  since the sweep only makes musical sense on synthesized oscillators.
- Any change to the one-shot SFX (`fireSfx`, `derezSfx`, `bounceSfx`,
  `pickupSfx`) or to the crash boom itself — those already go straight to
  `ctx.destination`/`master` independent of which music track is active.

## `src/audio.js` changes

### Track dispatch

- Rename the existing sequencer body `scheduleStep` → `scheduleStepOriginal`
  (logic untouched).
- Add `scheduleStepDarkwave` (new pattern, see below).
- `pump()`'s `scheduleStep(t)` call becomes a small dispatcher:
  ```js
  function scheduleStep(t) {
    (currentTrack === 'darkwave' ? scheduleStepDarkwave : scheduleStepOriginal)(t);
  }
  ```
- `stepInterval()` reads a per-track base tempo:
  ```js
  const TRACK_TEMPO = { original: 0.14, darkwave: 0.125 };
  function stepInterval() {
    return (TRACK_TEMPO[currentTrack] || TRACK_TEMPO.original) - intensity * 0.07;
  }
  ```
- `step` and `intensity` stay shared globals — only one track ever plays at
  a time, reset in `start()`.

### DARKWAVE pattern (new)

Same primitives as the original track, new arrangement:

- **Bass:** a pounding root-note pulse (`DARK_BASS = [0, 0, 0, 0, 3, 3, 0, 0]`,
  semitone offsets) run through a new small distortion helper (see below)
  instead of the plain `tone()` lowpass path, for a grittier industrial
  texture.
- **Kick:** four-on-the-floor every 4 steps like the original, but harder
  (`peak` closer to 1.0, faster pitch drop) for more aggression.
- **Hats:** every 16th step (busier than the original's accented-every-4th
  pattern), for a driving rave feel.
- **Siren stab:** every 32 steps (roughly every 2 bars), a swept-bandpass
  noise burst (reusing `noise()`, automating `.frequency` up then down over
  ~0.5s like the existing crash sweep) for an industrial siren accent.
- Tempo scales with intensity the same way as the original (shared
  `stepInterval()` formula, different base).

### Distortion helper (new, small)

```js
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

Used only by the DARKWAVE bass voice: oscillator → waveshaper → lowpass
filter → envelope gain → `master`, mirroring the existing `tone()` wiring
but with the extra waveshaper node spliced in.

### Custom track support (new)

```js
let customEl = null, customUrl = null;
const CUSTOM_VOLUME = 0.5, CUSTOM_DUCK = CUSTOM_VOLUME * 0.2;

function loadCustomTrack(file) {
  if (customUrl) URL.revokeObjectURL(customUrl);
  customUrl = URL.createObjectURL(file);
  if (!customEl) { customEl = new Audio(); customEl.loop = true; }
  customEl.src = customUrl;
  customEl.volume = CUSTOM_VOLUME;
}
```

- `start(track)` gains a parameter (`'original' | 'darkwave' | 'custom'`,
  defaults to `'original'`):
  - For `'original'`/`'darkwave'`: sets `currentTrack`, resets `step = 0`,
    starts drone + sequencer exactly as today.
  - For `'custom'`: sets `currentTrack = 'custom'`; if `customEl` has a
    `src`, resets `currentTime = 0`, sets `volume = CUSTOM_VOLUME`, calls
    `.play().catch(() => {})` (autoplay is already gated behind the same
    user gesture that reaches countdown-end today). If no file has been
    loaded yet, this is a silent no-op — the menu flow (below) makes this
    unreachable in practice.
- `stop()` additionally calls `customEl?.pause()` regardless of track (cheap
  no-op if not playing).
- `crash()` branches its duck/swell: for `'custom'`, ramps `customEl.volume`
  from `CUSTOM_DUCK` back to `CUSTOM_VOLUME` over 1.6s via a small
  `requestAnimationFrame` loop (no Web Audio automation available on a
  plain `<audio>` element); for the two procedural tracks, the existing
  `master.gain` ramp is unchanged. The boom/debris SFX after it is
  untouched in both cases.
- `setIntensity(v)` unchanged; harmless no-op effect on the custom track
  (nothing reads `intensity` outside the procedural path).

### Exports

Add `loadCustomTrack` to the returned API object. `start` keeps its name
but now takes an argument; every other export is unchanged.

## Menu wiring (`index.html` + `src/main.js`)

### `index.html`

New settings group, structurally identical to the existing `.trail-toggle`,
placed alongside it:

```html
<div class="music-toggle settings-group hidden" role="group" aria-label="Music track">
  <span class="hint">MUSIC</span>
  <button data-music="original" class="wall-btn active">ORIGINAL</button>
  <button data-music="darkwave" class="wall-btn">DARKWAVE</button>
  <button data-music="custom" id="music-custom-btn" class="wall-btn">CUSTOM…</button>
  <input type="file" id="music-file-input" accept="audio/*" class="hidden" />
</div>
```

Reuses `.wall-btn` styling and the `.settings-group` show/hide behavior
already wired to the SETTINGS button — no new CSS needed.

### `src/main.js`

- `state.musicTrack = 'original'` added to initial state, next to
  `trailMode`.
- New wiring block, mirroring `trailButtons`:
  ```js
  const musicButtons = document.querySelectorAll('[data-music]');
  const musicFileInput = el('music-file-input');
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
    musicButtons.forEach((b) => b.classList.toggle('active', b === el('music-custom-btn')));
    el('music-custom-btn').textContent = `CUSTOM: ${file.name.slice(0, 18)}`;
  });
  ```
  Clicking `CUSTOM…` always reopens the file picker (lets a player swap in
  a different file later in the session); clicking ORIGINAL/DARKWAVE always
  switches tracks directly without touching the file input.
- The single existing `Audio.start()` call site (on countdown-end) becomes
  `Audio.start(state.musicTrack)`.

## Edge cases

- **CUSTOM selected with no file loaded:** unreachable through the UI — the
  `custom` button's click handler always opens the file picker rather than
  directly selecting the track; `state.musicTrack` only ever becomes
  `'custom'` inside the file input's `change` handler, after a file exists.
- **File input cancelled:** `change` fires with an empty `FileList`; handled
  by the early `if (!file) return;` guard, leaving the previous track
  selection untouched.
- **Switching tracks between rounds:** each round's countdown-end calls
  `Audio.start(state.musicTrack)` fresh, so a mid-session track change
  takes effect on the next round without any special teardown.
- **Page reload with a custom file loaded:** the object URL and `<audio>`
  element are page-lifetime only; a reload returns to `state.musicTrack =
  'original'` like every other menu setting. Not treated as a bug.

## Testing plan

`audio.js` is a browser-only module with no unit tests today (per
CLAUDE.md), and this change doesn't alter that — the new code is exercised
manually in the browser preview:

- Start a round with MUSIC left on ORIGINAL — confirm it sounds unchanged
  from current behavior.
- Switch to DARKWAVE, start a round — confirm a distinctly different,
  faster/harder industrial pattern plays and still intensifies over time.
- Click CUSTOM…, pick a local audio file, start a round — confirm it loops
  the picked file, ducks briefly on crash, and resumes.
- Trigger a crash in both a procedural-track round and a custom-track round
  — confirm the boom SFX plays in both, and the music ducks/swells back in
  both.

## Files touched

- `src/audio.js` (track dispatch, DARKWAVE pattern, distortion helper,
  custom-file playback, `start`/`crash` branching, new `loadCustomTrack`
  export)
- `index.html` (new `.music-toggle` markup, version bump)
- `src/main.js` (state, menu wiring, `Audio.start(state.musicTrack)`)
- `package.json` (version bump)
- `CLAUDE.md` (brief mention of multi-track/custom-file support in the
  `audio.js` module description)
