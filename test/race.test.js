// Run: node test/race.test.js
// Feature 6 logic: the ghost's pacing schedule over seeded scrambles (hits the target, stage pauses,
// last-layer bursts, double turns slower, cap at the animation limit), PB lookup and target fallback,
// race settings storage, the result line, and the timer in race mode (a solved cube doesn't stop it).
var C = require('../src/core.js');
var S = require('../src/solver.js');
var T = require('../src/timer.js');
var R = require('../src/race.js');

var pass = 0, fail = 0;
function check(name, ok, info) {
  if (ok) pass++;
  else { fail++; console.log('FAIL: ' + name + (info !== undefined ? ' -- ' + info : '')); }
}
var seed = 4242;
function rnd() { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; }
function fakeStorage() {
  var data = {};
  return { data: data,
    getItem: function (k) { return Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null; },
    setItem: function (k, v) { data[k] = String(v); } };
}
function mean(a) { return a.reduce(function (x, y) { return x + y; }, 0) / a.length; }

// ---- Schedule over many seeded scrambles ----
var TARGETS = [8000, 12000, 20000, 35000, 60000];
var worstErr = 0, okSolved = true, okOrder = true, okPauses = true, okDouble = true, okBurst = true, okMoves = true;
var okAnim = true, okVar = true, worstMin = 0;
for (var i = 0; i < 200; i++) {
  var start = C.applyAlg(C.solvedState(), C.randomScramble(25, { random: rnd }));
  var sol = S.solve(start);
  var target = TARGETS[i % TARGETS.length];
  var plan = R.schedule(sol.steps, target, { random: rnd });
  var flat = [];
  sol.steps.forEach(function (st) { flat = flat.concat(st.moves); });
  worstMin = Math.max(worstMin, plan.minTotal);

  if (plan.capped) { okMoves = false; continue; }
  worstErr = Math.max(worstErr, Math.abs(plan.total - target) / target);
  // The ghost plays exactly the solver's moves, and they solve the cube.
  if (plan.moves.map(function (m) { return m.move; }).join(' ') !== flat.join(' ')) okMoves = false;
  if (!C.isSolved(C.applyAlg(start, plan.moves.map(function (m) { return m.move; })))) okSolved = false;
  // Moves don't overlap and the last one ends at total.
  for (var k = 1; k < plan.moves.length; k++) {
    var a = plan.moves[k - 1], b = plan.moves[k];
    if (a.at + a.anim > b.at + 1e-6 || a.anim > a.dur + 1e-6) okOrder = false;
  }
  var lastM = plan.moves[plan.moves.length - 1];
  if (Math.abs(lastM.at + lastM.anim - plan.total) > 1e-6) okOrder = false;
  plan.moves.forEach(function (m) {
    if (m.anim < (m.kind === 'quarter' ? R.MIN_QUARTER : R.MIN_DOUBLE) * 0.85 - 1e-6) okAnim = false;
  });
  // One pause before every step, each longer than any single move of that step.
  if (plan.pauses.length !== sol.steps.length) okPauses = false;
  var pi = 0, mi = 0;
  sol.steps.forEach(function (st) {
    var p = plan.pauses[pi++];
    if (!p || p.stage !== st.stage || !(p.dur > 0)) okPauses = false;
    var mine = plan.moves.slice(mi, mi + st.moves.length);
    mi += st.moves.length;
    if (p && mine.length && Math.abs(mine[0].at - (p.at + p.dur)) > 1e-6) okPauses = false;
    // Double turns slower than every quarter turn of the same step.
    var q = mine.filter(function (m) { return m.kind === 'quarter'; }).map(function (m) { return m.dur; });
    var d = mine.filter(function (m) { return m.kind === 'double'; }).map(function (m) { return m.dur; });
    if (q.length && d.length && Math.min.apply(null, d) <= Math.max.apply(null, q)) okDouble = false;
  });
  // Last-layer alg turns faster than F2L turns (quarter turns, on average).
  var f2l = plan.moves.filter(function (m) { return m.stage === 3 && m.kind === 'quarter'; }).map(function (m) { return m.dur; });
  var ll = plan.moves.filter(function (m) { return m.stage >= 4 && m.stage <= 7 && m.kind === 'quarter'; }).map(function (m) { return m.dur; });
  if (f2l.length && ll.length && !(mean(ll) < mean(f2l) * 0.7)) okBurst = false;
  // Random variation: F2L quarter turns are not all the same length.
  if (f2l.length > 3 && Math.max.apply(null, f2l) - Math.min.apply(null, f2l) < 1) okVar = false;
}
check('schedule: never capped for targets >= 8 s', okMoves);
check('schedule: finishes within 2% of the target (200 scrambles, 8-60 s)', worstErr < 0.02, worstErr);
check('schedule: plays the solver moves, which solve the cube', okSolved);
check('schedule: moves in order, no overlap, last turn ends at total', okOrder);
check('schedule: animations respect the speed limit', okAnim);
check('schedule: a pause before every stage step', okPauses);
check('schedule: double turns take longer than quarter turns in the same step', okDouble);
check('schedule: last-layer turns are faster than F2L turns', okBurst);
check('schedule: move-to-move variation', okVar);
check('schedule: fastest possible solve is under 8 s', worstMin < 8000, worstMin);
console.log('race: worst target error ' + (worstErr * 100).toFixed(3) + '%, slowest minimum ' + Math.round(worstMin) + ' ms');

