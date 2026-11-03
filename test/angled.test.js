// Run: node test/angled.test.js
// Feature 9 logic in Node (no DOM, no browser): the angled-view geometry and homography, snapping
// and reading on synthetic frames drawn from the model itself, settled timing, quick-scan slots,
// auto-capture, this cube's colour reference, and three quick-scan holds assembled into the cube.
// (Rendered Three.js frames and the end-to-end run are in angled-browser.test.js.)
var S = require('../src/scan.js');
var C = require('../src/core.js');

var pass = 0, fail = 0;
function check(name, ok, info) {
  if (ok) pass++;
  else { fail++; console.log('FAIL: ' + name + (info !== undefined ? ' -- ' + info : '')); }
}
function rng(seed) {
  var s = seed >>> 0 || 1;
  return function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}
var rnd = rng(9);
function scrambled() {
  var st = C.solvedState();
  C.randomScramble(25, { random: rnd }).forEach(function (m) { st = C.applyMove(st, m); });
  return st;
}
function rgbOf(letter) { var x = C.COLOR_HEX[letter]; return [x >> 16 & 255, x >> 8 & 255, x & 255]; }
function mapH(H, u, v) { var z = H[6] * u + H[7] * v + 1; return [(H[0] * u + H[1] * v + H[2]) / z, (H[3] * u + H[4] * v + H[5]) / z]; }
function invH(H) {
  var a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
  var I = a * e - b * d;
  return [(e - f * h) / I, (c * h - b) / I, (b * f - c * e) / I, (f * g - d) / I, (a - c * g) / I, (c * d - a * f) / I, (d * h - e * g) / I, (b * g - a * h) / I];
}
// The cube as the model sees it: stickers 0.8 of a pitch, near-black gaps, the front a little
// darker than the top, a grey wall, noise. letters: the 18 colours in readAngled order.
function draw(letters, p, w, h, o) {
  o = o || {};
  var data = new Uint8ClampedArray(w * h * 4), r = rng(o.seed || 5), noise = o.noise === undefined ? 6 : o.noise, bg = o.bg || [120, 116, 108];
  for (var i = 0; i < w * h; i++) for (var j = 0; j < 3; j++) data[i * 4 + j] = bg[j] + (r() - 0.5) * 2 * noise;
  if (!p) return data;
  var q = S.angledQuads(p, w, h);
  [q.top, q.front].forEach(function (quad, f) {
    var Hi = invH(S.squareToQuad(quad)), shade = f ? 0.85 : 1;
    var xs = quad.map(function (pt) { return pt[0]; }), ys = quad.map(function (pt) { return pt[1]; });
    for (var y = Math.floor(Math.min.apply(null, ys)); y <= Math.ceil(Math.max.apply(null, ys)); y++) {
      for (var x = Math.floor(Math.min.apply(null, xs)); x <= Math.ceil(Math.max.apply(null, xs)); x++) {
        if (x < 0 || y < 0 || x >= w || y >= h) continue;
        var uv = mapH(Hi, x + 0.5, y + 0.5), u = uv[0], v = uv[1];
        if (!(u >= 0 && u < 1 && v >= 0 && v < 1)) continue;
        var c = Math.floor(u * 3), rr = Math.floor(v * 3), fu = u * 3 - c, fv = v * 3 - rr, k = f * 9 + rr * 3 + c;
        var col = [18, 18, 18];
        if (fu > 0.1 && fu < 0.9 && fv > 0.1 && fv < 0.9) {
          col = rgbOf(letters[k]).map(function (cv) { return cv * shade; });
          if (o.logo && k === 4 && Math.abs(fu - 0.5) < 0.18 && Math.abs(fv - 0.5) < 0.1) col = [60, 74, 106];
        }
        var at = (y * w + x) * 4;
        for (var t = 0; t < 3; t++) data[at + t] = col[t] + (r() - 0.5) * 2 * noise;
      }
    }
  });
  return data;
}
function lettersOf(state) { return state.slice(0, 9).concat(state.slice(18, 27)); }
function holdState(state, top, front) {
  for (var i = 0; i < S.ORIENTATIONS.length; i++) {
    var s = C.applyAlg(state, S.ORIENTATIONS[i].alg);
    if (s[4] === top && s[22] === front) return s;
  }
  return null;
}
// The fit's tilt (against the camera's axis) for a downward view of `view` degrees onto the top
// face, as seen from the camera (as in test/browser/angled-scene.js).
function modelTilt(view, ty, dist) {
  var t = view;
  for (var i = 0; i < 4; i++) {
    var a = t * Math.PI / 180;
    t = view + Math.atan2(ty + 1.5 * Math.cos(a), dist - 1.5 * Math.sin(a)) * 180 / Math.PI;
  }
  return t;
}
function cornerErr(a, b) {
  var e = 0;
  ['front', 'top'].forEach(function (k) { a[k].forEach(function (pt, j) { e = Math.max(e, Math.hypot(pt[0] - b[k][j][0], pt[1] - b[k][j][1])); }); });
  return e;
}

