// Run: node test/baseline-logic.test.js
// Pure parts of src/baseline.js: key mapping and solve history.
var C = require('../src/core.js');
var B = require('../src/baseline.js');

var pass = 0, fail = 0;
function check(name, ok, info) {
  if (ok) pass++;
  else { fail++; console.log('FAIL: ' + name + (info ? ' -- ' + info : '')); }
}

// Key mapping.
check('KeyR', B.keyToMove('KeyR', false) === 'R');
check('shift KeyU', B.keyToMove('KeyU', true) === "U'");
check('KeyX', B.keyToMove('KeyX', false) === 'x');
check('shift z', B.keyToMove('z', true) === "z'");
check('KeyH ignored', B.keyToMove('KeyH', false) === null);
check('KeyM', B.keyToMove('KeyM', false) === 'M');
check('shift M', B.keyToMove('m', true) === "M'");
check('alt KeyR = r', B.keyToMove('KeyR', false, true) === 'r');
check('alt shift f', B.keyToMove('f', true, true) === "f'");
check('alt KeyX ignored', B.keyToMove('KeyX', false, true) === null);
check('alt KeyM ignored', B.keyToMove('KeyM', false, true) === null);
check('Space ignored', B.keyToMove('Space', false) === null);
check('eventKey: AZERTY printed z (code KeyW) maps to z', B.keyToMove(B.eventKey({ key: 'z', code: 'KeyW' }), false) === 'z');
check('eventKey: shifted letter', B.keyToMove(B.eventKey({ key: 'R', code: 'KeyR' }), true) === "R'");
check('eventKey: non-latin letter falls back to code', B.eventKey({ key: 'к', code: 'KeyR' }) === 'KeyR');

// After a whole-cube rotation the U key turns whatever face is now on top (spatial frame).
var s = C.applyAlg(C.solvedState(), 'x');           // F (green) now on top
var afterU = C.applyMove(s, 'U');
check('U after x turns the green face', C.centerColor(afterU, 'U') === 'F' && C.isEqual(afterU, C.applyAlg(C.solvedState(), 'F x')));

// Solve undoes everything since last solved, with cancellation.
var h = B.createHistory();
['R', 'U', "U'", 'F', 'x', 'D2'].forEach(h.push);
check('cancel U U\'', JSON.stringify(h.moves) === JSON.stringify(['R', 'F', 'x', 'D2']), h.moves.join(' '));
var sol = h.solveMoves();
check('solve moves', sol.join(' ') === "D2 x' F' R'", sol.join(' '));
sol.forEach(h.push);
check('solve empties history', h.moves.length === 0);
check('solve reaches solved', C.isSolved(h.state));

// History restarts whenever the cube is solved (including in another orientation).
h.reset();
['R', 'R', 'R', 'R', 'y', 'L'].forEach(h.push);
check('restart after R4 and y', h.moves.join(' ') === 'L', h.moves.join(' '));

// Scramble then Solve.
h.reset();
var scr = C.randomScramble(25);
var prev = null, okFaces = true;
scr.forEach(function (m) { if (m[0] === prev) okFaces = false; prev = m[0]; });
check('scramble 25 quarter turns, no repeat face', scr.length === 25 && okFaces && scr.every(function (m) { return !/2/.test(m); }));
scr.forEach(h.push);
h.solveMoves().forEach(h.push);
check('scramble then solve', C.isSolved(h.state) && h.moves.length === 0);

// Random sequences (incl. rotations) + solve always return to solved.
var TOK = ['U', 'D', 'L', 'R', 'F', 'B', 'x', 'y', 'z'];
var seed = 99;
function rnd() { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; }
for (var t = 0; t < 100; t++) {
  h.reset();
  for (var i = 0; i < 30; i++) h.push(TOK[Math.floor(rnd() * 9)] + (rnd() < 0.5 ? "'" : ''));
  h.solveMoves().forEach(h.push);
  check('random solve ' + t, C.isSolved(h.state) && h.moves.length === 0);
}

console.log('baseline-logic: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
