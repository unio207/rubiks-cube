// app.js - wires the page together: baseline cube, CFOP hint panel (solver in a Web Worker),
// timer (with the Feature 6 race ghost), and the Cube | Algorithms | Scan tabs. Browser only; loaded last.
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var scrambleBtn = $('scramble'), solveBtn = $('solve'), resetBtn = $('reset');
  var hintsBtn = $('hintsBtn'), tabCube = $('tabCube'), tabAlgs = $('tabAlgs'), tabScan = $('tabScan');
  var hintsEl = $('hints'), algsEl = $('algs'), scanEl = $('scan');

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
  [scrambleBtn, solveBtn, resetBtn, hintsBtn, tabCube, tabAlgs, tabScan].forEach(function (b) {
    b.addEventListener('mousedown', function (e) { e.preventDefault(); });
    b.addEventListener('click', function () { b.blur(); });
  });

  var tab = 'cube';
  var timing = false;   // inspection, space hold or timed solve in progress
  // Race ghost (Feature 6): the digital cube solving itself while the user solves a real one.
  var ghost = { id: 0, solution: null, waiting: false, active: false, plan: null, idx: 0, t0: 0, target: 0 };
  function ghostBusy() { return ghost.waiting || ghost.active; }

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
        '  try { out.hint = Solver[e.data.fn](e.data.state); } catch (err) { out.error = String(err && err.message || err); }\n' +
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
        try { cb(null, window.Solver[cb.fn](state)); } catch (err) { cb(String(err && err.message || err), null); }
      }, 0);
    }

    // call('getHint' | 'solve', state, cb(err, result))
    function call(fn, state, cb) {
      var id = nextId++;
      cb.state = state;
      cb.fn = fn;
      pending[id] = cb;
      if (worker) worker.postMessage({ id: id, fn: fn, state: state });
      else run(id, state);
    }
    return {
      getHint: function (state, cb) { call('getHint', state, cb); },
      solve: function (state, cb) { call('solve', state, cb); }
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

  function hintsVisible() { return hintsOn && !timing && !ghostBusy() && tab === 'cube'; }

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

  // Solve button: play a short CFOP solution from the solver instead of rewinding history.
  // If the cube changes before the solution arrives, it is dropped.
  var solveId = 0;
  app.hooks.solve = function () {
    var id = ++solveId, state = app.getQueuedState();
    solver.solve(state, function (err, res) {
      if (id !== solveId || err || !res) return;
      if (!Cube.isEqual(state, app.getQueuedState()) || timing) return;
      app.applyMoves(res.moves);
    });
  };
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

  // Show the solved cube for a moment, then apply the next timer scramble.
  function delayScramble(moves) {
    cancelPendingScramble();
    pendingScramble = moves;
    scrambleTimer = setTimeout(function () {
      scrambleTimer = 0;
      if (timerIdle()) applyTimerScramble(moves);
    }, 700);
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
      // The ghost is still solving: scramble once it has finished.
      if (mounted && ghostBusy()) { cancelPendingScramble(); pendingScramble = moves; return; }
      // After a solve, leave the solved cube visible for a moment before scrambling.
      if (mounted && ui && ui.timer.state === 'stopped' && Cube.isSolved(app.getState())) {
        delayScramble(moves);
        return;
      }
      applyTimerScramble(moves);
    },
    // Inspection, the space hold and the solve itself all count as timing.
    onActiveChange: function (active) {
      timing = active;
      updateBusy();
    },
    raceBlocked: function () {
      return Cube.isSolved(app.getQueuedState())
        ? 'The cube is already solved: scramble it (or load one from the Scan tab) to race.' : null;
    },
    // Work out the ghost's solution during the hold / inspection, so it is ready on release.
    raceArm: function () {
      var id = ++ghost.id, state = app.getQueuedState();
      ghost.solution = null;
      solver.solve(state, function (err, res) {
        if (id !== ghost.id) return;
        if (err || !res) { ghost.waiting = false; ui.raceMessage('The ghost could not solve this cube.'); updateBusy(); return; }
        ghost.solution = res;
        if (ghost.waiting) startGhost();
      });
    },
    raceStart: function (targetMs) {
      ghost.t0 = ui.timer.startAt;
      ghost.target = targetMs;
      ghost.waiting = true;
      if (ghost.solution) startGhost();
      updateBusy();
    },
    raceCancel: function () { ghost.id++; ghost.waiting = false; updateBusy(); }
  });

  // Buttons, tabs, hints and keys while timing or racing. During a race the cube keys are off too,
  // until the ghost has finished.
  function updateBusy() {
    var racing = (timing && ui.timer.isRace()) || ghostBusy();
    var busy = timing || racing;
    app.setButtonsEnabled(!busy);
    tabAlgs.disabled = busy;
    tabScan.disabled = busy;
    hintsBtn.disabled = busy;
    app.setKeysEnabled(tab === 'cube' && !racing);
    ui.setGhostBusy(ghostBusy());
    refreshHints();
  }

  // Play the solution on the human-like schedule, each move at its time from the timer's start.
  function startGhost() {
    ghost.waiting = false;
    ghost.active = true;
    ghost.plan = Race.schedule(ghost.solution.steps, ghost.target);
    ghost.idx = 0;
    if (ghost.plan.capped) {
      ui.raceMessage('(' + Timer.formatTime(ghost.target) + ' s is faster than the animation allows for this solve: the ghost needs ' +
        Timer.formatTime(ghost.plan.total) + ' s.)');
    }
    ghostTick();
  }
  function ghostTick() {
    if (!ghost.active) return;
    var t = performance.now() - ghost.t0, mv = ghost.plan.moves;
    while (ghost.idx < mv.length && t >= mv[ghost.idx].at) {
      app.applyMoves(mv[ghost.idx].move, { duration: mv[ghost.idx].anim });
      ghost.idx++;
    }
    if (ghost.idx < mv.length) requestAnimationFrame(ghostTick);
  }
  function ghostMoveDone() {
    if (!ghost.active || ghost.idx < ghost.plan.moves.length || !app.isIdle()) return;
    ghost.active = false;
    ui.ghostFinished(performance.now() - ghost.t0);
    updateBusy();
    if (pendingScramble && timerIdle()) delayScramble(pendingScramble);
  }
  mounted = true;
  applyTimerScramble(ui.timer.scramble);   // the cube matches the scramble shown on load

  // ---------------------------------------------------------------------------
  // Moves finishing on the main cube
  // ---------------------------------------------------------------------------
  app.hooks.onMove = function (move, state) {
    if (app.isIdle()) scrambling = false;
    trackMove(move);
    if (Cube.isSolved(state)) ui.notifySolved();   // ignored by the timer during a race
    ghostMoveDone();
    if (app.isIdle()) refreshHints();
  };

  // ---------------------------------------------------------------------------
  // Tabs
  // ---------------------------------------------------------------------------
  var algTab = AlgTab.mount(algsEl);
  // Scan tab: loading a scanned or hand-entered cube replaces the 3D cube's state and history.
  var scanTab = ScanTab.mount(scanEl, {
    getCubeState: function () { return app.getQueuedState(); },
    onLoad: function (state) {
      cancelPendingScramble();
      scrambling = false;
      app.reset(state);
      invalidateHint();
      setTab('cube');
    }
  });

  function setTab(name) {
    var t = ui.timer.state;
    if (name !== 'cube' && ((t !== 'idle' && t !== 'stopped') || ghostBusy())) return;  // finish the timed solve / race first
    tab = name;
    tabCube.classList.toggle('active', name === 'cube');
    tabAlgs.classList.toggle('active', name === 'algs');
    tabScan.classList.toggle('active', name === 'scan');
    algsEl.style.display = name === 'algs' ? '' : 'none';
    scanEl.style.display = name === 'scan' ? '' : 'none';
    if (name === 'scan') scanTab.show(); else scanTab.hide();
    $('timer').style.display = name === 'cube' ? '' : 'none';
    updateBusy();   // keys only on the Cube tab, and not while racing
  }
  updateBusy();
  tabCube.addEventListener('click', function () { setTab('cube'); });
  tabAlgs.addEventListener('click', function () { setTab('algs'); });
  tabScan.addEventListener('click', function () { setTab('scan'); });

  // ---------------------------------------------------------------------------
  // Keyboard: Space / Escape go to the timer, H toggles hints, cube keys are handled by Baseline.
  // ---------------------------------------------------------------------------
  function isSpace(e) { return e.code === 'Space' || e.key === ' '; }

  window.addEventListener('keydown', function (e) {
    if (isSpace(e)) {
      e.preventDefault();
      if (tab === 'cube' && timerIdle() && ghostBusy()) return;   // the ghost is still solving
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
    if (e.target && e.target.tagName === 'INPUT') return;     // typing a race target
    if ((timing && ui.timer.isRace()) || ghostBusy()) return;  // racing: the cube is busy
    var key = Baseline.eventKey(e);
    if (!e.altKey && (key === 'KeyH' || key === 'h' || key === 'H')) { e.preventDefault(); if (!hintsBtn.disabled) toggleHints(); return; }
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
  window.rubiksApp = { app: app, timer: ui, algTab: algTab, scanTab: scanTab };
})();
