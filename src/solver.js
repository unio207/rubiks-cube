// solver.js - CFOP hint engine (spec Feature 1 logic, no DOM).
// Browser / Web Worker: needs Cube (core.js) loaded first, defines Solver on the global object.
// Node: require('./src/solver.js') returns the same object.
//
// getHint(state) returns
//   { stage, stageName, goal, caseName, moves, setup, alg, pair }
// stage is 1..8 in spec order (0 = already solved). moves is an array of move names that,
// played in order, completes the current stage (or the next F2L pair).
(function (root) {
  'use strict';

  var Cube = (typeof module !== 'undefined' && module.exports) ? require('./core.js') : root.Cube;

  var STAGE_NAMES = ['Solved', 'Orientation', 'Cross', 'F2L', 'OLL edges', 'OLL corners',
    'PLL corners', 'PLL edges', 'AUF'];
  var FACE_MOVES = [];
  'UDRLFB'.split('').forEach(function (f) { FACE_MOVES.push(f, f + "'", f + '2'); });
  var U_TURNS = ['', 'U', "U'", 'U2'];

  // ---- Facelet bookkeeping ----
  var FL = Cube.FACELETS;
  function nonzero(p) { return (p[0] !== 0) + (p[1] !== 0) + (p[2] !== 0); }
  var EDGE_FL = [], CORNER_FL = [];      // 54-index of each edge / corner facelet
  FL.forEach(function (f, i) {
    if (nonzero(f.pos) === 2) EDGE_FL.push(i);
    if (nonzero(f.pos) === 3) CORNER_FL.push(i);
  });
  var EDGE_SLOT = {}, CORNER_SLOT = {};  // 54-index -> 0..23
  EDGE_FL.forEach(function (i, k) { EDGE_SLOT[i] = k; });
  CORNER_FL.forEach(function (i, k) { CORNER_SLOT[i] = k; });

  function idx(pos, face) { return Cube.faceletIndex(pos, Cube.NORMALS[face]); }
  // All facelet indices of the cubie at pos.
  function cubieFacelets(pos) {
    var out = [];
    FL.forEach(function (f, i) { if (f.pos.join() === pos.join()) out.push(i); });
    return out;
  }

  // Where each facelet goes under a move sequence: to[i] = new index of the sticker at i.
  var ID = []; for (var i = 0; i < 54; i++) ID.push(i);
  function faceletMap(alg) {
    var s = Cube.applyAlg(ID, alg), to = new Array(54);
    for (var j = 0; j < 54; j++) to[s[j]] = j;
    return to;
  }
  function slotTables(alg) {
    var to = faceletMap(alg), e = new Uint8Array(24), c = new Uint8Array(24);
    EDGE_FL.forEach(function (i, k) { e[k] = EDGE_SLOT[to[i]]; });
    CORNER_FL.forEach(function (i, k) { c[k] = CORNER_SLOT[to[i]]; });
    return { e: e, c: c };
  }

  // ---- Cross / F2L geometry (cross on D, slots named by their side faces) ----
  var SIDES = ['F', 'R', 'B', 'L'];
  var CROSS_POS = SIDES.map(function (f) { var n = Cube.NORMALS[f]; return [n[0], -1, n[2]]; });
  // Cross edge k: home of its D-colored sticker.
  var CROSS_HOME = CROSS_POS.map(function (p) { return EDGE_SLOT[idx(p, 'D')]; });

  var PAIRS = [['F', 'R'], ['R', 'B'], ['B', 'L'], ['L', 'F']].map(function (ab) {
    var na = Cube.NORMALS[ab[0]], nb = Cube.NORMALS[ab[1]];
    var x = na[0] + nb[0], z = na[2] + nb[2];
    return {
      name: ab[0] + ab[1], a: ab[0], b: ab[1],
      cornerPos: [x, -1, z], edgePos: [x, 0, z],
      cornerHome: CORNER_SLOT[idx([x, -1, z], 'D')],   // D-colored sticker of the corner
      edgeHome: EDGE_SLOT[idx([x, 0, z], ab[0])]       // a-colored sticker of the edge
    };
  });

  // Locate the facelet holding the sticker of color `want` on the piece whose colors are `colors`.
  function findSticker(state, list, size, colors, want) {
    for (var p = 0; p < list.length; p++) {
      var fs = list[p], cs = fs.map(function (i) { return state[i]; });
      if (cs.length !== size) continue;
      var ok = colors.every(function (c) { return cs.indexOf(c) >= 0; });
      if (ok) return fs[cs.indexOf(want)];
    }
    return -1;
  }
  var EDGE_CUBIES = [], CORNER_CUBIES = [];
  (function () {
    for (var x = -1; x <= 1; x++) for (var y = -1; y <= 1; y++) for (var z = -1; z <= 1; z++) {
      var n = nonzero([x, y, z]);
      if (n === 2) EDGE_CUBIES.push(cubieFacelets([x, y, z]));
      if (n === 3) CORNER_CUBIES.push(cubieFacelets([x, y, z]));
    }
  })();

  function crossSlots(state) {
    var d = Cube.centerColor(state, 'D');
    return SIDES.map(function (f) {
      return EDGE_SLOT[findSticker(state, EDGE_CUBIES, 2, [d, Cube.centerColor(state, f)], d)];
    });
  }
  function pairSlots(state, pair) {
    var d = Cube.centerColor(state, 'D'), a = Cube.centerColor(state, pair.a), b = Cube.centerColor(state, pair.b);
    return {
      c: CORNER_SLOT[findSticker(state, CORNER_CUBIES, 3, [d, a, b], d)],
      e: EDGE_SLOT[findSticker(state, EDGE_CUBIES, 2, [a, b], a)]
    };
  }

  function crossDone(state) { return Cube.cubiesSolved(state, CROSS_POS); }
  function pairDone(state, pair) { return Cube.cubiesSolved(state, [pair.cornerPos, pair.edgePos]); }
  function f2lDone(state) { return crossDone(state) && PAIRS.every(function (p) { return pairDone(state, p); }); }
  function uEdgesDone(state) { var u = state[4]; return state[1] === u && state[3] === u && state[5] === u && state[7] === u; }
  function uFaceDone(state) { for (var k = 0; k < 9; k++) if (state[k] !== state[4]) return false; return true; }
  var U_CORNERS = [[1, 1, 1], [1, 1, -1], [-1, 1, 1], [-1, 1, -1]];
  function aufFor(state, test) {
    for (var k = 0; k < 4; k++) {
      if (test(U_TURNS[k] ? Cube.applyMove(state, U_TURNS[k]) : state)) return U_TURNS[k];
    }
    return null;
  }
  function cornersPermuted(s) { return aufFor(s, function (t) { return Cube.cubiesSolved(t, U_CORNERS); }) !== null; }
  function solvedUpToU(s) { return aufFor(s, Cube.isSolved) !== null; }

  // ---- Tables (built once, lazily) ----
  var T = null;
  function init() {
    if (T) return;
    T = {};
    T.moves = FACE_MOVES.map(slotTables);

    // Cross: exact distance table over the 4 cross edges (24^4 encodings), BFS with face moves.
    var N = 331776, dist = new Int8Array(N).fill(-1);
    var h = CROSS_HOME, start = ((h[0] * 24 + h[1]) * 24 + h[2]) * 24 + h[3];
    var queue = new Int32Array(190080), qh = 0, qt = 0;
    dist[start] = 0; queue[qt++] = start;
    while (qh < qt) {
      var code = queue[qh++], d = dist[code];
      var s3 = code % 24, s2 = (code / 24 | 0) % 24, s1 = (code / 576 | 0) % 24, s0 = code / 13824 | 0;
      for (var m = 0; m < 18; m++) {
        var e = T.moves[m].e;
        var n = ((e[s0] * 24 + e[s1]) * 24 + e[s2]) * 24 + e[s3];
        if (dist[n] < 0) { dist[n] = d + 1; queue[qt++] = n; }
      }
    }
    T.crossDist = dist;

    // F2L macros: U turns and X U^k X^-1 for each side face X. Every macro keeps the cross.
    var macros = [{ moves: ['U'], fam: 'U' }, { moves: ["U'"], fam: 'U' }, { moves: ['U2'], fam: 'U' }];
    SIDES.forEach(function (f) {
      [[f, f + "'"], [f + "'", f]].forEach(function (pr) {
        ['U', "U'", 'U2'].forEach(function (u) {
          macros.push({ moves: [pr[0], u, pr[1]], fam: pr[0] });
        });
      });
    });
    macros.forEach(function (mc) { var t = slotTables(mc.moves); mc.e = t.e; mc.c = t.c; });
    T.macros = macros;

    // Per-pair macro distance (pair pieces alone), BFS over 24*24 states.
    T.pairDist = PAIRS.map(function (p) {
      var pd = new Int8Array(576).fill(-1), q = [p.cornerHome * 24 + p.edgeHome];
      pd[q[0]] = 0;
      for (var k = 0; k < q.length; k++) {
        var c = q[k] / 24 | 0, ed = q[k] % 24;
        macros.forEach(function (mc) {
          var nx = mc.c[c] * 24 + mc.e[ed];
          if (pd[nx] < 0) { pd[nx] = pd[q[k]] + 1; q.push(nx); }
        });
      }
      return pd;
    });
  }

  // ---- Stage solvers ----
  function solveCross(state) {
    var s = crossSlots(state), out = [];
    var code = ((s[0] * 24 + s[1]) * 24 + s[2]) * 24 + s[3];
    var d = T.crossDist[code];
    while (d > 0) {
      for (var m = 0; m < 18; m++) {
        var e = T.moves[m].e;
        var n0 = e[s[0]], n1 = e[s[1]], n2 = e[s[2]], n3 = e[s[3]];
        var nc = ((n0 * 24 + n1) * 24 + n2) * 24 + n3;
        if (T.crossDist[nc] === d - 1) { out.push(FACE_MOVES[m]); s = [n0, n1, n2, n3]; d--; break; }
      }
    }
    return out;
  }

  // Merge adjacent turns of the same face (R' R' -> R2, R R' -> nothing).
  function simplify(moves) {
    var out = [];
    moves.forEach(function (mv) {
      var m = Cube.parseMove(mv), last = out.length ? Cube.parseMove(out[out.length - 1]) : null;
      if (last && last.base === m.base) {
        out.pop();
        var t = (((last.turns + m.turns) % 4) + 4) % 4;
        if (t) out.push(m.base + (t === 2 ? '2' : t === 3 ? "'" : ''));
      } else out.push(m.name);
    });
    return out;
  }

  // IDA* over macros: bring `pair` home while every pair in `keep` stays home.
  var MAX_MACROS = 9, NODE_LIMIT = 300000;
  function solvePair(state, pi, keep) {
    var pieces = [pi].concat(keep).map(function (k) {
      var s = pairSlots(state, PAIRS[k]); return { k: k, c: s.c, e: s.e };
    });
    var cs = pieces.map(function (p) { return p.c; }), es = pieces.map(function (p) { return p.e; });
    var tables = pieces.map(function (p) { return T.pairDist[p.k]; });
    var M = T.macros, path = [], nodes = 0, np = pieces.length;

    function h(c, e) {
      var best = 0;
      for (var j = 0; j < np; j++) { var v = tables[j][c[j] * 24 + e[j]]; if (v > best) best = v; }
      return best;
    }
    function dfs(c, e, g, bound, lastFam) {
      var hv = h(c, e);
      if (hv === 0) return true;
      if (g + hv > bound || ++nodes > NODE_LIMIT) return false;
      for (var m = 0; m < M.length; m++) {
        var mc = M[m];
        if (mc.fam === lastFam) continue;  // U U, or X U^a X' X U^b X' (same as one macro)
        var nc = new Array(np), ne = new Array(np);
        for (var j = 0; j < np; j++) { nc[j] = mc.c[c[j]]; ne[j] = mc.e[e[j]]; }
        path.push(m);
        if (dfs(nc, ne, g + 1, bound, mc.fam)) return true;
        path.pop();
      }
      return false;
    }
    for (var bound = h(cs, es); bound <= MAX_MACROS; bound++) {
      path = [];
      if (dfs(cs, es, 0, bound, null)) {
        var moves = [];
        path.forEach(function (m) { moves = moves.concat(M[m].moves); });
        return simplify(moves);
      }
      if (nodes > NODE_LIMIT) break;
    }
    return null;
  }

  function f2lCaseName(moves) {
    var str = moves.join(' ');
    for (var k = 0; k < 4; k++) {
      var a = Cube.ALGS[k];
      if (str === a.alg) return a.name;
      for (var u = 1; u < 4; u++) {
        if (str === U_TURNS[u] + ' ' + a.alg) return a.name;
      }
    }
    return null;
  }

  function solveF2L(state) {
    var solved = [], open = [];
    PAIRS.forEach(function (p, k) { (pairDone(state, p) ? solved : open).push(k); });
    var best = null;
    open.forEach(function (k) {
      var mv = solvePair(state, k, solved);
      if (mv && (!best || mv.length < best.moves.length)) best = { k: k, moves: mv };
    });
    if (!best) throw new Error('F2L search failed');
    return best;
  }

  // Last layer: try each U setup with each alg of the group; chain two steps if one is not enough.
  function algsOf(group) { return Cube.ALGS.filter(function (a) { return a.group === group; }); }
  function llStep(state, group, goal, only) {
    var algs = algsOf(group).filter(function (a) { return !only || a.id === only; });
    var steps = [];
    U_TURNS.forEach(function (u) {
      algs.forEach(function (a) { steps.push({ setup: u, alg: a }); });
    });
    function run(s, st) { return Cube.applyAlg(st.setup ? Cube.applyMove(s, st.setup) : s, st.alg.alg); }
    function seq(st) { return (st.setup ? [st.setup] : []).concat(Cube.algToString(st.alg.alg).split(' ')); }
    for (var a = 0; a < steps.length; a++) {
      if (goal(run(state, steps[a]))) return { setup: steps[a].setup, alg: steps[a].alg, moves: seq(steps[a]) };
    }
    for (a = 0; a < steps.length; a++) {
      var mid = run(state, steps[a]);
      for (var b = 0; b < steps.length; b++) {
        if (goal(run(mid, steps[b]))) {
          return { setup: steps[a].setup, alg: steps[a].alg, moves: seq(steps[a]).concat(seq(steps[b])) };
        }
      }
    }
    throw new Error('No ' + group + ' alg sequence found');
  }

  function ollEdgeCase(state) {
    var u = state[4], up = [state[1] === u, state[5] === u, state[7] === u, state[3] === u]; // B R F L
    var n = up.filter(Boolean).length;
    if (n === 0) return 'oll-dot';
    if ((up[0] && up[2]) || (up[1] && up[3])) return 'oll-line';
    return 'oll-l';
  }

  var GOALS = {
    1: 'Turn the whole cube so the white center is on the bottom (D).',
    2: 'Make the white cross on the bottom: each white edge on D, its other color matching the side center.',
    3: 'Pair up a white corner with its edge and insert them into their slot without breaking the cross or other pairs.',
    4: 'Make a yellow cross on top (orient the top edges).',
    5: 'Make the whole top face yellow (orient the top corners).',
    6: 'Put the top corners in their correct places relative to each other.',
    7: 'Put the top edges in place so the cube is solved except for a U turn.',
    8: 'Turn the top layer to finish the solve.'
  };

  function hint(stage, moves, extra) {
    var out = { stage: stage, stageName: STAGE_NAMES[stage], goal: GOALS[stage] || 'The cube is solved.',
      caseName: null, moves: moves, setup: null, alg: null, pair: null };
    for (var k in extra) out[k] = extra[k];
    return out;
  }

  function getHint(state) {
    init();
    if (Cube.isSolved(state)) return hint(0, []);

    // 1. Orientation
    var white = 'U';
    if (state[31] !== white) {
      var rots = ['z2', 'x', "x'", 'z', "z'", 'x2'];
      for (var r = 0; r < rots.length; r++) {
        if (Cube.applyMove(state, rots[r])[31] === white) return hint(1, [rots[r]]);
      }
    }
    // 2. Cross
    if (!crossDone(state)) return hint(2, solveCross(state));
    // 3. F2L
    if (!f2lDone(state)) {
      var f = solveF2L(state), p = PAIRS[f.k];
      var g = 'Insert the ' + p.name + ' pair: the ' + Cube.COLOR_NAME[Cube.centerColor(state, p.a)] + '-' +
        Cube.COLOR_NAME[Cube.centerColor(state, p.b)] + ' edge and its white corner.';
      return hint(3, f.moves, { goal: g, pair: p.name, caseName: f2lCaseName(f.moves) });
    }
    var st;
    // 4. OLL edges
    if (!uEdgesDone(state)) {
      st = llStep(state, 'OLL edges', function (s) { return uEdgesDone(s) && f2lDone(s); }, ollEdgeCase(state));
      return hint(4, st.moves, { caseName: st.alg.name, setup: st.setup || null, alg: st.alg.alg });
    }
    // 5. OLL corners
    if (!uFaceDone(state)) {
      st = llStep(state, 'OLL corners', function (s) { return uFaceDone(s) && f2lDone(s); });
      return hint(5, st.moves, { caseName: st.alg.name, setup: st.setup || null, alg: st.alg.alg });
    }
    // 6. PLL corners
    if (!cornersPermuted(state)) {
      st = llStep(state, 'PLL corners', function (s) { return uFaceDone(s) && f2lDone(s) && cornersPermuted(s); });
      return hint(6, st.moves, { caseName: st.alg.name, setup: st.setup || null, alg: st.alg.alg });
    }
    // 7. PLL edges
    if (!solvedUpToU(state)) {
      st = llStep(state, 'PLL edges', solvedUpToU);
      return hint(7, st.moves, { caseName: st.alg.name, setup: st.setup || null, alg: st.alg.alg });
    }
    // 8. AUF
    return hint(8, [aufFor(state, Cube.isSolved)]);
  }

  var Solver = { init: init, getHint: getHint, STAGE_NAMES: STAGE_NAMES };

  if (typeof module !== 'undefined' && module.exports) module.exports = Solver;
  else root.Solver = Solver;
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this));
