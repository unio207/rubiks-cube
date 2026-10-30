// Run: node test/acceptance-hints.test.js
// Acceptance checks for Feature 1 (hints), independent of solver internals:
//  A. Follow hints one move at a time the way app.js tracks them (X2 may be played as two quarter
//     turns), from 100 seeded scrambles; recompute only when the hint runs out. Must reach solved.
//  B. 30 more scrambles where a random wrong move is played mid-hint; hint recomputes and still solves.
//  C. The reported stage is the first stage not done, checked by an independent oracle.
//  D. Cross hints are optimal (<= 8) against an independent BFS distance table.
//  E. LL hints: case names from the spec, setup is a U turn, alg is the exact Feature 2 alg.
//  F. Timing: every hint well under one frame (no freeze even without a worker).
var C = require('../src/core.js');
var S = require('../src/solver.js');

var pass = 0, fail = 0;
function check(name, ok, info) {
  if (ok) pass++;
  else { fail++; if (fail < 40) console.log('FAIL: ' + name + (info !== undefined ? ' -- ' + info : '')); }
}
function now() { var t = process.hrtime(); return t[0] * 1000 + t[1] / 1e6; }
var seed = 424242;
function rnd() { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; }

var ROTS = ['', 'x', "x'", 'x2', 'y', "y'", 'y2', 'z', "z'", 'z2'];
function scramble() {
  var s = C.randomScramble(25, { random: rnd }).concat(C.randomScramble(20, { half: true, random: rnd }));
  s.push(ROTS[Math.floor(rnd() * ROTS.length)]);
  return C.applyAlg(C.solvedState(), s.filter(Boolean));
}

// ---- Independent stage oracle (own geometry, only core's cubiesSolved/at) ----
var CROSS = [[0, -1, 1], [1, -1, 0], [0, -1, -1], [-1, -1, 0]];
var SLOTS = [[[1, -1, 1], [1, 0, 1]], [[1, -1, -1], [1, 0, -1]], [[-1, -1, -1], [-1, 0, -1]], [[-1, -1, 1], [-1, 0, 1]]];
var UCORN = [[1, 1, 1], [1, 1, -1], [-1, 1, -1], [-1, 1, 1]];
function upFace(s) { var out = []; for (var r = -1; r <= 1; r++) for (var c = -1; c <= 1; c++) out.push(C.at(s, [c, 1, r], [0, 1, 0])); return out; }
function f2l(s) { return C.cubiesSolved(s, CROSS) && SLOTS.every(function (p) { return C.cubiesSolved(s, p); }); }
function upToU(s, test) { return ['', 'U', "U'", 'U2'].some(function (u) { return test(u ? C.applyMove(s, u) : s); }); }
function oracleStage(s) {
  if (C.isSolved(s)) return 0;
  if (C.centerColor(s, 'D') !== 'U') return 1;                 // white center on D
  if (!C.cubiesSolved(s, CROSS)) return 2;
  if (!f2l(s)) return 3;
  var u = upFace(s), y = u[4];
  if (!(u[1] === y && u[3] === y && u[5] === y && u[7] === y)) return 4;
  if (!u.every(function (c) { return c === y; })) return 5;
  if (!upToU(s, function (t) { return C.cubiesSolved(t, UCORN); })) return 6;
  if (!upToU(s, C.isSolved)) return 7;
  return 8;
}

