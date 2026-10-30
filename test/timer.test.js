// Run: node test/timer.test.js
var T = require('../src/timer.js');

var pass = 0, fail = 0;
function check(name, ok, info) {
  if (ok) pass++;
  else { fail++; console.log('FAIL: ' + name + (info !== undefined ? ' -- ' + info : '')); }
}

// Fake clock.
var clock = 0;
function now() { return clock; }
function wait(ms, timer) { clock += ms; if (timer) timer.tick(); }

function fakeStorage() {
  var data = {};
  return {
    data: data,
    getItem: function (k) { return Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null; },
    setItem: function (k, v) { data[k] = String(v); }
  };
}

function makeTimer(inspection) {
  var session = T.createSession({ storage: fakeStorage() });
  var results = [];
  var timer = T.createTimer({
    now: now, session: session, inspection: inspection,
    onResult: function (e) { results.push(e); }
  });
  timer.setScramble("R U R' U'");
  return { timer: timer, session: session, results: results };
}

// 1. Hold under 300 ms doesn't start.
(function () {
  var x = makeTimer(false), t = x.timer;
  t.press();
  check('press -> holding', t.state === 'holding', t.state);
  wait(200, t);
  check('still holding at 200 ms', t.state === 'holding', t.state);
  wait(99, t);
  t.release();
  check('release at 299 ms cancels to idle', t.state === 'idle', t.state);
  check('cancel records nothing', x.session.list().length === 0);
})();

// 2. Release on green starts; stop by space and by solved; escape = DNF.
(function () {
  var x = makeTimer(false), t = x.timer;
  t.press(); wait(300, t);
  check('green at 300 ms', t.state === 'ready', t.state);
  check('display 0 while ready', t.elapsed() === 0);
  t.release();
  check('release on green -> running', t.state === 'running', t.state);
  wait(12345, t);
  check('elapsed while running', t.elapsed() === 12345, t.elapsed());
  t.press(); // space stops
  check('space stops', t.state === 'stopped', t.state);
  check('recorded time', x.results.length === 1 && x.results[0].time === 12345 && x.results[0].penalty === 'none',
    JSON.stringify(x.results));
  check('scramble stored', x.results[0].scramble === "R U R' U'");
  t.release(); // the release of the stopping press does nothing
  check('release after stop stays stopped', t.state === 'stopped', t.state);

  t.press(); wait(100, t); t.release();
  check('cancel from stopped returns to stopped', t.state === 'stopped', t.state);

  t.press(); wait(400, t); t.release(); wait(9000, t);
  t.notifySolved();
  check('notifySolved stops', t.state === 'stopped' && x.results[1].time === 9000, t.state);
  t.notifySolved();
  check('notifySolved when not running is a no-op', x.results.length === 2);

  t.press(); wait(400, t); t.release(); wait(5000, t);
  t.stop('escape');
  check('escape = DNF', x.results[2].penalty === 'DNF' && x.results[2].time === 5000, JSON.stringify(x.results[2]));
  check('session has 3', x.session.list().length === 3);
})();

// 3. Inspection penalties.
function inspectRun(inspectMs) {
  var x = makeTimer(true), t = x.timer;
  t.press();
  var s1 = t.state;
  t.release(); // release of the starting press is ignored
  wait(inspectMs - 300, t);
  t.press(); wait(300, t); t.release();
  wait(10000, t);
  t.press();
  return { x: x, firstState: s1 };
}
(function () {
  var r = inspectRun(10000);
  check('inspection: press starts countdown', r.firstState === 'inspecting', r.firstState);
  check('inspection 10 s: no penalty', r.x.results[0].penalty === 'none', JSON.stringify(r.x.results));
  r = inspectRun(16000);
  check('inspection 16 s: +2', r.x.results[0].penalty === '+2', JSON.stringify(r.x.results));
  check('+2 effective', T.effective(r.x.results[0]) === 12000);
  r = inspectRun(15000);
  check('inspection exactly 15 s: no penalty', r.x.results[0].penalty === 'none', JSON.stringify(r.x.results));
  r = inspectRun(16900);
  check('inspection 16.9 s: +2', r.x.results[0].penalty === '+2', JSON.stringify(r.x.results));

  // Run out the clock: over 17 s with no start = DNF.
  var x = makeTimer(true), t = x.timer;
  t.press(); t.release();
  wait(17001, t);
  check('inspection over 17 s: DNF recorded', t.state === 'stopped' && x.results.length === 1 &&
    x.results[0].penalty === 'DNF', t.state + ' ' + JSON.stringify(x.results));

  // Holding during inspection past 17 s also DNFs.
  x = makeTimer(true); t = x.timer;
  t.press(); t.release(); wait(16900, t); t.press(); wait(200, t);
  check('hold past 17 s: DNF', t.state === 'stopped' && x.results[0].penalty === 'DNF', t.state);

  // Cancelled hold during inspection returns to inspecting.
  x = makeTimer(true); t = x.timer;
  t.press(); t.release(); wait(2000, t); t.press(); wait(100, t); t.release();
  check('short hold in inspection returns to inspecting', t.state === 'inspecting', t.state);
  t.stop('escape');
  check('escape during inspection cancels', t.state === 'idle' && x.results.length === 0, t.state);

  // Inspection off by default.
  t = T.createTimer({ now: now });
  check('inspection off by default', t.inspection === false);
})();

