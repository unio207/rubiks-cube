// Run: node test/notation.test.js
// Feature 7: every notation card plays what its label says. The mini cube's end state (through the
// same cubie model the 3D view uses) equals Cube.applyMove(solved, move), its dimmed cubies are exactly
// the ones that stay put, and its arrow turns the same way as the move.
var C = require('../src/core.js');
var A = require('../src/algtab.js');
var V = require('../src/view3d.js').mapping;

var pass = 0, fail = 0;
function check(name, ok, info) {
  if (ok) pass++;
  else { fail++; console.log('FAIL: ' + name + (info !== undefined ? ' -- ' + info : '')); }
}

var expectBases = ['U', 'D', 'L', 'R', 'F', 'B', 'u', 'd', 'l', 'r', 'f', 'b', 'M', 'E', 'S', 'x', 'y', 'z'];
check('one card per move family', A.NOTATION.map(function (n) { return n.base; }).join() === expectBases.join());
check('four groups', A.NOTATION_GROUPS.join() === 'Face turns,Wide turns,Slices,Rotations');
A.NOTATION.forEach(function (n) {
  check(n.base + ' group listed', A.NOTATION_GROUPS.indexOf(n.group) >= 0);
  check(n.base + ' has a description', n.desc.length > 20);
});
var FOLLOW = { M: 'L', E: 'D', S: 'F', x: 'R', y: 'U', z: 'F' };
Object.keys(FOLLOW).forEach(function (b) {
  var n = A.NOTATION.filter(function (x) { return x.base === b; })[0];
  check(b + ' says it follows ' + FOLLOW[b], n.desc.indexOf('follows ' + FOLLOW[b]) >= 0, n.desc);
});
'udlrfb'.split('').forEach(function (b) {
  var n = A.NOTATION.filter(function (x) { return x.base === b; })[0];
  check(b + ' mentions ' + b.toUpperCase() + 'w', n.desc.indexOf(b.toUpperCase() + 'w means the same as ' + b) >= 0 && n.name.indexOf(b.toUpperCase() + 'w') >= 0);
});
['B', 'b', 'D', 'd', 'L', 'l'].forEach(function (b) {
  var n = A.NOTATION.filter(function (x) { return x.base === b; })[0];
  check(b + ' card notes the hidden face', /^Seen from/.test(n.note), n.note);
});

function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
var AXV = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };

A.NOTATION.forEach(function (n) {
  check(n.base + ' variants', n.variants.join() === [n.base, n.base + "'", n.base + '2'].join());
  n.variants.forEach(function (v) {
    var play = A.notationPlay(n, v);
    var m = C.parseMove(play.move);
    check(v + ': plays its own label', m.name === v && play.start.join('') === C.solvedState().join(''));
    // End state through the 3D view's cubie model.
    var model = V.createModel(play.start);
    var before = model.map(function (c) { return c.pos.join(); });
    V.applyMoveToModel(model, play.move);
    var end = V.deriveState(model);
    check(v + ': mini cube ends at applyMove(solved, ' + v + ')', C.isEqual(end, C.applyMove(C.solvedState(), v)));
    // Lit cubies (not dimmed) = those in the focus layers = those that move or spin in place.
    var f = C.parseMove(play.focus), ai = { x: 0, y: 1, z: 2 }[f.axis];
    var lit = model.map(function (c) { return f.layers.indexOf(c.pos[ai]) >= 0; });
    var moved = model.map(function (c, i) {
      return c.pos.join() !== before[i] || c.rot.join() !== [[1, 0, 0], [0, 1, 0], [0, 0, 1]].join();
    });
    check(v + ': dimmed cubies are exactly the still ones', lit.every(function (x, i) { return x === moved[i]; }));
    // Arrow: every head turns the same way as the move about its axis.
    var ax = AXV[m.axis];
    var okDir = play.arrow.heads.every(function (h) {
      var r = h.pos.slice(); r[ai] -= play.arrow.at;
      var c = cross(r, h.dir);
      var s = c[0] * ax[0] + c[1] * ax[1] + c[2] * ax[2];
      return Math.sign(s) === Math.sign(m.amount);
    });
    check(v + ': arrow direction', okDir && play.arrow.axis === m.axis);
    check(v + ': arrow heads (2 for a half turn)', play.arrow.heads.length === (m.turns === 2 ? 2 : 1));
    check(v + ': arrow sits on the moving layers', play.arrow.at === f.layers.reduce(function (a, b) { return a + b; }, 0) / f.layers.length);
    // Arrow faces the camera: its middle point is on the camera side.
    var mid = play.arrow.points[16];
    var cam = [Math.cos(n.phi) * Math.sin(n.theta), Math.sin(n.phi), Math.cos(n.phi) * Math.cos(n.theta)];
    check(v + ': arrow on the camera side', mid[0] * cam[0] + mid[1] * cam[1] + mid[2] * cam[2] > 0);
  });
});

// Turning face is visible from the card's camera (front-facing normal), except slices, which show the middle layer.
A.NOTATION.forEach(function (n) {
  if (n.group === 'Slices') return;
  var cam = [Math.cos(n.phi) * Math.sin(n.theta), Math.sin(n.phi), Math.cos(n.phi) * Math.cos(n.theta)];
  var nv = C.NORMALS[n.follows];
  check(n.base + ': camera sees the ' + n.follows + ' face', nv[0] * cam[0] + nv[1] * cam[1] + nv[2] * cam[2] > 0.3);
});

console.log('notation tests: ' + pass + ' passed, ' + fail + ' failed');
if (fail) process.exit(1);
