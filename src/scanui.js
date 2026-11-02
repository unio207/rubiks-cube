// scanui.js - Feature 4 UI: the Scan tab. A paintable net with live validation, and a webcam
// scanner that fills the net from six guided captures. Browser only; needs window.Cube and window.Scan.
(function (root) {
  'use strict';

  var Cube = root.Cube, Scan = root.Scan;
  var GRAY = '#4a4f59';
  var GUIDE = 0.6;          // guide square side, as a fraction of the shorter video side
  var TINT_MS = 250;        // live tint refresh

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
    cam.appendChild(el('p', 'sc-note', 'Fill the guide with one face and hold it still: it is captured by itself and ' +
      'goes to the step of its centre colour, so any order works. Even, bright light works best. ' +
      'Afterwards, check the net against your cube and fix any sticker.'));

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
    var camMsg = el('p', 'sc-note');

    cam.appendChild(stepsEl);
    cam.appendChild(instr);
    cam.appendChild(seenEl);
    cam.appendChild(videoBox);
    cam.appendChild(mirrorRow);
    cam.appendChild(autoRow);
    cam.appendChild(camBtns);
    cam.appendChild(camMsg);

    var captures = [null, null, null, null, null, null];
    var stepIdx = 0;
    var stream = null, tintTimer = 0, visible = false;
    var auto = Scan.createAutoCapture(), autoDone = false, flashTimer = 0, lockTried = false;
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
      chips.forEach(function (c, k) {
        var st = Scan.STEPS[k];
        c.el.classList.toggle('on', k === stepIdx);
        var cap = captures[k];
        Array.prototype.forEach.call(c.mini.children, function (dot, j) {
          dot.style.background = cap ? hex(Scan.nearestColor(cap[j])) : j === 4 ? hex(st.face) : GRAY;
        });
      });
      var st = Scan.STEPS[stepIdx];
      instr.textContent = '';
      instr.appendChild(el('b', null, 'Step ' + (stepIdx + 1) + ' of 6: '));
      seenEl.style.display = running ? '' : 'none';
      instr.appendChild(document.createTextNode(st.text));
      placeGuide();
    }
    mirrorBox.addEventListener('change', renderCam);

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
    function readFrame(maxW) {
      var vw = video.videoWidth, vh = video.videoHeight;
      if (!vw || !vh) return null;
      var k = Math.min(1, maxW / vw), w = Math.round(vw * k), h = Math.round(vh * k);
      canvas.width = w; canvas.height = h;
      ctx.drawImage(video, 0, 0, w, h);
      var size = GUIDE * Math.min(w, h);
      var data = ctx.getImageData(0, 0, w, h).data;
      return Scan.frameInfo(data, w, h, (w - size) / 2, (h - size) / 2, size);
    }

    function tint() {
      if (!stream) return;
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
      var even = info.even.every(function (e) { return e >= 0.7; }) && (Object.keys(kinds).length > 1 || info.gaps >= 9);
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
      var read = readFrame(640);
      if (!read) { camMsg.textContent = 'The camera has no picture yet; try again in a moment.'; return; }
      var slot = Scan.slotFor(read.cells[4], allowedSlots());
      captures[slot] = read.cells;
      stepIdx = slot;
      lockCamera();
      guide.classList.remove('sc-hold');
      guide.classList.add('sc-flash');
      clearTimeout(flashTimer);
      flashTimer = setTimeout(function () { guide.classList.remove('sc-flash'); }, 500);
      var missing = captures.indexOf(null);
      if (missing < 0) {
        var res = Scan.assemble(captures);
        setNet(res.state);
        camMsg.textContent = 'All six faces scanned and the net is filled in' +
          (res.rearranged ? ' (some faces were turned or misread and were put right)' : '') +
          '. Check it against your cube, fix any sticker, then Load.';
        autoDone = true;
      } else {
        stepIdx = captures.indexOf(null, stepIdx) >= 0 ? captures.indexOf(null, stepIdx) : missing;
        camMsg.textContent = '';
      }
      renderCam();
    }

    startBtn.addEventListener('click', startCamera);
    stopBtn.addEventListener('click', stopCamera);
    captureBtn.addEventListener('click', capture);
    resetScanBtn.addEventListener('click', function () {
      captures = [null, null, null, null, null, null];
      stepIdx = 0;
      autoDone = false;
      auto.reset();
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
      isCameraOn: function () { return !!stream; }
    };
  }

  root.ScanTab = { mount: mount };
})(typeof window !== 'undefined' ? window : this);
