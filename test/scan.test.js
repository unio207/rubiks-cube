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
// Webcams often expose dark, and auto-exposure changes between captures. Reading must not depend on
// brightness: dark yellow is olive (looked green), dark orange looked red.
var CASTS = { neutral: [1, 1, 1], warm: [1.08, 0.95, 0.72], greenish: [0.9, 1.05, 0.85], cool: [0.85, 0.97, 1.12] };
var tintMiss = [];
[1, 0.8, 0.65, 0.5, 0.4, 0.3].forEach(function (k) {
  Object.keys(CASTS).forEach(function (n) {
    Object.keys(TRUE).forEach(function (c) {
      var got = S.nearestColor(TRUE[c].map(function (v, j) { return clamp(v * k * CASTS[n][j]); }));
      if (got !== c) tintMiss.push(c + '->' + got + ' @' + k + ' ' + n);
    });
  });
});
check('live tint reads every colour at any exposure (0.3-1) and cast', tintMiss.length === 0, tintMiss);
(function () {
  var ok = 0, N = 200, conf = {};
  for (var k = 0; k < N; k++) {
    var st = C.applyAlg(randomState(30), pick(S.ORIENTATIONS).alg);
    var exp = S.STEPS.map(function () { return 0.35 + rnd() * 0.65; });   // each capture exposed differently
    var faceOf = {};
    S.STEPS.forEach(function (sp, j) { sp.cells.forEach(function (f) { faceOf[f] = j; }); });
    var reads = st.map(function (c, i) {
      var e = exp[faceOf[i]] * (1 - rnd() * 0.1);
      return TRUE[c].map(function (v) { return clamp(v * e + (rnd() - 0.5) * 16); });
    });
    var got = S.classify(reads);
    if (C.isEqual(got, st)) ok++;
    else st.forEach(function (c, i) { if (got[i] !== c) conf[c + '->' + got[i]] = (conf[c + '->' + got[i]] || 0) + 1; });
  }
  console.log('classify per-face exposure 0.35-1: ' + ok + '/' + N + ' exact ' + JSON.stringify(conf));
  check('classify survives a different exposure on every capture', ok === N, ok + '/' + N);
})();

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


