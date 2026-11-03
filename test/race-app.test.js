// Run: node test/race-app.test.js
// Feature 6 race end and hint availability through the real app.js wiring: the page's modules
// (core, timer, race, keymap, solver, baseline, app) run in a sandbox with a fake DOM, a fake
// clock and a fake 3D view (CubeView). Covers: stopping first freezes the ghost (no ghost moves
// after the stop, nothing queued, result against the scheduled finish); Escape freezes it and saves
// a DNF; the ghost finishing first is unchanged; hints are off for the whole race but work during a
// normal timed solve; controls come back after each kind of race end.
var fs = require('fs');
var path = require('path');
var vm = require('vm');

var pass = 0, fail = 0;
function check(name, ok, info) {
  if (ok) pass++;
  else { fail++; console.log('FAIL: ' + name + (info !== undefined ? ' -- ' + info : '')); }
}

// ---- fake DOM ----
var byId = {};
function Elem(tag) {
  this.tagName = tag.toUpperCase(); this.children = []; this.listeners = {}; this.style = {};
  this.className = ''; this._text = ''; this.disabled = false; this.parentNode = null;
  var self = this;
  this.classList = { toggle: function (c, on) {
    var cls = self.className.split(' ').filter(function (x) { return x && x !== c; });
    if (on) cls.push(c);
    self.className = cls.join(' ');
  } };
}
Object.defineProperty(Elem.prototype, 'textContent', {
  get: function () { return this._text + this.children.map(function (c) { return c.textContent; }).join(''); },
  set: function (v) { this._text = String(v); this.children = []; }
});
Object.defineProperty(Elem.prototype, 'id', {
  get: function () { return this._id; }, set: function (v) { this._id = v; byId[v] = this; }
});
Elem.prototype.appendChild = function (c) { c.parentNode = this; this.children.push(c); return c; };
Elem.prototype.addEventListener = function (t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); };
Elem.prototype.setAttribute = function () {};
Elem.prototype.blur = function () { if (document.activeElement === this) document.activeElement = document.body; };
Elem.prototype.focus = function () { document.activeElement = this; };
Elem.prototype.fire = function (t, ev) {
  ev = ev || {}; ev.preventDefault = function () {};
  (this.listeners[t] || []).forEach(function (f) { f(ev); });
};
Elem.prototype.click = function () { if (!this.disabled) { this.fire('mousedown'); this.fire('click'); } };
function TextNode(t) { this.textContent = t; this.children = []; }
function walk(el, fn) { fn(el); (el.children || []).forEach(function (c) { walk(c, fn); }); }
function find(el, pred) { var out = []; walk(el, function (e) { if (pred(e)) out.push(e); }); return out; }

var document = {
  head: new Elem('head'), body: new Elem('body'), activeElement: null,
  createElement: function (t) { return new Elem(t); },
  createTextNode: function (t) { return new TextNode(t); },
  getElementById: function (id) { return byId[id] || null; }
};
document.activeElement = document.body;
['scramble', 'solve', 'reset', 'hintsBtn', 'tabCube', 'tabAlgs', 'tabScan'].forEach(function (id) {
  var b = new Elem('button'); b.id = id;
});
['hints', 'algs', 'scan', 'cube', 'solved', 'help', 'timer', 'src-core', 'src-solver', 'src-twophase'].forEach(function (id) {
  var d = new Elem('div'); d.id = id;
});

// ---- fake clock, rAF, timers ----
var clock = 1e6;
var rafQ = [], timeouts = [], nextTimeout = 1;
function setTimeoutF(f, ms) { var id = nextTimeout++; timeouts.push({ id: id, at: clock + (ms || 0), f: f }); return id; }
function clearTimeoutF(id) { timeouts = timeouts.filter(function (t) { return t.id !== id; }); }
var view = null;
function frame() {
  var due = timeouts.filter(function (t) { return t.at <= clock; });
  timeouts = timeouts.filter(function (t) { return t.at > clock; });
  due.forEach(function (t) { t.f(); });
  var q = rafQ; rafQ = [];
  q.forEach(function (f) { f(clock); });
  if (view) view.step(clock);
}
function advance(ms) {
  var end = clock + ms;
  frame();
  while (clock < end) { clock = Math.min(end, clock + 16); frame(); }
}

