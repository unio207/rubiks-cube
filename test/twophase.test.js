// Two-phase scrambles (TwoPhase.scramble) for loaded cubes: for random states, the scramble applied to
// a solved cube gives exactly the state, uses face turns only, never turns the same face twice in a
// row, and is at most 25 moves. Also: the cubie model matches core.js moves, solved -> empty, and
// impossible cubes are rejected.
var C = require('../src/core.js');
var TP = require('../src/twophase.js');
var pass = 0, fail = 0;
function check(name, ok, info) { if (ok) pass++; else { fail++; console.log('FAIL ' + name + (info !== undefined ? ': ' + info : '')); } }

var seed = 2026;
function rnd() { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; }
var ALL = 'U D L R F B M E S x y z r l u d f b'.split(' ');
function randomAlg(n, tokens) {
  var out = [];
  for (var i = 0; i < n; i++) out.push(tokens[Math.floor(rnd() * tokens.length)] + ['', "'", '2'][Math.floor(rnd() * 3)]);
  return out;
}
// The state turned so white is on top and green in front.
function standard(s) {
  var rots = ['', 'x', 'x2', "x'", 'z', "z'"], ys = ['', 'y', 'y2', "y'"];
  for (var i = 0; i < 6; i++) for (var j = 0; j < 4; j++) {
    var t = C.applyAlg(s, (rots[i] + ' ' + ys[j]).trim() || []);
    if (C.centerColor(t, 'U') === 'U' && C.centerColor(t, 'F') === 'F') return t;
  }
  return null;
}

var t0 = Date.now();
TP.init();
var initMs = Date.now() - t0;
check('tables build in under 5 s', initMs < 5000, initMs);

// Cubie model: toCubie(state after m) === toCubie(state) * move m.
var moveCubes = TP.NAMES.map(function (n) { return TP.toCubie(C.applyMove(C.solvedState(), n)); });
var same = true;
for (var k = 0; k < 50; k++) {
  var s0 = C.applyAlg(C.solvedState(), randomAlg(20, 'UDLRFB'.split('')));
  var m = Math.floor(rnd() * 18);
  var a = TP.toCubie(C.applyMove(s0, TP.NAMES[m])), b = TP.multiply(TP.toCubie(s0), moveCubes[m]);
  if (JSON.stringify(a) !== JSON.stringify(b)) same = false;
}
check('cubie moves match core.js moves', same);

check('solved cube: empty scramble', TP.scramble(C.solvedState()).moves.length === 0);
check('solved cube held another way: empty scramble', TP.scramble(C.applyAlg(C.solvedState(), 'x y')).moves.length === 0);

var FACE_TURN = /^[UDLRFB]['2]?$/;
var N = 150, total = 0, longest = 0, worst = 0;
for (var t = 0; t < N; t++) {
  // Two thirds face-turn states (white on top, green in front, as scans load); the rest also use
  // slices, wide moves and rotations, so their centres are elsewhere.
  var s = C.applyAlg(C.solvedState(), t % 3 ? C.randomScramble(25, { half: true, random: rnd }) : randomAlg(30, ALL));
  var start = Date.now();
  var r = TP.scramble(s);
  worst = Math.max(worst, Date.now() - start);
  var mv = r.moves;
  check('scramble ' + t + ' gives the state', C.isEqual(C.applyAlg(C.solvedState(), mv), standard(s)), r.text);
  if (t % 3) check('scramble ' + t + ' gives exactly the loaded state', C.isEqual(C.applyAlg(C.solvedState(), mv), s));
  check('scramble ' + t + ' face turns only', mv.every(function (x) { return FACE_TURN.test(x); }), r.text);
  check('scramble ' + t + ' never the same face twice in a row', mv.every(function (x, i) { return !i || x[0] !== mv[i - 1][0]; }), r.text);
  check('scramble ' + t + ' at most 25 moves', mv.length <= 25, mv.length);
  check('scramble ' + t + ' text matches moves', r.text === mv.join(' '));
  total += mv.length;
  longest = Math.max(longest, mv.length);
}

// Impossible cubes are rejected rather than searched forever.
var twisted = C.solvedState().slice();
var tmp = twisted[8]; twisted[8] = twisted[9]; twisted[9] = twisted[20]; twisted[20] = tmp;   // URF corner twisted
var threw = false; try { TP.scramble(twisted); } catch (e) { threw = true; }
check('twisted corner rejected', threw);
var swapped = C.solvedState().slice();
// Swap two edges (UF and UR stickers) -> parity.
var e1 = [C.faceletIndex([0, 1, 1], C.NORMALS.U), C.faceletIndex([0, 1, 1], C.NORMALS.F)];
var e2 = [C.faceletIndex([1, 1, 0], C.NORMALS.U), C.faceletIndex([1, 1, 0], C.NORMALS.R)];
tmp = swapped[e1[1]]; swapped[e1[1]] = swapped[e2[1]]; swapped[e2[1]] = tmp;
threw = false; try { TP.scramble(swapped); } catch (e) { threw = true; }
check('swapped edges (parity) rejected', threw);

console.log('twophase: tables ' + initMs + ' ms, average ' + (total / N).toFixed(1) + ' moves, longest ' + longest +
  ', slowest ' + worst + ' ms');
console.log('twophase: ' + pass + ' passed, ' + fail + ' failed');
process.exitCode = fail ? 1 : 0;
