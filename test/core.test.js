// Run: node test/core.test.js
var C = require('../src/core.js');

var pass = 0, fail = 0;
function check(name, ok, info) {
  if (ok) pass++;
  else { fail++; console.log('FAIL: ' + name + (info ? ' -- ' + info : '')); }
}

var S = C.solvedState();
var BASES = Object.keys(C.BASE_MOVES);
var ALL_MOVES = [];
BASES.forEach(function (b) { ALL_MOVES.push(b, b + "'", b + '2'); });

// Seeded RNG so failures are reproducible.
var seed = 12345;
function rnd() { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; }

// 1. Each move followed by its inverse returns solved; 4x each quarter move = identity.
ALL_MOVES.forEach(function (m) {
  check(m + ' then inverse', C.isEqual(C.applyAlg(S, [m, C.invertMove(m)]), S));
});
BASES.forEach(function (b) {
  check('4x ' + b, C.isEqual(C.applyAlg(S, [b, b, b, b]), S));
  check(b + ' changes state', !C.isEqual(C.applyMove(S, b), S));
  check(b + "2 = " + b + ' ' + b, C.isEqual(C.applyMove(S, b + '2'), C.applyAlg(S, [b, b])));
});

// 2. Random sequences (incl. M, wide, half turns) followed by inverse return solved.
for (var t = 0; t < 300; t++) {
  var seq = [];
  for (var k = 0; k < 30; k++) seq.push(ALL_MOVES[Math.floor(rnd() * ALL_MOVES.length)]);
  var s = C.applyAlg(S, seq);
  check('random seq ' + t + ' + inverse', C.isEqual(C.applyAlg(s, C.invertAlg(seq)), S), seq.join(' '));
  // also from a non-solved start, using the string parser
  check('parser round trip ' + t, C.isEqual(C.applyAlg(S, C.algToString(seq)), s));
}

// 3. Slice/wide relationships.
var scr = C.applyAlg(S, "R U F' D2 L B' M r2 u");
check("M' = r R'", C.isEqual(C.applyAlg(scr, "M'"), C.applyAlg(scr, "r R'")));
check("M = R r'", C.isEqual(C.applyAlg(scr, 'M'), C.applyAlg(scr, "R r'")));
check("r = R M'", C.isEqual(C.applyAlg(scr, 'r'), C.applyAlg(scr, "R M'")));
check("x = r L'", C.isEqual(C.applyAlg(scr, 'x'), C.applyAlg(scr, "r L'")));
check("x = R M' L'", C.isEqual(C.applyAlg(scr, 'x'), C.applyAlg(scr, "R M' L'")));
check("y = U D' (+E) via u D'", C.isEqual(C.applyAlg(scr, 'y'), C.applyAlg(scr, "u D'")));
check("z = f B'", C.isEqual(C.applyAlg(scr, 'z'), C.applyAlg(scr, "f B'")));
check("l = L M", C.isEqual(C.applyAlg(scr, 'l'), C.applyAlg(scr, 'L M')));
check("d = D y'", C.isEqual(C.applyAlg(scr, 'd'), C.applyAlg(scr, "y' U")));
check("b = B z'", C.isEqual(C.applyAlg(scr, 'b'), C.applyAlg(scr, "z' F")));

// Face-letter direction sanity: R moves F stickers to U; U moves F to L; F moves U to R.
var r1 = C.applyMove(S, 'R');
check('R: F->U', r1[C.faceletIndex([1, 1, 1], [0, 1, 0])] === 'F');
var u1 = C.applyMove(S, 'U');
check('U: F->L', u1[C.faceletIndex([-1, 1, 1], [-1, 0, 0])] === 'F');
var f1 = C.applyMove(S, 'F');
check('F: U->R', f1[C.faceletIndex([1, 1, 1], [1, 0, 0])] === 'U');
var m1 = C.applyMove(S, 'M');
check('M follows L: U->F', m1[C.faceletIndex([0, 0, 1], [0, 0, 1])] === 'U');