var W = 640, H = 480;

// ---- geometry ----
(function () {
  var ok = true;
  for (var i = 0; i < 50; i++) {
    var q = [[rnd() * 100, rnd() * 100], [300 + rnd() * 100, rnd() * 100], [300 + rnd() * 100, 300 + rnd() * 100], [rnd() * 100, 300 + rnd() * 100]];
    var Hq = S.squareToQuad(q);
    [[0, 0], [1, 0], [1, 1], [0, 1]].forEach(function (u, j) { var m = mapH(Hq, u[0], u[1]); if (Math.hypot(m[0] - q[j][0], m[1] - q[j][1]) > 1e-6) ok = false; });
  }
  check('squareToQuad takes the unit square to the quad', ok);
  var d = S.defaultFit(W, H), dq = S.angledQuads(d, W, H);
  check('default outline: top and front share the edge', dq.top[3].join() === dq.front[0].join() && dq.top[2].join() === dq.front[1].join());
  check('default outline: top above front, inside the frame', dq.top[0][1] < dq.front[0][1] && dq.top.concat(dq.front).every(function (pt) { return pt[0] > 0 && pt[1] > 0 && pt[0] < W && pt[1] < H; }));
  var lo = S.angledQuads(Object.assign({}, d, { tilt: 15 }), W, H), hi = S.angledQuads(Object.assign({}, d, { tilt: 50 }), W, H);
  check('more tilt shows more of the top and less of the front',
    hi.top[3][1] - hi.top[0][1] > lo.top[3][1] - lo.top[0][1] && hi.front[3][1] - hi.front[0][1] < lo.front[3][1] - lo.front[0][1]);
  check('the top narrows toward the back', dq.top[1][0] - dq.top[0][0] < dq.top[2][0] - dq.top[3][0]);
})();

// ---- snapping and reading synthetic frames ----
var reads = [];
(function () {
  var snapped = 0, exact = 0, near = 0, alignedN = 0, n = 30;
  for (var i = 0; i < n; i++) {
    var st = scrambled(), d = S.defaultFit(W, H), s = d.s * (0.8 + 0.4 * rnd());
    var p = { x: d.x + (rnd() - 0.5) * 120, y: d.y + (rnd() - 0.5) * 80, s: s, roll: -4 + 8 * rnd(), pz: s / (0.85 * W) };
    var vt = 18 + 30 * rnd(), vy = -8 + 16 * rnd(), dist = 1 / p.pz, tx = (p.x - W / 2) / s, ty = -(p.y - H / 2) / s;
    p.tilt = modelTilt(vt, ty, dist); p.yaw = vy - Math.atan2(tx, dist) * 180 / Math.PI;
    var letters = lettersOf(st), data = draw(letters, p, W, H, { seed: i + 1, logo: i % 2 === 0 });
    var sn = S.snapAngled(data, W, H);
    if (sn.ok) snapped++;
    var ce = cornerErr(sn.quads, S.angledQuads(p, W, H));
    if (ce <= 2) near++; else console.log('  synthetic frame ' + i + ': corner error ' + ce.toFixed(1) + ' px, tilt ' + p.tilt.toFixed(0) + ', yaw ' + p.yaw.toFixed(0) + ', score ' + sn.score.toFixed(3));
    var rd = S.readAngled(data, W, H, sn.quads, { now: 0 });
    if (rd.letters.join('') === letters.join('')) exact++;
    if (rd.aligned) alignedN++;
    reads.push({ data: data, sn: sn, rd: rd, letters: letters });
  }
  check('synthetic frames snap', snapped === n, snapped);
  check('synthetic frames: corners within 2 px', near === n, near);
  check('synthetic frames: all 18 stickers read (logos on half the white centres)', exact === n, exact);
  check('synthetic frames: aligned', alignedN === n, alignedN);
})();