// 7. Feature 5: captures in any order and rotation give the same state as holds as instructed,
// always with white on top and green in front.
(function () {
  var QT = [6, 3, 0, 7, 4, 1, 8, 5, 2];
  function turn(cap, q) { for (var i = 0; i < q; i++) cap = QT.map(function (k) { return cap[k]; }); return cap; }
  function std(st) { return S.normalize(st).state; }
  var okG = 0, okA = 0, flagged = 0, N = 60, t0 = Date.now();
  for (var k = 0; k < N; k++) {
    var st = C.applyAlg(randomState(30), pick(S.ORIENTATIONS).alg);
    var reads = camera(st, pick([LIGHTS.neutral, LIGHTS.dim, LIGHTS.warm, LIGHTS.cool]));
    var caps = S.STEPS.map(function (sp) { return sp.cells.map(function (f) { return reads[f]; }); });
    var g = S.assemble(caps);
    if (C.isEqual(g.state, std(st)) && !g.rearranged) okG++;
    // Captures land on the wrong steps and every picture is turned.
    var order = [0, 1, 2, 3, 4, 5].sort(function () { return rnd() - 0.5; });
    var qs = order.map(function () { return Math.floor(rnd() * 4); });
    var mixed = order.map(function (j, i) { return turn(caps[j], qs[i]); });
    var a = S.assemble(mixed);
    if (C.isEqual(a.state, std(st))) okA++;
    var same = order.join() === '0,1,2,3,4,5' && qs.every(function (q) { return q === 0; });
    if (a.rearranged !== same) flagged++;
  }
  console.log('assemble: as held ' + okG + '/' + N + ', any order ' + okA + '/' + N + ' (' + (Date.now() - t0) + ' ms)');
  check('assemble keeps captures held as instructed', okG === N, okG);
  check('assemble recovers any order and rotation', okA === N, okA);
  check('assemble says when faces were put right', flagged === N, flagged);
  // A partly solved cube (F2L done: whole D face yellow, in the CFOP hold) also assembles.
  var mid = C.applyAlg(C.solvedCfop(), "R U R' U R U2 R' U2 F R U R' U' F'");
  var mr = camera(mid, LIGHTS.neutral);
  var mc = S.STEPS.map(function (sp) { return sp.cells.map(function (f) { return mr[f]; }); });
  var mixedMid = [mc[0], turn(mc[5], 1), mc[2], turn(mc[4], 3), mc[1], turn(mc[3], 2)];
  check('mid-solve cube assembles in any order', C.isEqual(S.assemble(mixedMid).state, std(mid)));

  // Steps are named by centre colour, and a capture goes to the step of its centre colour.
  check('steps named by centre colour', S.STEPS.map(function (sp) { return sp.title; }).join() === 'Green,Red,Blue,Orange,White,Yellow' &&
    S.STEPS.every(function (sp) { return sp.title.toLowerCase() === C.COLOR_NAME[sp.face]; }));
  var all = [0, 1, 2, 3, 4, 5], miss = [];
  [1, 0.6, 0.4].forEach(function (e) {
    Object.keys(CASTS).forEach(function (n) {
      S.STEPS.forEach(function (sp, k) {
        var rgb = TRUE[sp.face].map(function (v, j) { return clamp(v * e * CASTS[n][j]); });
        if (S.slotFor(rgb, all) !== k) miss.push(sp.title + ' @' + e + ' ' + n);
      });
    });
  });
  check('slotFor picks the step of the centre colour', miss.length === 0, miss);
  // The step being asked for wins unless the centre is clearly another colour.
  var bluish = [175, 190, 220];   // white centre with a blue logo, read as a mix
  check('slotFor keeps the asked step for a logo-tinted centre', S.slotFor(bluish, all, 4) === 4, S.slotFor(bluish, all));
  check('slotFor: asked green, shown red goes to red', S.slotFor(TRUE.R, all, 0) === 1);
  check('slotFor: asked red, shown orange goes to orange', S.slotFor(TRUE.L, all, 1) === 3);
  check('slotFor: asked white, shown yellow goes to yellow', S.slotFor(TRUE.D, all, 4) === 5);
  // Assembling ignores a logo-tinted centre reading when the faces are on their steps.
  var logoOk = 0;
  for (var lk = 0; lk < 30; lk++) {
    var ls = std(randomState(30)), lr = camera(ls, LIGHTS.neutral);   // held as instructed
    var lc = S.STEPS.map(function (sp) { return sp.cells.map(function (f) { return lr[f]; }); });
    lc[4] = lc[4].slice(); lc[4][4] = [120, 140, 200];   // white centre, logo-heavy reading
    if (C.isEqual(S.assemble(lc).state, ls)) logoOk++;
  }
  check('assemble ignores a logo on the white centre', logoOk === 30, logoOk);
  // Any way up: each face on its own step but turned at random (some with a logo on white).
  var upOk = 0, UPN = 200;
  for (var uk = 0; uk < UPN; uk++) {
    var us = std(randomState(30)), ur = camera(us, pick([LIGHTS.neutral, LIGHTS.dim, LIGHTS.warm]));
    var uc = S.STEPS.map(function (sp) { return turn(sp.cells.map(function (f) { return ur[f]; }), Math.floor(rnd() * 4)); });
    if (uk % 3 === 0) { uc[4] = uc[4].slice(); uc[4][4] = [150, 165, 205]; }
    if (C.isEqual(S.assemble(uc).state, us)) upOk++;
  }
  console.log('assemble any way up: ' + upOk + '/' + UPN);
  check('assemble: faces shown any way up', upOk === UPN, upOk);
  check('steps say any way up', S.STEPS.every(function (sp) { return /any way up/.test(sp.text); }));
  check('slotFor picks among allowed steps only', S.slotFor(TRUE.R, [2, 3, 5]) === 3);   // red read, red step full: orange
})();

