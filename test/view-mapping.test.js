// Run: node test/view-mapping.test.js
// Checks the 3D view's sticker mapping (pure part of src/view3d.js) against core, without THREE.
var C = require('../src/core.js');
var V = require('../src/view3d.js').mapping;

var pass = 0, fail = 0;
function check(name, ok, info) {
  if (ok) pass++;
  else { fail++; console.log('FAIL: ' + name + (info ? ' -- ' + info : '')); }
}

var seed = 777;
function rnd() { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; }

var TOKENS = [];
Object.keys(C.BASE_MOVES).forEach(function (b) { TOKENS.push(b, b + "'", b + '2'); });

// 1. rotationMatrix matches the standard right-hand rotation matrices Three.js uses for
//    object.rotation[axis] = q * PI/2 (Rx, Ry, Rz), rounded.
function threeMatrix(axis, angle) {
  var c = Math.cos(angle), s = Math.sin(angle);
  if (axis === 'x') return [[1, 0, 0], [0, c, -s], [0, s, c]];
  if (axis === 'y') return [[c, 0, s], [0, 1, 0], [-s, 0, c]];
  return [[c, -s, 0], [s, c, 0], [0, 0, 1]];
}
['x', 'y', 'z'].forEach(function (a) {
  [-2, -1, 0, 1, 2, 3].forEach(function (q) {
    var t = threeMatrix(a, q * Math.PI / 2).map(function (r) { return r.map(function (v) { return Math.round(v) + 0; }); });
    check('rotationMatrix ' + a + q, JSON.stringify(t) === JSON.stringify(V.rotationMatrix(a, q)));
  });
});

// 2. snapRotation reads a noisy column-major Matrix4 element array.
var Ry = threeMatrix('y', Math.PI / 2 + 1e-6);
var el = [Ry[0][0], Ry[1][0], Ry[2][0], 0, Ry[0][1], Ry[1][1], Ry[2][1], 0, Ry[0][2], Ry[1][2], Ry[2][2], 0, 0, 0, 0, 1];
check('snapRotation', JSON.stringify(V.snapRotation(el)) === JSON.stringify(V.rotationMatrix('y', 1)));

// 3. createModel + deriveState round-trips any state.
var scr = C.applyAlg(C.solvedState(), "R U' F2 M r' D2 x L b' y' u B2 z d' f l2");
check('round-trip solved', C.isEqual(V.deriveState(V.createModel(C.solvedState())), C.solvedState()));
check('round-trip scrambled', C.isEqual(V.deriveState(V.createModel(scr)), scr));

// 4. Every move token from solved and from a scrambled state matches core.
[C.solvedState(), scr].forEach(function (start, k) {
  TOKENS.forEach(function (tok) {
    var model = V.applyMoveToModel(V.createModel(start), tok);
    check('move ' + tok + ' from start ' + k, C.isEqual(V.deriveState(model), C.applyMove(start, tok)));
  });
});

// 5. Long random sequences (the view keeps cubie rotations, so errors would compound).
for (var t = 0; t < 50; t++) {
  var model = V.createModel(C.solvedState()), s = C.solvedState(), seq = [];
  for (var i = 0; i < 40; i++) {
    var tok = TOKENS[Math.floor(rnd() * TOKENS.length)];
    seq.push(tok);
    V.applyMoveToModel(model, tok);
    s = C.applyMove(s, tok);
  }
  check('random seq ' + t, C.isEqual(V.deriveState(model), s), seq.join(' '));
  // Each cubie rotation stays a proper integer rotation (det +1, entries in -1..1).
  var okRot = model.every(function (c) {
    var r = c.rot;
    var det = r[0][0] * (r[1][1] * r[2][2] - r[1][2] * r[2][1]) - r[0][1] * (r[1][0] * r[2][2] - r[1][2] * r[2][0]) + r[0][2] * (r[1][0] * r[2][1] - r[1][1] * r[2][0]);
    return det === 1;
  });
  check('rotations proper ' + t, okRot);
}

console.log('view-mapping: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
