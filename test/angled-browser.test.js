// Run: node test/angled-browser.test.js
// Feature 9 acceptance in headless Chromium (Playwright). Test frames are rendered in the page with
// Three.js r128 in the app's style (test/browser/angled-scene.js): downward views of 15-50 degrees,
// sideways turns of +-10 degrees, a little lean, several sizes and positions, warm / cool / dim
// light, noise, plain and patterned walls, and a GAN-style logo on the white centre.
//   1. Snapping: the outline's corners against the true corners.
//   2. Reading: all 18 stickers exactly, with this cube's colours as the reference (taken from a
//      quick scan of another cube under the same light, which must itself come out right).
//   3. Settled: aligned frames are settled once steady for 250 ms (not before); frames with a layer
//      part-turned by 10-80 degrees never are.
//   4. Blank walls never snap.
//   5. End to end: rubiks-cube.html with a fake camera (getUserMedia -> canvas.captureStream,
//      redrawn with setInterval) playing the three holds shuffled and turned, with a part-turned
//      view and a blank wall in between: no clicks after "Start camera", the net fills, validates
//      and equals the cube. Then Reset scan, and a second cube held in other pairs.
// Skips cleanly (0 passed, 0 failed) when Playwright or the cdnjs copy of Three.js is unavailable.
// SHOTS=<dir> saves screenshots there.
var fs = require('fs');
var path = require('path');

var pass = 0, fail = 0;
function check(name, ok, info) {
  if (ok) pass++;
  else { fail++; console.log('FAIL: ' + name + (info !== undefined ? ' -- ' + info : '')); }
}
function done(note) { console.log('angled-browser: ' + pass + ' passed, ' + fail + ' failed' + (note ? ' (' + note + ')' : '')); }

var ROOT = path.join(__dirname, '..');
var THREE_URL = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js';
var SHOTS = process.env.SHOTS;

var playwright;
try { playwright = require('playwright'); } catch (e) { playwright = null; }

async function main() {
  if (!playwright) return done('skipped: Playwright is not installed');
  var browser;
  try { browser = await playwright.chromium.launch(); } catch (e) { return done('skipped: Chromium could not start: ' + e.message.split('\n')[0]); }
  try {
    var page = await browser.newPage();
    page.on('pageerror', function (e) { check('no page errors', false, e.message); });
    await page.setContent('<html><body></body></html>');
    try { await page.addScriptTag({ url: THREE_URL }); } catch (e) { return done('skipped: Three.js r128 could not be loaded from cdnjs'); }
    for (var f of ['src/core.js', 'src/scan.js', 'test/browser/angled-scene.js']) {
      await page.addScriptTag({ content: fs.readFileSync(path.join(ROOT, f), 'utf8') });
    }
    await frames(page);
    await endToEnd(browser);
  } finally {
    await browser.close();
  }
  done();
}