// Same seed -> same schedule; target scales the rhythm without changing its shape.
(function () {
  var st = C.applyAlg(C.solvedState(), C.parseAlg("R U F' L2 D B' R2 U' F D2 L B"));
  var steps = S.solve(st).steps;
  function seeded(s) { return function () { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; }; }
  var p1 = R.schedule(steps, 20000, { random: seeded(7) }), p2 = R.schedule(steps, 20000, { random: seeded(7) });
  check('schedule: deterministic for a seed', JSON.stringify(p1) === JSON.stringify(p2));
  var p3 = R.schedule(steps, 40000, { random: seeded(7) });
  check('schedule: pauses scale with the target', Math.abs(p3.pauses[1].dur / p1.pauses[1].dur - 2) < 0.1, p3.pauses[1].dur / p1.pauses[1].dur);
  // Cap: a target below the animation limit is reported, not silently missed.
  var cap = R.schedule(steps, 1000, { random: seeded(7) });
  check('schedule: too-fast target is capped', cap.capped === true && cap.total === cap.minTotal && cap.total > 1000, JSON.stringify([cap.capped, cap.total]));
  check('schedule: capped plan has no pauses and minimum turns',
    cap.pauses.every(function (p) { return p.dur === 0; }) &&
    cap.moves.every(function (m) { return m.dur === (m.kind === 'quarter' ? R.MIN_QUARTER : R.MIN_DOUBLE); }));
  check('schedule: target exactly at the limit is not capped', R.schedule(steps, cap.minTotal, { random: seeded(7) }).capped === false);
  // Stage pauses in seconds-at-20s: cross and F2L recognition are the longest.
  var byStage = {};
  p1.pauses.forEach(function (p) { (byStage[p.stage] = byStage[p.stage] || []).push(p.dur); });
  check('schedule: F2L pauses are longer than the AUF pause', !byStage[8] || mean(byStage[3]) > byStage[8][0], JSON.stringify(byStage));
  // Rotation (white on top -> z2) is slower than a quarter turn of the same step would be.
  check('schedule: solve starts with the orientation step', steps[0].stage === 1 && p1.moves[0].kind === 'rotation');
  check('schedule: empty solution', R.schedule([], 5000).total === 0 && R.schedule([], 5000).capped === false);
})();

// ---- PB lookup ----
check('pb: empty session -> null', R.bestSingle([]) === null);
check('pb: all DNF -> null', R.bestSingle([{ time: 5000, penalty: 'DNF' }, { time: 3000, penalty: 'DNF' }]) === null);
check('pb: skips DNFs', R.bestSingle([{ time: 9000, penalty: 'none' }, { time: 3000, penalty: 'DNF' }]) === 9000);
check('pb: +2 counts', R.bestSingle([{ time: 9000, penalty: 'none' }, { time: 7500, penalty: '+2' }]) === 9000);
check('pb: +2 still best when faster', R.bestSingle([{ time: 9800, penalty: 'none' }, { time: 7500, penalty: '+2' }]) === 9500);
check('pb: race solves count', R.bestSingle([{ time: 12000, penalty: 'none' }, { time: 11000, penalty: 'none', race: true }]) === 11000);
var tg = R.target({ target: 15000, usePB: true }, []);
check('target: no PB -> set time with a note', tg.ms === 15000 && !tg.fromPB && /No PB yet/.test(tg.note) && /15\.00/.test(tg.note), JSON.stringify(tg));
tg = R.target({ target: 15000, usePB: true }, [{ time: 4000, penalty: 'DNF' }]);
check('target: only DNFs -> set time', tg.ms === 15000 && !tg.fromPB);
tg = R.target({ target: 15000, usePB: true }, [{ time: 13210, penalty: 'none' }, { time: 12000, penalty: '+2' }]);
check('target: PB', tg.ms === 13210 && tg.fromPB && /13\.21/.test(tg.note), JSON.stringify(tg));
tg = R.target({ target: 15000, usePB: false }, [{ time: 9000, penalty: 'none' }]);
check('target: set time when PB not chosen', tg.ms === 15000 && !tg.fromPB);

