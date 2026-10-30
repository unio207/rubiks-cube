// app.js - wires the page together: baseline cube, CFOP hint panel (solver in a Web Worker),
// timer, and the Cube | Algorithms tabs. Browser only; loaded last.
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var scrambleBtn = $('scramble'), solveBtn = $('solve'), resetBtn = $('reset');
  var hintsBtn = $('hintsBtn'), tabCube = $('tabCube'), tabAlgs = $('tabAlgs');
  var hintsEl = $('hints'), algsEl = $('algs');

  var app = Baseline.init({
    container: $('cube'),
    scrambleBtn: scrambleBtn,
    solveBtn: solveBtn,
    resetBtn: resetBtn,
    solvedLabel: $('solved'),
    helpEl: $('help')
  });
  $('help').textContent = Baseline.HELP_TEXT + '  ·  H: hints  ·  Space: timer';

  // Top-bar buttons never keep focus, so Space can never press them.
  [scrambleBtn, solveBtn, resetBtn, hintsBtn, tabCube, tabAlgs].forEach(function (b) {
    b.addEventListener('mousedown', function (e) { e.preventDefault(); });
    b.addEventListener('click', function () { b.blur(); });
  });

  var tab = 'cube';
  var timing = false;   // inspection, space hold or timed solve in progress

  // ---------------------------------------------------------------------------
  // Solver worker. Built from the inlined core + solver source so it works from file://.
  // ---------------------------------------------------------------------------
  var solver = (function () {
    var src = $('src-core').textContent + '\n;\n' + $('src-solver').textContent;
    var pending = {};
    var nextId = 1;
    var worker = null;
    try {
      var body = src + '\n;self.onmessage = function (e) {\n' +
        '  var out = { id: e.data.id };\n' +
        '  try { out.hint = Solver.getHint(e.data.state); } catch (err) { out.error = String(err && err.message || err); }\n' +
        '  self.postMessage(out);\n' +
        '};\n';
      var url = URL.createObjectURL(new Blob([body], { type: 'text/javascript' }));
      worker = new Worker(url);
      worker.onmessage = function (e) {
        var cb = pending[e.data.id];
        delete pending[e.data.id];
        if (cb) cb(e.data.error || null, e.data.hint || null);
      };
      worker.onerror = function (e) { e.preventDefault(); fallback(); };
    } catch (err) {
      fallback();
    }

    // If workers are unavailable, run the solver on the main thread (it is fast, ~ms per hint).
    function fallback() {
      if (worker) { worker.terminate(); worker = null; }
      if (!window.Solver) (0, eval)($('src-solver').textContent);
      Object.keys(pending).forEach(function (id) { run(+id, pending[id].state); });
    }
    function run(id, state) {
      setTimeout(function () {
        var cb = pending[id];
        if (!cb) return;
        delete pending[id];
        try { cb(null, window.Solver.getHint(state)); } catch (err) { cb(String(err && err.message || err), null); }
      }, 0);
    }

    return {
      getHint: function (state, cb) {
        var id = nextId++;
        cb.state = state;
        pending[id] = cb;
        if (worker) worker.postMessage({ id: id, state: state });
        else run(id, state);
      }
    };
  })();

  // ---------------------------------------------------------------------------
  // Hint panel
  // ---------------------------------------------------------------------------
  var hintsOn = false;
  var hint = null;        // last hint from the solver
  var step = 0;           // index of the next move in hint.moves
  var nextMove = null;    // move still to play for hint.moves[step] (half of an X2 may be done)
  var stale = true;       // hint no longer matches the cube
  var requestId = 0;

  function hintsVisible() { return hintsOn && !timing && tab === 'cube'; }

  function refreshHints() {
    hintsBtn.textContent = 'Hints: ' + (hintsOn ? 'on' : 'off');
    hintsBtn.classList.toggle('on', hintsOn);
    if (!hintsVisible()) {
      hintsEl.style.display = 'none';
      app.view.highlightLayer(null);
      return;
    }
    hintsEl.style.display = '';
    if (stale && app.isIdle()) requestHint();
    render();
  }

  function requestHint() {
    var id = ++requestId;
    var state = app.getState();
    solver.getHint(state, function (err, h) {
      if (id !== requestId) return;       // a newer request superseded this one
      if (err) { hint = { error: err }; stale = false; render(); return; }
      hint = h;
      step = 0;
      nextMove = h.moves.length ? h.moves[0] : null;
      stale = false;
      render();
    });
  }

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function render() {
    if (!hintsVisible()) return;
    hintsEl.textContent = '';
    if (stale || !hint) {
      hintsEl.appendChild(el('div', 'busy', 'Working out the next step…'));
      app.view.highlightLayer(null);
      return;
    }
    if (hint.error) {
      hintsEl.appendChild(el('div', 'busy', 'No hint available: ' + hint.error));
      app.view.highlightLayer(null);
      return;
    }
    hintsEl.appendChild(el('div', 'stage', hint.stage === 0 ? 'Solved' :
      'Stage ' + hint.stage + ' of 8: ' + hint.stageName));
    hintsEl.appendChild(el('div', 'goal', hint.goal));
    if (hint.caseName) {
      hintsEl.appendChild(el('div', 'case', 'Case: ' + hint.caseName + (hint.setup ? '  (setup ' + hint.setup + ')' : '')));
    }
    if (hint.moves.length) {
      var row = el('div', 'moves');
      hint.moves.forEach(function (m, i) {
        var label = (i === step && nextMove !== m) ? m + ' (' + nextMove + ' left)' : m;
        row.appendChild(el('span', 'mv' + (i < step ? ' done' : i === step ? ' next' : ''), label));
      });
      hintsEl.appendChild(row);
    }
    app.view.highlightLayer(app.isIdle() && nextMove ? nextMove : null);
  }

  // A move finished on the main cube: advance the hint if it was the suggested move.
  function trackMove(move) {
    if (stale || !hint || hint.error || !nextMove) { stale = true; return; }
    var want = Cube.parseMove(nextMove);
    if (move.name === want.name) {
      step++;
      if (step >= hint.moves.length) { stale = true; nextMove = null; }
      else nextMove = hint.moves[step];
    } else if (want.turns === 2 && move.base === want.base && move.turns !== 2) {
      nextMove = move.name;  // first half of an X2 played as two quarter turns
    } else {
      stale = true;
    }
  }

  // Cube changed without per-move events (reset) or with moves we did not suggest.
  function invalidateHint() {
    stale = true;
    refreshHints();
  }

  function toggleHints() {
    hintsOn = !hintsOn;
    refreshHints();
  }
  hintsBtn.addEventListener('click', toggleHints);
  resetBtn.addEventListener('click', invalidateHint);   // runs after Baseline's own reset handler

  // ---------------------------------------------------------------------------
  // Timer
  // ---------------------------------------------------------------------------
  var mounted = false;
  var scrambleTimer = 0;      // pending delayed scramble after a solve (0 = none)
  var pendingScramble = null;
  var scrambling = false;     // a timer scramble is still animating

  function timerIdle() { var s = ui.timer.state; return s === 'idle' || s === 'stopped'; }

  function cancelPendingScramble() {
    clearTimeout(scrambleTimer);
    scrambleTimer = 0;
    pendingScramble = null;
  }

  function applyTimerScramble(moves) {
    if (!mounted) return;   // the first scramble is applied right after mount
    cancelPendingScramble();
    app.reset();
    app.applyMoves(moves, { fast: true });
    scrambling = true;
    invalidateHint();
  }

  var ui = Timer.mount($('timer'), {
    applyScramble: function (moves) {
      // After a solve, leave the solved cube visible for a moment before scrambling.
      if (mounted && ui && ui.timer.state === 'stopped' && Cube.isSolved(app.getState())) {
        cancelPendingScramble();
        pendingScramble = moves;
        scrambleTimer = setTimeout(function () {
          scrambleTimer = 0;
          if (timerIdle()) applyTimerScramble(moves);
        }, 700);
        return;
      }
      applyTimerScramble(moves);
    },
    // Inspection, the space hold and the solve itself all count as timing.
    onActiveChange: function (active) {
      timing = active;
      app.setButtonsEnabled(!active);
      tabAlgs.disabled = active;
      refreshHints();
    }
  });
  mounted = true;
  applyTimerScramble(ui.timer.scramble);   // the cube matches the scramble shown on load

  // ---------------------------------------------------------------------------
  // Moves finishing on the main cube
  // ---------------------------------------------------------------------------
  app.hooks.onMove = function (move, state) {
    if (app.isIdle()) scrambling = false;
    trackMove(move);
    if (Cube.isSolved(state)) ui.notifySolved();
    if (app.isIdle()) refreshHints();
  };

  // ---------------------------------------------------------------------------
  // Tabs
  // ---------------------------------------------------------------------------
  var algTab = AlgTab.mount(algsEl);

  function setTab(name) {
    var t = ui.timer.state;
    if (name === 'algs' && t !== 'idle' && t !== 'stopped') return;  // finish the timed solve first
    tab = name;
    tabCube.classList.toggle('active', name === 'cube');
    tabAlgs.classList.toggle('active', name === 'algs');
    algsEl.style.display = name === 'algs' ? '' : 'none';
    $('timer').style.display = name === 'cube' ? '' : 'none';
    app.setKeysEnabled(name === 'cube');
    refreshHints();
  }
  tabCube.addEventListener('click', function () { setTab('cube'); });
  tabAlgs.addEventListener('click', function () { setTab('algs'); });

  // ---------------------------------------------------------------------------
  // Keyboard: Space / Escape go to the timer, H toggles hints, cube keys are handled by Baseline.
  // ---------------------------------------------------------------------------
  function isSpace(e) { return e.code === 'Space' || e.key === ' '; }

  window.addEventListener('keydown', function (e) {
    if (isSpace(e)) {
      e.preventDefault();
      if (tab === 'cube' && timerIdle() && (scrambleTimer || scrambling)) {
        // Don't start inspection or a hold until the next scramble is on the cube.
        if (scrambleTimer) applyTimerScramble(pendingScramble);
        return;
      }
      if (tab === 'cube') ui.keyDown(e);
      else if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
      return;
    }
    if (tab !== 'cube') return;
    if (e.key === 'Escape') { ui.keyDown(e); return; }
    if (e.repeat || e.ctrlKey || e.metaKey) return;
    var key = Baseline.eventKey(e);
    if (!e.altKey && (key === 'KeyH' || key === 'h' || key === 'H')) { e.preventDefault(); toggleHints(); return; }
    // A cube key queues a move: the layer highlight would be stale while it animates,
    // and a delayed post-solve scramble must not overwrite it.
    if (Baseline.keyToMove(key, e.shiftKey, e.altKey)) { app.view.highlightLayer(null); cancelPendingScramble(); }
  });

  window.addEventListener('keyup', function (e) {
    if (!isSpace(e)) return;
    e.preventDefault();
    if (tab === 'cube') ui.keyUp(e);
  });

  // Scramble / Solve queue moves: drop the highlight now; the hint recomputes when they finish.
  // Any of the three buttons replaces a pending post-solve scramble.
  [scrambleBtn, solveBtn].forEach(function (b) {
    b.addEventListener('click', function () { app.view.highlightLayer(null); cancelPendingScramble(); });
  });
  resetBtn.addEventListener('click', function () { cancelPendingScramble(); scrambling = false; });

  refreshHints();
  window.rubiksApp = { app: app, timer: ui, algTab: algTab };
})();