// ---- fake 3D view: a timed move queue like view3d.js, without Three.js ----
var Cube = require('../src/core.js');
var enqueued = [];   // every move handed to the view: { move, fast, dur, at }
function createCubeView() {
  var state = Cube.solvedState(), queue = [], current = null;
  view = {
    onMoveDone: null,
    setState: function (s) { state = s.slice(); queue = []; current = null; },
    getState: function () { return state.slice(); },
    enqueue: function (moves, o) {
      var list = (typeof moves === 'object' && !Array.isArray(moves)) ? [moves] : moves;
      Cube.parseAlg(list).forEach(function (m) {
        var dur = (o && o.duration > 0) ? o.duration : (o && o.fast ? 40 : 160);
        queue.push({ move: m, dur: dur });
        enqueued.push({ move: m.name, fast: !!(o && o.fast), dur: dur, at: clock });
      });
    },
    isIdle: function () { return !current && queue.length === 0; },
    clearQueue: function () { queue = []; },
    currentMove: function () { return current ? current.move : null; },
    queueLength: function () { return queue.length; },
    highlightLayer: function () {}, setFocus: function () {}, setArrow: function () {},
    step: function (now) {
      if (!current && queue.length) { var it = queue.shift(); current = { move: it.move, start: now, dur: it.dur }; }
      while (current && now - current.start >= current.dur) {
        var done = current;
        state = Cube.applyMove(state, done.move);
        current = null;
        if (view.onMoveDone) view.onMoveDone(done.move, state.slice());
        if (queue.length) { var n = queue.shift(); current = { move: n.move, start: done.start + done.dur, dur: n.dur }; }
      }
    }
  };
  return view;
}

// ---- window ----
var winListeners = { capture: {}, bubble: {} };
var storageData = {};
var sandbox = {
  document: document,
  performance: { now: function () { return clock; } },
  requestAnimationFrame: function (f) { rafQ.push(f); return rafQ.length; },
  setTimeout: setTimeoutF, clearTimeout: clearTimeoutF,
  localStorage: {
    getItem: function (k) { return Object.prototype.hasOwnProperty.call(storageData, k) ? storageData[k] : null; },
    setItem: function (k, v) { storageData[k] = String(v); }
  },
  addEventListener: function (t, f, cap) { var m = cap ? winListeners.capture : winListeners.bubble; (m[t] = m[t] || []).push(f); },
  CubeView: { createCubeView: createCubeView },
  AlgTab: { mount: function () { return {}; } },
  ScanTab: { mount: function () { return { show: function () {}, hide: function () {} }; } },
  console: console, Math: Math, Date: { now: function () { return clock; } }, JSON: JSON
};
sandbox.window = sandbox; sandbox.self = sandbox;
// Race on, 20 s target, before the page loads.
storageData['rubiks-race-settings'] = JSON.stringify({ on: true, target: 20000, usePB: false });
vm.createContext(sandbox);
['core', 'timer', 'race', 'keymap', 'solver', 'baseline', 'app'].forEach(function (n) {
  var file = path.join(__dirname, '..', 'src', n + '.js');
  vm.runInContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: file });
});

function dispatch(type, ev) {
  ev.target = ev.target || document.body;
  ev.preventDefault = function () {};
  ev.stopPropagation = function () {};
  (winListeners.capture[type] || []).forEach(function (f) { f(ev); });
  (winListeners.bubble[type] || []).forEach(function (f) { f(ev); });
}
function space(type) { dispatch(type, { code: 'Space', key: ' ' }); }
function key(k) { dispatch('keydown', { code: 'Key' + k.toUpperCase(), key: k }); dispatch('keyup', { code: 'Key' + k.toUpperCase(), key: k }); }
function escape() { dispatch('keydown', { code: 'Escape', key: 'Escape' }); }
function startSolve() { space('keydown'); advance(320); space('keyup'); }
function stopSolve() { space('keydown'); space('keyup'); }
function waitIdle() { var n = 0; while ((!app.isIdle() || timeouts.length) && n++ < 2000) advance(16); }

var page = sandbox.rubiksApp, app = page.app, ui = page.timer;
var timerEl = byId.timer, hintsEl = byId.hints, hintsBtn = byId.hintsBtn;
function raceText() { return find(timerEl, function (e) { return e.className === 'tm-race'; })[0].textContent; }
function inputs() { return find(timerEl, function (e) { return e.tagName === 'INPUT'; }); }
function ghostMovesSince(t) { return enqueued.filter(function (e) { return !e.fast && e.at >= t; }).length; }
function controls() {
  return { scramble: byId.scramble.disabled, solve: byId.solve.disabled, reset: byId.reset.disabled,
    hints: hintsBtn.disabled, algs: byId.tabAlgs.disabled, scan: byId.tabScan.disabled, keys: byId.keysBtn.disabled };
}
function allEnabled() { var c = controls(); return Object.keys(c).every(function (k) { return !c[k]; }); }
function lastEntry() { var l = ui.session.list(); return l[l.length - 1]; }

