// Run: node test/algtab.test.js
// Pure parts of src/algtab.js: case states, card verification, diagram data and SVG output.
var C = require('../src/core.js');
var A = require('../src/algtab.js');

var pass = 0, fail = 0;
function check(name, ok, info) {
  if (ok) pass++;
  else { fail++; console.log('FAIL: ' + name + (info ? ' -- ' + info : '')); }
}

check('20 algs', C.ALGS.length === 20);

// Every card: diagram state == mini cube start, and the alg solves its target.
C.ALGS.forEach(function (e) {
  var r = A.verifyCard(e);
  check('verifyCard ' + e.id, r.ok, JSON.stringify(r));
  check('verifyCard by alg string ' + e.id, A.verifyCard(e.alg).ok);
  check('caseState ' + e.id, C.isEqual(A.caseState(e.alg), C.applyAlg(C.solvedCfop(), C.invertAlg(e.alg))));
  check('not already solved ' + e.id, !C.targetSolved(A.caseState(e.alg), e.target));
});

// A wrong alg for a case must fail verification (the check is not a tautology on the target).
var bad = { id: 'x', name: 'x', group: 'F2L', target: 'slotFR', alg: "R U R'" };
var badStart = A.startState(bad);
check('wrong alg does not solve another case', !C.targetSolved(C.applyAlg(badStart, "U R U' R'"), 'slotFR'));

function byId(id) { return C.ALGS.filter(function (e) { return e.id === id; })[0]; }
function yellowCount(id) {
  var s = A.caseState(byId(id).alg), top = C.centerColor(s, 'U');
  var v = A.topView(s);
  return v.u.filter(function (c) { return c === top; }).length;
}

// OLL top views come from the case state.
check('Sune: 6 yellow on top (center, cross, 1 corner)', yellowCount('oll-sune') === 6, yellowCount('oll-sune'));
check('Antisune: 6 yellow on top', yellowCount('oll-antisune') === 6);
check('H: 5 yellow on top (cross only)', yellowCount('oll-h') === 5);
check('Dot: only center yellow', yellowCount('oll-dot') === 1, yellowCount('oll-dot'));
check('Headlights: 7 yellow on top', yellowCount('oll-headlights') === 7);
check('Bowtie: 7 yellow on top', yellowCount('oll-bowtie') === 7);
var sv = A.topView(A.caseState(byId('oll-sune').alg));
check('Sune corner at UFL', sv.u[6] === C.centerColor(A.caseState(byId('oll-sune').alg), 'U'));
var tv = A.topView(C.solvedCfop());
check('topView sizes', tv.u.length === 9 && tv.back.length === 3 && tv.front.length === 3 && tv.left.length === 3 && tv.right.length === 3);
check('solved top view: sides match centers', tv.front.every(function (c) { return c === 'F'; }) && tv.right.every(function (c) { return c === 'L'; }));

// PLL arrows from the permutation.
function arrows(id) { return A.pllArrows(A.caseState(byId(id).alg)); }
function moved(list) { return list.reduce(function (n, a) { return n + (a.both ? 2 : 1); }, 0); }
check('solved: no arrows', A.pllArrows(C.solvedCfop()).length === 0);
check('T: 2 swaps', arrows('pll-t').length === 2 && arrows('pll-t').every(function (a) { return a.both; }), JSON.stringify(arrows('pll-t')));
check('Y: 2 swaps', arrows('pll-y').length === 2 && arrows('pll-y').every(function (a) { return a.both; }));
check('Ua: 3-cycle', arrows('pll-ua').length === 3 && arrows('pll-ua').every(function (a) { return !a.both; }));
check('Ub: 3-cycle', arrows('pll-ub').length === 3 && moved(arrows('pll-ub')) === 3);
check('H: 2 swaps', arrows('pll-h').length === 2 && moved(arrows('pll-h')) === 4);
// Z's case state carries a U offset (the alg has a net U turn), so the true permutation is a
// corner 4-cycle plus one edge swap; arrows show exactly that.
var zA = arrows('pll-z');
check('Z: corner 4-cycle + edge swap', zA.length === 5 && moved(zA) === 6 && zA.filter(function (a) { return a.both; }).length === 1, JSON.stringify(zA));
// Arrows point to the right place: moving each piece from -> to gives the solved layer.
var ua = arrows('pll-ua');
var uaFroms = ua.map(function (a) { return a.from.join(); }).sort().join('|');
var uaTos = ua.map(function (a) { return a.to.join(); }).sort().join('|');
check('Ua: cycle sources == destinations', uaFroms === uaTos);
check('Ua: only edges move', ua.every(function (a) { return Math.abs(a.from[0]) + Math.abs(a.from[2]) === 1; }));
var yA = arrows('pll-y');
check('Y: one corner swap is diagonal', yA.some(function (a) { return a.from[0] === -a.to[0] && a.from[2] === -a.to[2] && a.from[0] !== 0; }));

// F2L view: only cross, FR pair and centers colored.
C.ALGS.filter(function (e) { return e.group === 'F2L'; }).forEach(function (e) {
  var st = A.f2lStickers(A.caseState(e.alg));
  check(e.id + ' 27 visible stickers', st.length === 27);
  var colored = st.filter(function (x) { return x.color; }).length;
  // 3 centers + U-layer pair (corner shows 3, edge shows 2 when in top layer... visible subset) + FD/RD cross stickers.
  check(e.id + ' some gray', st.some(function (x) { return !x.color; }));
  check(e.id + ' centers colored', st.filter(function (x) { return x.pos.filter(function (v) { return v !== 0; }).length === 1 && x.color; }).length === 3);
  check(e.id + ' cross stickers colored', st.filter(function (x) { return x.pos[1] === -1 && x.pos.filter(function (v) { return v !== 0; }).length === 2 && x.color; }).length === 2);
  check(e.id + ' pair in U layer colored', st.filter(function (x) { return x.color && x.pos[1] === 1 && x.pos.join() !== '0,1,0'; }).length >= 3, colored);
});
var solvedF2l = A.f2lStickers(C.solvedCfop());
check('solved F2L view: FR slot colored', solvedF2l.filter(function (x) { return x.pos.join() === '1,-1,1' && x.color; }).length === 2);
check('solved F2L view: U corners gray', solvedF2l.filter(function (x) { return x.pos.join() === '1,1,1'; }).every(function (x) { return !x.color; }));

// SVGs render for every card.
C.ALGS.forEach(function (e, i) {
  var svg = A.diagramSvg(e, '-' + i);
  check('svg ' + e.id, /^<svg[\s\S]*<\/svg>$/.test(svg));
  if (e.group.indexOf('PLL') === 0) check('svg arrows ' + e.id, /<line /.test(svg) && svg.indexOf('id="ah-' + i + '"') > 0);
  if (e.group.indexOf('OLL') === 0) {
    var fills = svg.match(/fill="#[0-9a-f]{6}"/g).map(function (f) { return f.slice(6, 13); });
    var allowed = ['#' + ('000000' + C.COLOR_HEX.D.toString(16)).slice(-6), '#4a4f59'];
    check('OLL yellow/gray only ' + e.id, fills.every(function (f) { return allowed.indexOf(f) >= 0; }), fills.join(','));
  }
  if (e.group === 'F2L') check('svg iso ' + e.id, (svg.match(/<polygon /g) || []).length === 28);
});

console.log('algtab tests: ' + pass + ' passed, ' + fail + ' failed');
if (fail) process.exit(1);