// 4. Rotations keep isSolved true and move centers.
['x', 'y', 'z', "x'", 'y2', "z'", "x y z' x2"].forEach(function (a) {
  check('isSolved after ' + a, C.isSolved(C.applyAlg(S, a)));
});
check('x moves F center to U', C.applyMove(S, 'x')[4] === 'F');
check('M moves centers', C.applyMove(S, 'M')[4] === 'B');
check('not solved after R', !C.isSolved(C.applyMove(S, 'R')));
check('not solved after M', !C.isSolved(C.applyMove(S, 'M')));
check('isSolved after x y', C.isSolved(C.applyAlg(S, 'x y')));

// 5. Animation metadata.
var mr = C.parseMove("R'");
check("R' meta", mr.axis === 'x' && mr.layers.join() === '1' && mr.amount === 1 && mr.turns === -1);
var mm = C.parseMove('M2');
check('M2 meta', mm.axis === 'x' && mm.layers.join() === '0' && mm.amount === 2);
var mf = C.parseMove('f');
check('f meta', mf.axis === 'z' && mf.layers.join() === '0,1' && mf.amount === -1);
// metadata must agree with the permutation (rotate facelet geometry by amount)
ALL_MOVES.forEach(function (name) {
  var m = C.parseMove(name), st = C.applyAlg(S, "R U F' L2 D B M"), out = C.applyMove(st, m), ok = true;
  var ai = { x: 0, y: 1, z: 2 }[m.axis];
  C.FACELETS.forEach(function (f, i) {
    var j = i;
    if (m.layers.indexOf(f.pos[ai]) >= 0) j = C.faceletIndex(C.rotateVec(f.pos, m.axis, m.amount), C.rotateVec(f.normal, m.axis, m.amount));
    if (out[j] !== st[i]) ok = false;
  });
  check('meta matches state for ' + name, ok);
});
check('bad move throws', (function () { try { C.parseMove('Q'); return false; } catch (e) { return true; } })());

