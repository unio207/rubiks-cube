// Run: node test/acceptance-build.test.js
// Rebuilds rubiks-cube.html and checks it statically: one external script (cdnjs Three.js r128),
// all inline scripts parse, solver is text/plain, the worker body (core + solver + onmessage) runs in
// a sandbox that only has `self` and answers fast, plus static evidence for browser-only items.
var fs = require('fs');
var path = require('path');
var vm = require('vm');
var cp = require('child_process');

var pass = 0, fail = 0;
function check(name, ok, info) {
  if (ok) pass++;
  else { fail++; console.log('FAIL: ' + name + (info !== undefined ? ' -- ' + info : '')); }
}
var root = path.join(__dirname, '..');
var out = cp.execFileSync(process.execPath, [path.join(root, 'tools', 'build.js')], { encoding: 'utf8' });
check('build ran', /inlined 7 file\(s\)/.test(out), out);
var html = fs.readFileSync(path.join(root, 'rubiks-cube.html'), 'utf8');

var scripts = [], re = /<script([^>]*)>([\s\S]*?)<\/script>/g, m;
while ((m = re.exec(html))) scripts.push({ attrs: m[1], code: m[2] });
var ext = scripts.filter(function (s) { return /\bsrc=/.test(s.attrs); });
check('exactly one external script', ext.length === 1, ext.length);
check('external script is cdnjs Three.js r128',
  ext[0] && /src="https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/three\.js\/r128\/three\.min\.js"/.test(ext[0].attrs));
check('no stylesheet links', !/<link[^>]+stylesheet/i.test(html));
var inline = scripts.filter(function (s) { return !/\bsrc=/.test(s.attrs); });
check('7 inline scripts', inline.length === 7, inline.length);
inline.forEach(function (s, i) {
  var ok = true; try { new Function(s.code); } catch (e) { ok = e.message; }
  check('inline script ' + i + ' parses', ok === true, ok);
});
var core = inline.filter(function (s) { return /id="src-core"/.test(s.attrs); })[0];
var solver = inline.filter(function (s) { return /id="src-solver"/.test(s.attrs); })[0];
check('solver is type=text/plain (not run on page)', solver && /type="text\/plain"/.test(solver.attrs));
check('core is a running script', core && !/type=/.test(core.attrs));

// Worker body, exactly as app.js assembles it, in a sandbox with only `self`.
var appSrc = fs.readFileSync(path.join(root, 'src', 'app.js'), 'utf8');
var body = core.code + '\n;\n' + solver.code + '\n;self.onmessage = function (e) {\n' +
  '  var out = { id: e.data.id };\n' +
  '  try { out.hint = Solver[e.data.fn](e.data.state); } catch (err) { out.error = String(err && err.message || err); }\n' +
  '  self.postMessage(out);\n' + '};\n';
check('app.js builds the worker body the same way', appSrc.indexOf("'  try { out.hint = Solver[e.data.fn](e.data.state); }") >= 0);
var replies = [];
var sb = { self: null }; sb.self = sb; sb.postMessage = function (x) { replies.push(x); };
vm.createContext(sb);
vm.runInContext(body, sb);
var C = require('../src/core.js');
var seed = 31337;
function rnd() { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; }
var worst = 0;
for (var i = 0; i < 50; i++) {
  var st = C.applyAlg(C.solvedState(), C.randomScramble(25, { random: rnd }));
  var t0 = Date.now();
  sb.onmessage({ data: { id: i + 1, fn: 'getHint', state: st } });
  worst = Math.max(worst, Date.now() - t0);
}
check('worker answers every request with its id', replies.length === 50 && replies.every(function (r, k) { return r.id === k + 1 && r.hint && !r.error; }));
check('worker hint (incl. first-call init) < 300 ms', worst < 300, worst);
console.log('worker sandbox: worst reply ' + worst + ' ms');
// Full CFOP solve through the worker: solves, stays well under a second.
var worstSolve = 0, solveOk = true;
for (var i = 0; i < 20; i++) {
  var st = C.applyAlg(C.solvedState(), C.randomScramble(25, { random: rnd }));
  var t0 = Date.now();
  sb.onmessage({ data: { id: 100 + i, fn: 'solve', state: st } });
  worstSolve = Math.max(worstSolve, Date.now() - t0);
  var r = replies[replies.length - 1];
  if (r.id !== 100 + i || r.error || !C.isSolved(C.applyAlg(st, r.hint.moves))) solveOk = false;
}
check('worker solve reaches solved for 20 scrambles', solveOk);
check('worker solve < 1000 ms', worstSolve < 1000, worstSolve);
console.log('worker sandbox: worst solve ' + worstSolve + ' ms');