waitIdle();
check('setup: race mode on with a 20 s target', ui.timer.race === true && ui.raceSettings().target === 20000);
check('setup: the scramble is on the cube', !Cube.isSolved(app.getState()) && app.isIdle());
check('setup: everything enabled before a race', allEnabled(), JSON.stringify(controls()));

// ---- 1. Race, stop first: the ghost freezes where it is ----
startSolve();
check('stop first: timer running, ghost started', ui.timer.state === 'running');
advance(3000);
var playedBefore = ghostMovesSince(0);
check('stop first: the ghost played moves in 3 s', playedBefore > 0, playedBefore);
check('stop first: controls disabled while racing', !Object.keys(controls()).some(function (k) { return !controls()[k]; }), JSON.stringify(controls()));
var tStop = clock;
stopSolve();
check('stop first: space stops my timer at once', ui.timer.state === 'stopped' && Math.abs(lastEntry().time - 3000) < 40, lastEntry().time);
check('stop first: saved as a race solve', lastEntry().race === true && lastEntry().penalty === 'none');
check('stop first: nothing queued after the stop (only the turn in motion)', app.view.queueLength() === 0);
check('stop first: queued state = state after the turn in motion',
  Cube.isEqual(app.getQueuedState(), app.view.currentMove() ? Cube.applyMove(app.getState(), app.view.currentMove()) : app.getState()));
check('stop first: result against the scheduled finish',
  /^You 3\.0\d  ·  Ghost would have finished at (19\.99|20\.00)  ·  You won by 1\d\.\d\d s\.$/.test(raceText()), raceText());
check('stop first: controls enabled again', allEnabled(), JSON.stringify(controls()));
advance(300);
var frozen = app.getState();
check('stop first: the cube is idle and mid-solve, not solved', app.isIdle() && !Cube.isSolved(frozen));
check('stop first: "Solved" label hidden', byId.solved.style.display === 'none');
advance(300);   // 600 ms after the stop, before the next scramble
check('stop first: no ghost moves after the stop', ghostMovesSince(tStop + 1) === 0, ghostMovesSince(tStop + 1));
check('stop first: the frozen cube stays as it was', Cube.isEqual(app.getState(), frozen));
advance(200);   // past the 700 ms post-solve delay
waitIdle();
check('stop first: the next timer scramble is applied after the delay',
  Cube.isEqual(app.getState(), Cube.applyAlg(Cube.solvedState(), ui.timer.scramble)));
advance(2000);
check('stop first: still no ghost moves 2 s later', ghostMovesSince(tStop + 1) === 0);

// ---- 2. Race, Escape: DNF and the ghost freezes ----
startSolve();
advance(2000);
var tEsc = clock, nEntries = ui.session.list().length;
escape();
check('escape: timer stopped as a DNF', ui.timer.state === 'stopped' && ui.session.list().length === nEntries + 1 &&
  lastEntry().penalty === 'DNF' && lastEntry().race === true, JSON.stringify(lastEntry()));
check('escape: result says DNF loses', /^You DNF\(2\.0\d\)  ·  Ghost would have finished at (19\.99|20\.00)  ·  DNF: ghost wins\.$/.test(raceText()), raceText());
check('escape: nothing queued', app.view.queueLength() === 0);
check('escape: controls enabled again', allEnabled(), JSON.stringify(controls()));
advance(300);
var frozen2 = app.getState();
check('escape: cube frozen mid-solve', app.isIdle() && !Cube.isSolved(frozen2));
advance(300);
check('escape: no ghost moves after Escape', ghostMovesSince(tEsc + 1) === 0);
check('escape: frozen cube unchanged', Cube.isEqual(app.getState(), frozen2));
advance(200); waitIdle();
check('escape: next scramble after the delay', Cube.isEqual(app.getState(), Cube.applyAlg(Cube.solvedState(), ui.timer.scramble)));

