// Full CFOP solve (Solver.solve): reaches solved from any scramble and orientation, uses only
// the Feature 2 algs for the last layer, and is shorter than following the hints.
var C = require('../src/core.js');
var S = require('../src/solver.js');
var pass = 0, fail = 0;
function check(name, ok, info) { if (ok) pass++; else { fail++; console.log('FAIL ' + name + (info !== undefined ? ': ' + info : '')); } }

var seed = 4242;
function rnd() { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; }
var ROTS = ['', 'x', 'y2', "z'", 'x y', 'x2 z'];
var ALG_NAMES = C.ALGS.map(function (a) { return a.name; });

function hintLength(s) {
  var n = 0;
  for (var i = 0; i < 80; i++) {
    var h = S.getHint(s);
    if (!h.stage) return n;
    s = C.applyAlg(s, h.moves); n += h.moves.length;
  }
  return Infinity;
}

check('solved cube: empty solution', S.solve(C.solvedState()).moves.length === 0);
var total = 0, totalHints = 0, N = 100;
for (var t = 0; t < N; t++) {
  var s = C.applyAlg(C.solvedState(), C.randomScramble(25, { random: rnd }));
  if (ROTS[t % ROTS.length]) s = C.applyAlg(s, ROTS[t % ROTS.length]);
  var r = S.solve(s);
  check('solve ' + t + ' reaches solved', C.isSolved(C.applyAlg(s, r.moves)), r.moves.join(' '));
  var steps = [];
  r.steps.forEach(function (x) { steps = steps.concat(x.moves); });
  check('solve ' + t + ' steps add up to the solution', C.isEqual(C.applyAlg(s, steps), C.applyAlg(s, r.moves)));
  check('solve ' + t + ' stages in CFOP order', r.steps.every(function (x, k) { return !k || x.stage >= r.steps[k - 1].stage; }));
  check('solve ' + t + ' last layer uses Feature 2 algs', r.steps.every(function (x) {
    return x.stage < 4 || x.stage === 8 || ALG_NAMES.indexOf(x.name) >= 0;
  }), r.steps.map(function (x) { return x.name; }).join(','));
  total += r.moves.length;
  totalHints += hintLength(s);
}
check('average solution shorter than following hints', total < totalHints, (total / N) + ' vs ' + (totalHints / N));
console.log('solve: average ' + (total / N).toFixed(1) + ' moves (hints ' + (totalHints / N).toFixed(1) + ')');
console.log('solve: ' + pass + ' passed, ' + fail + ' failed');
process.exitCode = fail ? 1 : 0;
