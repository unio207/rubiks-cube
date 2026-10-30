// Run: node test/acceptance-algs.test.js
// Acceptance checks for Feature 2 / OLL-PLL hint algs:
//  - The 20 algs are exactly the spec's strings (read from spec.md) with the right names/groups.
//  - Independent verification: case state (solvedCfop + inverse alg) + alg leaves the target solved
//    up to one final U turn, checked with own target code (not core.targetSolved / verifyAlg).
//  - Card: diagram state == mini cube start state, and the mini cube's animation path (view3d's
//    pure model, using each move's axis/layers/amount) ends with the target solved; stepping back
//    through every move returns to the start state.
var fs = require('fs');
var path = require('path');
var C = require('../src/core.js');
var A = require('../src/algtab.js');
var V = require('../src/view3d.js').mapping;

var pass = 0, fail = 0;
function check(name, ok, info) {
  if (ok) pass++;
  else { fail++; console.log('FAIL: ' + name + (info !== undefined ? ' -- ' + info : '')); }
}

var spec = fs.readFileSync(path.join(__dirname, '..', 'spec.md'), 'utf8');

// Transcribed from spec.md "Algorithms (20)"; each string is also checked to occur in spec.md.
var EXPECT = [
  ['F2L', "U R U' R'"], ['F2L', "U' F' U F"], ['F2L', "R U R'"], ['F2L', "F' U' F"],
  ['OLL edges', "F R U R' U' F'", 'Line'], ['OLL edges', "f R U R' U' f'", 'L'],
  ['OLL edges', "F R U R' U' F' f R U R' U' f'", 'Dot'],
  ['OLL corners', "R U R' U R U2 R'", 'Sune'], ['OLL corners', "R U2 R' U' R U' R'", 'Antisune'],
  ['OLL corners', "R U R' U R U' R' U R U2 R'", 'H'], ['OLL corners', "R U2 R2 U' R2 U' R2 U2 R", 'Pi'],
  ['OLL corners', "R2 D R' U2 R D' R' U2 R'", 'Headlights'], ['OLL corners', "r U R' U' r' F R F'", 'Chameleon'],
  ['OLL corners', "F' r U R' U' r' F R", 'Bowtie'],
  ['PLL corners', "R U R' U' R' F R2 U' R' U' R U R' F'", 'Adjacent'],
  ['PLL corners', "F R U' R' U' R U R' F' R U R' U' R' F R F'", 'Diagonal'],
  ['PLL edges', "R U' R U R U R U' R' U' R2", 'Ua'], ['PLL edges', "R2 U R U R' U' R' U' R' U R'", 'Ub'],
  ['PLL edges', 'M2 U M2 U2 M2 U M2', 'H'], ['PLL edges', "M' U M2 U M2 U M' U2 M2", 'Z']
];
EXPECT.forEach(function (e) { check('spec.md contains "' + e[1] + '"', spec.indexOf(e[1]) >= 0); });
check('20 algs in core', C.ALGS.length === 20, C.ALGS.length);
EXPECT.forEach(function (e, i) {
  var a = C.ALGS[i] || {};
  check('alg ' + i + ' text is exactly the spec', a.alg === e[1], a.alg + ' vs ' + e[1]);
  check('alg ' + i + ' group', a.group === e[0], a.group);
  if (e[2]) check('alg ' + i + ' name mentions ' + e[2], (a.name || '').indexOf(e[2]) >= 0, a.name);
});

// Own target checks.
var CROSS = [[0, -1, 1], [1, -1, 0], [0, -1, -1], [-1, -1, 0]];
var SLOTS = [[[1, -1, 1], [1, 0, 1]], [[1, -1, -1], [1, 0, -1]], [[-1, -1, -1], [-1, 0, -1]], [[-1, -1, 1], [-1, 0, 1]]];
function myTarget(s, target) {
  if (target === 'slotFR') return C.cubiesSolved(s, CROSS.concat(SLOTS[0]));
  if (target === 'uFace') {
    var y = C.at(s, [0, 1, 0], [0, 1, 0]);
    var top = true;
    for (var x = -1; x <= 1; x++) for (var z = -1; z <= 1; z++) if (C.at(s, [x, 1, z], [0, 1, 0]) !== y) top = false;
    return top && C.cubiesSolved(s, CROSS.concat.apply(CROSS, SLOTS));
  }
  if (target === 'cube') {
    return C.FACES.every(function (f, k) { for (var j = 0; j < 9; j++) if (s[k * 9 + j] !== s[k * 9 + 4]) return false; return true; });
  }
  throw new Error('unknown target ' + target);
}
var TARGET_FOR = { 'F2L': 'slotFR', 'OLL edges': 'uFace', 'OLL corners': 'uFace', 'PLL corners': 'cube', 'PLL edges': 'cube' };
function upToU(s, target) {
  return ['', 'U', "U'", 'U2'].filter(function (u) { return myTarget(u ? C.applyMove(s, u) : s, target); })[0];
}

C.ALGS.forEach(function (e) {
  // OLL edges only orients edges, so its strict target is "yellow cross"; the spec says "the U face" for
  // OLL generally. Use the yellow-cross check for OLL edges, uFace for corners.
  var start = C.applyAlg(C.solvedCfop(), C.invertAlg(e.alg));
  check(e.id + ' case state = solvedCfop + inverse alg (core.caseState)', C.isEqual(start, C.caseState(e.alg)));
  check(e.id + ' case state starts unsolved', !myTarget(start, TARGET_FOR[e.group]) || e.group === 'OLL edges');
  var end = C.applyAlg(start, e.alg);
  var target = TARGET_FOR[e.group];
  if (e.group === 'OLL edges') {
    var y = C.at(end, [0, 1, 0], [0, 1, 0]);
    var cross = [[0, 1, 1], [1, 1, 0], [0, 1, -1], [-1, 1, 0]].every(function (p) { return C.at(end, p, [0, 1, 0]) === y; });
    check(e.id + ' leaves F2L + yellow cross', cross && C.cubiesSolved(end, CROSS.concat.apply(CROSS, SLOTS)));
    check(e.id + ' (strict uFace) leaves whole U solved', myTarget(end, 'uFace'));
  } else {
    var auf = upToU(end, target);
    check(e.id + ' solves its target (allowing one U)', auf !== undefined, e.alg);
    if (auf) console.log('  note: ' + e.id + ' needs final ' + auf);
  }

  // Card states: diagram and mini cube start.
  var card = A.verifyCard(e);
  check(e.id + ' card diagram state == mini cube start', card.sameStart, JSON.stringify(card));
  check(e.id + ' card start == independent case state', C.isEqual(A.startState(e), start));
  check(e.id + ' diagram view built from case state', JSON.stringify(A.topView(start)) === JSON.stringify(A.topView(A.caseState(e.alg))));

  // Mini cube animation path: card.moves = parseAlg(alg), played on the view model.
  var moves = C.parseAlg(e.alg);
  var model = V.createModel(start);
  moves.forEach(function (m) { V.applyMoveToModel(model, m); });
  var animEnd = V.deriveState(model);
  check(e.id + ' animated end == logical end', C.isEqual(animEnd, end));
  if (e.group !== 'OLL edges') check(e.id + ' animated end has target solved', upToU(animEnd, target) !== undefined);
  // Step back through every move (invertMove), like the step-back button.
  for (var k = moves.length - 1; k >= 0; k--) V.applyMoveToModel(model, C.invertMove(moves[k]));
  check(e.id + ' stepping back returns to start', C.isEqual(V.deriveState(model), start));
});

console.log('acceptance-algs: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
