// Run: node test/acceptance-timer-ui.test.js
// Timer.mount() driven through a minimal fake DOM and a fake clock: hold < 0.3 s does not start,
// red -> green colors, release on green starts, solved stops, Space/keyup always preventDefault and
// blur a focused element, session list newest first, +2 / DNF / delete buttons update ao5/ao12 text,
// times survive a "reload" (second mount on the same storage).
var pass = 0, fail = 0;
function check(name, ok, info) {
  if (ok) pass++;
  else { fail++; console.log('FAIL: ' + name + (info !== undefined ? ' -- ' + info : '')); }
}

// ---- fake clock ----
var clock = 1e6;
Date.now = function () { return clock; };
var rafQ = [];
global.requestAnimationFrame = function (f) { rafQ.push(f); return rafQ.length; };
function advance(ms) {          // advance time in 16 ms frames, running rAF callbacks
  var end = clock + ms;
  while (clock < end) {
    clock = Math.min(end, clock + 16);
    var q = rafQ; rafQ = [];
    q.forEach(function (f) { f(clock); });
  }
}

// ---- fake DOM ----
function Elem(tag) {
  this.tagName = tag.toUpperCase(); this.children = []; this.listeners = {}; this.style = {};
  this.className = ''; this._text = ''; this.disabled = false; this.attrs = {}; this.parentNode = null;
}
Object.defineProperty(Elem.prototype, 'textContent', {
  get: function () { return this._text + this.children.map(function (c) { return c.textContent; }).join(''); },
  set: function (v) { this._text = String(v); this.children = []; }
});
Elem.prototype.appendChild = function (c) { c.parentNode = this; this.children.push(c); return c; };
Elem.prototype.addEventListener = function (t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); };
Elem.prototype.setAttribute = function (k, v) { this.attrs[k] = v; };
Elem.prototype.blur = function () { if (document.activeElement === this) document.activeElement = document.body; };
Elem.prototype.focus = function () { document.activeElement = this; };
Elem.prototype.fire = function (t, ev) {
  ev = ev || {}; ev.defaultPrevented = false; ev.preventDefault = function () { ev.defaultPrevented = true; };
  (this.listeners[t] || []).forEach(function (f) { f(ev); });
  return ev;
};
Elem.prototype.click = function () {   // mousedown (focus unless prevented) then click, like a real mouse click
  var md = this.fire('mousedown');
  if (!md.defaultPrevented) this.focus();
  this.fire('click');
};
function TextNode(t) { this.textContent = t; this.children = []; }
function walk(el, fn) { fn(el); (el.children || []).forEach(function (c) { walk(c, fn); }); }
function find(el, pred) { var out = []; walk(el, function (e) { if (pred(e)) out.push(e); }); return out; }

var byId = {};
global.document = {
  head: new Elem('head'), body: new Elem('body'), activeElement: null,
  createElement: function (t) { return new Elem(t); },
  createTextNode: function (t) { return new TextNode(t); },
  getElementById: function (id) { return byId[id] || find(document.head, function (e) { return e.id === id; })[0] || null; }
};
document.activeElement = document.body;

var T = require('../src/timer.js');
var C = require('../src/core.js');

function fakeStorage() {
  var data = {};
  return { data: data,
    getItem: function (k) { return Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null; },
    setItem: function (k, v) { data[k] = String(v); } };
}
function key(code, extra) { var e = { code: code, key: code === 'Space' ? ' ' : code }; for (var k in extra) e[k] = extra[k]; return e; }
function evt() { var e = key('Space'); e.defaultPrevented = false; e.preventDefault = function () { e.defaultPrevented = true; }; return e; }
function esc() { var e = { code: 'Escape', key: 'Escape', defaultPrevented: false }; e.preventDefault = function () { e.defaultPrevented = true; }; return e; }

var storage = fakeStorage();
var container = new Elem('div');
var applied = [], running = [], active = [];
var ui = T.mount(container, {
  storage: storage,
  applyScramble: function (m) { applied.push(m); },
  onRunningChange: function (r) { running.push(r); },
  onActiveChange: function (a) { active.push(a); }
});
var digits = find(container, function (e) { return /tm-digits/.test(e.className); })[0];
var scrEl = find(container, function (e) { return e.className === 'tm-scramble'; })[0];
var statsEl = find(container, function (e) { return e.className === 'tm-stats'; })[0];
var listEl = find(container, function (e) { return e.className === 'tm-list'; })[0];
var css = document.getElementById('tm-style').textContent;

