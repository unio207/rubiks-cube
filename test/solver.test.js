// Run: node test/solver.test.js
// Follows hints from 100 seeded random scrambles (with random whole-cube orientation) until solved.
var C = require('../src/core.js');
var S = require('../src/solver.js');

var pass = 0, fail = 0;
function check(name, ok, info) {
  if (ok) pass++;
  else { fail++; console.log('FAIL: ' + name + (info ? ' -- ' + info : '')); }
}

function now() { var t = process.hrtime(); return t[0] * 1000 + t[1] / 1e6; }
var seed = 987654;
function rnd() { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; }

var CROSS = [[0, -1, 1], [1, -1, 0], [0, -1, -1], [-1, -1, 0]];
var PAIRS = {
  FR: [[1, -1, 1], [1, 0, 1]], RB: [[1, -1, -1], [1, 0, -1]],
  BL: [[-1, -1, -1], [-1, 0, -1]], LF: [[-1, -1, 1], [-1, 0, 1]]
};
var ROTS = ['', 'x', "x'", 'x2', 'y', "y'", 'y2', 'z', "z'", 'z2'];
var VALID_ALGS = {};
C.ALGS.forEach(function (a) { VALID_ALGS[a.alg] = true; });

var t0 = Date.now();
S.init();
var initMs = Date.now() - t0;
console.log('init: ' + initMs + ' ms');
check('init < 1000 ms', initMs < 1000, initMs + ' ms');

var times = [], maxMoves = 0, totalMoves = 0, maxCalls = 0, maxCross = 0;
var stageSeen = {};

for (var t = 0; t < 100; t++) {
  var scr = C.randomScramble(25, { random: rnd }).concat(C.randomScramble(20, { half: true, random: rnd }));
  scr.push(ROTS[Math.floor(rnd() * ROTS.length)], ROTS[Math.floor(rnd() * ROTS.length)]);
  scr = scr.filter(Boolean);
  var st = C.applyAlg(C.solvedState(), scr);
  var moves = 0, calls = 0, lastStage = 0, ok = true;

  while (!C.isSolved(st)) {
    if (calls >= 60 || moves > 300) { ok = false; break; }
    var h0 = now(), h;
    try { h = S.getHint(st); } catch (e) { check('hint throws (scramble ' + t + ')', false, e.message); ok = false; break; }
    times.push(now() - h0);
    calls++;
    stageSeen[h.stage] = (stageSeen[h.stage] || 0) + 1;
    if (!h.moves.length) { check('non-empty hint', false, 'stage ' + h.stage); ok = false; break; }
    if (h.stage < lastStage) { check('stage never goes back', false, h.stage + ' after ' + lastStage + ' scramble ' + t); }
    lastStage = h.stage;

    var before = st;
    var after = C.applyAlg(st, h.moves);

    if (h.stage === 1) check('orientation puts white on D', after[31] === 'U');
    if (h.stage === 2) {
      maxCross = Math.max(maxCross, h.moves.length);
      check('cross hint <= 8 moves', h.moves.length <= 8, h.moves.join(' '));
      check('cross hint solves cross', C.cubiesSolved(after, CROSS), h.moves.join(' '));
    }
    if (h.stage === 3) {
      check('F2L keeps cross', C.cubiesSolved(after, CROSS), h.moves.join(' '));
      Object.keys(PAIRS).forEach(function (k) {
        if (C.cubiesSolved(before, PAIRS[k])) check('F2L keeps solved pair ' + k, C.cubiesSolved(after, PAIRS[k]));
      });
      check('F2L hint solves its pair', C.cubiesSolved(after, PAIRS[h.pair]), h.pair);
    }
    if (h.stage >= 4 && h.stage <= 7) {
      check('LL hint uses a listed alg', VALID_ALGS[h.alg], h.alg);
      var rest = h.moves.join(' ');
      var algsOnly = rest.replace(/^U[2']? /, '');
      check('LL hint is setup + listed alg(s)', VALID_ALGS[algsOnly] ||
        C.ALGS.some(function (a) { return algsOnly.indexOf(a.alg) === 0; }), rest);
    }
    st = after;
    moves += h.moves.length;
  }
  check('scramble ' + t + ' solved within bounds', ok && C.isSolved(st), 'moves ' + moves + ', calls ' + calls);
  maxMoves = Math.max(maxMoves, moves); totalMoves += moves; maxCalls = Math.max(maxCalls, calls);
}

check('solved state returns stage 0', S.getHint(C.solvedState()).stage === 0);

var avg = times.reduce(function (a, b) { return a + b; }, 0) / times.length;
var maxT = Math.max.apply(null, times);
console.log("hint calls: " + times.length + ", avg " + avg.toFixed(2) + " ms, max " + maxT.toFixed(2) + " ms");
console.log('moves per solve: avg ' + (totalMoves / 100).toFixed(1) + ', max ' + maxMoves + '; max hint calls ' + maxCalls +
  '; longest cross hint ' + maxCross);
console.log('hints per stage: ' + JSON.stringify(stageSeen));
check('max hint time < 300 ms', maxT < 300, maxT + ' ms');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