// 6. Scrambles and history.
var sc = C.randomScramble(25);
check('scramble length 25', sc.length === 25);
check('scramble quarter turns only', sc.every(function (m) { return /^[UDLRFB]'?$/.test(m); }));
for (var n = 0; n < 200; n++) {
  var q = C.randomScramble(25), w = C.randomScramble(20, { half: true });
  var okq = q.every(function (m, i) { return i === 0 || m[0] !== q[i - 1][0]; });
  var okw = w.length === 20 && w.every(function (m, i) { return i === 0 || m[0] !== w[i - 1][0]; });
  check('no same face twice ' + n, okq && okw, q.join(' ') + ' / ' + w.join(' '));
}
var h = [];
h = C.pushHistory(h, 'R'); h = C.pushHistory(h, 'U'); h = C.pushHistory(h, "U'");
check('history cancels U U\'', h.join() === 'R');
h = C.pushHistory(h, "R'");
check('history empty', h.length === 0);
h = C.pushHistory(C.pushHistory([], 'R2'), 'R2');
check('history cancels R2 R2', h.length === 0);
h = C.pushHistory(C.pushHistory([], 'R'), 'R');
check('history keeps R R', h.join() === 'R,R');

// 7. Algs: spec verification (case state + alg -> target solved up to one U).
check('20 algs', C.ALGS.length === 20);
C.ALGS.forEach(function (a) { check('alg verify ' + a.name + ' [' + a.group + ']', C.verifyAlg(a)); });

// 8. Case-state sanity: does each case look like its name? (cross color = D center)
function col(s, pos, n) { return C.at(s, pos, n); }
var Up = [0, 1, 0];
function f2lCase(a, cornerWhite, edgePos) {
  var s = C.caseState(a.alg), w = C.centerColor(s, 'D');
  var crossOk = C.cubiesSolved(s, [[0, -1, 1], [1, -1, 0], [0, -1, -1], [-1, -1, 0]]);
  var cn = cornerWhite === 'F' ? [0, 0, 1] : [1, 0, 0];
  var cornerOk = col(s, [1, 1, 1], cn) === w;
  // edge pieces: the FR edge colors = F and R centers
  var fc = C.centerColor(s, 'F'), rc = C.centerColor(s, 'R');
  var ep = { UR: [1, 1, 0], UF: [0, 1, 1], UB: [0, 1, -1], UL: [-1, 1, 0] }[edgePos];
  var side = [ep[0], 0, ep[2]];
  var pair = [col(s, ep, Up), col(s, ep, side)].sort().join();
  return crossOk && cornerOk && pair === [fc, rc].sort().join();
}
var A = {}; C.ALGS.forEach(function (a) { A[a.id] = a; });
check('F2L 1 case matches description', f2lCase(A['f2l-1'], 'F', 'UR'));
check('F2L 2 case matches description', f2lCase(A['f2l-2'], 'R', 'UF'));
check('F2L 3 case matches description', f2lCase(A['f2l-3'], 'R', 'UB'));
check('F2L 4 case matches description', f2lCase(A['f2l-4'], 'F', 'UL'));

function ollInfo(s) {
  var y = C.centerColor(s, 'U');
  var e = { UF: [0, 1, 1], UR: [1, 1, 0], UB: [0, 1, -1], UL: [-1, 1, 0] }, eo = [];
  Object.keys(e).forEach(function (k) { if (col(s, e[k], Up) === y) eo.push(k); });
  var c = { UFR: [1, 1, 1], UBR: [1, 1, -1], UBL: [-1, 1, -1], UFL: [-1, 1, 1] }, co = [];
  Object.keys(c).forEach(function (k) { if (col(s, c[k], Up) === y) co.push(k); });
  return { f2l: C.cubiesSolved(s, [[0, -1, 1], [1, -1, 0], [0, -1, -1], [-1, -1, 0],
    [1, -1, 1], [1, -1, -1], [-1, -1, 1], [-1, -1, -1], [1, 0, 1], [1, 0, -1], [-1, 0, 1], [-1, 0, -1]]),
    eo: eo.join(','), co: co.join(',') };
}
var line = ollInfo(C.caseState(A['oll-line'].alg));
check('Line: F2L solved, UR+UL oriented', line.f2l && line.eo === 'UR,UL', JSON.stringify(line));
var ll = ollInfo(C.caseState(A['oll-l'].alg));
// Spec says "hold at back-left", but f R U R' U' f' needs the L at front-right (UF+UR).
check('L: F2L solved, UF+UR oriented', ll.f2l && ll.eo === 'UF,UR', JSON.stringify(ll));
var dot = ollInfo(C.caseState(A['oll-dot'].alg));
check('Dot: no edges oriented', dot.f2l && dot.eo === '', JSON.stringify(dot));
var cornerCounts = { 'oll-sune': 1, 'oll-antisune': 1, 'oll-h': 0, 'oll-pi': 0,
  'oll-headlights': 2, 'oll-chameleon': 2, 'oll-bowtie': 2 };
Object.keys(cornerCounts).forEach(function (id) {
  var info = ollInfo(C.caseState(A[id].alg));
  var nco = info.co ? info.co.split(',').length : 0;
  check(id + ': cross done, ' + cornerCounts[id] + ' corners up', info.f2l && info.eo === 'UF,UR,UB,UL' && nco === cornerCounts[id], JSON.stringify(info));
  if (process.env.VERBOSE) console.log(id, JSON.stringify(info));
});
var bow = ollInfo(C.caseState(A['oll-bowtie'].alg)).co;
check('Bowtie corners diagonal', bow === 'UFR,UBL' || bow === 'UBR,UFL', bow);
['oll-headlights', 'oll-chameleon'].forEach(function (id) {
  var co = ollInfo(C.caseState(A[id].alg)).co;
  check(id + ' corners adjacent', co !== 'UFR,UBL' && co !== 'UBR,UFL', co);
});
['pll-t', 'pll-y', 'pll-ua', 'pll-ub', 'pll-h', 'pll-z'].forEach(function (id) {
  var info = ollInfo(C.caseState(A[id].alg));
  check(id + ': OLL done', info.f2l && info.eo.split(',').length === 4 && info.co.split(',').length === 4, JSON.stringify(info));
});
// PLL edges cases: corners already solved relative to each other (solved up to U turn except edges)
['pll-ua', 'pll-ub', 'pll-h', 'pll-z'].forEach(function (id) {
  var s = C.caseState(A[id].alg);
  var ok = ['', 'U', "U'", 'U2'].some(function (u) {
    var t = u ? C.applyMove(s, u) : s;
    return C.cubiesSolved(t, [[1, 1, 1], [1, 1, -1], [-1, 1, -1], [-1, 1, 1]]);
  });
  check(id + ': corners permuted', ok);
});

console.log('core tests: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