// ---- Independent cross BFS: 4 labeled edges, tracked by their D-colored sticker's facelet ----
var LABEL = []; for (var i = 0; i < 54; i++) LABEL.push(String.fromCharCode(200 + i));
var FACE_MOVES = []; 'UDRLFB'.split('').forEach(function (f) { FACE_MOVES.push(f, f + "'", f + '2'); });
var PERM = FACE_MOVES.map(function (m) {           // PERM[m][src] = dest facelet
  var out = C.applyMove(LABEL, m), to = new Array(54);
  out.forEach(function (ch, j) { to[ch.charCodeAt(0) - 200] = j; });
  return to;
});
var EDGE_FL = [];
C.FACELETS.forEach(function (f, i) { if (f.pos.filter(function (v) { return v !== 0; }).length === 2) EDGE_FL.push(i); });
var EI = {}; EDGE_FL.forEach(function (f, k) { EI[f] = k; });
var GOAL = CROSS.map(function (p) { return EI[C.faceletIndex(p, [0, -1, 0])]; });
function enc(a) { return ((a[0] * 24 + a[1]) * 24 + a[2]) * 24 + a[3]; }
var dist = new Int8Array(24 * 24 * 24 * 24).fill(-1);
(function bfs() {
  var q = [GOAL.slice()], head = 0; dist[enc(GOAL)] = 0;
  while (head < q.length) {
    var s = q[head++], d = dist[enc(s)];
    for (var m = 0; m < PERM.length; m++) {
      var n = s.map(function (k) { return EI[PERM[m][EDGE_FL[k]]]; }), c = enc(n);
      if (dist[c] < 0) { dist[c] = d + 1; q.push(n); }
    }
  }
  check('cross BFS covers all 190080 states', q.length === 190080, q.length);
})();
function crossDistance(s) {
  // edge k = the white edge whose side color matches the center above CROSS[k]
  var w = C.centerColor(s, 'D');
  var pos = CROSS.map(function (p) {
    var side = [p[0], 0, p[2]], want = C.at(s, side, side);
    for (var e = 0; e < EDGE_FL.length; e++) {
      var f = C.FACELETS[EDGE_FL[e]];
      if (s[EDGE_FL[e]] !== w) continue;
      var other = C.FACELETS.filter(function (g, j) { return g.pos.join() === f.pos.join() && j !== EDGE_FL[e]; })[0];
      if (C.at(s, other.pos, other.normal) === want) return e;
    }
    return -1;
  });
  return dist[enc(pos)];
}

// ---- LL expectations from the spec ----
var BY_ALG = {}; C.ALGS.forEach(function (a) { BY_ALG[a.alg] = a; });
var STAGE_GROUP = { 4: 'OLL edges', 5: 'OLL corners', 6: 'PLL corners', 7: 'PLL edges' };
var GROUP_ORDER = ['OLL edges', 'OLL corners', 'PLL corners', 'PLL edges'];

var times = [], stats = { crossChecked: 0, crossNonOptimal: 0, twoAlg: {}, splitX2: 0, deviations: 0 };

