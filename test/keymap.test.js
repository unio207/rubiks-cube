// Run: node test/keymap.test.js
// Feature 8: the default keymap reproduces the old keys, rebinding and conflicts, reserved keys,
// several keys per action, Shift/Alt handling, help text, and storage round trips.
var K = require('../src/keymap.js');
var B = require('../src/baseline.js');
var C = require('../src/core.js');

var pass = 0, fail = 0;
function check(name, ok, info) {
  if (ok) pass++;
  else { fail++; console.log('FAIL: ' + name + (info !== undefined ? ' -- ' + info : '')); }
}
function ev(key, code, o) {
  o = o || {};
  return { key: key, code: code, shiftKey: !!o.shift, altKey: !!o.alt, ctrlKey: !!o.ctrl, metaKey: !!o.meta };
}

// Every action is a real move or 'hints'.
check('actions: 18 bases x 3 + hints', K.ACTIONS.length === 55);
K.ACTIONS.forEach(function (a) {
  if (a !== 'hints') check(a + ' parses as a move', C.parseMove(a).name === a);
});

// 1. Defaults reproduce the old mapping for every letter with every Shift/Alt combination.
var D = K.defaults();
'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').forEach(function (L) {
  [false, true].forEach(function (shift) {
    [false, true].forEach(function (alt) {
      // Old behaviour: Baseline.keyToMove for moves; app.js toggled hints on H (any Shift, no Alt).
      var old = B.keyToMove('Key' + L, shift, alt);
      if (!old && L === 'H' && !alt) old = 'hints';
      // Shifted letters arrive as upper case e.key, others as lower case; Alt on a Mac gives a symbol.
      var key = alt ? '®' : (shift ? L : L.toLowerCase());
      var got = K.lookup(D, K.fromEvent(ev(key, 'Key' + L, { shift: shift, alt: alt })));
      check('default ' + (alt ? 'Alt+' : '') + (shift ? 'Shift+' : '') + L, got === old, got + ' vs ' + old);
    });
  });
});
check('default: E, S and all 2 turns unbound', ['E', "E'", 'S', "S'"].concat(K.ACTIONS.filter(function (a) { return /2$/.test(a); }))
  .every(function (a) { return D[a].length === 0; }));
check('default: digits unbound', K.lookup(D, K.fromEvent(ev('1', 'Digit1'))) === null);
check('Ctrl/Meta chords ignored', K.fromEvent(ev('r', 'KeyR', { ctrl: true })) === null && K.fromEvent(ev('r', 'KeyR', { meta: true })) === null);
check('lone Shift ignored', K.fromEvent(ev('Shift', 'ShiftLeft', { shift: true })) === null);
check('AZERTY: printed letter wins', K.fromEvent(ev('z', 'KeyW')) === 'Z');
check('non-latin letter falls back to the code', K.fromEvent(ev('к', 'KeyR')) === 'R');
check('Space combo', K.fromEvent(ev(' ', 'Space')) === 'Space');
check('punctuation uses the code', K.fromEvent(ev(';', 'Semicolon')) === 'Semicolon' && K.fromEvent(ev(':', 'Semicolon', { shift: true })) === 'Shift+Semicolon');

// 2. Help text: defaults give the old help line.
check('default help text = old help line', K.helpText(D) === B.HELP_TEXT + '  ·  H: hints  ·  Space: timer', K.helpText(D));