// 4. Stats, +2 / DNF / delete.
function sessionWith(times) {
  var s = T.createSession({ storage: fakeStorage() });
  times.forEach(function (ms) { s.add({ time: ms, scramble: 'x' }); });
  return s;
}
function near(a, b) { return Math.abs(a - b) < 1e-9; }
(function () {
  var s = sessionWith([10000, 12000, 11000, 9000, 13000]);
  var st = s.stats();
  check('ao5 drops best and worst', near(st.ao5, 11000), st.ao5);
  check('ao12 null with 5', st.ao12 === null);
  check('best', st.best === 9000);
  check('current', st.current === 13000);
  check('mean', near(st.mean, 11000), st.mean);

  s.togglePlus2(1); // 12000 -> 14000, becomes worst
  st = s.stats();
  check('+2 updates ao5', near(st.ao5, (10000 + 11000 + 13000) / 3), st.ao5);
  s.togglePlus2(1); // back
  check('+2 toggles off', near(s.stats().ao5, 11000));

  s.toggleDNF(3); // 9000 (best) -> DNF (worst)
  st = s.stats();
  check('one DNF in ao5 counts as worst', near(st.ao5, (11000 + 12000 + 13000) / 3), st.ao5); // drop best 10000 and the DNF
  check('best ignores DNF', st.best === 10000, st.best);
  s.toggleDNF(0);
  st = s.stats();
  check('two DNFs in ao5 = DNF', st.ao5 === Infinity, st.ao5);
  check('format DNF', T.formatTime(st.ao5) === 'DNF');
  s.toggleDNF(0);
  check('DNF toggles off', near(s.stats().ao5, (11000 + 12000 + 13000) / 3)); // index 3 still DNF

  s.remove(3); // drop the DNF; only 4 solves left
  check('delete -> ao5 null with 4 solves', s.stats().ao5 === null);
  check('delete removed entry', s.list().length === 4 && s.list()[3].time === 13000);

  // ao12: 12 solves 1..12 s -> drop 1 and 12, mean of 2..11 = 6.5 s
  var times = [];
  for (var i = 1; i <= 12; i++) times.push(i * 1000);
  s = sessionWith(times);
  check('ao12', near(s.stats().ao12, 6500), s.stats().ao12);
  check('ao5 uses newest 5', near(s.stats().ao5, 10000), s.stats().ao5);
  s.toggleDNF(0);
  check('ao12 one DNF', near(s.stats().ao12, 7500), s.stats().ao12); // mean of 3..12 s
  s.toggleDNF(5);
  check('ao12 two DNFs = DNF', s.stats().ao12 === Infinity);
  s.remove(5);
  check('ao12 null after delete to 11', s.stats().ao12 === null);
  s.add({ time: 20000 });
  check('ao12 after new solve', near(s.stats().ao12, (3 + 4 + 5 + 7 + 8 + 9 + 10 + 11 + 12 + 20) * 100), s.stats().ao12);

  var empty = T.computeStats([]);
  check('empty stats are null', empty.current === null && empty.best === null && empty.ao5 === null && empty.mean === null);
  var allDnf = T.computeStats([{ time: 1000, penalty: 'DNF' }]);
  check('all-DNF best/mean = DNF', allDnf.best === Infinity && allDnf.mean === Infinity && allDnf.current === Infinity);
})();

// 5. formatTime.
check('format 12.345 s', T.formatTime(12345) === '12.34', T.formatTime(12345));
check('format 0', T.formatTime(0) === '0.00');
check('format 1:02.05', T.formatTime(62050) === '1:02.05', T.formatTime(62050));
check('format null', T.formatTime(null) === '-');
check('formatEntry +2', T.formatEntry({ time: 10000, penalty: '+2' }) === '12.00+');

// 6. Persistence round trip.
(function () {
  var storage = fakeStorage();
  var a = T.createSession({ storage: storage });
  a.add({ time: 11111, scramble: "R U", date: 1 });
  a.add({ time: 22222, scramble: "F2", date: 2 });
  a.togglePlus2(0);
  a.add({ time: 33333, scramble: "D'", date: 3 });
  a.toggleDNF(2);
  a.remove(1);
  check('saved under STORAGE_KEY', typeof storage.data[T.STORAGE_KEY] === 'string');
  var b = T.createSession({ storage: storage }); // simulated reload
  var l = b.list();
  check('round trip length', l.length === 2, l.length);
  check('round trip entry 0', l[0].time === 11111 && l[0].penalty === '+2' && l[0].scramble === 'R U' && l[0].date === 1,
    JSON.stringify(l[0]));
  check('round trip entry 1', l[1].time === 33333 && l[1].penalty === 'DNF' && l[1].scramble === "D'",
    JSON.stringify(l[1]));

  // Timer results persist too.
  var s2 = T.createSession({ storage: storage });
  var t = T.createTimer({ now: now, session: s2 });
  t.press(); wait(300, t); t.release(); wait(4000, t); t.press();
  check('timer result persisted', T.createSession({ storage: storage }).list().length === 3);

  // Broken storage never throws.
  var broken = {
    getItem: function () { throw new Error('denied'); },
    setItem: function () { throw new Error('denied'); }
  };
  var ok = true;
  try {
    var c = T.createSession({ storage: broken });
    c.add({ time: 1000 });
    ok = c.list().length === 1;
  } catch (e) { ok = false; }
  check('throwing storage is tolerated', ok);
  var garbage = fakeStorage();
  garbage.setItem(T.STORAGE_KEY, '{not json');
  check('corrupt storage -> empty session', T.createSession({ storage: garbage }).list().length === 0);
  check('null storage works', T.createSession({ storage: null }).list().length === 0);
})();

// 7. Scramble generation used by the UI.
(function () {
  var C = require('../src/core.js');
  var m = C.randomScramble(20, { half: true });
  check('20-move scramble', m.length === 20);
})();

console.log('timer tests: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