// ---- settled timing ----
(function () {
  var r0 = reads[0], d = r0.data, q = r0.sn.quads;
  var a = S.readAngled(d, W, H, q, { now: 1000 });
  check('a first aligned frame is not settled yet', a.aligned && !a.settled && a.since === 1000);
  var b = S.readAngled(d, W, H, q, { prev: a, now: 1200 });
  check('not settled before 250 ms', !b.settled && b.since === 1000);
  var c = S.readAngled(d, W, H, q, { prev: b, now: 1260 });
  check('settled after 250 ms steady', c.settled);
  var other = S.readAngled(reads[1].data, W, H, reads[1].sn.quads, { prev: c, now: 1300 });
  check('a different view starts the steady time again', !other.settled && other.since === 1300);
  var blank = draw(null, null, W, H, { seed: 3 });
  var bs = S.snapAngled(blank, W, H);
  check('a blank wall does not snap', !bs.ok);
  var br = S.readAngled(blank, W, H, bs.quads, { now: 0 });
  check('a blank wall is not aligned', !br.aligned);
  var cl = S.readAngled(blank, W, H, bs.quads, { prev: br, now: 5000 });
  check('a blank wall is never settled', !cl.settled);
  check('confidence: high on a cube, low on a wall', a.confidence > 0.6 && br.confidence < 0.3, a.confidence + ' / ' + br.confidence);
  // Layers lined up but the grid a little off (a sticker row out of place): not aligned.
  var shifted = r0.sn.fit, sq = S.angledQuads(Object.assign({}, shifted, { y: shifted.y + 0.35 * shifted.s }), W, H);
  check('a grid off by a third of a sticker is not aligned', !S.readAngled(d, W, H, sq).aligned);
})();

// ---- quick-scan slots ----
var IDX = {}; S.STEPS.forEach(function (st, k) { IDX[st.face] = k; });
function cellsFor(state, top, front, o) {
  o = o || {};
  var hs = holdState(state, top, front), r = o.r || rnd, cast = o.cast || [1, 1, 1];
  return lettersOf(hs).map(function (l, k) {
    var c = rgbOf(l).map(function (v, t) { return Math.max(0, Math.min(255, v * cast[t] * (k < 9 ? 1 : 0.8) + (r() - 0.5) * 16)); });
    if (o.logo && k % 9 === 4 && l === 'U') c = [175, 190, 220];
    return c;
  });
}
(function () {
  var st = scrambled(), all = 0, pairs = [['U', 'F'], ['F', 'U'], ['R', 'B'], ['B', 'L'], ['D', 'L'], ['U', 'R']];
  pairs.forEach(function (pr) {
    var cells = cellsFor(st, pr[0], pr[1]), sl = S.quickSlots({ cells: cells }, [false, false, false, false, false, false]);
    if (sl[0] === IDX[pr[0]] && sl[1] === IDX[pr[1]]) all++;
  });
  check('quickSlots: each face goes to the step of its centre colour', all === pairs.length, all);
  var logo = S.quickSlots({ cells: cellsFor(st, 'U', 'R', { logo: true }) }, [false, false, false, false, false, false]);
  check('quickSlots: a logo-tinted white centre still goes to white', logo[0] === IDX.U && logo[1] === IDX.R, logo);
  var never = true;
  for (var i = 0; i < 200; i++) {
    var rc = [0, 1].map(function () { return [rnd() * 255, rnd() * 255, rnd() * 255]; });
    var cells = new Array(18).fill([128, 128, 128]); cells[4] = rc[0]; cells[13] = rc[1];
    var s2 = S.quickSlots({ cells: cells }, null);
    if (s2[0] === s2[1] || S.OPPOSITE[S.STEPS[s2[0]].face] === S.STEPS[s2[1]].face) never = false;
  }
  check('quickSlots: the two faces are always different neighbours', never);
})();

