// Run: node test/scan.test.js
// Feature 4 logic: validator, capture-step mapping, colour classification, grid sampling.
var C = require('../src/core.js');
var S = require('../src/scan.js');
var Solver = require('../src/solver.js');

var pass = 0, fail = 0;
function check(name, ok, info) {
  if (ok) pass++;
  else { fail++; console.log('FAIL: ' + name + (info !== undefined ? ' -- ' + JSON.stringify(info) : '')); }
}
var seed = 4242;
function rnd() { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; }
function pick(a) { return a[Math.floor(rnd() * a.length)]; }

var ALL = [];
Object.keys(C.BASE_MOVES).forEach(function (b) { ALL.push(b, b + "'", b + '2'); });
function randomState(n) { var a = []; for (var i = 0; i < n; i++) a.push(pick(ALL)); return C.applyAlg(C.solvedState(), a); }
function has(res, re) { return res.errors.some(function (e) { return re.test(e); }); }
function swap(s, a, b) { s = s.slice(); var t = s[a]; s[a] = s[b]; s[b] = t; return s; }
function cycle3(s, a, b, c) { s = s.slice(); var t = s[a]; s[a] = s[c]; s[c] = s[b]; s[b] = t; return s; }
function idx(pos, face) { return C.faceletIndex(pos, C.NORMALS[face]); }

// 1. Orientations.
check('24 orientations', S.ORIENTATIONS.length === 24, S.ORIENTATIONS.length);

// 2. Every reachable state (incl. M, wide moves, rotations) validates; the solver solves them.
var solvedOk = S.validate(C.solvedState());
check('solved validates', solvedOk.ok, solvedOk.errors);
var solveFails = 0;
for (var t = 0; t < 600; t++) {
  var st = randomState(10 + Math.floor(rnd() * 30));
  var v = S.validate(st);
  check('random state ' + t + ' validates', v.ok && v.bad.length === 0, v.errors);
  if (t < 40) {
    var res = Solver.solve(st);
    if (!C.isSolved(C.applyAlg(st, res.moves))) solveFails++;
  }
}
check('solver solves validated states', solveFails === 0, solveFails);

// 3. Each kind of error is caught with the right message.
var base = randomState(25);
var nC = S.normalize(base);
check('normalize gives solved centres', nC && [4, 13, 22, 31, 40, 49].map(function (i) { return nC.state[i]; }).join('') === 'URFDLB');

var UFR = [idx([1, 1, 1], 'U'), idx([1, 1, 1], 'R'), idx([1, 1, 1], 'F')];   // clockwise from outside
var UF = [idx([0, 1, 1], 'U'), idx([0, 1, 1], 'F')];
var UR = [idx([1, 1, 0], 'U'), idx([1, 1, 0], 'R')];
var UBL = [idx([-1, 1, -1], 'U'), idx([-1, 1, -1], 'B'), idx([-1, 1, -1], 'L')];

for (var r = 0; r < 30; r++) {
  var s0 = randomState(20 + r);
  var tw = S.validate(cycle3(s0, UFR[0], UFR[1], UFR[2]));
  check('twisted corner caught ' + r, !tw.ok && has(tw, /twisted/) && !has(tw, /flipped|parity/), tw.errors);
  var fl = S.validate(swap(s0, UF[0], UF[1]));
  check('flipped edge caught ' + r, !fl.ok && has(fl, /flipped/) && !has(fl, /twisted|parity/), fl.errors);
  var sw = swap(swap(s0, UF[0], UR[0]), UF[1], UR[1]);   // swap two edges as whole pieces
  var pv = S.validate(sw);
  check('swapped edges caught ' + r, !pv.ok && has(pv, /parity/) && !has(pv, /twisted|flipped/), pv.errors);
  var mirror = swap(s0, UFR[1], UFR[2]);
  var mv = S.validate(mirror);
  check('mirrored corner caught ' + r, !mv.ok && has(mv, /mirror order/), mv.errors);
  check('mirrored corner highlighted ' + r, UFR.every(function (i) { return mv.bad.indexOf(i) >= 0; }), mv.bad);
}
// Green on the UF edge swapped with yellow on the DF edge: white-yellow and green-green edges don't exist.
var DF = [idx([0, -1, 1], 'D'), idx([0, -1, 1], 'F')];
var badPiece = S.validate(swap(C.solvedState(), UF[1], DF[0]));
check('impossible pieces caught', !badPiece.ok && has(badPiece, /No real edge is white-yellow/) && has(badPiece, /No real edge is green-green/), badPiece.errors);
check('impossible pieces highlighted', UF.concat(DF).every(function (i) { return badPiece.bad.indexOf(i) >= 0; }), badPiece.bad);
// Green and red swapped between the UF and UR edges: the two edges trade places (parity).
var two = S.validate(swap(C.solvedState(), UF[1], UR[1]));
check('stickers swapped between two edges give parity', !two.ok && has(two, /parity/), two.errors);
var mirrorCorner = S.validate(swap(C.solvedState(), UBL[1], UBL[2]));
check('mirror corner on solved cube caught', has(mirrorCorner, /mirror order/), mirrorCorner.errors);