// ---- 3. Race, ghost first (5 s target): unchanged ----
var target = inputs()[2];
target.value = '5'; target.fire('change');
check('ghost first: target set to 5 s', ui.raceSettings().target === 5000);
startSolve();
var t0 = clock, n = 0;
while (raceText().indexOf('Ghost finished') < 0 && n++ < 1000) advance(16);
var gt = clock - t0;
check('ghost first: the ghost finishes in about 5 s', gt > 4800 && gt < 5400, gt);
check('ghost first: the cube is solved', Cube.isSolved(app.getState()) && app.isIdle());
check('ghost first: my timer keeps running', ui.timer.state === 'running');
check('ghost first: panel shows the ghost time', /^Ghost finished in 5\.\d\d\. Keep going!$/.test(raceText()), raceText());
check('ghost first: hints and controls still off while I solve', hintsBtn.disabled && byId.scramble.disabled && byId.tabAlgs.disabled);
advance(1500);
stopSolve();
check('ghost first: space stops my timer', ui.timer.state === 'stopped' && lastEntry().race === true && lastEntry().penalty === 'none');
check('ghost first: both times and the winner', /^You 6\.\d\d  ·  Ghost 5\.\d\d  ·  Ghost won by 1\.\d\d s\.$/.test(raceText()), raceText());
check('ghost first: controls enabled again', allEnabled(), JSON.stringify(controls()));
check('ghost first: solved cube shown with the "Solved" label', Cube.isSolved(app.getState()) && byId.solved.style.display === '');
advance(800); waitIdle();
check('ghost first: next scramble after the delay', Cube.isEqual(app.getState(), Cube.applyAlg(Cube.solvedState(), ui.timer.scramble)));

// ---- 4. Hints: off for the whole race, available in a normal timed solve ----
key('h');
check('hints: H toggles hints on when idle', hintsBtn.textContent === 'Hints: on' && hintsEl.style.display === '');
advance(50);
check('hints: shown with a stage', /Stage \d of 8/.test(hintsEl.textContent), hintsEl.textContent);
// Race with inspection: inspection, hold and solving all hide hints.
var insp = inputs()[0];
insp.checked = true; insp.fire('change');
space('keydown'); space('keyup');
check('race inspection: inspecting', ui.timer.state === 'inspecting');
check('race inspection: hints hidden and the button disabled', hintsEl.style.display === 'none' && hintsBtn.disabled);
key('h');
check('race inspection: H does nothing', hintsBtn.textContent === 'Hints: on');
space('keydown');
check('race hold: hints hidden', ui.timer.state === 'holding' && hintsEl.style.display === 'none' && hintsBtn.disabled);
advance(320); space('keyup');
check('race solving: hints hidden, button disabled', ui.timer.state === 'running' && hintsEl.style.display === 'none' && hintsBtn.disabled);
key('h'); hintsBtn.click();
check('race solving: H and the button do nothing', hintsBtn.textContent === 'Hints: on' && hintsEl.style.display === 'none');
advance(1000);
stopSolve();
check('race over: hints back', !hintsBtn.disabled && hintsEl.style.display === '' && allEnabled());
advance(800); waitIdle();

// Normal (non-race) timed solve with inspection.
var raceBox = inputs()[1];
raceBox.checked = false; raceBox.fire('change');
space('keydown'); space('keyup');
check('timed: inspecting, hints still shown', ui.timer.state === 'inspecting' && hintsEl.style.display === '' && !hintsBtn.disabled);
check('timed: Scramble/Solve/Reset, tabs and Keys disabled',
  byId.scramble.disabled && byId.solve.disabled && byId.reset.disabled && byId.tabAlgs.disabled && byId.tabScan.disabled && byId.keysBtn.disabled);
key('h');
check('timed inspection: H turns hints off', hintsBtn.textContent === 'Hints: off' && hintsEl.style.display === 'none');
space('keydown'); advance(320); space('keyup');
check('timed: running', ui.timer.state === 'running' && !ui.timer.isRace());
hintsBtn.click();
advance(50);
check('timed solving: the Hints button turns hints on and they show',
  hintsBtn.textContent === 'Hints: on' && hintsEl.style.display === '' && /Stage \d of 8/.test(hintsEl.textContent), hintsEl.textContent);
key('r');   // a cube key while timing: the hint updates
waitIdle(); advance(50);
check('timed solving: hints update after a move', /Stage \d of 8/.test(hintsEl.textContent) && !Cube.isSolved(app.getState()));
stopSolve();
check('timed: stopped, entry not a race', ui.timer.state === 'stopped' && !lastEntry().race);
check('timed: controls enabled again', allEnabled(), JSON.stringify(controls()));

console.log('race-app: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