function checkHint(h, st, ctx) {
  var want = oracleStage(st);
  check('stage = first not done (' + ctx + ')', h.stage === want, h.stage + ' vs oracle ' + want);
  if (h.stage === 1) check('orientation hint is one rotation putting white on D', h.moves.length === 1 &&
    /^[xyz][2']?$/.test(h.moves[0]) && C.centerColor(C.applyAlg(st, h.moves), 'D') === 'U', h.moves.join(' '));
  if (h.stage === 2) {
    var d = crossDistance(st);
    stats.crossChecked++;
    check('cross hint <= 8', h.moves.length <= 8, h.moves.length);
    if (h.moves.length !== d) stats.crossNonOptimal++;
    check('cross hint optimal (' + ctx + ')', h.moves.length === d, h.moves.length + ' vs optimal ' + d);
  }
  if (STAGE_GROUP[h.stage]) {
    var a = BY_ALG[h.alg];
    check('LL alg is a Feature 2 alg (' + ctx + ')', !!a, h.alg);
    if (!a) return;
    check('LL alg group matches stage', a.group === STAGE_GROUP[h.stage], a.group + ' at stage ' + h.stage);
    check('LL caseName is the alg name', h.caseName === a.name, h.caseName + ' / ' + a.name);
    check('LL setup is a U turn or none', h.setup === null || /^U[2']?$/.test(h.setup), h.setup);
    // moves = [setup] alg [ [setup] alg ] with every alg from the listed set for this group
    var str = h.moves.join(' ');
    var expectStart = (h.setup ? h.setup + ' ' : '') + h.alg;
    check('LL moves start with setup + alg', str.indexOf(expectStart) === 0, str);
    var rest = str.slice(expectStart.length).trim().replace(/^U[2']? /, '');
    if (rest) {
      stats.twoAlg[h.stage] = (stats.twoAlg[h.stage] || 0) + 1;
      var b = BY_ALG[rest];
      check('LL second alg is listed and from a group not later than this stage', !!b &&
        GROUP_ORDER.indexOf(b.group) <= GROUP_ORDER.indexOf(STAGE_GROUP[h.stage]) + 0, rest);
    }
  }
}

function getHint(st) {
  var t0 = now(), h = S.getHint(st);
  times.push(now() - t0);
  return h;
}

// Play one hint move-by-move like app.js: an X2 may be done as two equal quarter turns.
function followOne(st, deviateAt, ctx) {
  var calls = 0, played = 0, lastStage = 0;
  while (!C.isSolved(st)) {
    if (calls > 80 || played > 400) return { ok: false, why: 'bounds calls ' + calls + ' moves ' + played };
    var h = getHint(st); calls++;
    checkHint(h, st, ctx);
    if (!h.moves.length) return { ok: false, why: 'empty hint at stage ' + h.stage };
    if (h.stage < lastStage) check('stage never goes back (' + ctx + ')', false, h.stage + ' after ' + lastStage);
    lastStage = h.stage;
    for (var k = 0; k < h.moves.length; k++) {
      if (deviateAt !== null && played === deviateAt) {
        // wrong move: a face turn that is not the suggested one -> app marks hint stale, recompute
        var wrong;
        do { wrong = FACE_MOVES[Math.floor(rnd() * FACE_MOVES.length)]; } while (wrong === h.moves[k]);
        st = C.applyMove(st, wrong); played++; deviateAt = null; stats.deviations++;
        lastStage = 0;     // a wrong move may legitimately undo progress
        break;
      }
      var m = C.parseMove(h.moves[k]);
      if (m.turns === 2 && rnd() < 0.5) {
        var q = m.base + (rnd() < 0.5 ? "'" : '');
        st = C.applyAlg(st, [q, q]); stats.splitX2++;
      } else st = C.applyMove(st, m);
      played++;
    }
  }
  return { ok: true, calls: calls, played: played };
}

S.init();
var maxPlayed = 0;
for (var t = 0; t < 100; t++) {
  var r = followOne(scramble(), null, 'scramble ' + t);
  check('A: step-by-step scramble ' + t + ' reaches solved', r.ok, r.why);
  if (r.ok) maxPlayed = Math.max(maxPlayed, r.played);
}
for (var u = 0; u < 30; u++) {
  var r2 = followOne(scramble(), Math.floor(rnd() * 60), 'deviation ' + u);
  check('B: deviation scramble ' + u + ' reaches solved', r2.ok, r2.why);
}

// F. Timing (main-thread worst case).
var maxT = Math.max.apply(null, times), avgT = times.reduce(function (a, b) { return a + b; }, 0) / times.length;
check('every hint < 16 ms on main thread', maxT < 16, maxT.toFixed(2) + ' ms');

console.log('hint calls ' + times.length + ', avg ' + avgT.toFixed(2) + ' ms, max ' + maxT.toFixed(2) + ' ms; max moves played ' + maxPlayed);
console.log('cross hints checked vs BFS: ' + stats.crossChecked + ', non-optimal: ' + stats.crossNonOptimal);
console.log('X2 played as two quarters: ' + stats.splitX2 + '; deviations: ' + stats.deviations +
  '; LL hints needing two algs per stage: ' + JSON.stringify(stats.twoAlg));
console.log('acceptance-hints: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
