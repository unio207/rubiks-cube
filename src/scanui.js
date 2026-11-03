// scanui.js - Feature 4 UI: the Scan tab. A paintable net with live validation, and a webcam
// scanner that fills the net from six guided captures. Browser only; needs window.Cube and window.Scan.
(function (root) {
  'use strict';

  var Cube = root.Cube, Scan = root.Scan;
  var GRAY = '#4a4f59';
  var GUIDE = 0.6;          // guide square side, as a fraction of the shorter video side
  var TINT_MS = 250;        // live tint refresh
  var PAIRS = [['U', 'F'], ['R', 'B'], ['D', 'L']];   // quick scan: suggested holds (top, front)

  var CSS = [
    '.sc-wrap{display:flex;flex-wrap:wrap;gap:16px;padding:16px;box-sizing:border-box;align-items:flex-start}',
    '.sc-card{background:#1e2128;border:1px solid #2f343e;border-radius:10px;padding:14px;color:#ddd;box-sizing:border-box;display:flex;flex-direction:column;gap:12px;min-width:0}',
    '.sc-card h2{font-size:16px;margin:0;font-weight:600}',
    '.sc-note{color:#8a909c;font-size:13px;line-height:1.4;margin:0}',
    '.sc-net{display:grid;grid-template-columns:repeat(12,var(--sz));grid-auto-rows:var(--sz);gap:2px;--sz:26px;touch-action:none;user-select:none;max-width:100%}',
    '.sc-st{border-radius:4px;cursor:pointer;box-sizing:border-box;border:1px solid #0d0e11}',
    '.sc-st.sc-ctr{border-radius:50%;border:2px solid #0d0e11}',
    '.sc-st.sc-bad{outline:2px solid #ff5a5a;outline-offset:-1px}',
    '.sc-gap{width:6px}',
    '.sc-pal{display:flex;flex-wrap:wrap;gap:6px;align-items:center}',
    '.sc-sw{width:30px;height:30px;border-radius:6px;border:2px solid #0d0e11;cursor:pointer;padding:0}',
    '.sc-sw.on{outline:2px solid #3d7bdc;outline-offset:2px}',
    '.sc-btns{display:flex;flex-wrap:wrap;gap:8px}',
    '.sc-btns button,.sc-chip{background:#2a2e37;color:#eee;border:1px solid #444a56;border-radius:6px;padding:7px 14px;font:inherit;cursor:pointer}',
    '.sc-btns button:hover:not(:disabled),.sc-chip:hover{background:#353a45}',
    '.sc-btns button:disabled{opacity:0.4;cursor:default}',
    '.sc-btns button.sc-main:not(:disabled){background:#24497e;border-color:#3d7bdc}',
    '.sc-errs{margin:0;padding-left:18px;color:#ffb0b0;font-size:13px;line-height:1.45}',
    '.sc-ok{color:#3ddc84;font-size:14px}',
    '.sc-fly{position:fixed;z-index:50;display:grid;grid-template-columns:repeat(3,1fr);grid-template-rows:repeat(3,1fr);gap:3px;pointer-events:none;box-sizing:border-box}',
    '.sc-fly i{display:block;border-radius:4px;border:1px solid #0d0e11}',
    '.sc-land{animation:sc-land 0.45s ease-out}',
    '@keyframes sc-land{0%{box-shadow:0 0 0 3px #3ddc84}100%{box-shadow:0 0 0 0 transparent}}',
    '.sc-video{position:relative;background:#0d0e11;border-radius:8px;overflow:hidden;width:100%}',
    '.sc-video video{display:block;width:100%;height:auto}',
    '.sc-video video.sc-mirror{transform:scaleX(-1)}',
    '.sc-guide{position:absolute;display:grid;grid-template-columns:repeat(3,1fr);grid-template-rows:repeat(3,1fr);gap:4px;pointer-events:none}',
    '.sc-guide{outline:3px solid transparent;outline-offset:4px;border-radius:8px;transition:outline-color 0.15s}',
    '.sc-guide.sc-hold{outline-color:#ffd23d}',
    '.sc-guide.sc-flash{outline-color:#3ddc84}',
    '.sc-guide div{border:2px solid rgba(255,255,255,0.85);border-radius:6px;box-shadow:0 0 0 1px rgba(0,0,0,0.5)}',
    '.sc-steps{display:flex;flex-wrap:wrap;gap:6px}',
    '.sc-chip{display:flex;align-items:center;gap:6px;padding:5px 9px;font-size:13px}',
    '.sc-chip.on{border-color:#3d7bdc;background:#24497e}',
    '.sc-mini{display:grid;grid-template-columns:repeat(3,6px);grid-auto-rows:6px;gap:1px}',
    '.sc-mini i{display:block;border-radius:1px}',
    '.sc-instr{font-size:14px;line-height:1.4;margin:0}',
    '.sc-instr b{color:#8fb8ff}',
    '.sc-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:13px;color:#b8bec8}',
    '.sc-outline{position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none;overflow:visible}',
    '.sc-outline.sc-mirror{transform:scaleX(-1)}',
    '.sc-outline path{fill:none;stroke:rgba(255,255,255,0.9);stroke-width:2.5;stroke-linejoin:round;vector-effect:non-scaling-stroke}',
    '.sc-outline path.sc-in{stroke-width:1.5;stroke:rgba(255,255,255,0.6)}',
    '.sc-outline path.sc-shade{stroke:rgba(0,0,0,0.55);stroke-width:5}',
    '.sc-outline.sc-lost path{stroke-dasharray:7 6}',
    '.sc-outline.sc-hold path:not(.sc-shade){stroke:#ffd23d}',
    '.sc-outline.sc-flash path:not(.sc-shade){stroke:#3ddc84}',
    '.sc-ang{display:flex;align-items:center;gap:12px;font-size:13px;color:#b8bec8}',
    '.sc-ang .sc-faces{display:flex;flex-direction:column;gap:7px}',
    '.sc-ang .sc-face{display:grid;grid-template-columns:repeat(3,12px);grid-auto-rows:12px;gap:2px}',
    '.sc-ang .sc-face i{display:block;border-radius:2px;background:#4a4f59}',
    '.sc-dot{display:inline-block;width:10px;height:10px;border-radius:50%;background:#555b66;margin-right:6px;vertical-align:-1px}',
    '.sc-dot.on{background:#3ddc84;box-shadow:0 0 6px #3ddc84}',
    '@media (max-width:420px){.sc-net{--sz:calc((100vw - 90px) / 12)}}'
  ].join('\n');

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function hex(letter) { return '#' + ('000000' + Cube.COLOR_HEX[letter].toString(16)).slice(-6); }

  // Net layout: [face, gridRow, gridCol] of each face's top-left sticker.
  var NET = { U: [0, 3], L: [3, 0], F: [3, 3], R: [3, 6], B: [3, 9], D: [6, 3] };

  function clearedNet() {
    var s = Cube.solvedState(), out = [];
    for (var i = 0; i < 54; i++) out.push(Scan.CENTERS.indexOf(i) >= 0 ? s[i] : null);
    return out;
  }

  // opts: { getCubeState(): state, onLoad(state) }
  function mount(container, opts) {
    if (!document.getElementById('sc-style')) {
      var st = el('style'); st.id = 'sc-style'; st.textContent = CSS; document.head.appendChild(st);
    }
    var net = clearedNet();
    var brush = 'U';
    var wrap = el('div', 'sc-wrap');
    container.appendChild(wrap);

    // ---------------- Net editor ----------------
    var edit = el('div', 'sc-card');
    edit.style.flex = '1 1 380px';
    wrap.appendChild(edit);
    edit.appendChild(el('h2', null, 'Cube net'));
    edit.appendChild(el('p', 'sc-note', 'Pick a colour, then click or drag over stickers. The net is your cube unfolded: ' +
      'top above, then left, front, right and back, bottom below. Painting a centre swaps that colour everywhere.'));

    var pal = el('div', 'sc-pal'), swatches = {};
    Scan.COLOR_LETTERS.concat([null]).forEach(function (c) {
      var b = el('button', 'sc-sw');
      b.style.background = c ? hex(c) : GRAY;
      b.title = c ? Cube.COLOR_NAME[c] : 'Unset';
      b.setAttribute('aria-label', b.title);
      b.addEventListener('click', function () { brush = c; renderPalette(); });
      swatches[c] = b;
      pal.appendChild(b);
    });
    edit.appendChild(pal);
    function renderPalette() {
      Object.keys(swatches).forEach(function (k) { swatches[k].classList.toggle('on', String(brush) === k); });
    }

    var netEl = el('div', 'sc-net'), cells = [];
    Object.keys(NET).forEach(function (f) {
      var fi = Cube.FACES.indexOf(f);
      for (var k = 0; k < 9; k++) {
        var i = fi * 9 + k, d = el('div', 'sc-st' + (k === 4 ? ' sc-ctr' : ''));
        d.style.gridRow = String(NET[f][0] + Math.floor(k / 3) + 1);
        d.style.gridColumn = String(NET[f][1] + (k % 3) + 1);
        d.dataset.i = i;
        d.title = f + ' face' + (k === 4 ? ' centre' : '');
        cells[i] = d;
        netEl.appendChild(d);
      }
    });
    edit.appendChild(netEl);

    var painting = false;
    function paintAt(target, first) {
      if (!target || target.dataset.i === undefined) return;
      var i = +target.dataset.i;
      if (Scan.CENTERS.indexOf(i) >= 0) {
        if (!first || !brush || net[i] === brush) return;
        var a = net[i], b = brush;   // swap colours a <-> b across the net
        net = net.map(function (c) { return c === a ? b : c === b ? a : c; });
      } else {
        if (net[i] === brush) return;
        net[i] = brush;
      }
      render();
    }
    netEl.addEventListener('pointerdown', function (e) {
      painting = true;
      paintAt(e.target, true);
      e.preventDefault();
    });
    netEl.addEventListener('pointermove', function (e) {
      if (!painting) return;
      paintAt(document.elementFromPoint(e.clientX, e.clientY), false);
    });
    window.addEventListener('pointerup', function () { painting = false; });
    window.addEventListener('pointercancel', function () { painting = false; });

    var btns = el('div', 'sc-btns');
    var clearBtn = el('button', null, 'Clear');
    var fromBtn = el('button', null, 'From cube');
    var loadBtn = el('button', 'sc-main', 'Load onto cube');
    clearBtn.title = 'Unset every sticker except the centres';
    fromBtn.title = 'Copy the 3D cube into the net';
    [clearBtn, fromBtn, loadBtn].forEach(function (b) { btns.appendChild(b); });
    edit.appendChild(btns);
    clearBtn.addEventListener('click', function () { setNet(clearedNet()); });
    fromBtn.addEventListener('click', function () { setNet(opts.getCubeState()); });
    loadBtn.addEventListener('click', function () {
      if (Scan.validate(net).ok) opts.onLoad(net.slice());
    });

    var status = el('div');
    edit.appendChild(status);

    function render() {
      var v = Scan.validate(net), bad = {};
      v.bad.forEach(function (i) { bad[i] = true; });
      net.forEach(function (c, i) {
        cells[i].style.background = c ? hex(c) : GRAY;
        cells[i].classList.toggle('sc-bad', !!bad[i]);
      });
      status.textContent = '';
      if (v.ok) status.appendChild(el('div', 'sc-ok', 'This is a valid cube. Load it, then use Hints or Solve.'));
      else {
        var ul = el('ul', 'sc-errs');
        v.errors.forEach(function (e) { ul.appendChild(el('li', null, e)); });
        status.appendChild(ul);
      }
      loadBtn.disabled = !v.ok;
      return v;
    }
    function setNet(state) { net = state.map(function (c) { return c == null ? null : c; }); render(); }

    // ---------------- Webcam ----------------
    var cam = el('div', 'sc-card');
    cam.style.flex = '1 1 360px';
    cam.style.maxWidth = '640px';
    wrap.appendChild(cam);
    cam.appendChild(el('h2', null, 'Scan with camera'));
    var NOTE_SIX = 'Fill the guide with one face and hold it still: it is captured by itself and ' +
      'goes to the step of its centre colour, so any order works. Even, bright light works best. ' +
      'Afterwards, check the net against your cube and fix any sticker.';
    var NOTE_QUICK = 'Hold the cube a little below the camera so it sees the top and front faces, and keep it still: ' +
      'the outline locks onto the cube (solid lines) and both faces are captured by themselves. Three holds cover all six faces. ' +
      'Even, bright light works best. Afterwards, check the net against your cube and fix any sticker.';
    var camNote = el('p', 'sc-note', NOTE_SIX);
    cam.appendChild(camNote);

    var camBtns = el('div', 'sc-btns');
    var startBtn = el('button', 'sc-main', 'Start camera');
    var captureBtn = el('button', 'sc-main', 'Capture');
    var stopBtn = el('button', null, 'Stop camera');
    var resetScanBtn = el('button', null, 'Reset scan');
    resetScanBtn.title = 'Throw away all six captures and start again at step 1';
    [startBtn, captureBtn, stopBtn, resetScanBtn].forEach(function (b) { camBtns.appendChild(b); });

    var stepsEl = el('div', 'sc-steps'), chips = [];
    var instr = el('p', 'sc-instr');
    var seenEl = el('p', 'sc-row');
    var videoBox = el('div', 'sc-video');
    var video = el('video');
    video.setAttribute('playsinline', '');
    video.muted = true;
    var guide = el('div', 'sc-guide'), guideCells = [];
    for (var g = 0; g < 9; g++) { var gc = el('div'); guideCells.push(gc); guide.appendChild(gc); }
    videoBox.appendChild(video);
    videoBox.appendChild(guide);
    var mirrorRow = el('label', 'sc-row');
    var mirrorBox = el('input');
    mirrorBox.type = 'checkbox';
    mirrorBox.checked = true;
    mirrorRow.appendChild(mirrorBox);
    mirrorRow.appendChild(document.createTextNode('Mirror the preview (like a mirror; does not change what is read)'));
    var autoRow = el('label', 'sc-row');
    var autoBox = el('input');
    autoBox.type = 'checkbox';
    autoBox.checked = true;
    autoRow.appendChild(autoBox);
    autoRow.appendChild(document.createTextNode('Auto-capture a face held still'));
    // Feature 9: quick scan, two faces per hold, read from the angled view.
    var quickRow = el('label', 'sc-row');
    var quickBox = el('input');
    quickBox.type = 'checkbox';
    quickRow.appendChild(quickBox);
    quickRow.appendChild(document.createTextNode('Quick scan (3 holds): show the top and front faces together'));
    var SVGNS = 'http://www.w3.org/2000/svg';
    var outline = document.createElementNS(SVGNS, 'svg');
    outline.setAttribute('class', 'sc-outline sc-lost');
    outline.setAttribute('preserveAspectRatio', 'none');
    var outlineShade = document.createElementNS(SVGNS, 'path'), outlineInner = document.createElementNS(SVGNS, 'path'), outlineEdge = document.createElementNS(SVGNS, 'path');
    outlineShade.setAttribute('class', 'sc-shade');
    outlineInner.setAttribute('class', 'sc-in');
    [outlineShade, outlineInner, outlineEdge].forEach(function (pth) { outline.appendChild(pth); });
    videoBox.appendChild(outline);
    var angEl = el('div', 'sc-ang'), angFaces = el('div', 'sc-faces'), angDots = [];
    angFaces.title = 'The 18 stickers read right now: the top face above, the front face below';
    [0, 1].forEach(function () {
      var g2 = el('div', 'sc-face');
      for (var j = 0; j < 9; j++) { var d2 = el('i'); angDots.push(d2); g2.appendChild(d2); }
      angFaces.appendChild(g2);
    });
    var angState = el('span'), angDot = el('span', 'sc-dot');
    var angText = el('div');
    angText.appendChild(angDot);
    angText.appendChild(angState);
    angEl.appendChild(angFaces);
    angEl.appendChild(angText);
    var camMsg = el('p', 'sc-note');

    cam.appendChild(stepsEl);
    cam.appendChild(instr);
    cam.appendChild(seenEl);
    cam.appendChild(videoBox);
    cam.appendChild(angEl);
    cam.appendChild(mirrorRow);
    cam.appendChild(autoRow);
    cam.appendChild(quickRow);
    cam.appendChild(camBtns);
    cam.appendChild(camMsg);

    var captures = [null, null, null, null, null, null];
    var stepIdx = 0;
    var stream = null, tintTimer = 0, visible = false;
    var auto = Scan.createAutoCapture(), autoDone = false, flashTimer = 0, lockTried = false;
    // Quick scan state: the last snapped fit (followed from frame to frame), the last reading, how
    // many holds were captured, and this cube's own colours once it has been scanned.
    var quickAuto = Scan.createAngledCapture(), lastFit = null, lostTicks = 0, lastRead = null, lastSnap = null, holds = 0;
    var reference = null;
    var canvas = el('canvas'), ctx = canvas.getContext('2d', { willReadFrequently: true });

    Scan.STEPS.forEach(function (st, k) {
      var chip = el('button', 'sc-chip');
      var mini = el('span', 'sc-mini');
      for (var j = 0; j < 9; j++) mini.appendChild(el('i'));
      chip.appendChild(mini);
      chip.appendChild(el('span', null, (k + 1) + '. ' + st.title));
      chip.title = 'Scan (or rescan) the face with the ' + st.title.toLowerCase() + ' centre';
      chip.addEventListener('click', function () { stepIdx = k; autoDone = false; renderCam(); });
      chips.push({ el: chip, mini: mini });
      stepsEl.appendChild(chip);
    });

    function renderCam() {
      var running = !!stream;
      startBtn.style.display = running ? 'none' : '';
      captureBtn.style.display = stopBtn.style.display = running ? '' : 'none';
      resetScanBtn.disabled = captures.every(function (c) { return !c; });
      videoBox.style.display = mirrorRow.style.display = autoRow.style.display = running ? '' : 'none';
      video.classList.toggle('sc-mirror', mirrorBox.checked);
      var quick = quickBox.checked;
      camNote.textContent = quick ? NOTE_QUICK : NOTE_SIX;
      guide.style.display = quick ? 'none' : '';
      outline.style.display = quick ? '' : 'none';
      angEl.style.display = running && quick ? '' : 'none';
      outline.classList.toggle('sc-mirror', mirrorBox.checked);
      chips.forEach(function (c, k) {
        var st = Scan.STEPS[k];
        c.el.classList.toggle('on', k === stepIdx && !quickBox.checked);
        var cap = captures[k];
        Array.prototype.forEach.call(c.mini.children, function (dot, j) {
          dot.style.background = cap ? hex(Scan.nearestColor(cap[j])) : j === 4 ? hex(st.face) : GRAY;
        });
      });
      var st = Scan.STEPS[stepIdx];
      instr.textContent = '';
      seenEl.style.display = running ? '' : 'none';
      if (quick) {
        var missing = Scan.STEPS.filter(function (s2, k) { return !captures[k]; }).map(function (s2) { return s2.face; });
        var pair = PAIRS.filter(function (pr) { return missing.indexOf(pr[0]) >= 0 || missing.indexOf(pr[1]) >= 0; })[0];
        var names = function (list) { return list.map(function (f) { return Cube.COLOR_NAME[f]; }).join(', '); };
        instr.appendChild(el('b', null, missing.length ? 'Hold ' + Math.min(3, holds + 1) + ' of 3: ' : 'Quick scan: '));
        instr.appendChild(document.createTextNode(missing.length
          ? 'Hold the cube in the outline, a little below the camera, so the top and front faces show' +
            (pair ? ' (for example the ' + Cube.COLOR_NAME[pair[0]] + ' and ' + Cube.COLOR_NAME[pair[1]] + ' centres)' : '') +
            ', either face on top, any way up. Still missing: ' + names(missing) + '.'
          : 'all six centres are scanned.'));
      } else {
        instr.appendChild(el('b', null, 'Step ' + (stepIdx + 1) + ' of 6: '));
        instr.appendChild(document.createTextNode(st.text));
      }
      placeGuide();
    }
    mirrorBox.addEventListener('change', renderCam);
    quickBox.addEventListener('change', function () {
      auto.reset(); quickAuto.reset(); lastFit = null; lastRead = null; lastSnap = null;
      guide.classList.remove('sc-hold');
      renderCam();
    });

    function placeGuide() {
      var w = videoBox.clientWidth, h = video.clientHeight;
      if (!w || !h) return;
      var size = GUIDE * Math.min(w, h);
      guide.style.width = guide.style.height = size + 'px';
      guide.style.left = (w - size) / 2 + 'px';
      guide.style.top = (h - size) / 2 + 'px';
    }
    window.addEventListener('resize', placeGuide);
    video.addEventListener('loadedmetadata', placeGuide);

    // Reads the guide's 9 cells from the current frame (camera cell order, unmirrored).
    function grabFrame(maxW) {
      var vw = video.videoWidth, vh = video.videoHeight;
      if (!vw || !vh) return null;
      var k = Math.min(1, maxW / vw), w = Math.round(vw * k), h = Math.round(vh * k);
      canvas.width = w; canvas.height = h;
      ctx.drawImage(video, 0, 0, w, h);
      return { data: ctx.getImageData(0, 0, w, h).data, w: w, h: h };
    }
    function readFrame(maxW) {
      var fr = grabFrame(maxW);
      if (!fr) return null;
      var size = GUIDE * Math.min(fr.w, fr.h);
      return Scan.frameInfo(fr.data, fr.w, fr.h, (fr.w - size) / 2, (fr.h - size) / 2, size);
    }

    // ---- Quick scan (Feature 9) ----
    // Each tick: snap the outline to the cube (following the last fit while it holds), read the 18
    // stickers, show the outline, the mini-view and whether the view is settled, and auto-capture.
    function quickTick() {
      var fr = grabFrame(640);
      if (!fr) return;
      var sn = Scan.snapAngled(fr.data, fr.w, fr.h, lastFit ? { around: lastFit, track: true } : null);
      if (sn.ok) { lastFit = sn.fit; lostTicks = 0; } else if (++lostTicks > 2) lastFit = null;
      var read = sn.ok ? Scan.readAngled(fr.data, fr.w, fr.h, sn.quads, { prev: lastRead, now: Date.now(), ref: reference }) : null;
      lastRead = read;
      lastSnap = { quads: sn.ok ? sn.quads : Scan.angledQuads(lastFit || Scan.defaultFit(fr.w, fr.h), fr.w, fr.h), ok: sn.ok, w: fr.w, h: fr.h };
      drawOutline();
      renderAngled(read);
      var both = read && [read.cells.slice(0, 9), read.cells.slice(9)].every(function (f) {
        return captures.some(function (c) { return c && Scan.sameFace(f, c); });
      });
      seenEl.textContent = !read ? 'Camera sees: no cube in the outline yet' : 'Camera sees: ' + Cube.COLOR_NAME[read.letters[4]] + ' centre on top, ' +
        Cube.COLOR_NAME[read.letters[13]] + ' in front' + (both ? ' (already scanned)' : '');
      if (!autoBox.checked || autoDone) { outline.classList.remove('sc-hold'); return; }
      var st = quickAuto.feed(read, captures);
      outline.classList.toggle('sc-hold', st === 'holding');
      if (st === 'capture') quickCapture(read);
    }

    // The outline where it snapped (dashed where nothing fits): both faces and their 3x3 grids.
    function drawOutline() {
      if (!lastSnap) return;
      var q = lastSnap.quads, edge = '', inner = '';
      function pt(p) { return p[0].toFixed(1) + ' ' + p[1].toFixed(1); }
      [q.top, q.front].forEach(function (quad) {
        edge += 'M' + quad.map(pt).join('L') + 'Z';
        var H = Scan.squareToQuad(quad);
        function at(u, v) { var z = H[6] * u + H[7] * v + 1; return [(H[0] * u + H[1] * v + H[2]) / z, (H[3] * u + H[4] * v + H[5]) / z]; }
        [1 / 3, 2 / 3].forEach(function (t) { inner += 'M' + pt(at(t, 0)) + 'L' + pt(at(t, 1)) + 'M' + pt(at(0, t)) + 'L' + pt(at(1, t)); });
      });
      outline.setAttribute('viewBox', '0 0 ' + lastSnap.w + ' ' + lastSnap.h);
      outlineShade.setAttribute('d', edge);
      outlineEdge.setAttribute('d', edge);
      outlineInner.setAttribute('d', inner);
      outline.classList.toggle('sc-lost', !lastSnap.ok);
    }

    function renderAngled(read) {
      angDots.forEach(function (d, k) { d.style.background = read ? hex(read.letters[k]) : GRAY; });
      angDot.classList.toggle('on', !!(read && read.settled));
      angState.textContent = !read ? 'Not settled: no cube in the outline' : read.settled ? 'Settled' :
        read.aligned ? 'Settling…' : 'Not settled: hold still with the layers lined up';
    }

    // Where a face of the outline is on the page (for the capture animation).
    function quadRect(quad) {
      var box = videoBox.getBoundingClientRect(), k = box.width / lastSnap.w;
      var xs = quad.map(function (p) { return mirrorBox.checked ? lastSnap.w - p[0] : p[0]; }), ys = quad.map(function (p) { return p[1]; });
      var x0 = Math.min.apply(null, xs), x1 = Math.max.apply(null, xs), y0 = Math.min.apply(null, ys), y1 = Math.max.apply(null, ys);
      return { left: box.left + x0 * k, top: box.top + y0 * k, width: (x1 - x0) * k, height: (y1 - y0) * k };
    }

    // A hold's two faces go to the steps of their centre colours (neighbours, preferring steps not
    // yet scanned); once all six are in, the net is filled.
    function quickCapture(read) {
      if (!read) { camMsg.textContent = 'No cube in the outline yet: hold it so that the outline locks on (solid lines), then try again.'; return; }
      var slots = Scan.quickSlots(read, captures.map(function (c) { return !!c; }), reference);
      var faces = [read.cells.slice(0, 9), read.cells.slice(9)];
      captures[slots[0]] = faces[0];
      captures[slots[1]] = faces[1];
      holds++;
      lockCamera();
      outline.classList.remove('sc-hold');
      outline.classList.add('sc-flash');
      clearTimeout(flashTimer);
      flashTimer = setTimeout(function () { outline.classList.remove('sc-flash'); }, 500);
      flyToNet(slots[0], faces[0], quadRect(lastSnap.quads.top));
      flyToNet(slots[1], faces[1], quadRect(lastSnap.quads.front));
      if (captures.indexOf(null) < 0) finishScan();
      else camMsg.textContent = '';
      renderCam();
    }

    function tint() {
      if (!stream) return;
      if (quickBox.checked) { quickTick(); return; }
      var info = readFrame(320);
      if (!info) return;
      var cellsRead = info.cells;
      guideCells.forEach(function (gcEl, k) {
        // The guide sits over the (maybe mirrored) preview: mirror the column to match what is shown.
        var r = Math.floor(k / 3), c = k % 3, src = r * 3 + (mirrorBox.checked ? 2 - c : c);
        var col = hex(Scan.nearestColor(cellsRead[src]));
        gcEl.style.background = col + '66';
        gcEl.style.borderColor = col;
      });
      var kinds = {};
      cellsRead.forEach(function (c) { kinds[Scan.nearestColor(c)] = true; });
      var even = info.even.every(function (e, k) { return k === 4 || e >= 0.7; }) && (Object.keys(kinds).length > 1 || info.gaps >= 9);
      seenEl.textContent = !even ? 'Camera sees: no face in the guide yet' : 'Camera sees: ' + Cube.COLOR_NAME[Scan.nearestColor(cellsRead[4])] + ' centre' +
        (captures.some(function (c) { return c && Scan.sameFace(cellsRead, c); }) ? ' (already scanned)' : '');
      if (!autoBox.checked || autoDone) { guide.classList.remove('sc-hold'); return; }
      var others = captures.map(function (c, k) { return k === stepIdx ? null : c; });
      var st = auto.feed(info, others);
      guide.classList.toggle('sc-hold', st === 'holding');
      if (st === 'capture') capture();
    }

    // Best effort: keep exposure and white balance where they are, so later faces read like the first.
    function lockCamera() {
      if (lockTried || !stream) return;
      lockTried = true;
      try {
        var t = stream.getVideoTracks()[0];
        if (!t || !t.getCapabilities) return;
        var caps = t.getCapabilities() || {}, cur = t.getSettings() || {}, adv = {};
        if ((caps.exposureMode || []).indexOf('manual') >= 0) {
          adv.exposureMode = 'manual';
          if (cur.exposureTime) adv.exposureTime = cur.exposureTime;
        }
        if ((caps.whiteBalanceMode || []).indexOf('manual') >= 0) {
          adv.whiteBalanceMode = 'manual';
          if (cur.colorTemperature) adv.colorTemperature = cur.colorTemperature;
        }
        if (Object.keys(adv).length) t.applyConstraints({ advanced: [adv] }).catch(function () {});
      } catch (e) { /* not supported: readings already tolerate exposure changes */ }
    }

    function startCamera() {
      camMsg.textContent = '';
      var md = navigator.mediaDevices;
      if (!md || !md.getUserMedia) {
        camMsg.textContent = 'This browser can\'t open a camera here (it needs https or a local file in a recent browser). ' +
          'You can still fill in the net by hand.';
        return;
      }
      startBtn.disabled = true;
      md.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false })
        .then(function (s) {
          startBtn.disabled = false;
          if (!visible) { s.getTracks().forEach(function (t) { t.stop(); }); return; }
          stream = s;
          video.srcObject = s;
          var p = video.play();
          if (p && p.catch) p.catch(function () {});
          clearInterval(tintTimer);
          tintTimer = setInterval(tint, TINT_MS);
          renderCam();
        })
        .catch(function (err) {
          startBtn.disabled = false;
          var name = err && err.name;
          camMsg.textContent = name === 'NotAllowedError' ? 'Camera permission was denied. Allow it in the browser and try again, or fill in the net by hand.'
            : name === 'NotFoundError' ? 'No camera was found. You can fill in the net by hand.'
              : 'The camera could not start (' + (err && err.message || name || err) + '). You can fill in the net by hand.';
        });
    }

    function stopCamera() {
      clearInterval(tintTimer);
      tintTimer = 0;
      auto.reset();
      quickAuto.reset(); lastFit = null; lastRead = null; lastSnap = null;
      outline.classList.remove('sc-hold');
      lockTried = false;
      guide.classList.remove('sc-hold');
      if (stream) stream.getTracks().forEach(function (t) { t.stop(); });
      stream = null;
      video.srcObject = null;
      renderCam();
    }

    // Steps a capture may fill: the unscanned ones and the selected one; when all are full, any.
    function allowedSlots() {
      var out = [];
      captures.forEach(function (c, k) { if (!c || k === stepIdx) out.push(k); });
      return out.length > 1 || captures.indexOf(null) >= 0 ? out : [0, 1, 2, 3, 4, 5];
    }

    function capture() {
      if (quickBox.checked) { quickCapture(lastRead); return; }
      var read = readFrame(640);
      if (!read) { camMsg.textContent = 'The camera has no picture yet; try again in a moment.'; return; }
      var slot = Scan.slotFor(read.cells[4], allowedSlots(), stepIdx);
      captures[slot] = read.cells;
      stepIdx = slot;
      lockCamera();
      guide.classList.remove('sc-hold');
      guide.classList.add('sc-flash');
      clearTimeout(flashTimer);
      flashTimer = setTimeout(function () { guide.classList.remove('sc-flash'); }, 500);
      flyToNet(slot, read.cells);
      var missing = captures.indexOf(null);
      if (missing < 0) {
        finishScan();
      } else {
        stepIdx = captures.indexOf(null, stepIdx) >= 0 ? captures.indexOf(null, stepIdx) : missing;
        camMsg.textContent = '';
      }
      renderCam();
    }

    // All six faces are in: classify and assemble them into the net. A valid result also becomes
    // this cube's colour reference for later quick-scan readings.
    function finishScan() {
      var res = Scan.assemble(captures);
      setNet(res.state);
      var ok = Scan.validate(res.state).ok;
      if (ok) reference = Scan.reference(captures, res.state);
      camMsg.textContent = (quickBox.checked ? 'All six faces scanned in ' + holds + (holds === 1 ? ' hold' : ' holds') + ' and the net is filled in'
        : 'All six faces scanned and the net is filled in' + (res.rearranged ? ' (some faces were turned or misread and were put right)' : '')) +
        '. Check it against your cube, fix any sticker, then Load.';
      autoDone = true;
    }

    // Capture animation: the face lifts off the guide (or its place in the outline) and flies into
    // its place in the net, where it lands as a preview (the final assembly may still turn it).
    function flyToNet(slot, readCells, fromRect) {
      var cols = readCells.map(function (c) { return Scan.nearestColor(c); });
      var face = Scan.STEPS[slot].cells;   // facelets in the suggested hold
      function land() {
        if (captures[slot] !== readCells) return;   // rescanned or reset meanwhile
        // Once all six are in, the net already holds the assembled cube: just mark where it landed.
        if (captures.indexOf(null) >= 0) {
          face.forEach(function (fi, k) { if (k !== 4) net[fi] = cols[k]; });
          render();
        }
        face.forEach(function (fi) {
          cells[fi].classList.remove('sc-land');
          void cells[fi].offsetWidth;
          cells[fi].classList.add('sc-land');
        });
      }
      var reduce = root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches;
      var from = fromRect || guide.getBoundingClientRect(), a = cells[face[0]].getBoundingClientRect(), b = cells[face[8]].getBoundingClientRect();
      if (reduce || !from.width || !a.width || !guide.animate) { land(); return; }
      var fly = el('div', 'sc-fly');
      cols.forEach(function (c, k) {
        var dot = el('i');
        dot.style.background = hex(k === 4 ? Scan.STEPS[slot].face : c);
        fly.appendChild(dot);
      });
      fly.style.left = from.left + 'px'; fly.style.top = from.top + 'px';
      fly.style.width = from.width + 'px'; fly.style.height = from.height + 'px';
      document.body.appendChild(fly);
      var to = { left: a.left, top: a.top, width: b.right - a.left, height: b.bottom - a.top };
      var dx = to.left - from.left, dy = to.top - from.top, sx = to.width / from.width, sy = to.height / from.height;
      var anim = fly.animate([
        { transform: 'translate(0,0) scale(1)', boxShadow: '0 0 0 rgba(0,0,0,0)', opacity: 1, offset: 0 },
        { transform: 'translate(0,-14px) scale(1.06) rotate(-3deg)', boxShadow: '0 18px 30px rgba(0,0,0,0.55)', opacity: 1, offset: 0.25 },
        { transform: 'translate(' + dx + 'px,' + dy + 'px) scale(' + sx + ',' + sy + ')', boxShadow: '0 0 0 rgba(0,0,0,0)', opacity: 0.9, offset: 1 }
      ], { duration: 650, easing: 'cubic-bezier(0.5,0,0.3,1)' });
      fly.style.transformOrigin = '0 0';
      anim.onfinish = anim.oncancel = function () { fly.remove(); land(); };
    }

    startBtn.addEventListener('click', startCamera);
    stopBtn.addEventListener('click', stopCamera);
    captureBtn.addEventListener('click', capture);
    resetScanBtn.addEventListener('click', function () {
      captures = [null, null, null, null, null, null];
      stepIdx = 0;
      autoDone = false;
      auto.reset();
      quickAuto.reset();
      holds = 0;
      camMsg.textContent = '';
      renderCam();
    });

    render();
    renderPalette();
    renderCam();

    return {
      show: function () { visible = true; placeGuide(); },
      hide: function () { visible = false; stopCamera(); },
      getNet: function () { return net.slice(); },
      setNet: setNet,
      validate: function () { return Scan.validate(net); },
      captures: function () { return captures.slice(); },
      isCameraOn: function () { return !!stream; },
      quickView: function () { return { snapped: !!(lastSnap && lastSnap.ok), quads: lastSnap && lastSnap.quads, read: lastRead, holds: holds }; }
    };
  }

  root.ScanTab = { mount: mount };
})(typeof window !== 'undefined' ? window : this);