// 8. Feature 5: frameInfo and the auto-capture state machine.
(function () {
  var W = 160, H = 120, X0 = 20, Y0 = 0, SIZE = 120, CELL = 40;
  // faceCols: 9 colours or null for a blank wall; gap: dark plastic between stickers.
  function image(faceCols, opts) {
    opts = opts || {};
    var data = new Uint8ClampedArray(W * H * 4), dx = opts.dx || 0;
    for (var y = 0; y < H; y++) for (var x = 0; x < W; x++) {
      var p = (y * W + x) * 4, c = opts.bg || [120, 110, 100], cx = x - X0 - dx, cy = y - Y0;
      if (faceCols && cx >= 0 && cx < SIZE && cy >= 0 && cy < SIZE) {
        var inX = cx % CELL, inY = cy % CELL;
        c = (opts.gap === false || inX > 3 && inX < CELL - 4 && inY > 3 && inY < CELL - 4)
          ? faceCols[Math.floor(cy / CELL) * 3 + Math.floor(cx / CELL)] : [15, 15, 18];
      }
      if (opts.logo && Math.abs(cx - 60) < 9 && Math.abs(cy - 60) < 7) c = (x + y) % 3 ? [40, 70, 150] : [90, 90, 100];
      if (opts.noisy) c = c.map(function (v) { return clamp(v + (rnd() - 0.5) * 140); });
      data[p] = c[0]; data[p + 1] = c[1]; data[p + 2] = c[2]; data[p + 3] = 255;
    }
    return S.frameInfo(data, W, H, X0, Y0, SIZE);
  }
  var scr = randomState(25), faceA = scr.slice(18, 27).map(function (c) { return TRUE[c]; });
  var faceB = scr.slice(0, 9).map(function (c) { return TRUE[c]; });
  var uni = [0, 1, 2, 3, 4, 5, 6, 7, 8].map(function () { return TRUE.D; });
  var a = image(faceA);
  check('frameInfo reads cells', a.cells.every(function (c, k) { return c.join() === faceA[k].join(); }), a.cells);
  check('frameInfo: stickers are even', a.even.every(function (e) { return e > 0.9; }), a.even);
  check('frameInfo: gaps found', a.gaps === 12, a.gaps);
  check('frameInfo: no gaps on a stickerless face', image(uni, { gap: false }).gaps === 0);
  check('frameInfo: no gaps on a wall', image(null).gaps === 0);
  check('frameInfo: noise is uneven', image(faceA, { noisy: true }).even.some(function (e) { return e < 0.7; }));

  function run(frames, others) {
    var ac = S.createAutoCapture(), out = [];
    frames.forEach(function (f) { out.push(ac.feed(f, others)); });
    return out;
  }
  function n(f, k) { var a = []; for (var i = 0; i < k; i++) a.push(f); return a; }
  function count(list) { return list.filter(function (x) { return x === 'capture'; }).length; }
  var steadyA = run(n(a, 12));
  check('steady face captured once', count(steadyA) === 1 && steadyA[3] === 'capture', steadyA);
  check('holding shown before capture', steadyA[1] === 'holding');
  var b = image(faceB);
  check('next face captured after moving', count(run(n(a, 5).concat([image(faceB, { dx: 15 })], n(b, 5)))) === 2);
  check('a face already captured is ignored', count(run(n(a, 8), [null, faceA.map(function (c) { return c.map(function (v) { return v * 0.7; }); })])) === 0);
  check('the same face turned is ignored', S.sameFace(faceA, [6, 3, 0, 7, 4, 1, 8, 5, 2].map(function (k) { return faceA[k]; })));
  check('different faces are not the same', !S.sameFace(faceA, faceB));
  check('uniform face with gaps captured', count(run(n(image(uni), 6))) === 1);
  check('uniform face without gaps not captured', count(run(n(image(uni, { gap: false }), 6))) === 0);
  check('blank wall not captured', count(run(n(image(null), 8))) === 0);
  var moving = []; for (var i = 0; i < 10; i++) moving.push(image(i % 2 ? faceA : faceB));
  check('moving view not captured', count(run(moving)) === 0);
  // A logo on the centre cap (GAN): the centre still reads as its colour, and the face is captured.
  var white = scr.slice(0, 9).map(function (c) { return TRUE[c]; }); white[4] = TRUE.U;
  var logo = image(white, { logo: true });
  check('logo: centre reads its colour', S.nearestColor(logo.cells[4]) === 'U', logo.cells[4]);
  check('logo: face with a logo is captured', count(run(n(logo, 6))) === 1);
  var uniLogo = image([0, 1, 2, 3, 4, 5, 6, 7, 8].map(function () { return TRUE.U; }), { logo: true });
  check('logo: solved white face with a logo is captured', count(run(n(uniLogo, 6))) === 1);
  check('noisy view not captured', count(run([0, 1, 2, 3, 4, 5].map(function () { return image(faceA, { noisy: true }); }))) === 0);
})();

console.log('scan tests: ' + pass + ' passed, ' + fail + ' failed');
process.exitCode = fail ? 1 : 0;