// ---------------------------------------------------------------------------------------------
// 1-4: rendered frames, checked in the page.
// ---------------------------------------------------------------------------------------------
async function frames(page) {
  var r = await page.evaluate(function () {
    var W = 640, H = 480, S = AngledScene.create(W, H), rnd = AngledScene.rng(20261103);
    var LIGHTS = ['neutral', 'warm', 'cool', 'dim'], BGS = [0x202226, 0x8a8478, 0xd8d4cc, 0x3a4a3a];
    var F = 240 / Math.tan(22.5 * Math.PI / 180), D = Scan.defaultFit(W, H);
    function scrambled() {
      var st = Cube.solvedState();
      Cube.randomScramble(25, { random: rnd }).forEach(function (m) { st = Cube.applyMove(st, m); });
      return st;
    }
    // A random view: the image of the cube's centre near the default outline, the given light.
    function view(state, i, extra) {
      var s = D.s * (0.75 + 0.55 * rnd()), dist = F / s, x = D.x + (rnd() - 0.5) * 160, y = D.y + (rnd() - 0.5) * 120;
      var tx = (x - W / 2) * dist / F, ty = -(y - H / 2) * dist / F, vt = 15 + 35 * rnd(), vy = -10 + 20 * rnd();
      var o = { state: state, tilt: AngledScene.modelTilt(vt, ty, dist), yaw: vy - Math.atan2(tx, dist) * 180 / Math.PI, roll: -4 + 8 * rnd(),
        dist: dist, tx: tx, ty: ty, light: LIGHTS[i % 4], bg: BGS[(i >> 2) % 4], logo: true, noise: 6, seed: i + 1, vt: vt, vy: vy };
      return Object.assign(o, extra || {});
    }
    function inFrame(fr) { return fr.front.concat(fr.top).every(function (p) { return p[0] > 8 && p[1] > 8 && p[0] < W - 8 && p[1] < H - 8; }); }
    function cornerErr(fr, quads) {
      var e = 0;
      ['front', 'top'].forEach(function (k) { fr[k].forEach(function (c, j) { e = Math.max(e, Math.hypot(c[0] - quads[k][j][0], c[1] - quads[k][j][1])); }); });
      return e;
    }
    var out = { refs: [], snap: [], turned: [], walls: [] };

    // This cube's colours under each light, from a quick scan of another cube (three holds).
    var refs = {};
    LIGHTS.forEach(function (light, li) {
      var st = scrambled(), caps = [null, null, null, null, null, null];
      [['U', 'F'], ['R', 'B'], ['D', 'L']].forEach(function (pr, hi) {
        var fr = S.render({ state: AngledScene.holdState(st, pr[0], pr[1]), tilt: AngledScene.modelTilt(30, -0.5, 10), yaw: 0, roll: 0, dist: 10, tx: 0, ty: -0.5,
          light: light, bg: BGS[li], logo: true, noise: 6, seed: 99 + hi });
        var sn = Scan.snapAngled(fr.data, W, H), rd = Scan.readAngled(fr.data, W, H, sn.quads);
        var sl = Scan.quickSlots(rd, caps.map(function (c) { return !!c; }));
        caps[sl[0]] = rd.cells.slice(0, 9); caps[sl[1]] = rd.cells.slice(9);
      });
      var as = Scan.assemble(caps);
      out.refs.push({ light: light, equal: Cube.isEqual(as.state, st) });
      refs[light] = Scan.reference(caps, as.state);
    });

    // 1-3 on aligned frames.
    for (var i = 0; i < 200; i++) {
      var st = scrambled(), o, fr;
      do { o = view(st, i); fr = S.render(o); } while (!inFrame(fr));
      var t0 = performance.now(), sn = Scan.snapAngled(fr.data, W, H), ms = performance.now() - t0;
      var t1 = performance.now(), tr = sn.ok ? Scan.snapAngled(fr.data, W, H, { around: sn.fit, track: true }) : null, trackMs = performance.now() - t1;
      var truth = AngledScene.trueLetters(o.state);
      var r0 = Scan.readAngled(fr.data, W, H, sn.quads, { ref: refs[o.light], now: 1000 });
      var early = Scan.readAngled(fr.data, W, H, sn.quads, { ref: refs[o.light], prev: r0, now: 1150 });
      var late = Scan.readAngled(fr.data, W, H, sn.quads, { ref: refs[o.light], prev: r0, now: 1300 });
      out.snap.push({ ok: sn.ok, err: cornerErr(fr, sn.quads), ms: ms, trackMs: tr ? trackMs : null, trackErr: tr && tr.ok ? cornerErr(fr, tr.quads) : null, exact: sn.ok && r0.letters.every(function (l, k) { return l === truth[k]; }),
        settledEarly: sn.ok && early.settled, settled: sn.ok && late.settled, conf: r0.confidence, vt: o.vt, light: o.light });
    }
    // 3: a layer part-turned by 10-80 degrees (each of the nine layers), never settled.
    var LAYERS = [['y', 1], ['y', -1], ['x', 1], ['x', -1], ['z', 1], ['z', -1], ['x', 0], ['y', 0], ['z', 0]];
    for (var j = 0; j < 108; j++) {
      var st2 = j % 6 ? scrambled() : Cube.solvedState(), L = LAYERS[j % 9], deg = (10 + 70 * rnd()) * (rnd() < 0.5 ? -1 : 1), o2, fr2;
      do { o2 = view(st2, j, { turn: { axis: L[0], layer: L[1], deg: deg } }); fr2 = S.render(o2); } while (!inFrame(fr2));
      var sn2 = Scan.snapAngled(fr2.data, W, H), a = Scan.readAngled(fr2.data, W, H, sn2.quads, { now: 0 });
      var b = Scan.readAngled(fr2.data, W, H, sn2.quads, { prev: a, now: 1000 });
      out.turned.push({ layer: L.join(''), deg: deg, settled: sn2.ok && b.settled, ok: sn2.ok });
    }
    // 4: blank walls (the cube far out of sight) in several colours, and a striped one.
    [0x202226, 0x8a8478, 0xd8d4cc, 0x3a4a3a, 0xffffff, 0x000000, 0xb03030].forEach(function (bg, k) {
      var fr3 = S.render({ state: Cube.solvedState(), tilt: 30, yaw: 0, roll: 0, dist: 5000, tx: 0, ty: 0, light: 'neutral', bg: bg, noise: 6, seed: k });
      out.walls.push(Scan.snapAngled(fr3.data, W, H).ok);
    });
    var c = document.createElement('canvas'); c.width = W; c.height = H;
    var g = c.getContext('2d');
    for (var x = 0; x < W; x += 40) { g.fillStyle = (x / 40) % 2 ? '#d8d4cc' : '#202226'; g.fillRect(x, 0, 40, H); }
    out.walls.push(Scan.snapAngled(g.getImageData(0, 0, W, H).data, W, H).ok);
    return out;
  });

  r.refs.forEach(function (x) { check('quick scan under ' + x.light + ' light gives the cube (reference scan)', x.equal); });
  var n = r.snap.length, errs = r.snap.map(function (x) { return x.err; }).sort(function (a, b) { return a - b; });
  var within3 = r.snap.filter(function (x) { return x.ok && x.err <= 3; }).length;
  var exact = r.snap.filter(function (x) { return x.exact; }).length;
  var settled = r.snap.filter(function (x) { return x.settled; }).length;
  var early = r.snap.filter(function (x) { return x.settledEarly; }).length;
  var ms = r.snap.reduce(function (a, x) { return a + x.ms; }, 0) / n;
  var tracked = r.snap.filter(function (x) { return x.trackMs !== null; });
  var trackMs = tracked.reduce(function (a, x) { return a + x.trackMs; }, 0) / tracked.length;
  var trackGood = tracked.filter(function (x) { return x.trackErr !== null && x.trackErr <= 3; }).length;
  var wrongLock = r.snap.filter(function (x) { return x.ok && x.err > 10; }).length;
  console.log('  snap: ' + within3 + '/' + n + ' within 3 px of the true corners; median ' + errs[n >> 1].toFixed(2) + ' px, 90th percentile ' +
    errs[Math.floor(n * 0.9)].toFixed(2) + ' px; search ' + ms.toFixed(0) + ' ms per frame');
  console.log('  tracking from the last fit: ' + trackMs.toFixed(0) + ' ms per frame, ' + trackGood + '/' + tracked.length + ' within 3 px; solid outline more than 10 px off: ' + wrongLock);
  console.log('  read: ' + exact + '/' + n + ' frames with all 18 stickers exact; settled after 300 ms: ' + settled + '/' + n);
  check('outline snaps within 3 px of the true corners on at least 98% of frames', within3 >= 0.98 * n, within3 + '/' + n);
  check('median corner error under 1.5 px', errs[n >> 1] < 1.5, errs[n >> 1]);
  check('following the last fit keeps it (within 3 px)', trackGood >= 0.98 * tracked.length, trackGood + '/' + tracked.length);
  check('the outline is solid far from the cube on at most 1% of frames', wrongLock <= 0.01 * n, wrongLock);
  check('at least 99% of frames read all 18 stickers exactly', exact >= 0.99 * n, exact + '/' + n);
  check('aligned frames are settled after the steady time (99%)', settled >= 0.99 * n, settled + '/' + n);
  check('no frame is settled before the steady time', early === 0, early);
  var turnedSettled = r.turned.filter(function (x) { return x.settled; });
  console.log('  part-turned: ' + turnedSettled.length + '/' + r.turned.length + ' settled (outline found on ' + r.turned.filter(function (x) { return x.ok; }).length + ')');
  check('a part-turned layer (10-80 degrees) is never settled', turnedSettled.length === 0, JSON.stringify(turnedSettled.slice(0, 3)));
  check('blank walls never snap', r.walls.every(function (x) { return !x; }), JSON.stringify(r.walls));
}