var unset = C.solvedState(); unset[0] = null; unset[10] = null;
var uv = S.validate(unset);
check('unset stickers reported', !uv.ok && has(uv, /^2 stickers are not set/), uv.errors);
var one = C.solvedState(); one[0] = 'D';
var ov = S.validate(one);
check('wrong colour counts reported', !ov.ok && has(ov, /white has 8, yellow has 10/), ov.errors);
var ctr = swap(C.solvedState(), 4, 22);   // white and green centres swapped
var cv = S.validate(ctr);
check('bad centres reported', !cv.ok && has(cv, /centres don't match/), cv.errors);
var mirC = swap(C.solvedState(), 13, 40); // red and orange centres swapped: mirror-image scheme
check('mirror-image centres reported', has(S.validate(mirC), /centres don't match/));
check('short state rejected', !S.validate([]).ok);

// 4. Capture steps: each step shows one face in its reading order (contract: row 0 at the top,
// col 0 on the left, seen from outside; U with B at the top, D with F at the top).
S.STEPS.forEach(function (st) {
  var f = C.FACES.indexOf(st.face), want = [];
  for (var k = 0; k < 9; k++) want.push(f * 9 + k);
  check('step ' + st.face + ' maps camera cells to the face in reading order', st.cells.join() === want.join(), st.cells);
});
// The instructions describe the holds as a chain of physical moves; they must equal each step's rot.
var ids = []; for (var i = 0; i < 54; i++) ids.push(String(i));
function same(a, b) { return C.applyAlg(ids, a).join() === C.applyAlg(ids, b).join(); }
check('Right = one quarter turn left (y)', same(['y'], S.STEPS[1].rot));
check('Back = two quarter turns left', same(['y', 'y'], S.STEPS[2].rot));
check('Left = three quarter turns left', same(['y', 'y', 'y'], S.STEPS[3].rot));
check('Up = four quarter turns left, then tip top toward camera', same(['y', 'y', 'y', 'y', "x'"], S.STEPS[4].rot));
check('Down = from Up, tip over half a turn', same(["x'", 'x2'], S.STEPS[5].rot));
check('Up: back side is at the top of the image', C.applyAlg(C.solvedState(), S.STEPS[4].rot)[19] === 'U' &&
  C.solvedState()[1] === 'U' && S.STEPS[4].cells[1] === 1);

// 5. Classification from synthetic camera readings.
var TRUE = { U: [225, 228, 222], D: [228, 214, 55], F: [30, 150, 85], B: [35, 85, 175], R: [175, 30, 45], L: [235, 105, 35] };
function clamp(v) { return Math.max(0, Math.min(255, Math.round(v))); }
function camera(state, light) {
  return state.map(function (c) {
    var shade = 1 - rnd() * light.shade;
    return TRUE[c].map(function (v, j) { return clamp(v * light.gain * light.tint[j] * shade + (rnd() - 0.5) * 2 * light.noise); });
  });
}
var LIGHTS = {
  neutral: { gain: 1, tint: [1, 1, 1], shade: 0.1, noise: 10 },
  dim: { gain: 0.55, tint: [1, 1, 1], shade: 0.15, noise: 8 },
  warm: { gain: 0.95, tint: [1.08, 0.95, 0.72], shade: 0.12, noise: 10 },
  cool: { gain: 0.9, tint: [0.85, 0.97, 1.12], shade: 0.12, noise: 10 }
};
Object.keys(LIGHTS).forEach(function (name) {
  var ok = 0, N = 150;
  for (var k = 0; k < N; k++) {
    var st = C.applyAlg(randomState(30), pick(S.ORIENTATIONS).alg);   // any orientation
    var got = S.classify(camera(st, LIGHTS[name]));
    if (C.isEqual(got, st)) ok++;
  }
  console.log('classify ' + name + ': ' + ok + '/' + N + ' exact');
  check('classify ' + name + ' recovers every state', ok === N, ok + '/' + N);
});
// Readings put through the capture steps land back on the right facelets.
var stc = randomState(30);
var reads = camera(stc, LIGHTS.neutral);
var caps = S.STEPS.map(function (st) { return st.cells.map(function (f) { return reads[f]; }); });
check('readingsFromCaptures round trip', JSON.stringify(S.readingsFromCaptures(caps)) === JSON.stringify(reads));
check('nearestColor', S.nearestColor([240, 100, 20]) === 'L' && S.nearestColor([20, 70, 180]) === 'B' && S.nearestColor([230, 230, 230]) === 'U');

// 6. sampleGrid reads the median of each cell's middle, ignoring black borders and outliers.
(function () {
  var w = 120, h = 90, data = new Uint8ClampedArray(w * h * 4);
  var x0 = 15, y0 = 0, size = 90, cell = 30;
  var cols = [];
  for (var k = 0; k < 9; k++) cols.push([k * 25, 255 - k * 20, (k * 53) % 256]);
  for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
    var p = (y * w + x) * 4, cx = x - x0, cy = y - y0, c = [0, 0, 0];
    if (cx >= 0 && cx < size && cy >= 0 && cy < size) {
      var inX = cx % cell, inY = cy % cell;
      if (inX > 2 && inX < cell - 3 && inY > 2 && inY < cell - 3) c = cols[Math.floor(cy / cell) * 3 + Math.floor(cx / cell)];
    }
    if ((x * 7 + y * 13) % 31 === 0) c = [255, 0, 255];   // sparse outlier pixels
    data[p] = c[0]; data[p + 1] = c[1]; data[p + 2] = c[2]; data[p + 3] = 255;
  }
  var got = S.sampleGrid(data, w, h, x0, y0, size, 0.5);
  check('sampleGrid reads all 9 cells', JSON.stringify(got) === JSON.stringify(cols), got);
})();

console.log('scan tests: ' + pass + ' passed, ' + fail + ' failed');
process.exitCode = fail ? 1 : 0;
