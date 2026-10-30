// baseline.js - main cube controller: keys, Scramble / Solve / Reset, Solved label, help line.
// Browser: defines window.Baseline (needs window.Cube and window.CubeView).
// Node: require('./src/baseline.js') gives the pure helpers (keyToMove, createHistory) for tests.
(function (root) {
  'use strict';

  var Cube = root.Cube || (typeof require === 'function' ? require('./core.js') : null);

  var HELP_TEXT = 'U D L R F B: turn face  ·  Alt+face: wide turn  ·  M: middle slice  ·  X Y Z: rotate cube  ·  Shift: reverse  ·  drag to rotate the view';
  var KEYS = { U: 'U', D: 'D', L: 'L', R: 'R', F: 'F', B: 'B', X: 'x', Y: 'y', Z: 'z', M: 'M' };
  var FACES = 'UDLRFB';

  // Map a key (from event.code like 'KeyR', or a letter) plus shift/alt to a move name, or null.
  // Alt + a face key is the wide turn (Alt+R = r). Moves are in the fixed spatial frame,
  // so after a rotation 'U' turns whatever face is on top.
  function keyToMove(key, shift, alt) {
    var k = /^Key[A-Z]$/.test(key) ? key.slice(3) : String(key).toUpperCase();
    var base = KEYS[k];
    if (!base) return null;
    if (alt) {
      if (FACES.indexOf(base) < 0) return null;
      base = base.toLowerCase();
    }
    return shift ? base + "'" : base;
  }

  // The key to map for a keyboard event: the printed letter when it is a latin letter
  // (so AZERTY/QWERTZ users get the key they see), otherwise the physical key code.
  function eventKey(e) {
    return /^[a-z]$/i.test(e.key || '') ? e.key : (e.code || e.key);
  }

  // History of moves since the cube was last solved, tracked in queue order.
  // push(move): records the move; if the predicted state is then solved, history restarts.
  // solveMoves(): the inverse of the history (pushing these empties it again).
  function createHistory(startState) {
    var h = { moves: [], state: (startState || Cube.solvedState()).slice() };
    h.push = function (move) {
      h.state = Cube.applyMove(h.state, move);
      h.moves = Cube.isSolved(h.state) ? [] : Cube.pushHistory(h.moves, move);
    };
    h.reset = function (state) { h.moves = []; h.state = (state || Cube.solvedState()).slice(); };
    h.solveMoves = function () { return Cube.invertAlg(h.moves).map(function (m) { return m.name; }); };
    return h;
  }

  // opts:
  //   container    element for the full-window 3D cube (required)
  //   scrambleBtn, solveBtn, resetBtn   button elements (optional)
  //   solvedLabel  element shown (display '') when solved and idle, hidden otherwise (optional)
  //   helpEl       element whose text is set to HELP_TEXT (optional)
  //   keyTarget    where to listen for keydown (default window)
  //   view         extra options passed to CubeView.createCubeView
  //   onMove(move, state)        after each completed move (any source)
  //   onSolvedChange(solved)     when "solved and idle" changes
  function init(opts) {
    var hooks = { onMove: opts.onMove || null, onSolvedChange: opts.onSolvedChange || null };
    var view = root.CubeView.createCubeView(opts.container, opts.view || {});
    var history = createHistory(view.getState());
    var keysEnabled = true;
    var shownSolved = null;

    function updateSolved() {
      var solved = view.isIdle() && Cube.isSolved(view.getState());
      if (opts.solvedLabel) opts.solvedLabel.style.display = solved ? '' : 'none';
      if (solved !== shownSolved) {
        shownSolved = solved;
        if (hooks.onSolvedChange) hooks.onSolvedChange(solved);
      }
    }

    view.onMoveDone = function (move, state) {
      if (hooks.onMove) hooks.onMove(move, state);
      updateSolved();
    };

    // Queue moves (names, objects, alg string or array). o.fast plays them quickly.
    // o.record === false skips the solve history (default records).
    function applyMoves(moves, o) {
      o = o || {};
      var list = Cube.parseAlg(typeof moves === 'object' && !Array.isArray(moves) ? [moves] : moves);
      if (!list.length) return;
      if (o.record !== false) list.forEach(function (m) { history.push(m); });
      else history.reset(Cube.applyAlg(history.state, list));
      view.enqueue(list, { fast: !!o.fast });
      updateSolved();
    }

    function scramble() { applyMoves(Cube.randomScramble(25), { fast: true }); }
    function solve() { applyMoves(history.solveMoves()); }
    function reset(state) {
      view.setState(state || Cube.solvedState());
      history.reset(view.getState());
      updateSolved();
    }

    function bind(btn, fn) {
      if (!btn) return;
      btn.addEventListener('click', function () { fn(); btn.blur(); });
    }
    bind(opts.scrambleBtn, scramble);
    bind(opts.solveBtn, solve);
    bind(opts.resetBtn, function () { reset(); });
    if (opts.helpEl) opts.helpEl.textContent = HELP_TEXT;

    function onKey(e) {
      if (!keysEnabled || e.repeat || e.ctrlKey || e.metaKey) return;
      var t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      var move = keyToMove(eventKey(e), e.shiftKey, e.altKey);
      if (!move) return;
      e.preventDefault();
      applyMoves(move);
    }
    var keyTarget = opts.keyTarget || root;
    keyTarget.addEventListener('keydown', onKey);

    updateSolved();

    return {
      view: view,
      hooks: hooks,                                   // assign hooks.onMove / hooks.onSolvedChange any time
      applyMoves: applyMoves,
      scramble: scramble,
      solve: solve,
      reset: reset,                                   // reset(state?) instant, clears queue + history
      getState: function () { return view.getState(); },          // state after completed moves
      getQueuedState: function () { return history.state.slice(); }, // state after all queued moves
      getHistory: function () { return history.moves.slice(); },
      isIdle: function () { return view.isIdle(); },
      isSolvedIdle: function () { return !!shownSolved; },
      setButtonsEnabled: function (on) {
        [opts.scrambleBtn, opts.solveBtn, opts.resetBtn].forEach(function (b) { if (b) b.disabled = !on; });
      },
      setKeysEnabled: function (on) { keysEnabled = !!on; },
      dispose: function () { keyTarget.removeEventListener('keydown', onKey); view.dispose(); }
    };
  }

  var Baseline = { init: init, keyToMove: keyToMove, eventKey: eventKey, createHistory: createHistory, HELP_TEXT: HELP_TEXT };
  if (typeof module !== 'undefined' && module.exports) module.exports = Baseline;
  else root.Baseline = Baseline;
})(typeof window !== 'undefined' ? window : this);
