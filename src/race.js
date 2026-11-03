// race.js - Feature 6 logic, no DOM: the ghost's human-like pacing schedule, the PB lookup,
// race settings storage and the result line.
// Browser: defines window.Race (needs window.Cube and window.Timer loaded first).
// Node: require('./src/race.js') returns the same object.
(function (root) {
  'use strict';

  var isNode = typeof module !== 'undefined' && module.exports;
  var Cube = isNode ? require('./core.js') : root.Cube;
  var Timer = isNode ? require('./timer.js') : root.Timer;

  var SETTINGS_KEY = 'rubiks-race-settings';
  var DEFAULT_TARGET = 20000;

  // Nominal pace (ms) of a ~20 s CFOP solver, by solver stage (1 orientation .. 8 AUF).
  // PAUSE: recognition / lookahead before the stage. TURN: one quarter turn.
  var PAUSE = { 1: 300, 2: 800, 3: 900, 4: 700, 5: 600, 6: 700, 7: 600, 8: 350 };
  var TURN = { 1: 250, 2: 210, 3: 240, 4: 110, 5: 110, 6: 110, 7: 110, 8: 180 };
  var DOUBLE = 1.6;          // a double turn takes this much longer than a quarter turn
  var ROTATION = 1.5;        // a whole-cube rotation (x, y, z)
  var TURN_JITTER = 0.2;     // +-20% per move
  var PAUSE_JITTER = 0.3;    // +-30% per pause
  var MIN_QUARTER = 60;      // animation limit per quarter turn (ms)
  var MIN_DOUBLE = 90;       // per double turn or rotation
  var ANIM_SHARE = 0.85;     // share of a move's slot spent animating (the rest is the gap)
  var MAX_ANIM = 250;

  function kindOf(move) {
    var m = Cube.parseMove(move);
    if ('xyz'.indexOf(m.base) >= 0) return 'rotation';
    return Math.abs(m.turns) === 2 ? 'double' : 'quarter';
  }

  // schedule(steps, targetMs, opts) -> { moves, pauses, total, target, capped, minTotal }
  // steps: Solver.solve(state).steps ([{ stage, moves }]). opts.random: RNG in [0, 1) (default Math.random).
  // moves: [{ move, stage, kind, at, dur, anim }]: the move starts at `at` ms after the start and
  //   animates for `anim` ms; `dur` is its whole slot (animation + gap before the next move).
  // pauses: [{ stage, at, dur }], one before each step.
  // total: when the last turn finishes. It equals target unless the target is below minTotal
  //   (every turn at the animation limit, no pauses), in which case capped is true and total = minTotal.
  function schedule(steps, targetMs, opts) {
    var rnd = (opts && opts.random) || Math.random;
    function jitter(j) { return 1 + j * (2 * rnd() - 1); }
    // Unscaled weights, drawn once so the scaling below doesn't change the rhythm.
    var items = [];
    steps.forEach(function (st) {
      items.push({ pause: true, stage: st.stage, w: PAUSE[st.stage] * jitter(PAUSE_JITTER) });
      st.moves.forEach(function (mv) {
        var kind = kindOf(mv);
        var w = TURN[st.stage] * (kind === 'double' ? DOUBLE : kind === 'rotation' ? ROTATION : 1) * jitter(TURN_JITTER);
        items.push({ pause: false, stage: st.stage, move: mv, kind: kind, w: w,
          min: kind === 'quarter' ? MIN_QUARTER : MIN_DOUBLE });
      });
    });
    var last = -1;
    items.forEach(function (it, i) { if (!it.pause) last = i; });

    function build(k) {
      var t = 0, moves = [], pauses = [], end = 0;
      items.forEach(function (it, i) {
        if (it.pause) { var p = k * it.w; pauses.push({ stage: it.stage, at: t, dur: p }); t += p; return; }
        var dur = Math.max(it.min, k * it.w);
        var anim = Math.min(MAX_ANIM, ANIM_SHARE * dur);
        moves.push({ move: it.move, stage: it.stage, kind: it.kind, at: t, dur: dur, anim: anim });
        if (i === last) end = t + anim;
        t += dur;
      });
      return { moves: moves, pauses: pauses, total: end };
    }

    var minPlan = build(0);
    if (last < 0 || targetMs <= minPlan.total) {
      minPlan.target = targetMs; minPlan.capped = last >= 0 && targetMs < minPlan.total; minPlan.minTotal = minPlan.total;
      return minPlan;
    }
    // total(k) is continuous and increasing: bisect for the scale that lands on the target.
    var lo = 0, hi = 1;
    while (build(hi).total < targetMs) hi *= 2;
    for (var n = 0; n < 60; n++) {
      var mid = (lo + hi) / 2;
      if (build(mid).total < targetMs) lo = mid; else hi = mid;
    }
    var plan = build(hi);
    plan.target = targetMs; plan.capped = false; plan.minTotal = minPlan.total;
    return plan;
  }

  // Best non-DNF single (ms, +2 included) of a session list, or null.
  function bestSingle(list) {
    var best = null;
    (list || []).forEach(function (e) {
      var t = Timer.effective(e);
      if (t !== Infinity && (best === null || t < best)) best = t;
    });
    return best;
  }

  // The ghost's target: { ms, fromPB, note }. settings: { target, usePB }.
  function target(settings, list) {
    var set = settings.target > 0 ? settings.target : DEFAULT_TARGET;
    if (!settings.usePB) return { ms: set, fromPB: false, note: '' };
    var pb = bestSingle(list);
    if (pb === null) return { ms: set, fromPB: false, note: 'No PB yet: using the set time (' + Timer.formatTime(set) + ' s).' };
    return { ms: pb, fromPB: true, note: 'Ghost target: your PB, ' + Timer.formatTime(pb) + ' s.' };
  }

  function defaultStorage() {
    try { return root.localStorage || null; } catch (e) { return null; }
  }

  function loadSettings(storage) {
    if (storage === undefined) storage = defaultStorage();
    var out = { on: false, target: DEFAULT_TARGET, usePB: false };
    try {
      var raw = storage && storage.getItem(SETTINGS_KEY);
      var s = raw ? JSON.parse(raw) : null;
      if (s && typeof s === 'object') {
        out.on = !!s.on;
        out.usePB = !!s.usePB;
        if (typeof s.target === 'number' && s.target > 0) out.target = s.target;
      }
    } catch (e) { /* defaults */ }
    return out;
  }

  function saveSettings(settings, storage) {
    if (storage === undefined) storage = defaultStorage();
    try {
      if (storage) storage.setItem(SETTINGS_KEY, JSON.stringify({ on: !!settings.on, target: settings.target, usePB: !!settings.usePB }));
    } catch (e) { /* ignore */ }
  }

  // Result of a race: user is the saved entry (or null while running), ghost the ghost's ms (or null
  // while it is still solving or was stopped). stoppedAt: when I stopped first, the ghost is stopped
  // too and this is its scheduled finish (ms), which my time is compared against.
  // -> { winner: 'you' | 'ghost' | 'tie' | null, margin: ms | null, text }
  function result(user, ghost, stoppedAt) {
    var g = ghost === null || ghost === undefined ? null : ghost;
    var s = stoppedAt === null || stoppedAt === undefined ? null : stoppedAt;
    if (!user) {
      return { winner: null, margin: null, text: g === null ? 'Racing the ghost…' : 'Ghost finished in ' + Timer.formatTime(g) + '. Keep going!' };
    }
    var u = Timer.effective(user);
    var you = 'You ' + Timer.formatEntry(user);
    if (g === null && s === null) {   // ended before the ghost started (inspection ran out)
      if (u === Infinity) return { winner: 'ghost', margin: null, text: you + '  ·  DNF: ghost wins.' };
      return { winner: 'you', margin: null, text: you + '  ·  You won!' };
    }
    var both = you + '  ·  ' + (g !== null ? 'Ghost ' + Timer.formatTime(g) : 'Ghost would have finished at ' + Timer.formatTime(s)) + '  ·  ';
    if (g === null) g = s;
    if (u === Infinity) return { winner: 'ghost', margin: null, text: both + 'DNF: ghost wins.' };
    // Compare the times as shown (truncated to 0.01 s), so the margin matches the two numbers.
    var d = Math.abs(Math.floor(u / 10) - Math.floor(g / 10)) * 10;
    if (d === 0) return { winner: 'tie', margin: 0, text: both + 'Tie!' };
    var w = u < g ? 'you' : 'ghost';
    return { winner: w, margin: d, text: both + (w === 'you' ? 'You won by ' : 'Ghost won by ') + Timer.formatTime(d) + ' s.' };
  }

  var Race = {
    SETTINGS_KEY: SETTINGS_KEY, DEFAULT_TARGET: DEFAULT_TARGET,
    MIN_QUARTER: MIN_QUARTER, MIN_DOUBLE: MIN_DOUBLE,
    schedule: schedule, bestSingle: bestSingle, target: target,
    loadSettings: loadSettings, saveSettings: saveSettings, result: result
  };

  if (isNode) module.exports = Race;
  else root.Race = Race;
})(typeof window !== 'undefined' ? window : this);
