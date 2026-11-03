// twophase.js - WCA-style scramble for any cube state (Kociemba two-phase solver, no DOM).
// Browser / Web Worker: needs Cube (core.js) loaded first, defines TwoPhase on the global object.
// Node: require('./src/twophase.js') returns the same object.
//
// scramble(state) -> { moves, text }: face turns only (U D L R F B with ' and 2), never the same face
// twice in a row, that take a solved cube (white U, green F) to `state`. A state held in another
// orientation is first turned to white on top, green in front. Usually 19-21 moves.
// The tables are built on the first call (about a second); after that a scramble takes a few ms.
(function (root) {
  'use strict';

  var Cube = (typeof module !== 'undefined' && module.exports) ? require('./core.js') : root.Cube;

  // Faces in Cube.FACES order (U R F D L B), so the opposite of face f is (f + 3) % 6.
  // Move m = face * 3 + power, power 0 = quarter turn, 1 = half turn, 2 = inverse.
  var FACES = 'URFDLB';
  var SUFFIX = ['', '2', "'"];
  var NAMES = [];
  for (var f = 0; f < 6; f++) for (var p = 0; p < 3; p++) NAMES.push(FACES[f] + SUFFIX[p]);
  // Phase 2 moves: U, D (any power) and half turns of R, F, L, B.
  var P2 = [0, 1, 2, 4, 7, 9, 10, 11, 13, 16];

  // Cubie slots in Kociemba's order; each lists its facelets clockwise, starting on U or D.
  var CORNERS = [
    [[1, 1, 1], 'URF'], [[-1, 1, 1], 'UFL'], [[-1, 1, -1], 'ULB'], [[1, 1, -1], 'UBR'],
    [[1, -1, 1], 'DFR'], [[-1, -1, 1], 'DLF'], [[-1, -1, -1], 'DBL'], [[1, -1, -1], 'DRB']];
  var EDGES = [
    [[1, 1, 0], 'UR'], [[0, 1, 1], 'UF'], [[-1, 1, 0], 'UL'], [[0, 1, -1], 'UB'],
    [[1, -1, 0], 'DR'], [[0, -1, 1], 'DF'], [[-1, -1, 0], 'DL'], [[0, -1, -1], 'DB'],
    [[1, 0, 1], 'FR'], [[-1, 0, 1], 'FL'], [[-1, 0, -1], 'BL'], [[1, 0, -1], 'BR']];
  function facelets(slot) {
    return slot[1].split('').map(function (face) { return Cube.faceletIndex(slot[0], Cube.NORMALS[face]); });
  }
  var CF = CORNERS.map(facelets), EF = EDGES.map(facelets);

  // Facelet state -> cubie cube { cp, co, ep, eo } (cp[i] = corner in slot i), or null if impossible.
  function toCubie(state) {
    var c = { cp: [], co: [], ep: [], eo: [] };
    for (var i = 0; i < 8; i++) {
      var col = CF[i].map(function (k) { return state[k]; });
      var o = 0;
      while (o < 3 && col[o] !== 'U' && col[o] !== 'D') o++;
      var name = col[o] + col[(o + 1) % 3] + col[(o + 2) % 3];
      var j = CORNERS.findIndex(function (s) { return s[1] === name; });
      if (o === 3 || j < 0) return null;
      c.cp.push(j); c.co.push(o);
    }
    for (i = 0; i < 12; i++) {
      var a = state[EF[i][0]], b = state[EF[i][1]];
      var e = EDGES.findIndex(function (s) { return s[1] === a + b; });
      var e2 = EDGES.findIndex(function (s) { return s[1] === b + a; });
      if (e < 0 && e2 < 0) return null;
      c.ep.push(e >= 0 ? e : e2); c.eo.push(e >= 0 ? 0 : 1);
    }
    return c;
  }

  // a * b: the cube a with the move (or cube) b applied.
  function multiply(a, b) {
    var c = { cp: [], co: [], ep: [], eo: [] };
    for (var i = 0; i < 8; i++) { c.cp[i] = a.cp[b.cp[i]]; c.co[i] = (a.co[b.cp[i]] + b.co[i]) % 3; }
    for (i = 0; i < 12; i++) { c.ep[i] = a.ep[b.ep[i]]; c.eo[i] = (a.eo[b.ep[i]] + b.eo[i]) % 2; }
    return c;
  }
  function identity() {
    return { cp: [0, 1, 2, 3, 4, 5, 6, 7], co: [0, 0, 0, 0, 0, 0, 0, 0],
      ep: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], eo: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] };
  }

  // ---- Coordinates ----
  function getTwist(c) { var t = 0; for (var i = 0; i < 7; i++) t = t * 3 + c.co[i]; return t; }
  function setTwist(c, t) {
    var s = 0;
    for (var i = 6; i >= 0; i--) { c.co[i] = t % 3; s += c.co[i]; t = (t / 3) | 0; }
    c.co[7] = (15 - s) % 3;
  }
  function getFlip(c) { var t = 0; for (var i = 0; i < 11; i++) t = t * 2 + c.eo[i]; return t; }
  function setFlip(c, t) {
    var s = 0;
    for (var i = 10; i >= 0; i--) { c.eo[i] = t & 1; s += c.eo[i]; t >>= 1; }
    c.eo[11] = s & 1;
  }
  // Slice: which 4 of the 12 slots hold the FR, FL, BL, BR edges (495 combinations).
  var MASK2SLICE = new Int16Array(4096).fill(-1), SLICE2MASK = [];
  for (var mk = 0; mk < 4096; mk++) {
    var bits = 0;
    for (var bt = 0; bt < 12; bt++) bits += (mk >> bt) & 1;
    if (bits === 4) { MASK2SLICE[mk] = SLICE2MASK.length; SLICE2MASK.push(mk); }
  }
  function getSlice(c) {
    var mask = 0;
    for (var i = 0; i < 12; i++) if (c.ep[i] >= 8) mask |= 1 << i;
    return MASK2SLICE[mask];
  }
  function setSlice(c, s) {
    var mask = SLICE2MASK[s], j = 8, k = 0;
    for (var i = 0; i < 12; i++) c.ep[i] = (mask >> i) & 1 ? j++ : k++;
  }
  var SLICE_SOLVED = MASK2SLICE[0xf00];
  // Permutation rank (Lehmer code) of arr[off .. off+n-1], values base .. base+n-1.
  function rank(arr, off, n) {
    var r = 0;
    for (var i = 0; i < n; i++) {
      var cnt = 0;
      for (var j = i + 1; j < n; j++) if (arr[off + j] < arr[off + i]) cnt++;
      r = r * (n - i) + cnt;
    }
    return r;
  }
  function unrank(r, n, arr, off, base) {
    var digits = [], avail = [];
    for (var i = n - 1; i >= 0; i--) { digits[i] = r % (n - i); r = Math.floor(r / (n - i)); }
    for (i = 0; i < n; i++) avail.push(base + i);
    for (i = 0; i < n; i++) arr[off + i] = avail.splice(digits[i], 1)[0];
  }

  // ---- Tables (built once) ----
  var MOVES = null;
  var twistMove, flipMove, sliceMove, cpMove, epMove, spMove, prTwist, prFlip, prCp, prEp;

  // Move table: size coordinates x nm moves.
  function moveTable(size, moves, set, get) {
    var t = new Uint16Array(size * moves.length), c = identity();
    for (var i = 0; i < size; i++) {
      set(c, i);
      for (var k = 0; k < moves.length; k++) t[i * moves.length + k] = get(multiply(c, MOVES[moves[k]]));
    }
    return t;
  }
  // Breadth-first distance table over the pair (a, b), index a * nb + b.
  function pruneTable(na, nb, ta, tb, nm, start) {
    var size = na * nb, dist = new Int8Array(size).fill(-1), queue = new Int32Array(size);
    var head = 0, tail = 0;
    dist[start] = 0; queue[tail++] = start;
    while (head < tail) {
      var x = queue[head++], a = (x / nb) | 0, b = x - a * nb, d = dist[x] + 1;
      for (var m = 0; m < nm; m++) {
        var y = ta[a * nm + m] * nb + tb[b * nm + m];
        if (dist[y] < 0) { dist[y] = d; queue[tail++] = y; }
      }
    }
    return dist;
  }

  function init() {
    if (MOVES) return;
    var solved = Cube.solvedState();
    MOVES = NAMES.map(function (n) { return toCubie(Cube.applyMove(solved, n)); });
    var ALL = []; for (var m = 0; m < 18; m++) ALL.push(m);
    twistMove = moveTable(2187, ALL, setTwist, getTwist);
    flipMove = moveTable(2048, ALL, setFlip, getFlip);
    sliceMove = moveTable(495, ALL, setSlice, getSlice);
    cpMove = moveTable(40320, P2, function (c, i) { unrank(i, 8, c.cp, 0, 0); }, function (c) { return rank(c.cp, 0, 8); });
    epMove = moveTable(40320, P2, function (c, i) { unrank(i, 8, c.ep, 0, 0); }, function (c) { return rank(c.ep, 0, 8); });
    spMove = moveTable(24, P2, function (c, i) { unrank(i, 4, c.ep, 8, 8); }, function (c) { return rank(c.ep, 8, 4); });
    prTwist = pruneTable(2187, 495, twistMove, sliceMove, 18, SLICE_SOLVED);
    prFlip = pruneTable(2048, 495, flipMove, sliceMove, 18, SLICE_SOLVED);
    prCp = pruneTable(40320, 24, cpMove, spMove, 10, 0);
    prEp = pruneTable(40320, 24, epMove, spMove, 10, 0);
  }

  // A move may follow `last` unless it turns the same face, or the opposite face in the wrong order
  // (D then U is skipped since U then D is the same).
  function allowed(face, last) {
    if (last < 0) return true;
    var lf = (last / 3) | 0;
    return face !== lf && face !== lf - 3;
  }

  // Shortest-ish face-turn solution of cubie cube c. opts.target: stop at a solution this short
  // (default 21); opts.maxMs: then stop with the best so far (default 200).
  function solveCubie(c, opts) {
    init();
    opts = opts || {};
    var target = opts.target || 21, deadline = Date.now() + (opts.maxMs || 200);
    var best = null, done = false, sol1 = [], sol2 = [], nodes = 0;

    function phase2(cp, ep, sp, togo, last) {
      if (togo === 0) return cp === 0 && ep === 0 && sp === 0;
      for (var k = 0; k < 10; k++) {
        var m = P2[k];
        if (!allowed((m / 3) | 0, last)) continue;
        var cp2 = cpMove[cp * 10 + k], ep2 = epMove[ep * 10 + k], sp2 = spMove[sp * 10 + k];
        if (Math.max(prCp[cp2 * 24 + sp2], prEp[ep2 * 24 + sp2]) >= togo) continue;
        sol2.push(m);
        if (phase2(cp2, ep2, sp2, togo - 1, m)) return true;
        sol2.pop();
      }
      return false;
    }

    function startPhase2() {
      var last = sol1.length ? sol1[sol1.length - 1] : -1;
      // A phase-1 solution ending in a phase-2 move was already tried one move shorter.
      if (last >= 0 && P2.indexOf(last) >= 0) return;
      var d = c;
      for (var i = 0; i < sol1.length; i++) d = multiply(d, MOVES[sol1[i]]);
      var cp = rank(d.cp, 0, 8), ep = rank(d.ep, 0, 8), sp = rank(d.ep, 8, 4);
      var limit = Math.min(18, (best ? best.length : 99) - 1 - sol1.length);
      for (var depth = Math.max(prCp[cp * 24 + sp], prEp[ep * 24 + sp]); depth <= limit; depth++) {
        sol2 = [];
        if (phase2(cp, ep, sp, depth, last)) {
          best = sol1.concat(sol2);
          if (best.length <= target) done = true;
          break;
        }
      }
      if (best && Date.now() > deadline) done = true;
    }

    function phase1(tw, fl, sl, togo, last) {
      if (togo === 0) { if (tw === 0 && fl === 0 && sl === SLICE_SOLVED) startPhase2(); return; }
      if ((++nodes & 1023) === 0 && best && Date.now() > deadline) done = true;
      for (var m = 0; m < 18 && !done; m++) {
        if (!allowed((m / 3) | 0, last)) continue;
        var tw2 = twistMove[tw * 18 + m], fl2 = flipMove[fl * 18 + m], sl2 = sliceMove[sl * 18 + m];
        if (Math.max(prTwist[tw2 * 495 + sl2], prFlip[fl2 * 495 + sl2]) >= togo) continue;
        sol1.push(m);
        phase1(tw2, fl2, sl2, togo - 1, m);
        sol1.pop();
      }
    }

    var tw = getTwist(c), fl = getFlip(c), sl = getSlice(c);
    for (var depth = Math.max(prTwist[tw * 495 + sl], prFlip[fl * 495 + sl]); !done && depth <= 20; depth++) {
      if (best && depth >= best.length) break;
      phase1(tw, fl, sl, depth, -1);
    }
    return best;
  }

  // The state turned to white on top, green in front (state itself when it already is).
  var ROTATIONS = [];
  ['', 'x', 'x2', "x'", 'z', "z'"].forEach(function (a) {
    ['', 'y', 'y2', "y'"].forEach(function (b) { ROTATIONS.push((a + ' ' + b).trim()); });
  });
  function standardOrientation(state) {
    for (var i = 0; i < ROTATIONS.length; i++) {
      var s = ROTATIONS[i] ? Cube.applyAlg(state, ROTATIONS[i]) : state;
      if (Cube.centerColor(s, 'U') === 'U' && Cube.centerColor(s, 'F') === 'F') return s;
    }
    return null;
  }

  // Every piece once, no twisted corner or flipped edge, and matching permutation parity.
  function parity(p) {
    var n = 0;
    for (var i = 0; i < p.length; i++) for (var j = i + 1; j < p.length; j++) if (p[j] < p[i]) n++;
    return n & 1;
  }
  function solvable(c) {
    var sum = function (a) { return a.reduce(function (x, y) { return x + y; }, 0); };
    var distinct = function (a) { return a.every(function (x, i) { return a.indexOf(x) === i; }); };
    return distinct(c.cp) && distinct(c.ep) && sum(c.co) % 3 === 0 && sum(c.eo) % 2 === 0 &&
      parity(c.cp) === parity(c.ep);
  }

  // scramble(state, opts) -> { moves: [names], text }. Throws on a state no real cube has.
  function scramble(state, opts) {
    var s = standardOrientation(state);
    var c = s && toCubie(s);
    if (!c || !solvable(c)) throw new Error('Not a valid cube');
    var sol = solveCubie(c, opts);
    var moves = [];
    for (var i = sol.length - 1; i >= 0; i--) {
      var m = sol[i], pw = m % 3;
      moves.push(NAMES[m - pw + (pw === 1 ? 1 : 2 - pw)]);   // X <-> X', X2 stays
    }
    return { moves: moves, text: moves.join(' ') };
  }

  var TwoPhase = { init: init, scramble: scramble, toCubie: toCubie, multiply: multiply, NAMES: NAMES };

  if (typeof module !== 'undefined' && module.exports) module.exports = TwoPhase;
  else root.TwoPhase = TwoPhase;
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this));