check('style injected once', document.head.children.length === 1);
check('mount shows a 20-move scramble', scrEl.textContent.split(' ').length === 20, scrEl.textContent);
check('mount calls applyScramble with the shown moves', applied.length === 1 && applied[0].join(' ') === scrEl.textContent);
check('scramble parses', (function () { try { C.parseAlg(scrEl.textContent); return true; } catch (e) { return false; } })());
check('holding is red', /\.tm-digits\.tm-holding\{color:#e53935\}/.test(css));
check('ready is green', /\.tm-digits\.tm-ready\{color:#43a047\}/.test(css));
var allButtons = function () { return find(container, function (e) { return e.tagName === 'BUTTON'; }); };
check('every timer button has tabIndex -1', allButtons().every(function (b) { return b.tabIndex === -1; }));
check('inspection off by default', ui.timer.inspection === false);

// Space with a focused button: preventDefault on down+up, focus removed, button not clicked.
var newBtn = allButtons()[0];
var clicked = 0; newBtn.addEventListener('click', function () { clicked++; });
newBtn.focus();
var d = evt(); ui.keyDown(d);
check('space keydown preventDefault', d.defaultPrevented);
check('space keydown blurs the focused button', document.activeElement === document.body);
check('hold counts as active (onActiveChange(true))', active.join() === 'true', active.join());
check('space -> holding (red)', ui.timer.state === 'holding' && /tm-holding/.test(digits.className), digits.className);
advance(100);
var u = evt(); ui.keyUp(u);
check('space keyup preventDefault', u.defaultPrevented);
check('hold 100 ms then release cancels (idle)', ui.timer.state === 'idle', ui.timer.state);
check('focused button was never clicked by space', clicked === 0);
check('no result recorded on cancel', ui.session.list().length === 0);

// Hold 290 ms: still red, cancel.
ui.keyDown(evt()); advance(290);
check('290 ms still red', /tm-holding/.test(digits.className) && ui.timer.state === 'holding');
ui.keyUp(evt());
check('290 ms release cancels', ui.timer.state === 'idle' && running.length === 0);

// Held key auto-repeat must not restart the hold.
ui.keyDown(evt()); advance(200);
var rep = evt(); rep.repeat = true; ui.keyDown(rep); advance(150);
check('auto-repeat keydown does not reset hold (green at 350 ms)', ui.timer.state === 'ready' && /tm-ready/.test(digits.className), ui.timer.state);
check('digits 0.00 while green', digits.textContent === '0.00', digits.textContent);
ui.keyUp(evt());
check('release on green -> running', ui.timer.state === 'running');
check('onRunningChange(true)', running.join() === 'true');
advance(4310);
check('digits show elapsed with 0.01 s precision', /^4\.3\d$/.test(digits.textContent), digits.textContent);
var nApplied = applied.length;
ui.notifySolved();
check('solved stops the timer', ui.timer.state === 'stopped');
check('onRunningChange(false)', running.join() === 'true,false');
check('onActiveChange: true on each hold, false on cancel and on stop', active.join() === 'true,false,true,false,true,false', active.join());
check('recorded 4.31', T.formatEntry(ui.session.list()[0]) === '4.31', T.formatEntry(ui.session.list()[0]));
check('new scramble requested after the solve', applied.length === nApplied + 1);
check('result keeps the scramble it was timed on', ui.session.list()[0].scramble === applied[0].join(' '));

// Space stops too; Escape = DNF.
function solve(ms, how) {
  ui.keyDown(evt()); advance(320); ui.keyUp(evt()); advance(ms);
  if (how === 'space') { ui.keyDown(evt()); ui.keyUp(evt()); }
  else if (how === 'esc') { var e = esc(); ui.keyDown(e); return e; }
  else ui.notifySolved();
}
solve(5000, 'space');
check('space stops', ui.timer.state === 'stopped' && ui.session.list().length === 2);
check('release after the stopping press does not start a new hold', ui.timer.state === 'stopped');
var e = solve(6000, 'esc');
check('escape stops as DNF', ui.session.list()[2].penalty === 'DNF' && e.defaultPrevented);
check('escape while idle/stopped is ignored', (function () { var x = esc(); ui.keyDown(x); return !x.defaultPrevented && ui.session.list().length === 3; })());

// Two more -> 5 solves: 4.31, 5.00, DNF, 7.00, 8.00
solve(7000); solve(8000);
function lis() { return listEl.children; }
function statsText() { return statsEl.textContent; }
function stat(name) { var m = statsText().match(new RegExp(name + ': (\\S+)')); return m && m[1]; }
check('list newest first', /^5\. 8\.00/.test(lis()[0].children[0].textContent) && /^1\. 4\.31/.test(lis()[4].children[0].textContent),
  lis().map(function (li) { return li.children[0].textContent; }).join(' | '));
check('each row shows its scramble', lis().every(function (li) { return li.children.some(function (c) { return c.className === 'tm-scr' && c.textContent.split(' ').length === 20; }); }));
// ao5 of 4.31 5.00 DNF 7.00 8.00 -> drop 4.31 and DNF -> mean(5,7,8)=6.66
check('ao5 with one DNF', stat('ao5') === '6.66', statsText());
check('best', stat('best') === '4.31');
check('current', stat('current') === '8.00');
function rowButtons(rowFromTop) { return lis()[rowFromTop].children.filter(function (c) { return c.tagName === 'BUTTON'; }); }
// +2 on the 5.00 solve (row 4 from top = solve #2)
rowButtons(3)[0].click();
check('+2 button marks entry', ui.session.list()[1].penalty === '+2');
check('+2 updates ao5', stat('ao5') === '7.33', statsText());    // drop 4.31 and DNF -> (7+7+8)/3
check('+2 button keeps no focus', document.activeElement === document.body);
// DNF on 8.00 (top row) -> two DNFs -> ao5 DNF
rowButtons(0)[1].click();
check('two DNFs -> ao5 DNF', stat('ao5') === 'DNF', statsText());
rowButtons(0)[1].click();   // toggle back
check('DNF toggles off', stat('ao5') === '7.33', statsText());
// delete the DNF (solve #3 = row 2)
rowButtons(2)[2].click();
check('delete removes the row', lis().length === 4 && ui.session.list().every(function (x) { return x.penalty !== 'DNF'; }));
check('ao5 back to - with 4 solves', stat('ao5') === '-', statsText());
// ao12: add 8 more solves (12 total)
for (var i = 0; i < 8; i++) solve(10000 + i * 1000);
// times: 4.31, 7.00(+2), 7.00, 8.00, 10..17 -> drop 4.31 and 17 -> mean of 7,7,8,10,11,12,13,14,15,16 = 11.3
check('ao12 computed', stat('ao12') === '11.30', statsText());
rowButtons(0)[1].click(); // DNF the 17.00 -> one DNF counts as worst; same drop -> unchanged
check('ao12 one DNF', stat('ao12') === '11.30', statsText());
rowButtons(1)[1].click(); // DNF the 16.00 -> two DNFs in ao12: WCA ao12 drops only one -> DNF
check('ao12 two DNFs -> DNF', stat('ao12') === 'DNF', statsText());
rowButtons(1)[2].click(); // delete one DNF -> 11 solves
check('ao12 null after delete to 11', stat('ao12') === '-', statsText());

// Reload: second mount on the same storage shows the same list.
var before = JSON.stringify(ui.session.list());
var c2 = new Elem('div');
var ui2 = T.mount(c2, { storage: storage, applyScramble: function () {} });
check('times survive reload', JSON.stringify(ui2.session.list()) === before);
var list2 = find(c2, function (e) { return e.className === 'tm-list'; })[0];
check('reloaded list rendered', list2.children.length === 11);
check('stored under localStorage key', typeof storage.data[T.STORAGE_KEY] === 'string');

// Inspection via checkbox: space starts countdown, +2 over 15 s.
var box = find(c2, function (e) { return e.tagName === 'INPUT'; })[0];
box.checked = true; box.fire('change');
ui2.keyDown(evt()); ui2.keyUp(evt());
check('inspection countdown starts on space', ui2.timer.state === 'inspecting');
advance(15500);
ui2.keyDown(evt()); advance(320); ui2.keyUp(evt()); advance(3000); ui2.notifySolved();
var last = ui2.session.list()[ui2.session.list().length - 1];
check('inspection over 15 s = +2', last.penalty === '+2', JSON.stringify(last));

console.log('acceptance-timer-ui: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