// ---- auto-capture ----
(function () {
  var st = scrambled();
  function read(top, front, aligned) { return { cells: cellsFor(st, top, front, { r: rng(1) }), aligned: aligned }; }
  var ac = S.createAngledCapture(), A = read('U', 'F', true), seq = [], caps = [];
  for (var i = 0; i < 6; i++) seq.push(ac.feed(A, caps));
  check('a steady aligned hold is captured once, after three steady intervals', seq.join() === 'waiting,holding,holding,capture,waiting,waiting', seq.join());
  caps = [A.cells.slice(0, 9), A.cells.slice(9)];
  ac.feed(read('R', 'B', false), caps);
  var again = []; for (var j = 0; j < 5; j++) again.push(ac.feed(A, caps));
  check('the same two faces again are never captured again', again.every(function (x) { return x === 'waiting'; }), again.join());
  var B = read('R', 'B', true), nb = []; for (var k = 0; k < 4; k++) nb.push(ac.feed(B, caps));
  check('a new hold after moving is captured', nb.indexOf('capture') === 3, nb.join());
  var half = read('U', 'R', true), hs = [];
  ac.feed(null, caps);
  for (var m = 0; m < 4; m++) hs.push(ac.feed(half, caps));
  check('a hold with one new face is captured', hs.indexOf('capture') >= 0, hs.join());
  var ac2 = S.createAngledCapture(), na = [], C2 = read('D', 'L', false);
  for (var n2 = 0; n2 < 8; n2++) na.push(ac2.feed(C2, []));
  check('a view that is not aligned (part-turned) is never captured', na.every(function (x) { return x === 'waiting'; }));
  var ac3 = S.createAngledCapture(), nn = [];
  for (var n3 = 0; n3 < 8; n3++) nn.push(ac3.feed(null, []));
  check('no cube in the outline: never captured', nn.every(function (x) { return x === 'waiting'; }));
})();

// ---- three holds assembled; this cube's colours as the reference ----
(function () {
  var good = 0, n = 40, refGain = 0, refOk = 0, paletteOk = 0, cases = 0;
  var holdSets = [[['U', 'F'], ['R', 'B'], ['D', 'L']], [['F', 'U'], ['L', 'D'], ['B', 'R']], [['U', 'R'], ['B', 'D'], ['L', 'F']], [['D', 'B'], ['F', 'L'], ['R', 'U']]];
  for (var i = 0; i < n; i++) {
    var st = scrambled(), set = holdSets[i % holdSets.length].slice(), caps = [null, null, null, null, null, null];
    if (i % 3) set.reverse();
    var cast = [[1, 1, 1], [1, 0.82, 0.6], [0.8, 0.92, 1.1], [0.45, 0.42, 0.38]][i % 4];
    set.forEach(function (pr) {
      var cells = cellsFor(st, pr[0], pr[1], { cast: cast, logo: i % 2 === 0 });
      var sl = S.quickSlots({ cells: cells }, caps.map(function (c) { return !!c; }));
      caps[sl[0]] = cells.slice(0, 9); caps[sl[1]] = cells.slice(9);
    });
    var res = S.assemble(caps);
    if (C.isEqual(res.state, st)) good++;
    // The reference from this scan reads a later view under the same light.
    var ref = S.reference(caps, res.state), view = cellsFor(st, 'R', 'F', { cast: cast }), truth = lettersOf(holdState(st, 'R', 'F'));
    var withRef = view.every(function (c, k) { return S.nearestRef(c, ref) === truth[k]; });
    var withPal = view.every(function (c, k) { return S.nearestColor(c) === truth[k]; });
    cases++; if (withRef) refOk++; if (withPal) paletteOk++;
  }
  check('three holds (any pairs, order, way up; colour casts; logos) assemble into the cube', good === n, good + '/' + n);
  check('this cube\'s colours as the reference read later views exactly', refOk === cases, refOk + '/' + cases);
  check('the reference reads at least as well as the generic palette', refOk >= paletteOk, refOk + ' vs ' + paletteOk);
})();

console.log('angled tests: ' + pass + ' passed, ' + fail + ' failed');