// 3. Rebinding U to J and U' to F (the browser scenario).
var r1 = K.bind(D, 'U', 'J');
check('bind J -> U', !r1.error && r1.moved === null && K.lookup(r1.map, 'J') === 'U');
check('U keeps its old key too (several keys per action)', K.lookup(r1.map, 'U') === 'U' && r1.map.U.join() === 'U,J');
check('bind does not change its input', D.U.join() === 'U' && K.lookup(D, 'J') === null);
var r2 = K.bind(r1.map, "U'", 'F');
check("bind F -> U' moves F from the F action", !r2.error && r2.moved === 'F' && K.lookup(r2.map, 'F') === "U'" && r2.map.F.length === 0);
check("Shift+F still F'", K.lookup(r2.map, 'Shift+F') === "F'");
var r3 = K.unbind(r2.map, 'U', 'U');
check('unbind U from U', K.lookup(r3, 'U') === null && r3.U.join() === 'J');
check('help reflects rebinds', /J: U\b/.test(K.helpText(r3)) && /F: U'/.test(K.helpText(r3)) && !/U D L R F B: turn face/.test(K.helpText(r3)), K.helpText(r3));
check('binding the same key again is a no-op', K.bind(r1.map, 'U', 'J').map.U.join() === 'U,J' && K.bind(r1.map, 'U', 'J').moved === null);

// 4. Reserved and invalid keys.
['Space', 'Escape', 'Shift+Space', 'Alt+Escape'].forEach(function (c) {
  var r = K.bind(D, 'U', c);
  check(c + ' refused', !!r.error && /reserved/.test(r.error) && r.map === D, r.error);
});
check('unknown action refused', !!K.bind(D, 'Q', 'J').error);
check('modifier-only combo refused', !!K.bind(D, 'U', 'Shift+ShiftLeft').error);

// 5. Shift and Alt are separate keys; csTimer-style two-handed layout with several keys per action.
var m = K.defaults();
[['U', 'J'], ['U', 'I'], ["U'", 'F'], ["U'", 'K'], ['R', 'Shift+J'], ['r', 'Alt+J'], ["r'", 'Alt+Shift+J'], ['U2', 'Digit5'], ['E', 'Semicolon']]
  .forEach(function (p) { m = K.bind(m, p[0], p[1]).map; });
check('J / I both U', K.lookup(m, 'J') === 'U' && K.lookup(m, 'I') === 'U');
check("F / K both U'", K.lookup(m, 'F') === "U'" && K.lookup(m, 'K') === "U'");
check('Shift+J is R, not U', K.lookup(m, 'Shift+J') === 'R');
check('Alt+J is r, Alt+Shift+J is r\'', K.lookup(m, 'Alt+J') === 'r' && K.lookup(m, 'Alt+Shift+J') === "r'");
check('Digit5 is U2', K.lookup(K.defaults(), 'Digit5') === null && K.lookup(m, 'Digit5') === 'U2');
check('event Shift+j gives R', K.lookup(m, K.fromEvent(ev('J', 'KeyJ', { shift: true }))) === 'R');
check('event 5 gives U2', K.lookup(m, K.fromEvent(ev('5', 'Digit5'))) === 'U2');
check('each combo on at most one action', (function () {
  var seen = {};
  return K.ACTIONS.every(function (a) { return m[a].every(function (c) { if (seen[c]) return false; seen[c] = 1; return true; }); });
})());
check('labels', K.keyLabel('Digit5') === '5' && K.keyLabel('Shift+Semicolon') === 'Shift+;' && K.keyLabel('Alt+J') === 'Alt+J');
check('help shows 2-turn and slice keys', /5: U2/.test(K.helpText(m)) && /;: E/.test(K.helpText(m)), K.helpText(m));

// 6. Storage: round trip, corrupt data, partial data, fake storage objects.
check('serialise/parse round trip', K.serialize(K.parse(K.serialize(m))) === K.serialize(m));
check('round trip keeps lookups', K.lookup(K.parse(K.serialize(m)), 'J') === 'U');
['', 'not json', 'null', '42', '[]', '{"foo":["J"]}', '{"U":"J"}'].forEach(function (bad) {
  check('corrupt "' + bad + '" gives defaults', K.serialize(K.parse(bad)) === K.serialize(D));
});
var partial = K.parse(JSON.stringify({ U: ['J', 'Space', 'J', 42, 'Escape', 'Shift+Space'], "U'": ['J', 'F'], hints: ['H'] }));
check('parse drops reserved, invalid and duplicate keys', partial.U.join() === 'J' && partial["U'"].join() === 'F' && partial.hints.join() === 'H');
check('parse fills missing actions with no keys', partial.R.length === 0 && K.ACTIONS.every(function (a) { return Array.isArray(partial[a]); }));
var store = { data: {}, getItem: function (k) { return k in this.data ? this.data[k] : null; }, setItem: function (k, v) { this.data[k] = String(v); } };
check('load with empty storage gives defaults', K.serialize(K.load(store)) === K.serialize(D));
K.save(m, store);
check('save then load (reload)', K.serialize(K.load(store)) === K.serialize(m));
store.data[K.STORAGE_KEY] = '{broken';
check('load with corrupt storage gives defaults', K.serialize(K.load(store)) === K.serialize(D));
var throwing = { getItem: function () { throw new Error('denied'); }, setItem: function () { throw new Error('denied'); } };
check('load with throwing storage gives defaults', K.serialize(K.load(throwing)) === K.serialize(D));
check('save with throwing storage does not throw', (function () { try { K.save(m, throwing); return true; } catch (e) { return false; } })());

console.log('keymap tests: ' + pass + ' passed, ' + fail + ' failed');
if (fail) process.exit(1);