// ---------------------------------------------------------------------------------------------
// 5: end to end with a fake camera.
// ---------------------------------------------------------------------------------------------
async function endToEnd(browser) {
  var page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on('pageerror', function (e) { check('no page errors (app)', false, e.message); });
  await page.addInitScript(function () {
    navigator.mediaDevices.getUserMedia = async function () {
      var c = document.createElement('canvas'); c.width = 640; c.height = 480;
      var g = c.getContext('2d');
      g.fillStyle = '#333'; g.fillRect(0, 0, 640, 480);
      window.__cam = window.__cam || {};
      setInterval(function () { if (window.__cam.frame) g.putImageData(window.__cam.frame, 0, 0); }, 50);
      return c.captureStream(20);
    };
  });
  await page.goto('file://' + path.join(ROOT, 'rubiks-cube.html'));
  await page.waitForFunction(function () { return window.rubiksApp && window.THREE; });
  await page.addScriptTag({ content: fs.readFileSync(path.join(ROOT, 'test/browser/angled-scene.js'), 'utf8') });
  // Two cubes. Cube A: the suggested pairs, shuffled, with the other face on top, a part-turned
  // view before its second hold. Cube B: other pairs of neighbouring faces.
  await page.evaluate(function () {
    window.__cam = window.__cam || {};
    var S = AngledScene.create(640, 480), rnd = AngledScene.rng(4242);
    function scrambled() {
      var st = Cube.solvedState();
      Cube.randomScramble(25, { random: rnd }).forEach(function (m) { st = Cube.applyMove(st, m); });
      return st;
    }
    function frame(o) { return new ImageData(new Uint8ClampedArray(S.render(o).data), 640, 480); }
    function holdFrames(st, holds) {
      return holds.map(function (hd, i) {
        var ty = -0.4, dist = 10;
        return frame({ state: AngledScene.holdState(st, hd[0], hd[1]), tilt: AngledScene.modelTilt(hd[2], ty, dist), yaw: hd[3], roll: 2 - 2 * i, dist: dist,
          tx: 0.25 * (i - 1), ty: ty, light: ['warm', 'neutral', 'cool'][i], bg: 0x8a8478, logo: true, noise: 5, seed: 10 + i, turn: hd[4] });
      });
    }
    window.__A = scrambled();
    window.__B = scrambled();
    window.__framesA = holdFrames(window.__A, [['B', 'R', 34, 6], ['L', 'D', 26, -5], ['U', 'F', 40, 3]]);
    window.__turnedA = holdFrames(window.__A, [['L', 'D', 26, -5, { axis: 'x', layer: 1, deg: 25 }], ['L', 'D', 26, -5, { axis: 'y', layer: 1, deg: -60 }]]);
    window.__framesB = holdFrames(window.__B, [['F', 'L', 30, -8], ['U', 'R', 45, 0], ['D', 'B', 20, 8]]);
    window.__blank = frame({ state: window.__A, tilt: 30, yaw: 0, roll: 0, dist: 5000, tx: 0, ty: 0, bg: 0x8a8478, noise: 5, seed: 3 });
  });
  function show(expr) { return page.evaluate(function (e) { window.__cam.frame = eval(e); }, expr); }
  function filled() { return page.evaluate(function () { return window.rubiksApp.scanTab.captures().filter(Boolean).length; }); }
  async function waitFilled(n) {
    try { await page.waitForFunction(function (k) { return window.rubiksApp.scanTab.captures().filter(Boolean).length >= k; }, n, { timeout: 15000 }); } catch (e) { /* checked below */ }
    return filled();
  }
  async function shot(name, full) {
    if (!SHOTS) return;
    var card = await page.$('.sc-card:nth-child(2)');
    await page.screenshot(full ? { path: path.join(SHOTS, name), fullPage: true } : { path: path.join(SHOTS, name), clip: await card.boundingBox() });
  }

  await page.click('#tabScan');
  await page.check('text=Quick scan (3 holds)');
  await page.click('text=Start camera');
  await page.waitForFunction(function () { return window.rubiksApp.scanTab.isCameraOn(); });

  await show('window.__blank');
  await page.waitForTimeout(2500);
  var v = await page.evaluate(function () { return window.rubiksApp.scanTab.quickView(); });
  check('blank wall: outline dashed', !v.snapped);
  check('blank wall: nothing captured', (await filled()) === 0);
  await shot('quick-blank.png');

  await show('window.__framesA[0]');
  check('cube A hold 1 captured (two faces)', (await waitFilled(2)) === 2);
  await page.waitForTimeout(300);
  await shot('quick-hold.png');
  await show('window.__turnedA[0]');
  await page.waitForTimeout(1500);
  await show('window.__turnedA[1]');
  await page.waitForTimeout(1500);
  check('part-turned views are not captured', (await filled()) === 2);
  for (var i = 1; i < 3; i++) {
    await show('window.__framesA[' + i + ']');
    check('cube A hold ' + (i + 1) + ' captured', (await waitFilled(2 * (i + 1))) === 2 * (i + 1));
    await page.waitForTimeout(600);
  }
  await page.waitForTimeout(800);
  var a = await page.evaluate(function () {
    var t = window.rubiksApp.scanTab;
    return { valid: t.validate().ok, equal: Cube.isEqual(t.getNet(), window.__A), holds: t.quickView().holds };
  });
  check('cube A: the net validates', a.valid);
  check('cube A: the net is the cube (white on top, green in front)', a.equal);
  check('cube A: three holds', a.holds === 3, a.holds);
  await shot('quick-done.png', true);

  await page.click('text=Reset scan');
  var reset = await page.evaluate(function () { var t = window.rubiksApp.scanTab; return { n: t.captures().filter(Boolean).length, holds: t.quickView().holds }; });
  check('Reset scan clears the quick scan', reset.n === 0 && reset.holds === 0, JSON.stringify(reset));
  for (var k = 0; k < 3; k++) {
    await show('window.__framesB[' + k + ']');
    check('cube B hold ' + (k + 1) + ' captured', (await waitFilled(2 * (k + 1))) === 2 * (k + 1));
    await page.waitForTimeout(600);
  }
  await page.waitForTimeout(800);
  var bres = await page.evaluate(function () { var t = window.rubiksApp.scanTab; return { valid: t.validate().ok, equal: Cube.isEqual(t.getNet(), window.__B) }; });
  check('cube B (other pairs): the net validates and is the cube', bres.valid && bres.equal, JSON.stringify(bres));
  await page.close();
}

main().catch(function (e) { check('test ran', false, e && e.stack); done(); });
