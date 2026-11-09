const assert = require('node:assert');
const { test } = require('node:test');
const Hud = require('../src/hud');

test('turbo bar is full and ready when idle, and drains while burning', () => {
  assert.deepStrictEqual(Hud.turboMeter({ held: false, fuel: 3, cooldown: 0 }, 3, 15), { state: 'ready', fill: 1, note: '' });
  const burning = Hud.turboMeter({ held: true, fuel: 1.5, cooldown: 0 }, 3, 15);
  assert.strictEqual(burning.state, 'burning');
  assert.strictEqual(burning.fill, 0.5);
});

test('on cooldown the bar refills and counts the seconds left', () => {
  const start = Hud.turboMeter({ held: false, fuel: 0, cooldown: 15 }, 3, 15);
  assert.deepStrictEqual(start, { state: 'cooldown', fill: 0, note: '15s' });
  const late = Hud.turboMeter({ held: false, fuel: 0, cooldown: 2.2 }, 3, 15);
  assert.strictEqual(late.note, '3s');
  assert.ok(late.fill > 0.8 && late.fill < 1);
});

test('round pips are dropped when the match target is too long to draw', () => {
  assert.deepStrictEqual(Hud.rounds(2, 5), { won: 2, target: 5 });
  assert.strictEqual(Hud.rounds(2, 15), null);
});

test('pips light one cell per unit held', () => {
  assert.strictEqual(Hud.pips(2, 3), '<i class="on"></i><i class="on"></i><i></i>');
});

test('a panel carries its side, colour, bars and chips', () => {
  const html = Hud.panel({
    side: 'right', color: '#ff3b3b', name: 'AGGRESSOR', score: 2,
    rounds: { won: 2, target: 5 }, turbo: { state: 'burning', fill: 0.404, note: '' },
    ammo: { have: 1, cap: 3 }, chips: ['SHIELD'], sub: 'RIVAL 2/5',
  });
  assert.match(html, /class="hud-panel right" style="--c:#ff3b3b"/);
  assert.match(html, /hud-turbo burning/);
  assert.match(html, /width:40%/);
  assert.match(html, /hud-chip">SHIELD</);
  assert.match(html, /RIVAL 2\/5/);
  assert.strictEqual(html.split('class="on"').length - 1, 3, 'two rounds won plus one bolt');
});

test('a panel leaves out what it is not given', () => {
  const html = Hud.panel({ side: 'left', color: '#0ff', name: 'YOU', score: 0 });
  assert.doesNotMatch(html, /hud-turbo|hud-ammo|hud-rounds|hud-sub/);
});

test('the scoreboard shows both names and scores', () => {
  const html = Hud.scoreboard('FINAL', [{ name: 'YOU', score: 5, color: '#0ff' }, { name: 'DRIFTER', score: 3, color: '#0f0' }]);
  assert.match(html, /FINAL/);
  assert.match(html, /<em>YOU<\/em><b>5<\/b>/);
  assert.match(html, /<em>DRIFTER<\/em><b>3<\/b>/);
});