// ---- Static evidence for browser-only items ----
var view = fs.readFileSync(path.join(root, 'src', 'view3d.js'), 'utf8');
var base = fs.readFileSync(path.join(root, 'src', 'baseline.js'), 'utf8');
var B = require('../src/baseline.js');
check('turn duration default 160 ms', /opts\.duration \|\| 160/.test(view));
check('ease in-out on turns', /easeInOut\(Math\.max\(0, t\)\)/.test(view));
check('vertical angle clamped', /phi = Math\.max\(-PHI_MAX, Math\.min\(PHI_MAX, phi\)\)/.test(view) && /PHI_MAX = Math\.PI \/ 2 - 0\.05/.test(view));
check('ambient + directional light', /AmbientLight/.test(view) && /DirectionalLight/.test(view));
check('directional light follows camera', /light\.position\.copy\(camera\.position\)/.test(view));
check('resize listener', /addEventListener\('resize', resize\)/.test(view));
check('pointer (mouse + touch) drag', /pointerdown/.test(view) && /touchAction = 'none'/.test(view));
check('snap after each turn', /Math\.round\(v \/ SPACING\)/.test(view) && /snapRotation\(m4\.elements\)/.test(view));
check('auto-repeat ignored', /e\.repeat/.test(base));
check('scramble = 25 random quarter turns, fast', /randomScramble\(25\), \{ fast: true \}/.test(base));
check('help text mentions drag to rotate the view', /drag to rotate the view/.test(B.HELP_TEXT), B.HELP_TEXT);
check('body color near-black', /color: 0x1[0-9a-f]{5}/.test(view));
check('sticker colors U white, D yellow, F green, B blue, R red, L orange',
  C.COLOR_NAME.U === 'white' && C.COLOR_NAME.D === 'yellow' && C.COLOR_NAME.F === 'green' &&
  C.COLOR_NAME.B === 'blue' && C.COLOR_NAME.R === 'red' && C.COLOR_NAME.L === 'orange');
// Space never triggers a button
var topBtns = html.match(/<button id="[^"]+"[^>]*>/g) || [];
check('top-bar buttons tabindex=-1', topBtns.length === 6 && topBtns.every(function (b) { return /tabindex="-1"/.test(b); }), topBtns.join(' '));
check('app blocks mousedown focus + blurs after click', /mousedown', function \(e\) \{ e\.preventDefault\(\); \}/.test(appSrc) && /b\.blur\(\)/.test(appSrc));
check('app: Space keydown always preventDefault', /if \(isSpace\(e\)\) \{\s*e\.preventDefault\(\);/.test(appSrc));
check('app: Space keyup always preventDefault', /if \(!isSpace\(e\)\) return;\s*e\.preventDefault\(\);/.test(appSrc));
var algtab = fs.readFileSync(path.join(root, 'src', 'algtab.js'), 'utf8');
check('algtab control buttons blur after click', /b\.blur\(\); fn\(\);/.test(algtab));
check('app: notifySolved on any solved finished move', /if \(Cube\.isSolved\(state\)\) ui\.notifySolved\(\);/.test(appSrc));
check('app: inspection/hold/running disables Scramble/Solve/Reset + Algorithms tab', /onActiveChange: function \(active\) \{\s*timing = active;\s*app\.setButtonsEnabled\(!active\);\s*tabAlgs\.disabled = active;/.test(appSrc));
check('app: first scramble applied after mount', /mounted = true;\s*applyTimerScramble\(ui\.timer\.scramble\);/.test(appSrc));
check('app: Scramble/Solve/Reset and cube keys cancel a pending post-solve scramble', (appSrc.match(/cancelPendingScramble\(\)/g) || []).length >= 5);
check('app: delayed scramble only applies when timer idle/stopped', /if \(timerIdle\(\)\) applyTimerScramble\(moves\)/.test(appSrc));
check('algtab: no extra hint paragraph on cards', algtab.indexOf('at-hint') < 0);
check('app: hints hidden while timing', /function hintsVisible\(\) \{ return hintsOn && !timing && tab === 'cube'; \}/.test(appSrc));

console.log('acceptance-build: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
