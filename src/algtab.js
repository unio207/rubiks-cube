// algtab.js - Feature 2: Algorithms tab. One card per Cube.ALGS entry with a generated diagram,
// the alg text, and a lazily created mini cube (Play/Pause, step back, step forward, Reset).
// Browser: defines window.AlgTab (needs window.Cube; mini cubes need window.CubeView + THREE).
// Node: require('./src/algtab.js') gives the pure parts (caseState, verifyCard, diagram builders).
(function (root) {
  'use strict';

  var Cube = root.Cube || (typeof require === 'function' ? require('./core.js') : null);

  var GRAY = '#4a4f59';
  var STROKE = '#0d0e11';
  var MAX_LIVE = 12;   // live WebGL mini cubes at once (browsers cap contexts at ~16)
  var PLACEHOLDER = 'Click to load 3D';

  function hex(letter) { return '#' + ('000000' + Cube.COLOR_HEX[letter].toString(16)).slice(-6); }

  // ---------- Pure parts ----------

  // The case state for an alg: CFOP-hold solved cube with the inverse alg applied.
  function caseState(alg) { return Cube.caseState(alg); }

  function findEntry(algOrEntry) {
    if (algOrEntry && typeof algOrEntry === 'object' && algOrEntry.alg) return algOrEntry;
    var s = Cube.algToString(Cube.parseAlg(algOrEntry));
    for (var i = 0; i < Cube.ALGS.length; i++) {
      if (Cube.algToString(Cube.parseAlg(Cube.ALGS[i].alg)) === s) return Cube.ALGS[i];
    }
    return { id: 'custom', name: 'Custom', group: 'PLL edges', target: 'cube', alg: algOrEntry };
  }

  // States a card uses: the diagram is drawn from diagramState, the mini cube starts at startState.
  function diagramState(entry) { return caseState(entry.alg); }
  function startState(entry) { return caseState(entry.alg); }

  // verifyCard(alg or ALGS entry): diagram and mini cube start in the same state, and playing the
  // alg from there leaves the target solved (exactly, no extra U turn needed).
  function verifyCard(algOrEntry) {
    var entry = findEntry(algOrEntry);
    var d = diagramState(entry), s = startState(entry);
    var sameStart = Cube.isEqual(d, s);
    var final = Cube.applyAlg(s, entry.alg);
    var solved = Cube.targetSolved(final, entry.target);
    return { ok: sameStart && solved, sameStart: sameStart, solved: solved };
  }

  function cubieColors(state, pos) {
    var out = [];
    Cube.FACELETS.forEach(function (f, i) { if (f.pos.join() === pos.join()) out.push(state[i]); });
    return out;
  }

  // Where the piece now at pos belongs, judged by the current centers.
  function homeOf(state, pos) {
    var home = [0, 0, 0];
    cubieColors(state, pos).forEach(function (c) {
      var face = Cube.FACES.filter(function (f) { return Cube.centerColor(state, f) === c; })[0];
      var n = Cube.NORMALS[face];
      home = [home[0] + n[0], home[1] + n[1], home[2] + n[2]];
    });
    return home;
  }

  // Top-down view data: U 3x3 (row 0 at the back) plus the 12 top-layer side stickers.
  // Returns { u: [9 colors], back: [3], front: [3], left: [3], right: [3] } (left/right ordered back to front,
  // back/front ordered left to right).
  function topView(state) {
    var u = [], back = [], front = [], left = [], right = [];
    for (var r = 0; r < 3; r++) for (var c = 0; c < 3; c++) u.push(Cube.at(state, [c - 1, 1, r - 1], [0, 1, 0]));
    for (var i = 0; i < 3; i++) {
      back.push(Cube.at(state, [i - 1, 1, -1], [0, 0, -1]));
      front.push(Cube.at(state, [i - 1, 1, 1], [0, 0, 1]));
      left.push(Cube.at(state, [-1, 1, i - 1], [-1, 0, 0]));
      right.push(Cube.at(state, [1, 1, i - 1], [1, 0, 0]));
    }
    return { u: u, back: back, front: front, left: left, right: right };
  }

  var U_PIECES = [[-1, 1, -1], [0, 1, -1], [1, 1, -1], [1, 1, 0], [1, 1, 1], [0, 1, 1], [-1, 1, 1], [-1, 1, 0]];

  // PLL arrows: for each U-layer piece out of place, from its position to where it belongs.
  // 2-cycles are merged into one { from, to, both: true }.
  function pllArrows(state) {
    var moved = [];
    U_PIECES.forEach(function (p) {
      var h = homeOf(state, p);
      if (h.join() !== p.join()) moved.push({ from: p, to: h });
    });
    var out = [];
    moved.forEach(function (a) {
      var back = moved.filter(function (b) { return b.from.join() === a.to.join() && b.to.join() === a.from.join(); })[0];
      if (back) {
        if (!out.some(function (o) { return o.both && o.from.join() === a.to.join(); })) {
          out.push({ from: a.from, to: a.to, both: true });
        }
      } else out.push({ from: a.from, to: a.to, both: false });
    });
    return out;
  }

  // F2L view: colors for the visible U, F and R facelets. Only cross edges, the FR pair and centers keep
  // their color; everything else is null (gray). Returns [{ face, pos, normal, color }].
  function f2lStickers(state) {
    var cross = Cube.centerColor(state, 'D'), fc = Cube.centerColor(state, 'F'), rc = Cube.centerColor(state, 'R');
    function same(a, b) { return a.length === b.length && a.every(function (x) { return b.indexOf(x) >= 0; }); }
    var out = [];
    Cube.FACELETS.forEach(function (f, i) {
      if (f.face !== 'U' && f.face !== 'F' && f.face !== 'R') return;
      var cols = cubieColors(state, f.pos);
      var keep = cols.length === 1 ||
        (cols.length === 2 && cols.indexOf(cross) >= 0) ||
        same(cols, [cross, fc, rc]) || same(cols, [fc, rc]);
      out.push({ face: f.face, pos: f.pos, normal: f.normal, color: keep ? state[i] : null });
    });
    return out;
  }

  // ---------- SVG builders (pure strings) ----------

  function rect(x, y, w, h, fill) {
    return '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="2" fill="' + fill +
      '" stroke="' + STROKE + '" stroke-width="1.5"/>';
  }

  // OLL (yellowOnly) or PLL (full color + arrows) top view.
  function topSvg(state, yellowOnly, idSuffix) {
    var v = topView(state);
    var top = Cube.centerColor(state, 'U');
    function fill(c) { return yellowOnly ? (c === top ? hex(top) : GRAY) : hex(c); }
    var S = 30, O = 16, T = 10, parts = [];
    for (var r = 0; r < 3; r++) for (var c = 0; c < 3; c++) parts.push(rect(O + c * S + 1, O + r * S + 1, S - 2, S - 2, fill(v.u[r * 3 + c])));
    for (var i = 0; i < 3; i++) {
      parts.push(rect(O + i * S + 2, O - T - 3, S - 4, T, fill(v.back[i])));
      parts.push(rect(O + i * S + 2, O + 3 * S + 3, S - 4, T, fill(v.front[i])));
      parts.push(rect(O - T - 3, O + i * S + 2, T, S - 4, fill(v.left[i])));
      parts.push(rect(O + 3 * S + 3, O + i * S + 2, T, S - 4, fill(v.right[i])));
    }
    var defs = '';
    if (!yellowOnly) {
      var id = 'ah' + (idSuffix || '');
      defs = '<defs><marker id="' + id + '" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" ' +
        'orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#111"/></marker></defs>';
      pllArrows(state).forEach(function (a) {
        var x1 = O + (a.from[0] + 1.5) * S, y1 = O + (a.from[2] + 1.5) * S;
        var x2 = O + (a.to[0] + 1.5) * S, y2 = O + (a.to[2] + 1.5) * S;
        var dx = x2 - x1, dy = y2 - y1, len = Math.sqrt(dx * dx + dy * dy), k = 7 / len;
        x1 += dx * k; y1 += dy * k; x2 -= dx * k; y2 -= dy * k;
        parts.push('<line x1="' + x1.toFixed(1) + '" y1="' + y1.toFixed(1) + '" x2="' + x2.toFixed(1) + '" y2="' + y2.toFixed(1) +
          '" stroke="#111" stroke-width="2.5" stroke-linecap="round" marker-end="url(#' + id + ')"' +
          (a.both ? ' marker-start="url(#' + id + ')"' : '') + '/>');
      });
    }
    var W = O * 2 + 3 * S;
    return '<svg class="at-diagram" viewBox="0 0 ' + W + ' ' + W + '" width="' + W + '" height="' + W + '" role="img">' +
      defs + parts.join('') + '</svg>';
  }

  // Isometric U/F/R view for F2L.
  function f2lSvg(state) {
    var K = 22, C30 = Math.cos(Math.PI / 6);
    function proj(p) { return [(p[0] - p[2]) * C30 * K, ((p[0] + p[2]) * 0.5 - p[1]) * K]; }
    var parts = [];
    f2lStickers(state).forEach(function (st) {
      var n = st.normal;
      var center = [st.pos[0] + n[0] * 0.5, st.pos[1] + n[1] * 0.5, st.pos[2] + n[2] * 0.5];
      var axes = [[1, 0, 0], [0, 1, 0], [0, 0, 1]].filter(function (a) { return a[0] * n[0] + a[1] * n[1] + a[2] * n[2] === 0; });
      var a = axes[0], b = axes[1], h = 0.45;
      var pts = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(function (s) {
        var p = [0, 1, 2].map(function (k) { return center[k] + (a[k] * s[0] + b[k] * s[1]) * h; });
        var q = proj(p);
        return (q[0] + 80).toFixed(1) + ',' + (q[1] + 80).toFixed(1);
      });
      parts.push('<polygon points="' + pts.join(' ') + '" fill="' + (st.color ? hex(st.color) : GRAY) +
        '" stroke="' + STROKE + '" stroke-width="1.5" stroke-linejoin="round"/>');
    });
    return '<svg class="at-diagram" viewBox="0 0 160 160" width="160" height="160" role="img">' +
      '<polygon points="' + outline(proj) + '" fill="' + STROKE + '"/>' + parts.join('') + '</svg>';
  }

  // Dark hexagon behind the iso stickers so the gaps read as the cube body.
  function outline(proj) {
    var e = 1.5;
    return [[e, e, -e], [e, -e, -e], [e, -e, e], [-e, -e, e], [-e, e, e], [-e, e, -e]].map(function (p) {
      var q = proj(p);
      return (q[0] + 80).toFixed(1) + ',' + (q[1] + 80).toFixed(1);
    }).join(' ');
  }

  // Diagram SVG for an ALGS entry, always generated from its case state.
  function diagramSvg(entry, idSuffix) {
    var s = diagramState(entry);
    if (entry.group === 'F2L') return f2lSvg(s);
    if (entry.group.indexOf('OLL') === 0) return topSvg(s, true, idSuffix);
    return topSvg(s, false, idSuffix);
  }

  // ---------- Browser UI ----------

  var CSS = [
    '.at-filter{display:flex;flex-wrap:wrap;gap:6px;padding:16px 16px 0}',
    '.at-filter button{background:#2a2e37;color:#ccc;border:1px solid #444a56;border-radius:16px;padding:5px 14px;font:inherit;font-size:13px;cursor:pointer}',
    '.at-filter button:hover{background:#353a45}',
    '.at-filter button.on{background:#3d7bdc;border-color:#3d7bdc;color:#fff}',
    '.at-section-title{color:#ddd;font-size:16px;font-weight:600;margin:0;padding:18px 16px 0}',
    '.at-section-title span{color:#8a909c;font-weight:400;font-size:13px;margin-left:8px}',
    '.at-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:16px;padding:12px 16px 16px;box-sizing:border-box}',
    '.at-card{background:#1e2128;border:1px solid #2f343e;border-radius:10px;padding:14px;color:#ddd;display:flex;flex-direction:column;gap:10px;min-width:0}',
    '.at-head{display:flex;justify-content:space-between;align-items:baseline;gap:8px}',
    '.at-name{font-weight:600;font-size:15px}',
    '.at-group{color:#8a909c;font-size:12px;white-space:nowrap}',
    '.at-body{display:flex;gap:10px;align-items:center;justify-content:space-around;flex-wrap:wrap}',
    '.at-diagram{display:block;max-width:100%;height:auto}',
    '.at-mini{width:150px;height:150px;border-radius:8px;background:#15171c;display:flex;align-items:center;justify-content:center;color:#666;font-size:12px}',
    '.at-alg{font:15px ui-monospace,Consolas,monospace;display:flex;flex-wrap:wrap;gap:2px 7px}',
    '.at-tok{padding:1px 3px;border-radius:4px}',
    '.at-tok.at-cur{background:#3d7bdc;color:#fff}',
    '.at-tok.at-done{color:#6f7682}',
    '.at-ctrl{display:flex;gap:6px}',
    '.at-ctrl button{background:#2a2e37;color:#eee;border:1px solid #444a56;border-radius:6px;padding:5px 10px;font:inherit;font-size:13px;cursor:pointer}',
    '.at-ctrl button:hover:not(:disabled){background:#353a45}',
    '.at-ctrl button:disabled{opacity:0.4;cursor:default}'
  ].join('\n');

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function mount(container) {
    if (!document.getElementById('at-style')) {
      var st = el('style'); st.id = 'at-style'; st.textContent = CSS; document.head.appendChild(st);
    }
    // Cards are grouped by layer (F2L, OLL edges, ...) in solve order; the filter shows one layer.
    var grid = el('div');
    container.appendChild(grid);
    var LAYERS = ['All', 'F2L', 'OLL', 'PLL'];
    var filterBar = el('div', 'at-filter'), filterBtns = {};
    LAYERS.forEach(function (name) {
      filterBtns[name] = button(filterBar, name, 'Show ' + (name === 'All' ? 'all algorithms' : name + ' algorithms'),
        function () { setFilter(name); });
    });
    grid.appendChild(filterBar);
    var sections = [];
    Cube.ALGS.forEach(function (entry) {
      var sec = sections.filter(function (x) { return x.group === entry.group; })[0];
      if (!sec) {
        sec = { group: entry.group, layer: entry.group.split(' ')[0], title: el('h2', 'at-section-title', entry.group), grid: el('div', 'at-grid'), count: 0 };
        grid.appendChild(sec.title);
        grid.appendChild(sec.grid);
        sections.push(sec);
      }
      sec.count++;
    });
    sections.forEach(function (sec) { sec.title.appendChild(el('span', null, sec.count + (sec.count === 1 ? ' alg' : ' algs'))); });
    function sectionOf(entry) { return sections.filter(function (x) { return x.group === entry.group; })[0]; }

    function setFilter(name) {
      LAYERS.forEach(function (n) {
        filterBtns[n].classList.toggle('on', n === name);
        filterBtns[n].setAttribute('aria-pressed', n === name ? 'true' : 'false');
      });
      sections.forEach(function (sec) {
        var show = name === 'All' || sec.layer === name;
        sec.title.style.display = show ? '' : 'none';
        sec.grid.style.display = show ? '' : 'none';
      });
      try { localStorage.setItem('rubiks-alg-filter', name); } catch (e) {}
    }

    var live = [];   // cards with a live mini cube, oldest first
    var cards = Cube.ALGS.map(function (entry, i) { return makeCard(entry, i); });
    var saved = null;
    try { saved = localStorage.getItem('rubiks-alg-filter'); } catch (e) {}
    setFilter(LAYERS.indexOf(saved) >= 0 ? saved : 'All');

    var io = null;
    if (typeof IntersectionObserver === 'function') {
      io = new IntersectionObserver(function (items) {
        // Update all flags and free off-screen cubes first, then fill visible cards.
        items.forEach(function (it) {
          var card = it.target.__atCard;
          card.visible = it.isIntersecting;
          if (!card.visible) releaseView(card);
        });
        cards.forEach(function (c) { if (c.visible) ensureView(c, false); });
      });
      cards.forEach(function (c) { c.mini.__atCard = c; io.observe(c.mini); });
    }

    function makeCard(entry, i) {
      var card = { entry: entry, moves: Cube.parseAlg(entry.alg), pos: 0, playing: false, active: -1, view: null, visible: false };
      var root_ = el('div', 'at-card');
      var head = el('div', 'at-head');
      head.appendChild(el('span', 'at-name', entry.name));
      head.appendChild(el('span', 'at-group', entry.group));
      root_.appendChild(head);

      var body = el('div', 'at-body');
      var diag = el('div');
      diag.innerHTML = diagramSvg(entry, '-' + i);
      body.appendChild(diag);
      card.mini = el('div', 'at-mini', PLACEHOLDER);
      card.mini.addEventListener('click', function () { ensureView(card, true); });
      body.appendChild(card.mini);
      root_.appendChild(body);

      var algEl = el('div', 'at-alg');
      card.tokens = card.moves.map(function (m) { var t = el('span', 'at-tok', m.name); algEl.appendChild(t); return t; });
      root_.appendChild(algEl);

      var ctrl = el('div', 'at-ctrl');
      card.btnBack = button(ctrl, '◀', 'Step back', function () { step(card, -1); });
      card.btnPlay = button(ctrl, 'Play', 'Play / Pause', function () { togglePlay(card); });
      card.btnFwd = button(ctrl, '▶', 'Step forward', function () { step(card, 1); });
      button(ctrl, 'Reset', 'Reset to the case', function () { resetCard(card); });
      root_.appendChild(ctrl);

      sectionOf(entry).grid.appendChild(root_);
      card.el = root_;
      render(card);
      return card;
    }

    function button(parent, label, title, fn) {
      var b = el('button', null, label);
      b.type = 'button';
      b.title = title;
      b.setAttribute('aria-label', title);
      b.addEventListener('click', function () { b.blur(); fn(); });
      parent.appendChild(b);
      return b;
    }

    // Create the mini cube (if needed) showing the card's current logical position.
    // At the cap, an off-screen cube is freed first; if all live cubes are on screen, only a click
    // (force) frees the oldest one, so scrolling never makes visible cubes flicker away.
    function ensureView(card, force) {
      if (card.view) return card.view;
      if (!root.CubeView || !root.THREE) return null;
      while (live.length >= MAX_LIVE) {
        var victim = live.filter(function (c) { return !c.visible; })[0] || (force ? live[0] : null);
        if (!victim) { card.mini.textContent = PLACEHOLDER; return null; }
        releaseView(victim);
      }
      card.mini.textContent = '';
      var s = Cube.applyAlg(startState(card.entry), card.moves.slice(0, card.pos));
      card.view = root.CubeView.createCubeView(card.mini, { width: 150, height: 150, distance: 10, state: s });
      card.view.onMoveDone = function () { moveDone(card); };
      live.push(card);
      return card.view;
    }

    function releaseView(card) {
      if (!card.view) return;
      // Finish logically: any move in flight counts as done.
      if (card.active >= 0) { card.pos = card.dir > 0 ? card.active + 1 : card.active; card.active = -1; }
      card.playing = false;
      card.view.dispose();
      card.view = null;
      card.mini.textContent = PLACEHOLDER;
      live.splice(live.indexOf(card), 1);
      render(card);
    }

    function startMove(card, dir) {
      var v = ensureView(card, true);
      if (!v || !v.isIdle()) return false;
      if (dir > 0) {
        if (card.pos >= card.moves.length) return false;
        card.active = card.pos; card.dir = 1;
        v.enqueue(card.moves[card.pos]);
      } else {
        if (card.pos <= 0) return false;
        card.active = card.pos - 1; card.dir = -1;
        v.enqueue(Cube.invertMove(card.moves[card.pos - 1]));
      }
      render(card);
      return true;
    }

    function moveDone(card) {
      card.pos = card.dir > 0 ? card.active + 1 : card.active;
      card.active = -1;
      if (card.playing && card.pos < card.moves.length) startMove(card, 1);
      else card.playing = false;
      render(card);
    }

    function step(card, dir) {
      card.playing = false;
      startMove(card, dir);
      render(card);
    }

    function togglePlay(card) {
      if (card.playing) { card.playing = false; render(card); return; }
      var v = ensureView(card, true);
      if (!v) return;
      if (card.pos >= card.moves.length && v.isIdle()) {
        card.pos = 0;
        v.setState(startState(card.entry));
      }
      card.playing = true;
      if (v.isIdle()) startMove(card, 1);
      render(card);
    }

    function resetCard(card) {
      card.playing = false;
      card.pos = 0;
      card.active = -1;
      if (card.view) card.view.setState(startState(card.entry));
      render(card);
    }

    // Highlight the move being played, or the next move when idle.
    function render(card) {
      var cur = card.active >= 0 ? card.active : card.pos;
      card.tokens.forEach(function (t, i) {
        t.className = 'at-tok' + (i === cur ? ' at-cur' : (i < cur ? ' at-done' : ''));
      });
      card.btnPlay.textContent = card.playing ? 'Pause' : 'Play';
      var busy = card.active >= 0;
      card.btnBack.disabled = busy || card.pos <= 0;
      card.btnFwd.disabled = busy || card.pos >= card.moves.length;
    }

    // Without IntersectionObserver, a card's cube is created on its first click (placeholder or controls).
    return {
      cards: cards,
      setFilter: setFilter,
      dispose: function () {
        if (io) io.disconnect();
        cards.forEach(releaseView);
        if (grid.parentNode) grid.parentNode.removeChild(grid);
      }
    };
  }

  var AlgTab = {
    mount: mount,
    caseState: caseState,
    verifyCard: verifyCard,
    diagramState: diagramState,
    startState: startState,
    topView: topView,
    pllArrows: pllArrows,
    f2lStickers: f2lStickers,
    diagramSvg: diagramSvg,
    MAX_LIVE: MAX_LIVE
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = AlgTab;
  else root.AlgTab = AlgTab;
})(typeof window !== 'undefined' ? window : this);
