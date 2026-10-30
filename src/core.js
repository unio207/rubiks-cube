// core.js - Rubik's cube logic core (sticker state, moves, algs).
// Works inlined in a browser (window.Cube) and via require() in Node.
// See src/CONTRACT.md for the documented API.
(function (root) {
  'use strict';

  // Faces in facelet order. Each face has 9 facelets, index = face*9 + row*3 + col.
  var FACES = ['U', 'R', 'F', 'D', 'L', 'B'];
  var COLOR_NAME = { U: 'white', R: 'red', F: 'green', D: 'yellow', L: 'orange', B: 'blue' };
  var COLOR_HEX = { U: 0xffffff, R: 0xc41e3a, F: 0x009e60, D: 0xffd500, L: 0xff5800, B: 0x0051ba };
  var NORMALS = {
    U: [0, 1, 0], D: [0, -1, 0], R: [1, 0, 0], L: [-1, 0, 0], F: [0, 0, 1], B: [0, 0, -1]
  };

  // Cubie position [x, y, z] of facelet (row, col) on a face, as seen looking at that face
  // (U viewed from above with B at the top, D viewed from below with F at the top,
  // side faces viewed from outside with U at the top).
  function faceletPos(face, r, c) {
    switch (face) {
      case 'U': return [c - 1, 1, r - 1];
      case 'D': return [c - 1, -1, 1 - r];
      case 'F': return [c - 1, 1 - r, 1];
      case 'B': return [1 - c, 1 - r, -1];
      case 'R': return [1, 1 - r, 1 - c];
      case 'L': return [-1, 1 - r, c - 1];
    }
  }

  var FACELETS = [];
  FACES.forEach(function (face) {
    for (var r = 0; r < 3; r++) {
      for (var c = 0; c < 3; c++) {
        FACELETS.push({ face: face, pos: faceletPos(face, r, c), normal: NORMALS[face].slice() });
      }
    }
  });

  function key(pos, normal) { return pos.join(',') + '|' + normal.join(','); }
  var INDEX_BY_KEY = {};
  FACELETS.forEach(function (f, i) { INDEX_BY_KEY[key(f.pos, f.normal)] = i; });

  // Index of the facelet at cubie position pos with outward normal, or -1.
  function faceletIndex(pos, normal) {
    var i = INDEX_BY_KEY[key(pos, normal)];
    return i === undefined ? -1 : i;
  }

  // Rotate integer vector v by q quarter turns about axis ('x'|'y'|'z'), right-hand rule
  // (positive q = counterclockwise looking from +axis toward the origin).
  function rotateVec(v, axis, q) {
    q = ((q % 4) + 4) % 4;
    var x = v[0], y = v[1], z = v[2], t;
    for (var i = 0; i < q; i++) {
      if (axis === 'x') { t = y; y = -z; z = t; }
      else if (axis === 'y') { t = z; z = -x; x = t; }
      else { t = x; x = -y; y = t; }
    }
    return [x + 0, y + 0, z + 0]; // +0 turns -0 into 0
  }

  // Base moves: axis, layers (coordinate on that axis), and dir = signed quarter turns
  // for the plain (clockwise) move, using the right-hand rule above.
  var ALL = [-1, 0, 1];
  var BASE = {
    U: { axis: 'y', layers: [1], dir: -1 },
    D: { axis: 'y', layers: [-1], dir: 1 },
    R: { axis: 'x', layers: [1], dir: -1 },
    L: { axis: 'x', layers: [-1], dir: 1 },
    F: { axis: 'z', layers: [1], dir: -1 },
    B: { axis: 'z', layers: [-1], dir: 1 },
    M: { axis: 'x', layers: [0], dir: 1 },
    x: { axis: 'x', layers: ALL, dir: -1 },
    y: { axis: 'y', layers: ALL, dir: -1 },
    z: { axis: 'z', layers: ALL, dir: -1 },
    r: { axis: 'x', layers: [0, 1], dir: -1 },
    l: { axis: 'x', layers: [-1, 0], dir: 1 },
    u: { axis: 'y', layers: [0, 1], dir: -1 },
    d: { axis: 'y', layers: [-1, 0], dir: 1 },
    f: { axis: 'z', layers: [0, 1], dir: -1 },
    b: { axis: 'z', layers: [-1, 0], dir: 1 }
  };
  var AXIS_I = { x: 0, y: 1, z: 2 };

  // PERM[base][i] = where facelet i goes after one plain (clockwise) quarter turn.
  var PERM = {};
  Object.keys(BASE).forEach(function (b) {
    var m = BASE[b], perm = [];
    FACELETS.forEach(function (f, i) {
      if (m.layers.indexOf(f.pos[AXIS_I[m.axis]]) < 0) { perm.push(i); return; }
      perm.push(faceletIndex(rotateVec(f.pos, m.axis, m.dir), rotateVec(f.normal, m.axis, m.dir)));
    });
    PERM[b] = perm;
  });

  function makeMove(base, turns) {
    var m = BASE[base];
    var suffix = turns === 2 ? '2' : turns === -1 ? "'" : '';
    return {
      name: base + suffix, base: base, turns: turns,
      axis: m.axis, layers: m.layers.slice(), amount: m.dir * turns
    };
  }

  // Parse one move token ("R", "R'", "R2", "R2'" = "R2") or pass a move object through.
  function parseMove(tok) {
    if (typeof tok === 'object' && tok) return makeMove(tok.base, tok.turns);
    var mt = /^([UDLRFBMxyzrlufdb])(2?)('?)$/.exec(String(tok).trim());
    if (!mt) throw new Error('Bad move: ' + tok);
    return makeMove(mt[1], mt[2] ? 2 : mt[3] ? -1 : 1);
  }

  // Parse an alg string (or array of tokens/moves) into an array of move objects.
  function parseAlg(alg) {
    if (Array.isArray(alg)) return alg.map(parseMove);
    var toks = String(alg).replace(/[()]/g, ' ').trim().split(/\s+/).filter(Boolean);
    return toks.map(parseMove);
  }

  function invertMove(m) {
    m = parseMove(m);
    return makeMove(m.base, m.turns === 2 ? 2 : -m.turns);
  }

  function invertAlg(alg) { return parseAlg(alg).reverse().map(invertMove); }

  function algToString(alg) { return parseAlg(alg).map(function (m) { return m.name; }).join(' '); }

  function solvedState() {
    var s = [];
    FACES.forEach(function (f) { for (var i = 0; i < 9; i++) s.push(f); });
    return s;
  }

  function clone(state) { return state.slice(); }

  // Returns a new state; does not mutate the input.
  function applyMove(state, move) {
    var m = parseMove(move);
    var perm = PERM[m.base];
    var q = ((m.turns % 4) + 4) % 4;
    var s = state.slice();
    for (var k = 0; k < q; k++) {
      var next = new Array(54);
      for (var i = 0; i < 54; i++) next[perm[i]] = s[i];
      s = next;
    }
    return s;
  }

  function applyAlg(state, alg) {
    return parseAlg(alg).reduce(applyMove, state.slice());
  }

  // Solved in any whole-cube orientation: every face is one color.
  function isSolved(state) {
    for (var f = 0; f < 6; f++) {
      for (var i = 1; i < 9; i++) if (state[f * 9 + i] !== state[f * 9]) return false;
    }
    return true;
  }

  function isEqual(a, b) {
    for (var i = 0; i < 54; i++) if (a[i] !== b[i]) return false;
    return true;
  }

  // Random scramble as an array of move names.
  // opts.half: also use ' and 2 suffixes (WCA-ish); default false = quarter turns only.
  // Never the same face twice in a row; with half, also never A B A on one axis (e.g. R L R).
  function randomScramble(n, opts) {
    opts = opts || {};
    var rnd = opts.random || Math.random;
    var faces = ['U', 'D', 'L', 'R', 'F', 'B'];
    var suffixes = opts.half ? ['', "'", '2'] : ['', "'"];
    var out = [], prev = null, prev2 = null;
    while (out.length < n) {
      var f = faces[Math.floor(rnd() * 6)];
      if (f === prev) continue;
      if (opts.half && prev2 && BASE[f].axis === BASE[prev].axis && BASE[f].axis === BASE[prev2].axis) continue;
      out.push(f + suffixes[Math.floor(rnd() * suffixes.length)]);
      prev2 = prev; prev = f;
    }
    return out;
  }

  // Solve-history helper: returns a new history array (move names) with move appended,
  // or with the last move removed if move is its inverse (e.g. R then R', or R2 then R2).
  function pushHistory(history, move) {
    var m = parseMove(move), h = history.slice();
    if (h.length) {
      var last = parseMove(h[h.length - 1]);
      if (last.base === m.base && ((last.turns + m.turns) % 4 + 4) % 4 === 0) { h.pop(); return h; }
    }
    h.push(m.name);
    return h;
  }

  // ---- Algorithms (spec Feature 2). Algs assume CFOP hold: cross color on D. ----
  var ALGS = [
    { id: 'f2l-1', name: 'Corner white front, edge UR', group: 'F2L', target: 'slotFR', alg: "U R U' R'",
      hint: 'Corner at UFR with white facing front; edge at UR.' },
    { id: 'f2l-2', name: 'Corner white right, edge UF', group: 'F2L', target: 'slotFR', alg: "U' F' U F",
      hint: 'Corner at UFR with white facing right; edge at UF.' },
    { id: 'f2l-3', name: 'Corner white right, edge UB', group: 'F2L', target: 'slotFR', alg: "R U R'",
      hint: 'Corner at UFR with white facing right; edge at UB.' },
    { id: 'f2l-4', name: 'Corner white front, edge UL', group: 'F2L', target: 'slotFR', alg: "F' U' F",
      hint: 'Corner at UFR with white facing front; edge at UL.' },
    { id: 'oll-line', name: 'Line', group: 'OLL edges', target: 'uFace', alg: "F R U R' U' F'",
      hint: 'Yellow line on top, hold it horizontal (UL-UR).' },
    { id: 'oll-l', name: 'L', group: 'OLL edges', target: 'uFace', alg: "f R U R' U' f'",
      hint: 'Yellow L on top, hold it at front-right (UF and UR).' },
    { id: 'oll-dot', name: 'Dot', group: 'OLL edges', target: 'uFace', alg: "F R U R' U' F' f R U R' U' f'",
      hint: 'No yellow edges on top.' },
    { id: 'oll-sune', name: 'Sune', group: 'OLL corners', target: 'uFace', alg: "R U R' U R U2 R'",
      hint: 'One yellow corner on top; put it at UFL.' },
    { id: 'oll-antisune', name: 'Antisune', group: 'OLL corners', target: 'uFace', alg: "R U2 R' U' R U' R'",
      hint: 'One yellow corner on top; put it at UBR.' },
    { id: 'oll-h', name: 'H', group: 'OLL corners', target: 'uFace', alg: "R U R' U R U' R' U R U2 R'",
      hint: 'No yellow corners on top; yellow pairs face left and right.' },
    { id: 'oll-pi', name: 'Pi', group: 'OLL corners', target: 'uFace', alg: "R U2 R2 U' R2 U' R2 U2 R",
      hint: 'No yellow corners on top; yellow pair on the left side.' },
    { id: 'oll-headlights', name: 'Headlights', group: 'OLL corners', target: 'uFace', alg: "R2 D R' U2 R D' R' U2 R'",
      hint: 'Two adjacent yellow corners on top; headlights face front.' },
    { id: 'oll-chameleon', name: 'Chameleon', group: 'OLL corners', target: 'uFace', alg: "r U R' U' r' F R F'",
      hint: 'Two adjacent yellow corners on top (at the right); the left corners have yellow facing front and back.' },
    { id: 'oll-bowtie', name: 'Bowtie', group: 'OLL corners', target: 'uFace', alg: "F' r U R' U' r' F R",
      hint: 'Two diagonal yellow corners on top, at UFL and UBR.' },
    { id: 'pll-t', name: 'Adjacent swap (T)', group: 'PLL corners', target: 'cube', alg: "R U R' U' R' F R2 U' R' U' R U R' F'",
      hint: 'Headlights on one side; put them on the left.' },
    { id: 'pll-y', name: 'Diagonal swap (Y)', group: 'PLL corners', target: 'cube', alg: "F R U' R' U' R U R' F' R U R' U' R' F R F'",
      hint: 'No headlights anywhere.' },
    { id: 'pll-ua', name: 'Ua', group: 'PLL edges', target: 'cube', alg: "R U' R U R U R U' R' U' R2",
      hint: 'Three edges cycle; solved side at the back.' },
    { id: 'pll-ub', name: 'Ub', group: 'PLL edges', target: 'cube', alg: "R2 U R U R' U' R' U' R' U R'",
      hint: 'Three edges cycle; solved side at the back.' },
    { id: 'pll-h', name: 'H', group: 'PLL edges', target: 'cube', alg: 'M2 U M2 U2 M2 U M2',
      hint: 'Opposite edges swap on both axes.' },
    { id: 'pll-z', name: 'Z', group: 'PLL edges', target: 'cube', alg: "M' U M2 U M2 U M' U2 M2",
      hint: 'Adjacent edges swap in two pairs; hold so the pairs are front-right and back-left.' }
  ];

  // Solved cube in CFOP hold: white (cross) on D, yellow on U, green F.
  function solvedCfop() { return applyAlg(solvedState(), 'z2'); }

  // Case state for an alg: CFOP-hold solved cube with the inverse of the alg applied.
  function caseState(alg) { return applyAlg(solvedCfop(), invertAlg(alg)); }

  function centerColor(state, face) { return state[FACES.indexOf(face) * 9 + 4]; }
  function at(state, pos, normal) { return state[faceletIndex(pos, normal)]; }

  // Do all stickers of the given cubies match the center of the face they point at?
  function cubiesSolved(state, positions) {
    return positions.every(function (p) {
      return FACELETS.every(function (f, i) {
        if (f.pos.join() !== p.join()) return true;
        return state[i] === centerColor(state, f.face);
      });
    });
  }

  var CROSS = [[0, -1, 1], [1, -1, 0], [0, -1, -1], [-1, -1, 0]];
  var SLOT_FR = [[1, -1, 1], [1, 0, 1]];
  var F2L_ALL = [];
  [-1, 0].forEach(function (y) {
    for (var x = -1; x <= 1; x++) for (var z = -1; z <= 1; z++) F2L_ALL.push([x, y, z]);
  });

  // Target checks used by alg verification (relative to current centers).
  function targetSolved(state, target) {
    if (target === 'slotFR') return cubiesSolved(state, CROSS.concat(SLOT_FR));
    if (target === 'uFace') {
      if (!cubiesSolved(state, F2L_ALL)) return false;
      var u = centerColor(state, 'U');
      for (var i = 0; i < 9; i++) if (state[i] !== u) return false;
      return true;
    }
    if (target === 'cube') return isSolved(state);
    throw new Error('Unknown target: ' + target);
  }

  // Starting from its own case state, does the alg leave its target solved (allowing one final U)?
  function verifyAlg(a) {
    var s = applyAlg(caseState(a.alg), a.alg);
    return ['', 'U', "U'", 'U2'].some(function (auf) {
      return targetSolved(auf ? applyMove(s, auf) : s, a.target);
    });
  }

  var Cube = {
    FACES: FACES, COLOR_NAME: COLOR_NAME, COLOR_HEX: COLOR_HEX, NORMALS: NORMALS,
    FACELETS: FACELETS, BASE_MOVES: BASE, ALGS: ALGS,
    faceletIndex: faceletIndex, rotateVec: rotateVec, at: at, centerColor: centerColor,
    parseMove: parseMove, parseAlg: parseAlg, invertMove: invertMove, invertAlg: invertAlg,
    algToString: algToString,
    solvedState: solvedState, solvedCfop: solvedCfop, clone: clone, isEqual: isEqual,
    applyMove: applyMove, applyAlg: applyAlg, isSolved: isSolved,
    randomScramble: randomScramble, pushHistory: pushHistory,
    caseState: caseState, cubiesSolved: cubiesSolved, targetSolved: targetSolved, verifyAlg: verifyAlg
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = Cube;
  else root.Cube = Cube;
})(typeof window !== 'undefined' ? window : this);
