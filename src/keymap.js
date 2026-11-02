// keymap.js - Feature 8: custom keybinds for the 3D cube, plus the Keys panel.
// A keymap is { action: [combo, ...] } for every action in ACTIONS. An action is a move name
// ("U", "U'", "U2", "r", "M", "x2", ...) or "hints". A combo is "Alt+Shift+KEY" with optional modifiers,
// where KEY is an upper-case letter (the printed letter, as Baseline.eventKey reads it) or a
// KeyboardEvent.code for any other key ("Digit1", "Semicolon", "ArrowLeft", ...).
// Browser: defines window.KeyMap. Node: require('./src/keymap.js') gives the pure parts.
(function (root) {
  'use strict';

  var FAMILIES = [
    { name: 'Face turns', bases: ['U', 'D', 'L', 'R', 'F', 'B'] },
    { name: 'Wide turns', bases: ['u', 'd', 'l', 'r', 'f', 'b'] },
    { name: 'Slices', bases: ['M', 'E', 'S'] },
    { name: 'Rotations', bases: ['x', 'y', 'z'] }
  ];
  var ACTIONS = [];
  FAMILIES.forEach(function (f) { f.bases.forEach(function (b) { ACTIONS.push(b, b + "'", b + '2'); }); });
  ACTIONS.push('hints');
  var RESERVED = ['Space', 'Escape'];
  var MODIFIER_KEY = /^(Shift|Alt|Control|Meta|OS|AltGraph|CapsLock|Fn)(Left|Right)?$/;
  var STORAGE_KEY = 'rubiks-keymap';

  function isWide(base) { return /^[udlrfb]$/.test(base); }

  // The plain key that turns a base move today: the letter, Alt+face letter for wide turns.
  function stdKey(base) { return (isWide(base) ? 'Alt+' : '') + base.toUpperCase(); }
  function withShift(combo) { return combo.replace(/^(Alt\+)?/, '$1Shift+'); }

  function emptyMap() {
    var m = {};
    ACTIONS.forEach(function (a) { m[a] = []; });
    return m;
  }

  // Baseline keys: letter = clockwise, Shift+letter = prime, for faces, M and x y z; Alt+face = wide;
  // H (with or without Shift) toggles hints. Everything else starts unbound.
  function defaults() {
    var m = emptyMap();
    ['U', 'D', 'L', 'R', 'F', 'B', 'M', 'x', 'y', 'z', 'u', 'd', 'l', 'r', 'f', 'b'].forEach(function (b) {
      m[b] = [stdKey(b)];
      m[b + "'"] = [withShift(stdKey(b))];
    });
    m.hints = ['H', 'Shift+H'];
    return m;
  }

  function clone(map) {
    var m = {};
    ACTIONS.forEach(function (a) { m[a] = (map[a] || []).slice(); });
    return m;
  }

  // Normalise a key name: 'KeyR' / 'r' -> 'R', ' ' -> 'Space', 'Esc' -> 'Escape'; codes pass through.
  function normKey(k) {
    k = String(k);
    if (/^Key[A-Z]$/.test(k)) return k.slice(3);
    if (/^[a-z]$/i.test(k)) return k.toUpperCase();
    if (k === ' ' || k === 'Spacebar') return 'Space';
    if (k === 'Esc') return 'Escape';
    return k;
  }

  function combo(key, shift, alt) { return (alt ? 'Alt+' : '') + (shift ? 'Shift+' : '') + normKey(key); }
  function keyPart(c) { return String(c).replace(/^(Alt\+)?(Shift\+)?/, ''); }

  // The combo for a keyboard event, or null (Ctrl/Meta chords, a lone modifier key).
  // Letters are the printed letter (so AZERTY users get the key they see), other keys the physical code.
  function fromEvent(e) {
    if (!e || e.ctrlKey || e.metaKey) return null;
    var k = /^[a-z]$/i.test(e.key || '') ? e.key : (e.code || e.key);
    if (!k || MODIFIER_KEY.test(k) || MODIFIER_KEY.test(e.key || '')) return null;
    return combo(k, e.shiftKey, e.altKey);
  }

  function isReserved(c) { return RESERVED.indexOf(keyPart(c)) >= 0; }
  function isValidCombo(c) {
    return typeof c === 'string' && /^(Alt\+)?(Shift\+)?[A-Za-z0-9]+$/.test(c) &&
      !MODIFIER_KEY.test(keyPart(c)) && !isReserved(c);
  }

  // The action a combo triggers, or null.
  function lookup(map, c) {
    if (!c) return null;
    for (var i = 0; i < ACTIONS.length; i++) if ((map[ACTIONS[i]] || []).indexOf(c) >= 0) return ACTIONS[i];
    return null;
  }

  // Bind combo to action (adding to its keys). Returns { map, moved, error }: a key another action used
  // moves here (moved = that action); Space and Escape are refused. The input map is not changed.
  function bind(map, action, c) {
    if (ACTIONS.indexOf(action) < 0) return { map: map, moved: null, error: 'Unknown action ' + action };
    if (isReserved(c)) return { map: map, moved: null, error: keyPart(c) + ' is reserved for the timer' };
    if (!isValidCombo(c)) return { map: map, moved: null, error: 'That key can\'t be bound' };
    var m = clone(map), from = lookup(m, c);
    if (from === action) return { map: m, moved: null, error: null };
    if (from) m[from] = m[from].filter(function (x) { return x !== c; });
    m[action].push(c);
    return { map: m, moved: from, error: null };
  }

  function unbind(map, action, c) {
    var m = clone(map);
    if (m[action]) m[action] = m[action].filter(function (x) { return x !== c; });
    return m;
  }

  function serialize(map) { return JSON.stringify(clone(map)); }

  // Parse stored bindings. Unknown actions, bad combos, reserved keys and duplicates are dropped;
  // anything unreadable gives the defaults.
  function parse(str) {
    var obj;
    try { obj = JSON.parse(str); } catch (e) { return defaults(); }
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return defaults();
    var known = ACTIONS.filter(function (a) { return Array.isArray(obj[a]); });
    if (!known.length) return defaults();
    var m = emptyMap();
    known.forEach(function (a) {
      obj[a].forEach(function (c) { if (isValidCombo(c) && !lookup(m, c)) m[a].push(c); });
    });
    return m;
  }

  function defaultStorage() {
    try { return root.localStorage || null; } catch (e) { return null; }
  }
  function load(storage) {
    storage = storage || defaultStorage();
    try {
      var s = storage && storage.getItem(STORAGE_KEY);
      return s ? parse(s) : defaults();
    } catch (e) { return defaults(); }
  }
  function save(map, storage) {
    storage = storage || defaultStorage();
    try { if (storage) storage.setItem(STORAGE_KEY, serialize(map)); } catch (e) { /* ignore */ }
  }

  // ---- Labels and help text ----
  var CODE_LABEL = {
    Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', Backslash: '\\', Backquote: '`',
    BracketLeft: '[', BracketRight: ']', Minus: '-', Equal: '=', ArrowLeft: '←', ArrowRight: '→',
    ArrowUp: '↑', ArrowDown: '↓', IntlBackslash: '\\'
  };
  function keyLabel(c) {
    var mods = String(c).match(/^(Alt\+)?(Shift\+)?/)[0];
    var k = keyPart(c);
    var lab = CODE_LABEL[k] || k.replace(/^Digit(\d)$/, '$1').replace(/^Numpad/, 'Num ');
    return mods + lab;
  }
  function actionLabel(a) { return a === 'hints' ? 'Toggle hints' : a; }

  // A base is "standard" when it has exactly today's keys: its letter, Shift for prime, no 2 key.
  function isStd(map, b) {
    var k = stdKey(b);
    return same(map[b], [k]) && same(map[b + "'"], [withShift(k)]) && !(map[b + '2'] || []).length;
  }
  function same(a, b) { return (a || []).length === b.length && b.every(function (x) { return a.indexOf(x) >= 0; }); }

  // The bottom help line for a keymap. With the defaults it is the Baseline help text plus hints and timer.
  function helpText(map) {
    var parts = [], anyStd = false;
    FAMILIES.forEach(function (f, fi) {
      var std = f.bases.filter(function (b) { return isStd(map, b); });
      if (std.length) {
        anyStd = true;
        if (fi === 0) parts.push(std.join(' ') + ': turn face');
        else if (fi === 1) parts.push((std.length === 6 ? 'Alt+face' : std.map(stdKey).join(' ')) + ': wide turn');
        else if (fi === 2) parts.push(std.join(' ') + (std.join() === 'M' ? ': middle slice' : ': slice'));
        else parts.push(std.map(function (b) { return b.toUpperCase(); }).join(' ') + ': rotate cube');
      }
      f.bases.forEach(function (b) {
        if (std.indexOf(b) >= 0) return;
        [b, b + "'", b + '2'].forEach(function (a) {
          if (map[a] && map[a].length) parts.push(map[a].map(keyLabel).join('/') + ': ' + a);
        });
      });
    });
    if (anyStd) parts.push('Shift: reverse');
    parts.push('drag to rotate the view', 'scroll or pinch to zoom');
    var h = (map.hints || []).filter(function (c) { return !(/^(Alt\+)?Shift\+/.test(c) && map.hints.indexOf(c.replace('Shift+', '')) >= 0); });
    if (h.length) parts.push(h.map(keyLabel).join('/') + ': hints');
    parts.push('Space: timer');
    return parts.join('  ·  ');
  }

  // ---- Keys panel (browser) ----
  var CSS = [
    '#keys{background:#1e2128;left:50%;transform:translateX(-50%);width:600px;max-width:calc(100vw - 24px);max-height:calc(100vh - 120px);overflow-y:auto;z-index:4}',
    '#keys h2{margin:0;font-size:16px}',
    '#keys .k-top{display:flex;justify-content:space-between;align-items:center;gap:8px}',
    '#keys .k-msg{min-height:20px;margin:8px 0;color:#8fb8ff}',
    '#keys .k-msg.err{color:#ff8a80}',
    '#keys h3{font-size:13px;color:#8a909c;font-weight:600;margin:12px 0 4px}',
    '#keys .k-row{display:flex;align-items:center;gap:6px;padding:3px 0;border-top:1px solid #2a2e37;flex-wrap:wrap}',
    '#keys .k-act{width:96px;font:14px ui-monospace,Consolas,monospace;color:#fff}',
    '#keys .k-chip{display:inline-flex;align-items:center;gap:2px;background:#2a2e37;border:1px solid #444a56;border-radius:5px;padding:1px 2px 1px 7px;font:13px ui-monospace,Consolas,monospace}',
    '#keys button{background:#2a2e37;color:#eee;border:1px solid #444a56;border-radius:6px;padding:3px 9px;font:inherit;font-size:12px;cursor:pointer}',
    '#keys button:hover{background:#353a45}',
    '#keys .k-chip button{border:none;background:none;padding:0 5px;color:#8a909c;font-size:14px}',
    '#keys .k-chip button:hover{color:#fff}',
    '#keys button.k-wait{background:#24497e;border-color:#3d7bdc}',
    '#keys .k-foot{display:flex;gap:8px;margin-top:12px}'
  ].join('\n');

  // opts: getMap(), setMap(map) (saves and applies), onOpenChange(open)
  function createPanel(opts) {
    var doc = root.document;
    if (!doc.getElementById('keys-style')) {
      var st = doc.createElement('style'); st.id = 'keys-style'; st.textContent = CSS; doc.head.appendChild(st);
    }
    var panel = doc.createElement('div');
    panel.id = 'keys';
    panel.className = 'panel';
    panel.style.display = 'none';
    doc.body.appendChild(panel);
    var open = false, waiting = null, msg = '', msgErr = false;

    function el(tag, cls, text) {
      var e = doc.createElement(tag);
      if (cls) e.className = cls;
      if (text != null) e.textContent = text;
      return e;
    }
    function btn(parent, label, title, fn) {
      var b = el('button', null, label);
      b.type = 'button';
      b.tabIndex = -1;
      b.title = title;
      b.addEventListener('mousedown', function (e) { e.preventDefault(); });
      b.addEventListener('click', function () { b.blur(); fn(); });
      parent.appendChild(b);
      return b;
    }
    function say(text, err) { msg = text; msgErr = !!err; }

    function render() {
      var map = opts.getMap();
      panel.textContent = '';
      var top = el('div', 'k-top');
      top.appendChild(el('h2', null, 'Keys'));
      btn(top, 'Close', 'Close the Keys panel (Escape)', close);
      panel.appendChild(top);
      panel.appendChild(el('div', 'k-msg' + (msgErr ? ' err' : ''), msg ||
        'Add key, then press any key (Shift and Alt allowed). Space and Escape are reserved for the timer.'));
      var groups = FAMILIES.map(function (f) {
        var acts = [];
        f.bases.forEach(function (b) { acts.push(b, b + "'", b + '2'); });
        return { name: f.name, acts: acts };
      });
      groups.push({ name: 'Other', acts: ['hints'] });
      groups.forEach(function (g) {
        panel.appendChild(el('h3', null, g.name));
        g.acts.forEach(function (a) {
          var row = el('div', 'k-row');
          row.appendChild(el('span', 'k-act', actionLabel(a)));
          map[a].forEach(function (c) {
            var chip = el('span', 'k-chip', keyLabel(c));
            btn(chip, '×', 'Remove ' + keyLabel(c), function () {
              opts.setMap(unbind(opts.getMap(), a, c));
              say('Removed ' + keyLabel(c) + ' from ' + actionLabel(a) + '.');
              render();
            });
            row.appendChild(chip);
          });
          var add = btn(row, waiting === a ? 'Press a key…' : 'Add key', 'Bind a key to ' + actionLabel(a), function () {
            waiting = waiting === a ? null : a;
            say(waiting ? 'Press a key to bind to ' + actionLabel(a) + ' (Escape cancels).' : '');
            render();
          });
          if (waiting === a) add.className = 'k-wait';
          panel.appendChild(row);
        });
      });
      var foot = el('div', 'k-foot');
      btn(foot, 'Reset to defaults', 'Restore the default keys', function () {
        waiting = null;
        opts.setMap(defaults());
        say('Keys reset to the defaults.');
        render();
      });
      btn(foot, 'Close', 'Close the Keys panel (Escape)', close);
      panel.appendChild(foot);
    }

    // While open, the panel takes every key first (capture phase) so nothing reaches the cube or timer.
    function onKeyDown(e) {
      if (!open) return;
      e.stopPropagation();
      if (e.key === 'Tab') return;
      e.preventDefault();
      if (e.repeat) return;
      if (!waiting) { if (e.key === 'Escape') close(); return; }
      var c = fromEvent(e);
      if (e.key === 'Escape' && !e.shiftKey && !e.altKey) { waiting = null; say('Cancelled.'); render(); return; }
      if (!c) return;                 // a lone modifier: keep waiting
      var r = bind(opts.getMap(), waiting, c);
      if (r.error) { say(r.error + '. Press another key, or Escape to cancel.', true); render(); return; }
      opts.setMap(r.map);
      say(keyLabel(c) + ' now does ' + actionLabel(waiting) + (r.moved ? ' (moved from ' + actionLabel(r.moved) + ').' : '.'));
      waiting = null;
      render();
    }
    function onKeyUp(e) {
      if (!open) return;
      e.stopPropagation();
      if (e.key !== 'Tab') e.preventDefault();
    }
    root.addEventListener('keydown', onKeyDown, true);
    root.addEventListener('keyup', onKeyUp, true);

    function show() {
      if (open) return;
      open = true; waiting = null; say('');
      render();
      panel.style.display = '';
      if (opts.onOpenChange) opts.onOpenChange(true);
    }
    function close() {
      if (!open) return;
      open = false; waiting = null;
      panel.style.display = 'none';
      if (opts.onOpenChange) opts.onOpenChange(false);
    }
    return {
      open: show, close: close, toggle: function () { if (open) close(); else show(); },
      isOpen: function () { return open; }, el: panel
    };
  }

  var KeyMap = {
    ACTIONS: ACTIONS, FAMILIES: FAMILIES, RESERVED: RESERVED, STORAGE_KEY: STORAGE_KEY,
    defaults: defaults, fromEvent: fromEvent, combo: combo, normKey: normKey, lookup: lookup,
    bind: bind, unbind: unbind, serialize: serialize, parse: parse, load: load, save: save,
    keyLabel: keyLabel, actionLabel: actionLabel, helpText: helpText, createPanel: createPanel
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = KeyMap;
  else root.KeyMap = KeyMap;
})(typeof window !== 'undefined' ? window : this);