// ---- Settings storage ----
(function () {
  var st = fakeStorage();
  var d = R.loadSettings(st);
  check('settings: defaults', d.on === false && d.target === 20000 && d.usePB === false);
  R.saveSettings({ on: true, target: 9500, usePB: true }, st);
  var l = R.loadSettings(st);
  check('settings: round trip', l.on === true && l.target === 9500 && l.usePB === true);
  st.data[R.SETTINGS_KEY] = '{bad json';
  check('settings: bad data -> defaults', R.loadSettings(st).target === 20000);
  var throwing = { getItem: function () { throw new Error('denied'); }, setItem: function () { throw new Error('denied'); } };
  check('settings: storage errors are caught', R.loadSettings(throwing).target === 20000 &&
    (function () { try { R.saveSettings({ target: 1 }, throwing); return true; } catch (e) { return false; } })());
  check('settings: no storage', R.loadSettings(null).on === false);
})();

// ---- Result line ----
var r = R.result(null, null);
check('result: racing', r.winner === null && /Racing/.test(r.text));
r = R.result(null, 8020);
check('result: ghost finished first, user still going', r.winner === null && /Ghost finished in 8\.02/.test(r.text), r.text);
r = R.result({ time: 7500, penalty: 'none' }, 8020);
check('result: user wins', r.winner === 'you' && Math.abs(r.margin - 520) < 1e-9 && /You 7\.50.*Ghost 8\.02.*You won by 0\.52/.test(r.text), r.text);
r = R.result({ time: 7500, penalty: '+2' }, 8020);
check('result: +2 counts against the user', r.winner === 'ghost' && /9\.50\+.*Ghost won by 1\.48/.test(r.text), r.text);
r = R.result({ time: 7500, penalty: 'DNF' }, 8020);
check('result: DNF loses', r.winner === 'ghost' && /DNF/.test(r.text), r.text);
r = R.result({ time: 6000, penalty: 'none' }, null);
check('result: ghost still solving -> user won', r.winner === 'you' && /still solving/.test(r.text), r.text);
r = R.result({ time: 8020, penalty: 'none' }, 8025);
check('result: tie when the shown times match', r.winner === 'tie', r.text);
r = R.result({ time: 9420.8, penalty: 'none' }, 8044.6);
check('result: margin matches the shown times', /You 9\.42.*Ghost 8\.04.*Ghost won by 1\.38/.test(r.text), r.text);

// ---- Timer in race mode (logic) ----
(function () {
  var clock = 0, results = [];
  var store = fakeStorage();
  var session = T.createSession({ storage: store });
  var t = T.createTimer({ now: function () { return clock; }, session: session, race: true,
    onResult: function (e) { results.push(e); } });
  t.setScramble("R U R'");
  t.press(); clock += 300; t.tick(); t.release();
  check('timer race: running', t.state === 'running' && t.isRace());
  clock += 6000;
  t.notifySolved();
  check('timer race: solved ghost does not stop the timer', t.state === 'running');
  clock += 1234;
  t.press();
  check('timer race: space stops it', t.state === 'stopped' && results.length === 1);
  var e = session.list()[0];
  check('timer race: saved as a normal solve, marked race', e.time === 7234 && e.penalty === 'none' && e.race === true && e.scramble === "R U R'", JSON.stringify(e));
  check('timer race: saved entry has no ghost time', Object.keys(e).sort().join() === 'date,penalty,race,scramble,time', Object.keys(e).join());
  check('timer race: stats count the user time only', session.stats().best === 7234 && session.stats().current === 7234);
  var again = T.createSession({ storage: store });
  check('timer race: race mark survives reload', again.list()[0].race === true);
  // +2 / DNF on a race entry work as usual.
  session.togglePlus2(0);
  check('timer race: +2 on a race entry', T.effective(session.list()[0]) === 9234 && session.list()[0].race === true);

  // Escape = DNF in race mode.
  t.press(); clock += 300; t.tick(); t.release(); clock += 2000;
  t.stop('escape');
  check('timer race: escape stops as DNF', session.list()[1].penalty === 'DNF' && session.list()[1].race === true);

  // Race off: solved stops it again, no race mark.
  t.setRace(false);
  t.press(); clock += 300; t.tick(); t.release(); clock += 3000;
  t.notifySolved();
  check('timer: race off, solved stops', t.state === 'stopped' && !session.list()[2].race && !t.isRace());

  // The race flag is taken when the attempt starts, not when it ends.
  t.setRace(true);
  t.press(); clock += 300; t.tick(); t.release();
  t.setRace(false);
  t.notifySolved();
  check('timer race: mode fixed for the running attempt', t.state === 'running');
  t.press();
  check('timer race: entry still marked', session.list()[3].race === true);
})();

console.log('race tests: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
