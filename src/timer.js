// timer.js - csTimer-style speedcubing timer (Feature 3).
// Browser: defines window.Timer (needs window.Cube from core.js loaded first).
// Node: require('./src/timer.js') returns the same object; only the logic part
// (createSession, createTimer, formatTime, computeStats) is usable without a DOM.
// Styles live in the CSS string below; mount() injects them once as <style id="tm-style">.
(function (root) {
  'use strict';

  var Cube = (typeof module !== 'undefined' && module.exports) ? require('./core.js') : root.Cube;

  var HOLD_MS = 300;          // hold time before the timer turns green
  var INSPECT_MS = 15000;     // inspection: over 15 s = +2
  var INSPECT_DNF_MS = 17000; // over 17 s = DNF
  var STORAGE_KEY = 'rubiks-timer-session';

  // ---------- formatting and stats (pure) ----------

  // Effective time of an entry in ms: +2 adds 2000, DNF is Infinity.
  function effective(entry) {
    if (entry.penalty === 'DNF') return Infinity;
    return entry.time + (entry.penalty === '+2' ? 2000 : 0);
  }

  // ms -> "12.34" or "1:02.34", truncated to 0.01 s. Infinity -> "DNF", null -> "-".
  function formatTime(ms) {
    if (ms === null || ms === undefined) return '-';
    if (ms === Infinity) return 'DNF';
    var cs = Math.floor(ms / 10);
    var min = Math.floor(cs / 6000);
    var sec = Math.floor((cs % 6000) / 100);
    var frac = cs % 100;
    var s = (frac < 10 ? '0' : '') + frac;
    if (min > 0) return min + ':' + (sec < 10 ? '0' : '') + sec + '.' + s;
    return sec + '.' + s;
  }

  function formatEntry(entry) {
    if (entry.penalty === 'DNF') return 'DNF(' + formatTime(entry.time) + ')';
    return formatTime(effective(entry)) + (entry.penalty === '+2' ? '+' : '');
  }

  // WCA average of the newest n entries (list is oldest first): drop best and worst,
  // mean the rest. More than one DNF in the window = DNF (a single DNF is the dropped worst).
  function averageOf(list, n) {
    if (list.length < n) return null;
    var times = list.slice(list.length - n).map(effective);
    var dnfs = times.filter(function (t) { return t === Infinity; }).length;
    if (dnfs > 1) return Infinity;
    times.sort(function (a, b) { return a - b; });
    var mid = times.slice(1, n - 1);
    var sum = 0;
    for (var i = 0; i < mid.length; i++) sum += mid[i];
    return sum / mid.length;
  }

  // {current, best, ao5, ao12, mean}: numbers in ms, Infinity for DNF, null when not enough solves.
  // mean is the mean of all non-DNF solves.
  function computeStats(list) {
    var finite = list.map(effective).filter(function (t) { return t !== Infinity; });
    var sum = 0;
    for (var i = 0; i < finite.length; i++) sum += finite[i];
    return {
      current: list.length ? effective(list[list.length - 1]) : null,
      best: finite.length ? Math.min.apply(null, finite) : (list.length ? Infinity : null),
      ao5: averageOf(list, 5),
      ao12: averageOf(list, 12),
      mean: finite.length ? sum / finite.length : (list.length ? Infinity : null)
    };
  }

  // ---------- session store ----------

  function defaultStorage() {
    try { return root.localStorage || null; } catch (e) { return null; }
  }

  // Session of solves, oldest first. storage: object with getItem/setItem (default localStorage).
  function createSession(opts) {
    opts = opts || {};
    var storage = opts.storage !== undefined ? opts.storage : defaultStorage();
    var key = opts.key || STORAGE_KEY;
    var list = [];

    try {
      var raw = storage && storage.getItem(key);
      var parsed = raw ? JSON.parse(raw) : [];
      if (Array.isArray(parsed)) list = parsed;
    } catch (e) { list = []; }

    function save() {
      try { if (storage) storage.setItem(key, JSON.stringify(list)); } catch (e) { /* ignore */ }
    }

    return {
      list: function () { return list.slice(); },
      add: function (entry) {
        var e = {
          time: entry.time, penalty: entry.penalty || 'none',
          scramble: entry.scramble || '', date: entry.date || Date.now()
        };
        if (entry.race) e.race = true;   // Feature 6: solved against the ghost
        list.push(e);
        save();
        return list.length - 1;
      },
      togglePlus2: function (i) {
        if (!list[i]) return;
        list[i].penalty = list[i].penalty === '+2' ? 'none' : '+2';
        save();
      },
      toggleDNF: function (i) {
        if (!list[i]) return;
        list[i].penalty = list[i].penalty === 'DNF' ? 'none' : 'DNF';
        save();
      },
      remove: function (i) {
        if (!list[i]) return;
        list.splice(i, 1);
        save();
      },
      stats: function () { return computeStats(list); }
    };
  }

  // ---------- timer state machine ----------
  // States: idle, inspecting, holding, ready, running, stopped.
  // press()/release() are space down/up. tick() advances time-based transitions
  // (holding -> ready, inspection running past 17 s) and should be called every frame.
  // opts: { now, session, inspection, race, onChange(state), onResult(entry, index) }.
  // Race mode (Feature 6): the attempt is marked as a race when it starts, its entry gets race: true,
  // and the cube becoming solved doesn't stop it (the ghost solves the digital cube); space does.
  function createTimer(opts) {
    opts = opts || {};
    var now = opts.now || function () { return root.performance ? root.performance.now() : Date.now(); };
    var session = opts.session || createSession({ storage: null });
    var t = {
      state: 'idle',
      inspection: !!opts.inspection,
      race: !!opts.race,
      scramble: '',
      startAt: 0, holdAt: 0, inspectAt: 0,
      penalty: 'none',     // inspection penalty for the solve about to start / running
      lastTime: 0,         // last displayed result in ms
      session: session
    };
    var inspectingBeforeHold = false;
    var rest = 'idle'; // state to return to when a hold or inspection is cancelled
    var raceRun = false; // the current / last attempt is a race

    function set(state) {
      if (t.state === state) return;
      t.state = state;
      if (opts.onChange) opts.onChange(state);
    }

    function inspectionPenalty(at) {
      var used = at - t.inspectAt;
      if (used > INSPECT_DNF_MS) return 'DNF';
      if (used > INSPECT_MS) return '+2';
      return 'none';
    }

    function record(time, penalty) {
      t.lastTime = time;
      var entry = { time: time, penalty: penalty, scramble: t.scramble, date: Date.now() };
      if (raceRun) entry.race = true;
      var index = session.add(entry);
      rest = 'stopped';
      set('stopped');
      if (opts.onResult) opts.onResult(entry, index);
    }

    t.press = function () {
      if (t.state === 'running') { t.stop('space'); return; }
      if (t.state === 'idle' || t.state === 'stopped') {
        raceRun = t.race;
        if (t.inspection) {
          t.inspectAt = now();
          inspectingBeforeHold = false;
          set('inspecting');
          return;
        }
        inspectingBeforeHold = false;
        t.holdAt = now();
        set('holding');
        return;
      }
      if (t.state === 'inspecting') {
        inspectingBeforeHold = true;
        t.holdAt = now();
        set('holding');
      }
    };

    t.release = function () {
      t.tick();
      if (t.state === 'ready') {
        t.startAt = now();
        t.penalty = inspectingBeforeHold ? inspectionPenalty(t.startAt) : 'none';
        set('running');
      } else if (t.state === 'holding') {
        set(inspectingBeforeHold ? 'inspecting' : rest); // released before green: cancel
      }
    };

    t.tick = function () {
      var at = now();
      if (t.state === 'holding' && at - t.holdAt >= HOLD_MS) set('ready');
      if ((t.state === 'inspecting' || ((t.state === 'holding' || t.state === 'ready') && inspectingBeforeHold)) &&
          at - t.inspectAt > INSPECT_DNF_MS) {
        inspectingBeforeHold = false;
        record(0, 'DNF'); // inspection ran out
      }
    };

    // reason: 'solved' | 'space' | 'escape' (escape = DNF). Escape outside a solve cancels.
    t.stop = function (reason) {
      if (t.state !== 'running') {
        if (reason === 'escape' && (t.state === 'inspecting' || t.state === 'holding' || t.state === 'ready')) {
          inspectingBeforeHold = false;
          set(rest);
        }
        return;
      }
      var time = Math.max(0, now() - t.startAt);
      record(time, reason === 'escape' ? 'DNF' : t.penalty);
    };

    t.notifySolved = function () { if (!raceRun) t.stop('solved'); };

    // Elapsed ms for display (running), or the last result.
    t.elapsed = function () {
      if (t.state === 'running') return now() - t.startAt;
      if (t.state === 'holding' || t.state === 'ready') return 0;
      return t.lastTime;
    };

    // Inspection ms used so far (only meaningful while inspecting/holding after inspection).
    t.inspectionUsed = function () { return now() - t.inspectAt; };
    t.isInspecting = function () {
      return t.state === 'inspecting' || ((t.state === 'holding' || t.state === 'ready') && inspectingBeforeHold);
    };
    t.isRunning = function () { return t.state === 'running'; };
    t.setInspection = function (on) { t.inspection = !!on; };
    t.setRace = function (on) { t.race = !!on; };
    t.isRace = function () { return raceRun; };   // the current (or last) attempt is a race
    t.setScramble = function (s) { t.scramble = s; };

    return t;
  }

  // ---------- scramble of a loaded cube (Feature 4 "Loading") ----------
  // createLoadScramble({ compute(state, cb(err, {text})), currentState(), panel }) returns
  // load(state): shows a "working" note, then the computed scramble as the timer scramble (panel is
  // the object mount() returns). A solved cube gets no scramble. A result is dropped when a newer load
  // superseded it or the cube no longer matches the loaded state.
  var WORKING = 'Working out the scramble…';
  function createLoadScramble(o) {
    var id = 0;
    return function load(state) {
      var my = ++id;
      if (Cube.isSolved(state)) { o.panel.setScramble(''); return; }
      o.panel.setScramble('', WORKING);
      o.compute(state, function (err, res) {
        if (my !== id) return;
        if (err || !res || !Cube.isEqual(state, o.currentState())) {
          if (o.panel.scrambleWorking()) o.panel.setScramble('');
          return;
        }
        o.panel.setScramble(res.text);
      });
    };
  }

  // ---------- UI (browser only) ----------

  var CSS = [
    '.tm-root{font-family:system-ui,sans-serif;color:#ddd;display:flex;flex-direction:column;gap:6px;max-width:340px}',
    '.tm-scramble{font-family:ui-monospace,Consolas,monospace;font-size:14px;line-height:1.4;word-spacing:3px}',
    '.tm-digits{font-family:ui-monospace,Consolas,monospace;font-size:56px;font-weight:600;line-height:1.1;color:#eee;user-select:none}',
    '.tm-digits.tm-holding{color:#e53935}',
    '.tm-digits.tm-ready{color:#43a047}',
    '.tm-digits.tm-inspecting{color:#fbc02d}',
    '.tm-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap;font-size:13px}',
    '.tm-root button{background:#333;color:#ddd;border:1px solid #555;border-radius:4px;padding:2px 8px;font-size:12px;cursor:pointer}',
    '.tm-root button:hover{background:#444}',
    '.tm-root button:disabled{opacity:.4;cursor:default}',
    '.tm-stats{font-size:13px;color:#bbb}',
    '.tm-list{list-style:none;margin:0;padding:0;max-height:240px;overflow-y:auto;font-size:13px}',
    '.tm-list li{padding:4px 0;border-top:1px solid #333}',
    '.tm-list .tm-time{display:inline-block;min-width:90px;font-family:ui-monospace,Consolas,monospace}',
    '.tm-list .tm-scr{display:block;color:#888;font-size:11px;font-family:ui-monospace,Consolas,monospace}',
    '.tm-list button.tm-on{background:#7a2b2b;border-color:#a44}',
    '.tm-list .tm-tag{color:#8ab4f8;font-size:11px;margin-right:6px}',
    '.tm-root input[type=number]{width:60px;background:#222;color:#ddd;border:1px solid #555;border-radius:4px;padding:1px 4px;font:inherit}',
    '.tm-note{font-size:12px;color:#aaa}',
    '.tm-race{font-size:14px;color:#ffd54f;min-height:0}'
  ].join('\n');

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  // Button that never keeps focus, so a later Space can't activate it.
  function button(text, onClick) {
    var b = el('button', '', text);
    b.type = 'button';
    b.tabIndex = -1;
    b.addEventListener('mousedown', function (e) { e.preventDefault(); }); // don't take focus
    b.addEventListener('click', function () { b.blur(); onClick(); });
    return b;
  }

  // mount(container, hooks) renders the timer UI.
  // hooks.applyScramble(moves)  - called with an array of move names to apply to the cube.
  // hooks.onRunningChange(bool) - called when timing starts (true) and stops (false).
  // hooks.onActiveChange(bool)  - true while inspecting, holding space or running; false when idle/stopped.
  // hooks.storage               - optional storage override (default localStorage).
  // Race mode (Feature 6), all optional:
  // hooks.raceBlocked()         - message when a race can't start (cube already solved), else null.
  // hooks.raceArm()             - a race attempt began (inspection or space hold): prepare the ghost.
  // hooks.raceStart(targetMs)   - the timer started: start the ghost.
  // hooks.raceCancel()          - the attempt ended before the timer started.
  // Returns { timer, session, keyDown(e), keyUp(e), notifySolved(), newScramble(), isRunning(),
  //   ghostFinished(ms), raceMessage(text), setGhostBusy(bool), setScramble(text, note), scrambleWorking() }.
  // setScramble shows and saves a scramble without applying it (a loaded cube's computed scramble);
  // with a note, the note is shown until the next setScramble or newScramble.
  function mount(container, hooks) {
    hooks = hooks || {};
    if (!document.getElementById('tm-style')) {
      var style = el('style');
      style.id = 'tm-style';
      style.textContent = CSS;
      document.head.appendChild(style);
    }

    var session = createSession(hooks.storage !== undefined ? { storage: hooks.storage } : {});
    var wasRunning = false;
    var wasActive = false;
    var rafId = 0;

    var rootEl = el('div', 'tm-root');
    var scrambleEl = el('div', 'tm-scramble');
    var digits = el('div', 'tm-digits', '0.00');
    var controls = el('div', 'tm-row');
    var inspLabel = el('label');
    var inspBox = el('input');
    inspBox.type = 'checkbox';
    inspBox.tabIndex = -1;
    inspLabel.appendChild(inspBox);
    inspLabel.appendChild(document.createTextNode(' Inspection (15 s)'));
    var newBtn = button('New scramble', function () { newScramble(); });
    var raceLabel = el('label');
    var raceBox = el('input');
    raceBox.type = 'checkbox';
    raceBox.tabIndex = -1;
    raceLabel.appendChild(raceBox);
    raceLabel.appendChild(document.createTextNode(' Race'));
    controls.appendChild(newBtn);
    controls.appendChild(inspLabel);
    controls.appendChild(raceLabel);
    // Race settings row: ghost target in seconds, or the session PB.
    var raceRow = el('div', 'tm-row');
    var targetIn = el('input');
    targetIn.type = 'number';
    targetIn.min = '1';
    targetIn.step = '0.5';
    targetIn.tabIndex = -1;
    var pbLabel = el('label');
    var pbBox = el('input');
    pbBox.type = 'checkbox';
    pbBox.tabIndex = -1;
    pbLabel.appendChild(pbBox);
    pbLabel.appendChild(document.createTextNode(' Use my PB'));
    raceRow.appendChild(document.createTextNode('Ghost target '));
    raceRow.appendChild(targetIn);
    raceRow.appendChild(document.createTextNode(' s'));
    raceRow.appendChild(pbLabel);
    var raceNote = el('div', 'tm-note');
    var raceEl = el('div', 'tm-race');
    var statsEl = el('div', 'tm-stats');
    var listEl = el('ul', 'tm-list');
    rootEl.appendChild(scrambleEl);
    rootEl.appendChild(digits);
    rootEl.appendChild(controls);
    rootEl.appendChild(raceRow);
    rootEl.appendChild(raceNote);
    rootEl.appendChild(raceEl);
    rootEl.appendChild(statsEl);
    rootEl.appendChild(listEl);
    container.appendChild(rootEl);

    var Race = root.Race || (typeof module !== 'undefined' && module.exports ? require('./race.js') : null);
    var raceStore = hooks.storage !== undefined ? hooks.storage : undefined;
    var raceSet = Race.loadSettings(raceStore);
    var race = null;          // { user: entry | null, ghost: ms | null, msg } for the current / last race
    var ghostBusy = false;    // the ghost is still solving the digital cube
    var prevState = 'idle';

    var timer = createTimer({
      session: session,
      race: raceSet.on,
      onChange: function (state) { onState(prevState, state); prevState = state; render(); loop(); },
      onResult: function (entry) {
        if (entry.race && race) { race.user = entry; renderRace(); }
        renderSession(); newScramble();
      }
    });

    function isActive(s) { return s !== 'idle' && s !== 'stopped'; }
    function onState(prev, state) {
      if (!timer.isRace()) return;
      if (!isActive(prev) && isActive(state)) {
        race = { user: null, ghost: null, msg: '' };
        renderRace();
        if (hooks.raceArm) hooks.raceArm();
      }
      if (state === 'running' && hooks.raceStart) hooks.raceStart(Race.target(raceSet, session.list()).ms);
      if (isActive(prev) && prev !== 'running' && !isActive(state) && hooks.raceCancel) hooks.raceCancel();
    }

    inspBox.addEventListener('change', function () {
      inspBox.blur();
      timer.setInspection(inspBox.checked);
    });

    raceBox.checked = raceSet.on;
    pbBox.checked = raceSet.usePB;
    targetIn.value = String(raceSet.target / 1000);
    function saveRace() { Race.saveSettings(raceSet, raceStore); renderRaceSettings(); }
    raceBox.addEventListener('change', function () {
      raceBox.blur();
      raceSet.on = !!raceBox.checked;
      timer.setRace(raceSet.on);
      if (!raceSet.on) { race = null; renderRace(); }
      saveRace();
    });
    pbBox.addEventListener('change', function () { pbBox.blur(); raceSet.usePB = !!pbBox.checked; saveRace(); });
    targetIn.addEventListener('change', function () {
      var v = parseFloat(targetIn.value);
      if (v > 0) raceSet.target = Math.round(v * 1000);
      targetIn.value = String(raceSet.target / 1000);
      targetIn.blur();
      saveRace();
    });

    function renderRaceSettings() {
      raceRow.style.display = raceSet.on ? '' : 'none';
      raceNote.style.display = raceSet.on ? '' : 'none';
      var tg = Race.target(raceSet, session.list());
      raceNote.textContent = tg.note || ('Ghost target: ' + formatTime(tg.ms) + ' s.');
    }
    function renderRace() {
      raceEl.style.display = race ? '' : 'none';
      if (!race) { raceEl.textContent = ''; return; }
      raceEl.textContent = race.msg || Race.result(race.user, race.ghost).text;
      if (race.cap) raceEl.textContent += '  ' + race.cap;
    }
    function newScramble() {
      if (timer.isRunning()) return;
      var moves = Cube.randomScramble(20, { half: true });
      showScramble(moves.join(' '));
      if (hooks.applyScramble) hooks.applyScramble(moves);
    }
    // The scramble saved with the next solve, and the text shown for it (note: shown instead while
    // the scramble is still being worked out).
    var scrambleNote = '';
    function showScramble(text, note) {
      timer.setScramble(text);
      scrambleNote = note || '';
      scrambleEl.textContent = scrambleNote || text;
    }

    function render() {
      var s = timer.state;
      var cls = 'tm-digits';
      if (s === 'holding') cls += ' tm-holding';
      else if (s === 'ready') cls += ' tm-ready';
      else if (s === 'inspecting') cls += ' tm-inspecting';
      digits.className = cls;

      if (s === 'inspecting') {
        var used = timer.inspectionUsed();
        digits.textContent = used > INSPECT_MS ? (used > INSPECT_DNF_MS ? 'DNF' : '+2')
          : String(Math.ceil((INSPECT_MS - used) / 1000));
      } else if (s === 'stopped') {
        var last = session.list();
        digits.textContent = last.length ? formatEntry(last[last.length - 1]) : formatTime(timer.lastTime);
      } else {
        digits.textContent = formatTime(timer.elapsed());
      }

      newBtn.disabled = timer.isRunning() || ghostBusy;
      inspBox.disabled = (s !== 'idle' && s !== 'stopped') || ghostBusy;
      raceBox.disabled = pbBox.disabled = targetIn.disabled = inspBox.disabled;

      var running = timer.isRunning();
      if (running !== wasRunning) {
        wasRunning = running;
        if (hooks.onRunningChange) hooks.onRunningChange(running);
      }
      var active = s !== 'idle' && s !== 'stopped';
      if (active !== wasActive) {
        wasActive = active;
        if (hooks.onActiveChange) hooks.onActiveChange(active);
      }
    }

    // Animate digits while a time-based state is active.
    function loop() {
      if (rafId) return;
      var active = { holding: 1, ready: 1, running: 1, inspecting: 1 };
      function frame() {
        rafId = 0;
        timer.tick();
        render();
        if (active[timer.state]) rafId = requestAnimationFrame(frame);
      }
      if (active[timer.state]) rafId = requestAnimationFrame(frame);
    }

    function renderSession() {
      var list = session.list();
      var st = session.stats();
      statsEl.textContent = 'current: ' + formatTime(st.current) + '   best: ' + formatTime(st.best) +
        '   ao5: ' + formatTime(st.ao5) + '   ao12: ' + formatTime(st.ao12) + '   mean: ' + formatTime(st.mean) +
        '   (' + list.length + ')';
      listEl.textContent = '';
      renderRaceSettings();   // the PB may have changed
      for (var i = list.length - 1; i >= 0; i--) {
        (function (i, entry) {
          var li = el('li');
          li.appendChild(el('span', 'tm-time', (i + 1) + '. ' + formatEntry(entry)));
          if (entry.race) li.appendChild(el('span', 'tm-tag', 'race'));
          var p2 = button('+2', function () { session.togglePlus2(i); renderSession(); render(); });
          var dnf = button('DNF', function () { session.toggleDNF(i); renderSession(); render(); });
          var del = button('delete', function () { session.remove(i); renderSession(); render(); });
          if (entry.penalty === '+2') p2.className = 'tm-on';
          if (entry.penalty === 'DNF') dnf.className = 'tm-on';
          li.appendChild(p2);
          li.appendChild(document.createTextNode(' '));
          li.appendChild(dnf);
          li.appendChild(document.createTextNode(' '));
          li.appendChild(del);
          li.appendChild(el('span', 'tm-scr', entry.scramble));
          listEl.appendChild(li);
        })(i, list[i]);
      }
    }

    function isSpace(e) { return e.code === 'Space' || e.key === ' '; }

    // Integrator calls these from window keydown/keyup listeners. Return true when handled.
    function keyDown(e) {
      if (isSpace(e)) {
        e.preventDefault();
        if (document.activeElement && document.activeElement.blur && document.activeElement !== document.body) {
          document.activeElement.blur();
        }
        if (e.repeat) return true;
        if (raceSet.on && !isActive(timer.state) && hooks.raceBlocked) {
          var msg = hooks.raceBlocked();
          if (msg) { race = { user: null, ghost: null, msg: msg }; renderRace(); return true; }
        }
        timer.press();
        return true;
      }
      if (e.key === 'Escape' && timer.state !== 'idle' && timer.state !== 'stopped') {
        e.preventDefault();
        timer.stop('escape');
        return true;
      }
      return false;
    }

    function keyUp(e) {
      if (isSpace(e)) {
        e.preventDefault();
        timer.release();
        return true;
      }
      return false;
    }

    newScramble();
    renderSession();
    renderRace();
    render();

    return {
      timer: timer,
      session: session,
      keyDown: keyDown,
      keyUp: keyUp,
      notifySolved: function () { timer.notifySolved(); },
      newScramble: newScramble,
      isRunning: function () { return timer.isRunning(); },
      // The ghost finished the digital cube in ms (from the timer's start).
      ghostFinished: function (ms) { if (race) { race.ghost = ms; renderRace(); } },
      // A note on the current race, e.g. the target is faster than the animation allows.
      raceMessage: function (text) { if (race) { race.cap = text; renderRace(); } },
      setGhostBusy: function (on) { ghostBusy = !!on; render(); },
      setScramble: showScramble,
      scrambleWorking: function () { return !!scrambleNote; },
      raceSettings: function () { return { on: raceSet.on, target: raceSet.target, usePB: raceSet.usePB }; }
    };
  }

  var Timer = {
    HOLD_MS: HOLD_MS, INSPECT_MS: INSPECT_MS, INSPECT_DNF_MS: INSPECT_DNF_MS, STORAGE_KEY: STORAGE_KEY,
    CSS: CSS,
    formatTime: formatTime, formatEntry: formatEntry, effective: effective,
    averageOf: averageOf, computeStats: computeStats,
    createSession: createSession, createTimer: createTimer,
    createLoadScramble: createLoadScramble, WORKING: WORKING,
    mount: mount
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = Timer;
  else root.Timer = Timer;
})(typeof window !== 'undefined' ? window : this);
