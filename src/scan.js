// scan.js - Feature 4/5 logic (no DOM): validating a hand-entered or scanned state, mapping webcam
// captures to facelets, classifying sticker colours and auto-capture. Feature 9: the angled view
// (top and front faces in one frame): snapping the outline, reading 18 stickers, settled detection.
// Browser: defines window.Scan (needs window.Cube). Node: require('./src/scan.js').
(function (root) {
  'use strict';

  var Cube = root.Cube || (typeof require === 'function' ? require('./core.js') : null);

  var FACES = Cube.FACES;                 // ['U','R','F','D','L','B']
  var CENTERS = [4, 13, 22, 31, 40, 49];
  var COLOR_LETTERS = ['U', 'D', 'F', 'B', 'R', 'L'];
  var OPPOSITE = { U: 'D', D: 'U', F: 'B', B: 'F', R: 'L', L: 'R' };

  // ---------------------------------------------------------------------------
  // Whole-cube orientations: the 24 rotations reachable with x / y / z.
  // ---------------------------------------------------------------------------
  var ORIENTATIONS = (function () {
    var out = [], seen = {}, frontier = [[]];
    var solved = Cube.solvedState();
    while (frontier.length) {
      var next = [];
      frontier.forEach(function (alg) {
        var s = Cube.applyAlg(solved, alg);
        var key = CENTERS.map(function (i) { return s[i]; }).join('');
        if (seen[key]) return;
        seen[key] = true;
        out.push({ alg: alg, centers: key });
        ['x', 'y', 'z'].forEach(function (r) { next.push(alg.concat([r])); });
      });
      frontier = next;
    }
    return out;
  })();

  function centerKey(state) { return CENTERS.map(function (i) { return state[i]; }).join(''); }
  function validCenters(state) {
    var k = centerKey(state);
    return ORIENTATIONS.some(function (o) { return o.centers === k; });
  }

  // Rotate a state with valid centres so its centres are the solved ones (white U, green F, red R).
  function normalize(state) {
    for (var i = 0; i < ORIENTATIONS.length; i++) {
      var inv = Cube.invertAlg(ORIENTATIONS[i].alg);
      var s = Cube.applyAlg(state, inv);
      if (centerKey(s) === 'URFDLB') return { state: s, alg: inv };
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // Piece geometry, derived from Cube.FACELETS.
  // ---------------------------------------------------------------------------
  var FL = Cube.FACELETS;
  function nonzero(p) { return (p[0] !== 0) + (p[1] !== 0) + (p[2] !== 0); }
  function det(a, b, c) {
    return a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0]);
  }
  function axisRank(n) { return n[1] !== 0 ? 0 : n[2] !== 0 ? 1 : 2; }   // y (U/D), then z (F/B), then x (R/L)

  var CORNERS = [], EDGES = [];
  (function () {
    var byPos = {};
    FL.forEach(function (f, i) {
      var key = f.pos.join();
      (byPos[key] = byPos[key] || { pos: f.pos, idx: [] }).idx.push(i);
    });
    Object.keys(byPos).forEach(function (key) {
      var p = byPos[key], n = nonzero(p.pos);
      // Order each piece's facelets by axis rank; corners are then put in a fixed cyclic order
      // (positive determinant of the three normals) so twist is consistent across positions.
      var idx = p.idx.slice().sort(function (a, b) { return axisRank(FL[a].normal) - axisRank(FL[b].normal); });
      if (n === 3) {
        if (det(FL[idx[0]].normal, FL[idx[1]].normal, FL[idx[2]].normal) < 0) idx = [idx[0], idx[2], idx[1]];
        CORNERS.push({ pos: p.pos, idx: idx });
      } else if (n === 2) {
        EDGES.push({ pos: p.pos, idx: idx });
      }
    });
  })();

  function faceOfNormal(n) {
    for (var f in Cube.NORMALS) { var m = Cube.NORMALS[f]; if (m[0] === n[0] && m[1] === n[1] && m[2] === n[2]) return f; }
    return null;
  }
  // Home colours of each piece slot on the solved cube (white U, green F, red R) = its face letters.
  CORNERS.forEach(function (c) {
    c.home = c.idx.map(function (i) { return faceOfNormal(FL[i].normal); });
    c.name = c.home.join('');
  });
  EDGES.forEach(function (e) {
    e.home = e.idx.map(function (i) { return faceOfNormal(FL[i].normal); });
    e.name = e.home.join('');
  });

  function sameSet(a, b) {
    return a.length === b.length && a.every(function (x) { return b.indexOf(x) >= 0; });
  }
  function rotateArr(a, k) { return a.slice(k).concat(a.slice(0, k)); }

  function parity(perm) {
    var seen = [], p = 0;
    for (var i = 0; i < perm.length; i++) {
      if (seen[i]) continue;
      var len = 0, j = i;
      while (!seen[j]) { seen[j] = true; j = perm[j]; len++; }
      p += len - 1;
    }
    return p % 2;
  }

  var COLOR_NAME = Cube.COLOR_NAME;
  function colorList(cols) { return cols.map(function (c) { return COLOR_NAME[c]; }).join('-'); }
  var FACE_WORD = { U: 'top', D: 'bottom', F: 'front', B: 'back', R: 'right', L: 'left' };
  function slotWord(name) { return name.split('').map(function (f) { return FACE_WORD[f]; }).join('-'); }

  // ---------------------------------------------------------------------------
  // validate(state) -> { ok, errors: [string], bad: [facelet index] }
  // state: 54 entries, each a colour letter or null (not set yet).
  // ---------------------------------------------------------------------------
  function validate(state) {
    var errors = [], bad = {};
    function mark(list) { list.forEach(function (i) { bad[i] = true; }); }
    function result() {
      return { ok: errors.length === 0, errors: errors, bad: Object.keys(bad).map(Number).sort(function (a, b) { return a - b; }) };
    }

    if (!state || state.length !== 54) { errors.push('The net must have 54 stickers.'); return result(); }
    var unset = 0, counts = {};
    COLOR_LETTERS.forEach(function (c) { counts[c] = 0; });
    state.forEach(function (c) {
      if (c == null) unset++;
      else if (counts[c] === undefined) unset++;
      else counts[c]++;
    });
    if (unset) errors.push(unset + (unset === 1 ? ' sticker is' : ' stickers are') + ' not set yet.');

    var offCount = COLOR_LETTERS.filter(function (c) { return counts[c] !== 9; });
    if (offCount.length && !unset) {
      errors.push('Each colour needs exactly 9 stickers: ' +
        offCount.map(function (c) { return COLOR_NAME[c] + ' has ' + counts[c]; }).join(', ') + '.');
    }

    var centersSet = CENTERS.every(function (i) { return counts[state[i]] !== undefined; });
    var centersOk = centersSet && validCenters(state);
    if (centersSet && !centersOk) {
      mark(CENTERS);
      errors.push('The centres don\'t match a real cube: white goes opposite yellow, green opposite blue, ' +
        'red opposite orange, and with white on top and green in front, red is on the right.');
    }
    if (unset || offCount.length || !centersOk) return result();

    // Pieces, checked on the normalized cube; facelet indices are mapped back for highlighting.
    var norm = normalize(state);
    var s = norm.state;
    var back = (function () {   // back[i] = index in `state` of what sits at index i of `s`
      var ids = []; for (var i = 0; i < 54; i++) ids.push(String(i));
      return Cube.applyAlg(ids, norm.alg).map(Number);
    })();
    function origIdx(list) { return list.map(function (i) { return back[i]; }); }

    var cornerPerm = [], cornerTwist = 0, cornerSeen = {};
    var pieceError = false;
    CORNERS.forEach(function (slot, k) {
      var cols = slot.idx.map(function (i) { return s[i]; });
      var homeK = -1;
      CORNERS.forEach(function (h, j) { if (sameSet(h.home, cols)) homeK = j; });
      if (homeK < 0) {
        pieceError = true; mark(origIdx(slot.idx));
        errors.push('No real corner is ' + colorList(cols) + ' (' + slotWord(slot.name) + ' corner).');
        return;
      }
      var t = cols.indexOf(CORNERS[homeK].home[0]);
      if (rotateArr(cols, t).join('') !== CORNERS[homeK].home.join('')) {
        pieceError = true; mark(origIdx(slot.idx));
        errors.push('The ' + slotWord(slot.name) + ' corner has its colours in mirror order; no real corner looks like that.');
        return;
      }
      if (cornerSeen[homeK] !== undefined) {
        pieceError = true; mark(origIdx(slot.idx)); mark(origIdx(CORNERS[cornerSeen[homeK]].idx));
        errors.push('Two corners are both ' + colorList(CORNERS[homeK].home) + '.');
        return;
      }
      cornerSeen[homeK] = k;
      cornerPerm[k] = homeK;
      cornerTwist += t;
    });

    var edgePerm = [], edgeFlip = 0, edgeSeen = {};
    EDGES.forEach(function (slot, k) {
      var cols = slot.idx.map(function (i) { return s[i]; });
      var homeK = -1;
      EDGES.forEach(function (h, j) { if (sameSet(h.home, cols)) homeK = j; });
      if (homeK < 0) {
        pieceError = true; mark(origIdx(slot.idx));
        errors.push('No real edge is ' + colorList(cols) + ' (' + slotWord(slot.name) + ' edge).');
        return;
      }
      if (edgeSeen[homeK] !== undefined) {
        pieceError = true; mark(origIdx(slot.idx)); mark(origIdx(EDGES[edgeSeen[homeK]].idx));
        errors.push('Two edges are both ' + colorList(EDGES[homeK].home) + '.');
        return;
      }
      edgeSeen[homeK] = k;
      edgePerm[k] = homeK;
      edgeFlip += cols[0] === EDGES[homeK].home[0] ? 0 : 1;
    });
    if (pieceError) return result();

    if (cornerTwist % 3 !== 0) {
      errors.push('A corner is twisted in place (the corner twists add up wrong). Check the corners, ' +
        'or twist one back on the real cube.');
    }
    if (edgeFlip % 2 !== 0) {
      errors.push('An edge is flipped in place. Check the edges, or flip one back on the real cube.');
    }
    if (parity(cornerPerm) !== parity(edgePerm)) {
      errors.push('Two pieces are swapped (parity). Check for two stickers entered the wrong way round, ' +
        'or swap two pieces back on the real cube.');
    }
    return result();
  }

  // ---------------------------------------------------------------------------
  // Webcam capture steps. The camera sees the front face; `rot` is the whole-cube rotation from
  // the first hold to this step's hold. cells[k] is the facelet shown at camera cell k
  // (row-major, row 0 at the top, column 0 on the left as the camera sees it).
  // ---------------------------------------------------------------------------
  // Steps are named by centre colour (standard scheme: the face letter is also its centre's colour).
  var STEPS = [
    { face: 'F', rot: [], title: 'Green',
      text: 'Show the face with the green centre, any way up.' },
    { face: 'R', rot: ['y'], title: 'Red',
      text: 'Show the face with the red centre, any way up.' },
    { face: 'B', rot: ['y2'], title: 'Blue',
      text: 'Show the face with the blue centre, any way up.' },
    { face: 'L', rot: ["y'"], title: 'Orange',
      text: 'Show the face with the orange centre, any way up.' },
    { face: 'U', rot: ["x'"], title: 'White',
      text: 'Show the face with the white centre, any way up.' },
    { face: 'D', rot: ['x'], title: 'Yellow',
      text: 'Show the face with the yellow centre, any way up.' }
  ];
  (function () {
    var ids = []; for (var i = 0; i < 54; i++) ids.push(String(i));
    STEPS.forEach(function (st) { st.cells = Cube.applyAlg(ids, st.rot).slice(18, 27).map(Number); });
  })();

  // ---------------------------------------------------------------------------
  // Colours: sRGB -> CIE Lab, palette, classification.
  // ---------------------------------------------------------------------------
  function lin(c) { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
  function toLab(rgb) {
    var r = lin(rgb[0]), g = lin(rgb[1]), b = lin(rgb[2]);
    var x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047;
    var y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    var z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
    function f(t) { return t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116; }
    var fx = f(x), fy = f(y), fz = f(z);
    return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
  }
  function dist(a, b) { var d0 = a[0] - b[0], d1 = a[1] - b[1], d2 = a[2] - b[2]; return Math.sqrt(d0 * d0 + d1 * d1 + d2 * d2); }

  // Typical sticker colours as a camera sees them.
  var PALETTE = { U: [235, 235, 230], D: [235, 220, 40], F: [20, 160, 80], B: [20, 80, 190], R: [190, 25, 40], L: [245, 110, 20] };
  var PALETTE_LAB = {};
  COLOR_LETTERS.forEach(function (c) { PALETTE_LAB[c] = toLab(PALETTE[c]); });

  // Webcams often expose dark, and auto-exposure changes from one capture to the next. A sticker's
  // channel ratios survive exposure but its brightness doesn't (dark yellow is olive, which is nearer
  // green; dark orange is nearer red), so readings are scaled to full brightness before matching.
  function fullBright(rgb) {
    var m = Math.max(rgb[0], rgb[1], rgb[2]);
    if (m < 8) return rgb;   // black: nothing to scale
    return rgb.map(function (v) { return v * 255 / m; });
  }

  // Nearest palette colour for a single reading (used for the live tint over the video).
  function nearestColor(rgb) {
    var lab = toLab(fullBright(rgb)), best = null, bd = Infinity;
    COLOR_LETTERS.forEach(function (c) { var d = dist(lab, PALETTE_LAB[c]); if (d < bd) { bd = d; best = c; } });
    return best;
  }

  // Lightness counts less than colour, so shading across a face matters less than hue.
  function weighted(a, b) { var d0 = (a[0] - b[0]) * 0.5, d1 = a[1] - b[1], d2 = a[2] - b[2]; return Math.sqrt(d0 * d0 + d1 * d1 + d2 * d2); }

  // Every cube has exactly 9 stickers of each colour, so the average of all 54 readings should be the
  // average of the palette. Scaling each channel to make it so removes the light's colour cast and
  // brightness before matching centres to palette colours.
  function balance(readings) {
    var mean = [0, 0, 0], want = [0, 0, 0];
    readings.forEach(function (c) { for (var j = 0; j < 3; j++) mean[j] += lin(c[j]) / readings.length; });
    COLOR_LETTERS.forEach(function (c) { for (var j = 0; j < 3; j++) want[j] += lin(PALETTE[c][j]) / 6; });
    return readings.map(function (c) {
      return c.map(function (v, j) {
        var l = mean[j] > 0 ? lin(v) * want[j] / mean[j] : lin(v);
        l = Math.min(1, Math.max(0, l));
        return 255 * (l <= 0.0031308 ? 12.92 * l : 1.055 * Math.pow(l, 1 / 2.4) - 0.055);
      });
    });
  }

  // classify(readings) -> state. readings[i] is the [r,g,b] read for facelet i (all 54).
  // 1. The centres pick the orientation: of the 24 orientations of a standard cube, the one whose
  //    colours best match the centre readings. 2. Each sticker goes to the centre it is closest to,
  //    greedily from the closest pairs, with exactly 9 stickers per colour.
  function classify(readings) {
    var labs = balance(readings.map(fullBright)).map(toLab);
    var centerLab = CENTERS.map(function (i) { return labs[i]; });
    var bestO = null, bestCost = Infinity;
    ORIENTATIONS.forEach(function (o) {
      var cost = 0;
      for (var k = 0; k < 6; k++) cost += dist(centerLab[k], PALETTE_LAB[o.centers[k]]);
      if (cost < bestCost) { bestCost = cost; bestO = o; }
    });
    return label(labs, bestO.centers.split(''));   // letters[k] = colour of the centre at CENTERS[k]
  }

  // Colours for all 54 Lab readings, given the centre colours: balanced assignment to the centres,
  // refined against each colour's mean. Only which stickers share a face matters, not where they are.
  function label(labs, letters) {
    // A centre reading way off its own colour (a logo, glare) is a bad reference: use the palette.
    var centerLab = CENTERS.map(function (i, k) {
      var own = dist(labs[i], PALETTE_LAB[letters[k]]), bestD = Infinity;
      COLOR_LETTERS.forEach(function (c) { bestD = Math.min(bestD, dist(labs[i], PALETTE_LAB[c])); });
      return own - bestD > WAY_OFF ? PALETTE_LAB[letters[k]] : labs[i].map(function (v, j) { return (v + PALETTE_LAB[letters[k]][j]) / 2; });
    });
    var out = assign(labs, letters, centerLab);
    // A single centre is a noisy reference: refine against the mean of each colour's 9 stickers.
    for (var iter = 0; iter < 4; iter++) {
      var means = letters.map(function (c) {
        var m = [0, 0, 0];
        out.forEach(function (x, i) { if (x === c) for (var j = 0; j < 3; j++) m[j] += labs[i][j] / 9; });
        return m;
      });
      var next = assign(labs, letters, means);
      if (next.join('') === out.join('')) break;
      out = next;
    }
    return out;
  }

  // Greedy balanced assignment: closest (sticker, colour) pairs first, 9 stickers per colour,
  // centres fixed. refs[k] is the reference Lab for letters[k].
  function assign(labs, letters, refs) {
    var out = new Array(54), left = {};
    letters.forEach(function (c, k) { out[CENTERS[k]] = c; left[c] = 8; });
    var pairs = [];
    for (var i = 0; i < 54; i++) {
      if (CENTERS.indexOf(i) >= 0) continue;
      for (var k = 0; k < 6; k++) pairs.push({ i: i, c: letters[k], d: weighted(labs[i], refs[k]) });
    }
    pairs.sort(function (a, b) { return a.d - b.d; });
    pairs.forEach(function (p) {
      if (out[p.i] !== undefined || left[p.c] === 0) return;
      out[p.i] = p.c;
      left[p.c]--;
    });
    return out;
  }

  // readings from the six captures: captures[stepIndex] = 9 [r,g,b] in camera cell order.
  function readingsFromCaptures(captures) {
    var readings = new Array(54);
    STEPS.forEach(function (st, k) {
      st.cells.forEach(function (f, cell) { readings[f] = captures[k][cell]; });
    });
    return readings;
  }

  // Median colour of a w*h RGBA pixel buffer over the middle `frac` of each of the 3x3 cells of the
  // square (x0, y0, size). Returns 9 [r,g,b] in camera cell order.
  function sampleGrid(data, w, h, x0, y0, size, frac) {
    frac = frac || 0.5;
    var out = [], cell = size / 3;
    for (var r = 0; r < 3; r++) {
      for (var c = 0; c < 3; c++) {
        var cx = x0 + (c + 0.5) * cell, cy = y0 + (r + 0.5) * cell, half = cell * frac / 2;
        // Centre caps often carry a logo in the middle: read the centre from a ring around it.
        var ring = r === 1 && c === 1, inner = cell * 0.22;
        if (ring) half = cell * 0.37;
        var rs = [], gs = [], bs = [];
        var step = Math.max(1, Math.floor(half / 6));
        for (var y = Math.round(cy - half); y < cy + half; y += step) {
          for (var x = Math.round(cx - half); x < cx + half; x += step) {
            if (x < 0 || y < 0 || x >= w || y >= h) continue;
            if (ring && Math.abs(x - cx) < inner && Math.abs(y - cy) < inner) continue;
            var p = (y * w + x) * 4;
            rs.push(data[p]); gs.push(data[p + 1]); bs.push(data[p + 2]);
          }
        }
        out.push([median(rs), median(gs), median(bs)]);
      }
    }
    return out;
  }
  function median(a) {
    if (!a.length) return 0;
    a.sort(function (x, y) { return x - y; });
    return a[a.length >> 1];
  }


  // ---------------------------------------------------------------------------
  // Captures in any order and rotation (Feature 5).
  // ---------------------------------------------------------------------------
  // BASE[f][k]: facelet of face f at camera cell k when the face is held as in its guided step.
  var BASE = {};
  STEPS.forEach(function (st) { BASE[st.face] = st.cells; });
  // A quarter turn of the picture: cell k of the turned picture shows cell QT[k] of the original.
  var QT = [6, 3, 0, 7, 4, 1, 8, 5, 2];
  var ROT = [[0, 1, 2, 3, 4, 5, 6, 7, 8]];
  for (var q = 1; q < 4; q++) ROT.push(ROT[q - 1].map(function (k) { return QT[k]; }));

  // Lookup of real pieces on the solved-centre cube, by colour code (corners in cyclic order, edges
  // either way round) -> piece number.
  var CODE = {}; FACES.forEach(function (f, i) { CODE[f] = i; });
  var CORNER_OF = new Int8Array(216).fill(-1), EDGE_OF = new Int8Array(36).fill(-1);
  CORNERS.forEach(function (c, k) {
    for (var t = 0; t < 3; t++) {
      var h = rotateArr(c.home, t);
      CORNER_OF[CODE[h[0]] * 36 + CODE[h[1]] * 6 + CODE[h[2]]] = k;
    }
  });
  EDGES.forEach(function (e, k) {
    EDGE_OF[CODE[e.home[0]] * 6 + CODE[e.home[1]]] = k;
    EDGE_OF[CODE[e.home[1]] * 6 + CODE[e.home[0]]] = k;
  });
  // How many of the 20 slots hold a real piece that no other slot holds (state with solved centres).
  function realPieces(s) {
    var seen = 0, n = 0, i, p;
    for (i = 0; i < CORNERS.length; i++) {
      var ci = CORNERS[i].idx;
      p = CORNER_OF[CODE[s[ci[0]]] * 36 + CODE[s[ci[1]]] * 6 + CODE[s[ci[2]]]];
      if (p >= 0 && !(seen & (1 << p))) { seen |= 1 << p; n++; }
    }
    for (i = 0; i < EDGES.length; i++) {
      var ei = EDGES[i].idx;
      p = EDGE_OF[CODE[s[ei[0]]] * 6 + CODE[s[ei[1]]]];
      if (p >= 0 && !(seen & (1 << (p + 8)))) { seen |= 1 << (p + 8); n++; }
    }
    return n;
  }
  function score(s) { return realPieces(s) + (validate(s).ok ? 1 : 0); }   // 21 = a valid cube

  function permutations(a) {
    if (a.length <= 1) return [a];
    var out = [];
    a.forEach(function (x, i) {
      permutations(a.slice(0, i).concat(a.slice(i + 1))).forEach(function (p) { out.push([x].concat(p)); });
    });
    return out;
  }
  var PERMS = permutations(FACES);

  // assemble(captures) -> { state, rearranged }. captures[k] = 9 [r,g,b] in camera cell order for
  // step k. The holds as instructed are tried first. Otherwise each capture's face comes from its
  // centre colour and its rotation from the shared pieces. The result has white on top, green in front.
  function assemble(captures) {
    var readings = readingsFromCaptures(captures);
    // How well centre colours fit the centre readings (letters[k] = colour taken for step k's centre).
    function centreCost(letters) {
      var c = 0;
      for (var k = 0; k < 6; k++) c += dist(toLab(fullBright(captures[k][4])), PALETTE_LAB[letters[k]]);
      return c;
    }
    // Each step's centre is taken to be that step's colour (the face letter is its colour), which
    // ignores logos. The centre readings only overrule it when they fit another orientation far
    // better, which means the faces aren't on their own steps.
    var asked = label(balance(readings.map(fullBright)).map(toLab), CENTERS.map(function (i) { return FACES[Math.floor(i / 9)]; }));
    var raw = classify(readings), guided = validCenters(raw) ? normalize(raw).state : raw;
    var askedOk = validate(asked).ok, guidedOk = validate(guided).ok;
    if (askedOk && (!guidedOk || centreCost(STEPS.map(function (st) { return st.face; })) -
        centreCost(STEPS.map(function (st) { return raw[st.cells[4]]; })) <= 2 * WAY_OFF)) {
      return { state: asked, rearranged: false };
    }
    if (guidedOk) return { state: guided, rearranged: false };
    var guidedScore = validCenters(guided) ? score(guided) : -1;

    var flat = [];
    captures.forEach(function (c) { c.forEach(function (rgb) { flat.push(fullBright(rgb)); }); });
    var labs = balance(flat).map(toLab);   // labs[j * 9 + k]
    // Colour frame: the capture whose centre is colour f goes on face f, so the centres are solved.
    var cands = PERMS.map(function (perm) {   // perm[j] = face (= centre colour) of capture j
      var cost = 0;
      for (var j = 0; j < 6; j++) cost += dist(labs[j * 9 + 4], PALETTE_LAB[perm[j]]);
      return { perm: perm, cost: cost };
    }).sort(function (a, b) { return a.cost - b.cost; }).slice(0, 6);
    // The steps' own colours are always tried too: each capture went to the step of its centre
    // colour, so this is usually right even when a logo spoils a centre reading.
    var own = STEPS.map(function (st) { return st.face; });
    if (!cands.some(function (c) { return c.perm.join('') === own.join(''); })) {
      var oc = 0;
      for (var j0 = 0; j0 < 6; j0++) oc += dist(labs[j0 * 9 + 4], PALETTE_LAB[own[j0]]);
      cands.push({ perm: own, cost: oc });
    }

    var best = null;
    cands.forEach(function (cand) {
      var perm = cand.perm, frame = new Array(54);
      perm.forEach(function (f, j) { BASE[f].forEach(function (fi, k) { frame[fi] = labs[j * 9 + k]; }); });
      var cols = label(frame, CENTERS.map(function (i) { return FACES[Math.floor(i / 9)]; }));
      var capCols = perm.map(function (f) { return BASE[f].map(function (fi) { return cols[fi]; }); });
      var s = new Array(54), r = [0, 0, 0, 0, 0, 0];
      for (var combo = 0; combo < 4096; combo++) {
        for (var j = 0; j < 6; j++) {
          r[j] = (combo >> (2 * j)) & 3;
          var map = ROT[r[j]], base = BASE[perm[j]], cc = capCols[j];
          for (var k = 0; k < 9; k++) s[base[map[k]]] = cc[k];
        }
        var sc = realPieces(s);
        if (best && sc < best.score) continue;
        if (sc === 20) sc += validate(s).ok ? 1 : 0;
        if (!best || sc > best.score || sc === best.score && cand.cost < best.cost) {
          best = { score: sc, cost: cand.cost, state: s.slice(), perm: perm, r: r.slice() };
        }
      }
    });
    if (!best || best.score <= guidedScore) return { state: guided, rearranged: false };

    return { state: best.state, rearranged: true };
  }

  // slotFor(centerRgb, allowed, preferred) -> the step in `allowed` whose centre colour is closest to
  // the reading. With `preferred` (the step being asked for), that step wins unless another allowed
  // colour is clearly closer: a logo or glare on the centre shouldn't send a face to the wrong step.
  var WAY_OFF = 25;
  function slotFor(rgb, allowed, preferred) {
    var lab = toLab(fullBright(rgb)), best = -1, bd = Infinity, dp = Infinity;
    allowed.forEach(function (k) {
      var d = dist(lab, PALETTE_LAB[STEPS[k].face]);
      if (k === preferred) dp = d;
      if (d < bd) { bd = d; best = k; }
    });
    return dp - bd <= WAY_OFF ? preferred : best;
  }

  // ---------------------------------------------------------------------------
  // Auto-capture (Feature 5).
  // ---------------------------------------------------------------------------
  function luma(c) { return 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]; }

  // frameInfo(data, w, h, x0, y0, size) -> { cells, even, gaps }. cells: as sampleGrid. even[k]: the
  // share of cell k's middle that is close to its median (1 = one even colour). gaps: how many of
  // the 12 places between neighbouring cells are dark, like the plastic between stickers.
  function frameInfo(data, w, h, x0, y0, size) {
    var cells = sampleGrid(data, w, h, x0, y0, size, 0.5), cell = size / 3, even = [];
    function px(x, y) {
      x = Math.round(x); y = Math.round(y);
      if (x < 0 || y < 0 || x >= w || y >= h) return null;
      var p = (y * w + x) * 4;
      return [data[p], data[p + 1], data[p + 2]];
    }
    for (var r = 0; r < 3; r++) for (var c = 0; c < 3; c++) {
      var m = cells[r * 3 + c], half = cell / 4, near = 0, all = 0, step = Math.max(1, half / 5);
      for (var y = y0 + (r + 0.5) * cell - half; y < y0 + (r + 0.5) * cell + half; y += step) {
        for (var x = x0 + (c + 0.5) * cell - half; x < x0 + (c + 0.5) * cell + half; x += step) {
          var v = px(x, y);
          if (!v) continue;
          all++;
          var d0 = v[0] - m[0], d1 = v[1] - m[1], d2 = v[2] - m[2];
          if (d0 * d0 + d1 * d1 + d2 * d2 < 45 * 45) near++;
        }
      }
      even.push(all ? near / all : 0);
    }
    // Between two cells, the darkest column (or row) in a band around the expected border, averaged
    // along the middle of the border, against the darker of the two cells.
    var gaps = 0, band = cell * 0.2;
    function darkest(a, b, line, vertical) {
      var lo = Infinity;
      for (var t = line - band; t <= line + band; t++) {
        var sum = 0, n = 0;
        for (var u = a; u < b; u++) {
          var v = vertical ? px(t, u) : px(u, t);
          if (v) { sum += luma(v); n++; }
        }
        if (n) lo = Math.min(lo, sum / n);
      }
      return lo;
    }
    for (var i = 0; i < 3; i++) for (var j = 1; j < 3; j++) {
      var a = y0 + (i + 0.3) * cell, b = y0 + (i + 0.7) * cell;   // vertical border, row i
      if (darkest(a, b, x0 + j * cell, true) < 0.6 * Math.min(luma(cells[i * 3 + j - 1]), luma(cells[i * 3 + j]))) gaps++;
      a = x0 + (i + 0.3) * cell; b = x0 + (i + 0.7) * cell;       // horizontal border, column i
      if (darkest(a, b, y0 + j * cell, false) < 0.6 * Math.min(luma(cells[(j - 1) * 3 + i]), luma(cells[j * 3 + i]))) gaps++;
    }
    return { cells: cells, even: even, gaps: gaps };
  }

  // Whether 9 readings show the same face as a capture (in any rotation), ignoring brightness.
  function sameFace(a, b) {
    var la = a.map(function (c) { return toLab(fullBright(c)); }), lb = b.map(function (c) { return toLab(fullBright(c)); });
    return ROT.some(function (map) {
      for (var k = 0; k < 9; k++) if (weighted(la[k], lb[map[k]]) > 14) return false;
      return true;
    });
  }

  // createAutoCapture() -> { feed(info, others) -> 'capture' | 'holding' | 'waiting', reset() }.
  // Feed it a frameInfo about every 250 ms; `others` are the captures of the other steps. It returns
  // 'capture' once a face-like view has been steady for STEADY frames, then waits for movement.
  function createAutoCapture(opts) {
    opts = opts || {};
    var STEADY = opts.steady || 3, prev = null, steady = 0, armed = true;
    function faceLike(info) {
      if (!info.even.every(function (e, k) { return k === 4 || e >= 0.7; })) return false;   // centre: logos
      var cols = {};
      info.cells.forEach(function (c) { cols[nearestColor(c)] = true; });
      return Object.keys(cols).length >= 2 || info.gaps >= 9;
    }
    return {
      feed: function (info, others) {
        var cur = info.cells.map(toLab), diff = Infinity;
        if (prev) { diff = 0; for (var k = 0; k < 9; k++) diff = Math.max(diff, dist(prev[k], cur[k])); }
        prev = cur;
        if (diff > 25 && diff !== Infinity) armed = true;
        if (!armed || !(diff < 8) || !faceLike(info)) { steady = 0; return 'waiting'; }
        if ((others || []).some(function (o) { return o && sameFace(info.cells, o); })) { steady = 0; return 'waiting'; }
        if (++steady < STEADY) return 'holding';
        steady = 0; armed = false;
        return 'capture';
      },
      reset: function () { prev = null; steady = 0; armed = true; }
    };
  }

  // ---------------------------------------------------------------------------
  // Angled view (Feature 9): the camera in front of the cube and a little above it sees the top and
  // front faces. A fit is a pinhole view of the cube: p = { x, y, s, tilt, yaw, roll, pz }, where
  // (x, y) is the image of the cube's centre, s the pixels per sticker pitch at the centre's depth,
  // tilt the downward view angle (degrees), yaw a sideways turn, roll a lean in the picture, and pz
  // the perspective (1 / distance in pitches). The image centre is taken as the optical centre.
  // ---------------------------------------------------------------------------
  var RAD = Math.PI / 180;
  var TILT_MIN = 15, TILT_MAX = 50;

  function rotation(p) {   // R = Rz(roll) * Rx(tilt) * Ry(yaw)
    var cy = Math.cos(p.yaw * RAD), sy = Math.sin(p.yaw * RAD);
    var ct = Math.cos(p.tilt * RAD), st = Math.sin(p.tilt * RAD);
    var cr = Math.cos(p.roll * RAD), sr = Math.sin(p.roll * RAD);
    var a = [[cy, 0, sy], [st * sy, ct, -st * cy], [-ct * sy, st, ct * cy]];   // Rx(tilt) * Ry(yaw)
    return [
      [cr * a[0][0] - sr * a[1][0], cr * a[0][1] - sr * a[1][1], cr * a[0][2] - sr * a[1][2]],
      [sr * a[0][0] + cr * a[1][0], sr * a[0][1] + cr * a[1][1], sr * a[0][2] + cr * a[1][2]],
      a[2]
    ];
  }
  // Image point of cube point P (pitches; +x right, +y up, +z toward the camera).
  function project(p, R, w, h, P) {
    var X = R[0][0] * P[0] + R[0][1] * P[1] + R[0][2] * P[2];
    var Y = R[1][0] * P[0] + R[1][1] * P[1] + R[1][2] * P[2];
    var Z = R[2][0] * P[0] + R[2][1] * P[1] + R[2][2] * P[2];
    var d = 1 / (1 - p.pz * Z), cx = w / 2, cy = h / 2;
    return [cx + (p.x - cx + p.s * X) * d, cy + (p.y - cy - p.s * Y) * d];
  }
  // The outline of a fit: front [top-left, top-right, bottom-right, bottom-left] and top
  // [back-left, back-right, front-right, front-left], in image pixels.
  function angledQuads(p, w, h) {
    var R = rotation(p), q = function (P) { return project(p, R, w, h, P); };
    return {
      front: [q([-1.5, 1.5, 1.5]), q([1.5, 1.5, 1.5]), q([1.5, -1.5, 1.5]), q([-1.5, -1.5, 1.5])],
      top: [q([-1.5, 1.5, -1.5]), q([1.5, 1.5, -1.5]), q([1.5, 1.5, 1.5]), q([-1.5, 1.5, 1.5])]
    };
  }
  // The outline drawn before anything is found: centred, a little below the middle.
  function defaultFit(w, h) {
    var m = Math.min(w, h), s = 0.13 * m;
    return { x: w / 2, y: h * 0.56, s: s, tilt: 30, yaw: 0, roll: 0, pz: s / (0.8 * w) };
  }

  // Homography taking the unit square (0,0) (1,0) (1,1) (0,1) to the quad q (Heckbert).
  function squareToQuad(q) {
    var x0 = q[0][0], y0 = q[0][1], x1 = q[1][0], y1 = q[1][1], x2 = q[2][0], y2 = q[2][1], x3 = q[3][0], y3 = q[3][1];
    var dx1 = x1 - x2, dx2 = x3 - x2, dx3 = x0 - x1 + x2 - x3, dy1 = y1 - y2, dy2 = y3 - y2, dy3 = y0 - y1 + y2 - y3;
    var g = 0, hh = 0, den = dx1 * dy2 - dx2 * dy1;
    if (den !== 0 && (dx3 || dy3)) { g = (dx3 * dy2 - dx2 * dy3) / den; hh = (dx1 * dy3 - dx3 * dy1) / den; }
    return [x1 - x0 + g * x1, x3 - x0 + hh * x3, x0, y1 - y0 + g * y1, y3 - y0 + hh * y3, y0, g, hh];
  }
  function mapH(H, u, v, out) {
    var z = H[6] * u + H[7] * v + 1;
    out[0] = (H[0] * u + H[1] * v + H[2]) / z;
    out[1] = (H[3] * u + H[4] * v + H[5]) / z;
    return out;
  }

  // Brightness (largest channel) of a frame, box-blurred by r pixels, so that a grid line placed on
  // a dark gap sits in a valley whose bottom is the middle of the gap.
  function brightness(data, w, h, r) {
    var n = w * h, v = new Float32Array(n), t = new Float32Array(n), i, x, y;
    for (i = 0; i < n; i++) { var p = i * 4; v[i] = Math.max(data[p], data[p + 1], data[p + 2]); }
    if (r < 1) return v;
    for (y = 0; y < h; y++) {          // horizontal pass
      var row = y * w, acc = 0, cnt = 0;
      for (x = 0; x < Math.min(r, w); x++) { acc += v[row + x]; cnt++; }
      for (x = 0; x < w; x++) {
        if (x + r < w) { acc += v[row + x + r]; cnt++; }
        if (x - r - 1 >= 0) { acc -= v[row + x - r - 1]; cnt--; }
        t[row + x] = acc / cnt;
      }
    }
    for (x = 0; x < w; x++) {          // vertical pass
      var acc2 = 0, cnt2 = 0;
      for (y = 0; y < Math.min(r, h); y++) { acc2 += t[y * w + x]; cnt2++; }
      for (y = 0; y < h; y++) {
        if (y + r < h) { acc2 += t[(y + r) * w + x]; cnt2++; }
        if (y - r - 1 >= 0) { acc2 -= t[(y - r - 1) * w + x]; cnt2--; }
        v[y * w + x] = acc2 / cnt2;
      }
    }
    return v;
  }

  // The 27 places where the grid says a dark gap is: [face, cellA, cellB, line] for 12 inside each
  // face (cells 0-8 top, 9-17 front) and 3 along the edge between the faces. line = [u0, v0, u1, v1]
  // in the face's unit square, from one end of the shared side to the other.
  var SEGMENTS = (function () {
    var out = [];
    [0, 1].forEach(function (f) {
      for (var r = 0; r < 3; r++) for (var c = 1; c < 3; c++) out.push([f, f * 9 + r * 3 + c - 1, f * 9 + r * 3 + c, [c / 3, r / 3, c / 3, (r + 1) / 3]]);
      for (var r2 = 1; r2 < 3; r2++) for (var c2 = 0; c2 < 3; c2++) out.push([f, f * 9 + (r2 - 1) * 3 + c2, f * 9 + r2 * 3 + c2, [c2 / 3, r2 / 3, (c2 + 1) / 3, r2 / 3]]);
    });
    for (var c3 = 0; c3 < 3; c3++) out.push([1, 6 + c3, 9 + c3, [c3 / 3, 0, (c3 + 1) / 3, 0]]);   // front row 0 meets top row 2
    return out;
  })();

  // How much a fit looks like stickers: each cell one even colour, darker gaps where the grid says.
  // Returns 0..1 (about 0.4 for a blank wall, 0.8+ for a cube). frontOnly: the front face alone.
  // level 0 (search): few samples, gaps looked for in a wide band across the line, so the fit only
  // has to be roughly right; 1: a narrower band; 2 (final): many samples, gaps where the grid says.
  var LEVELS = [
    { P: [0.38, 0.5, 0.62], T: [0.3, 0.7], A: [-0.3, -0.15, 0, 0.15, 0.3] },
    { P: [0.3, 0.5, 0.7], T: [0.25, 0.5, 0.75], A: [-0.12, 0, 0.12] },
    { P: [0.24, 0.37, 0.5, 0.63, 0.76], T: [0.2, 0.35, 0.5, 0.65, 0.8], A: [0] }
  ];
  function fitScore(fr, quads, level, frontOnly) {
    var w = fr.w, h = fr.h, data = fr.data, V = fr.v, LV = LEVELS[level];
    if (!inside(quads, w, h)) return -1;
    var Hs = [squareToQuad(quads.top), squareToQuad(quads.front)], pt = [0, 0];
    var P = LV.P, cellV = new Float32Array(18), even = 0, nEven = 0;
    for (var k = frontOnly ? 9 : 0; k < 18; k++) {
      var H = Hs[k < 9 ? 0 : 1], r = Math.floor((k % 9) / 3), c = k % 3, ctr = k % 9 === 4;
      var sr = 0, sg = 0, sb = 0, n = 0, rs = [], gs = [], bs = [];
      for (var i = 0; i < P.length; i++) for (var j = 0; j < P.length; j++) {
        if (ctr && Math.abs(P[i] - 0.5) < 0.1 && Math.abs(P[j] - 0.5) < 0.1) continue;   // logo
        mapH(H, (c + P[j]) / 3, (r + P[i]) / 3, pt);
        var q = ((pt[1] | 0) * w + (pt[0] | 0)) * 4;
        rs.push(data[q]); gs.push(data[q + 1]); bs.push(data[q + 2]);
        sr += data[q]; sg += data[q + 1]; sb += data[q + 2]; n++;
      }
      sr /= n; sg /= n; sb /= n;
      var spread = 0;
      for (var m = 0; m < n; m++) spread += Math.abs(rs[m] - sr) + Math.abs(gs[m] - sg) + Math.abs(bs[m] - sb);
      spread /= 3 * n;
      cellV[k] = Math.max(sr, sg, sb);
      if (!ctr) { even += Math.max(0, 1 - spread / (8 + 0.12 * cellV[k])); nEven++; }
    }
    var T = LV.T, A = LV.A, gap = 0, nGap = 0;
    for (var g = 0; g < SEGMENTS.length; g++) {
      var sg2 = SEGMENTS[g], L = sg2[3], H2 = Hs[sg2[0]];
      if (frontOnly && sg2[1] < 9) continue;
      var nu = L[1] === L[3] ? 0 : 1, nv = 1 - nu;   // across the line (unit-square direction)
      var sum = 0;
      for (var t = 0; t < T.length; t++) {
        var u = L[0] + (L[2] - L[0]) * T[t], v = L[1] + (L[3] - L[1]) * T[t], lo = Infinity;
        for (var a = 0; a < A.length; a++) {
          mapH(H2, u + nu * A[a] / 3, v + nv * A[a] / 3, pt);
          var val = V[(pt[1] | 0) * w + (pt[0] | 0)];
          if (val < lo) lo = val;
        }
        sum += lo;
      }
      var gv = sum / T.length, mv = Math.min(cellV[sg2[1]], cellV[sg2[2]]);
      gap += Math.max(-1, Math.min(1, (mv - gv) / (mv + 6)));
      nGap++;
    }
    return 0.6 * gap / nGap + 0.4 * even / nEven;
  }
  function inside(quads, w, h) {
    var all = quads.top.concat(quads.front);
    for (var i = 0; i < all.length; i++) {
      if (!(all[i][0] >= 1 && all[i][1] >= 1 && all[i][0] < w - 1 && all[i][1] < h - 1)) return false;
    }
    return true;
  }

  // The search works with the front face's centre (fx, fy) in place of the cube's centre, so that
  // trying another tilt or turn leaves the front face where it is.
  function fromFront(a, w, h) {
    var p = { x: 0, y: 0, s: a.s, tilt: a.tilt, yaw: a.yaw, roll: a.roll, pz: a.pz }, R = rotation(p);
    var X = R[0][2] * 1.5, Y = R[1][2] * 1.5, Z = R[2][2] * 1.5, d = 1 / (1 - a.pz * Z);
    p.x = (a.fx - w / 2) / d + w / 2 - a.s * X;
    p.y = (a.fy - h / 2) / d + h / 2 + a.s * Y;
    return p;
  }
  function toFront(p, w, h) {
    var f = project(p, rotation(p), w, h, [0, 0, 1.5]);
    return { fx: f[0], fy: f[1], s: p.s, tilt: p.tilt, yaw: p.yaw, roll: p.roll, pz: p.pz };
  }
  function scoreA(fr, a, level, frontOnly) { return fitScore(fr, angledQuads(fromFront(a, fr.w, fr.h), fr.w, fr.h), level, frontOnly); }
  function copyA(a) { return { fx: a.fx, fy: a.fy, s: a.s, tilt: a.tilt, yaw: a.yaw, roll: a.roll, pz: a.pz }; }
  function copyFit(p) { return { x: p.x, y: p.y, s: p.s, tilt: p.tilt, yaw: p.yaw, roll: p.roll, pz: p.pz }; }

  var SNAP_OK = 0.62;   // below this, nothing fits: the outline is dashed and nothing is read

  // snapAngled(data, w, h, opts) -> { ok, fit, quads, score }. Looks around opts.around (where the
  // outline is drawn; default: the default outline): 1. the front face over positions, sizes, two
  // tilts and small sideways turns; 2. the best 16 are polished on the front face's gaps and
  // ranked; 3. for the best 5, the top face over tilts of 15-50 degrees, sideways turns and
  // perspective, keeping 3 clearly different tilts; 4. each is polished on all 24 inner gaps; the
  // best by fitScore is finished on the sticker centres. ok: the fit looks enough like stickers.
  function snapAngled(data, w, h, opts) {
    opts = opts || {};
    var base = opts.around || defaultFit(w, h), b0 = toFront(base, w, h);
    var fr = { data: data, w: w, h: h, v: brightness(data, w, h, Math.max(1, Math.round(0.05 * base.s))), v1: brightness(data, w, h, 1) };
    // opts.track: opts.around is the last frame's fit. A cube held still (or moved a little) is
    // followed from there, which is far quicker than a search; the search is the fallback.
    if (opts.track && opts.around) {
      var tp = finish(fr, polish(fr, opts.around, 6), 2), tsc = fitScore(fr, angledQuads(tp, w, h), 2);
      if (tsc >= SNAP_OK + 0.04) return { ok: true, fit: tp, quads: angledQuads(tp, w, h), score: tsc };
    }
    var fronts = [];
    [0.7, 0.8, 0.9, 1, 1.12, 1.25, 1.4].forEach(function (k) {
      var s = base.s * k, step = 0.3 * s, rx = Math.max(1.6 * base.s, 2 * step), ry = Math.max(1.3 * base.s, 2 * step);
      for (var dx = -rx; dx <= rx + 1e-9; dx += step) for (var dy = -ry; dy <= ry + 1e-9; dy += step) {
        var los = sight(b0.fx + dx, b0.fy + dy - 1.8 * s, w, h);
        for (var t = 22; t <= 44; t += 22) {
          [-6, 0, 6].forEach(function (yaw) {
            var a = { fx: b0.fx + dx, fy: b0.fy + dy, s: s, tilt: t + los.up, yaw: yaw - los.right, roll: 0, pz: s / (0.8 * w) };
            var sc = scoreA(fr, a, 0, true);
            if (sc > 0.45) fronts.push({ a: a, sc: sc });
          });
        }
      }
    });
    var polished = distinct(fronts, 16).map(function (f) {
      var p = polish(fr, fromFront(f.a, w, h), 4, true);
      return { a: toFront(p, w, h), sc: fitScore(fr, angledQuads(p, w, h), 2, true) };
    });
    var best = null;
    distinct(polished, 5).forEach(function (c) {
      topSearch(fr, c.a, 3).forEach(function (ts) {
        var p0 = fromFront(ts, w, h), s0 = fitScore(fr, angledQuads(p0, w, h), 2);
        var p = polish(fr, p0, 6), sc = fitScore(fr, angledQuads(p, w, h), 2);
        if (sc < s0) { p = p0; sc = s0; }
        if (!best || sc > best.sc) best = { p: p, sc: sc };
      });
    });
    if (!best) { var d = copyFit(base); return { ok: false, fit: d, quads: angledQuads(d, w, h), score: 0 }; }
    var p = finish(fr, best.p, 3), sc = fitScore(fr, angledQuads(p, w, h), 2);
    if (sc < best.sc - 0.02) { p = best.p; sc = best.sc; }
    return { ok: sc >= SNAP_OK, fit: p, quads: angledQuads(p, w, h), score: sc };
  }
  // With the front face in place, the top face over tilts, sideways turns and perspective: the n
  // best of clearly different tilts, each to be polished.
  function topSearch(fr, a, n) {
    var pz0 = a.s / (0.8 * fr.w), list = [], los = sight(a.fx, a.fy - 1.8 * a.s, fr.w, fr.h);
    for (var t = TILT_MIN - 2 + los.up; t <= TILT_MAX + 2 + los.up; t += 1.5) {
      for (var yaw = -10 - los.right; yaw <= 10 - los.right; yaw += 2.5) {
        [0.85, 1.15].forEach(function (k) {
          var q = copyA(a); q.tilt = t; q.yaw = yaw; q.pz = pz0 * k;
          list.push({ a: q, sc: scoreA(fr, q, 1) });
        });
      }
    }
    list.sort(function (x, y) { return y.sc - x.sc; });
    var out = [];
    for (var i = 0; i < list.length && out.length < n; i++) {
      var q = list[i].a;
      if (out.some(function (o) { return Math.abs(o.tilt - q.tilt) < 4; })) continue;
      out.push(q);
    }
    return out;
  }
  // The n best candidates, skipping near-duplicates of better ones.
  function distinct(list, n) {
    list.sort(function (a, b) { return b.sc - a.sc; });
    var out = [];
    for (var i = 0; i < list.length && out.length < n; i++) {
      var c = list[i].a;
      if (out.some(function (o) { return Math.abs(o.a.fx - c.fx) < 0.4 * c.s && Math.abs(o.a.fy - c.fy) < 0.4 * c.s && Math.abs(o.a.s / c.s - 1) < 0.25; })) continue;
      out.push(list[i]);
    }
    return out;
  }

  var LIMITS = { tilt: [TILT_MIN - 12, TILT_MAX + 17], yaw: [-28, 28], roll: [-15, 15], pz: [0, 0.15] };
  // Tilt and sideways turn are as seen along the line of sight to the point (x, y) (for the tilt,
  // about the top face's centre). The fit's angles are against the camera's axis, so a top face
  // high in the picture (seen from lower down) needs more tilt, by `up` degrees, and a cube to the
  // right less turn, by `right` (for a typical webcam's field of view).
  function sight(x, y, w, h) {
    var f = 0.8 * w;
    return { up: Math.atan2(h / 2 - y, f) / RAD, right: Math.atan2(x - w / 2, f) / RAD };
  }

  // Sticker centres (16; the two centres are left out for logos) in cube coordinates.
  var STICKER_PTS = [];
  for (var sk = 0; sk < 18; sk++) {
    if (sk % 9 === 4) continue;
    var sr0 = Math.floor((sk % 9) / 3), sc0 = sk % 3;
    STICKER_PTS.push({ k: sk, P: sk < 9 ? [sc0 - 1, 1.5, sr0 - 1] : [sc0 - 1, 1 - sr0, 1.5] });
  }
  function invH(H) {   // inverse of [[a b c][d e f][g h 1]], scaled so the last entry is 1
    var a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
    var A = e - f * h, B = c * h - b, C = b * f - c * e, D = f * g - d, E = a - c * g, F = c * d - a * f, G = d * h - e * g, Hh = b * g - a * h, I = a * e - b * d;
    return [A / I, B / I, C / I, D / I, E / I, F / I, G / I, Hh / I];
  }
  // Polish: find each gap where it really is (the darkest point across the grid line, within 0.4 of
  // a sticker either side), then a damped least-squares (Levenberg-Marquardt) fit of the model to
  // those points, a few times over. It needs no colours, so faces of one colour are no problem.
  // front: the front face's gaps only (position, size, lean and, from its height, tilt).
  function polish(fr, p0, iters, front) {
    var p = copyFit(p0);
    for (var iter = 0; iter < iters; iter++) {
      var obs = gapPoints(fr, p, front);
      if (obs.length < (front ? 8 : 16)) return p;
      var next = fitPoints(obs, p, fr.w, fr.h, front ? ['x', 'y', 's', 'tilt', 'roll'] : ['x', 'y', 's', 'tilt', 'yaw', 'roll', 'pz']);
      var moved = Math.abs(next.x - p.x) + Math.abs(next.y - p.y);
      p = next;
      if (moved < 0.05) break;
    }
    return p;
  }
  // Points along the 24 grid lines inside the faces: { P (cube point on the line), d (image
  // direction across the line), x, y (where the gap's middle was found) }.
  var SCAN = []; for (var sa = -0.4; sa <= 0.4001; sa += 0.04) SCAN.push(sa);
  function gapPoints(fr, p, front) {
    var w = fr.w, h = fr.h, V = fr.v1, quads = angledQuads(p, w, h), obs = [], pt = [0, 0], q2 = [0, 0];
    var Hs = [squareToQuad(quads.top), squareToQuad(quads.front)];
    SEGMENTS.forEach(function (sg) {
      if (sg[1] >= 6 && sg[1] < 9 && sg[2] >= 9) return;   // the edge between the faces: two planes
      if (front && sg[0] === 0) return;
      var f = sg[0], L = sg[3], H = Hs[f], nu = L[1] === L[3] ? 0 : 1, nv = 1 - nu;
      [0.3, 0.7].forEach(function (t) {
        var u = L[0] + (L[2] - L[0]) * t, v = L[1] + (L[3] - L[1]) * t, vals = [], best = -1, lo = Infinity;
        for (var i = 0; i < SCAN.length; i++) {
          mapH(H, u + nu * SCAN[i] / 3, v + nv * SCAN[i] / 3, pt);
          var x = pt[0] | 0, y = pt[1] | 0;
          var val = x >= 0 && y >= 0 && x < w && y < h ? V[y * w + x] : Infinity;
          vals.push(val);
          if (val < lo) { lo = val; best = i; }
        }
        // A real gap: clearly darker than the stickers on both sides of it.
        var left = Math.max.apply(null, vals.slice(0, Math.max(1, best))), right = Math.max.apply(null, vals.slice(best + 1).concat([-Infinity]));
        if (best <= 0 || best >= SCAN.length - 1 || !(lo < 0.7 * Math.min(left, right))) return;
        // The middle of the dark run: where it crosses half way to the stickers on either side.
        var half = (lo + Math.min(left, right)) / 2, i0 = best, i1 = best;
        while (i0 > 0 && vals[i0 - 1] < half) i0--;
        while (i1 < SCAN.length - 1 && vals[i1 + 1] < half) i1++;
        if (i0 === 0 || i1 === SCAN.length - 1) return;
        var e0 = i0 - (half - vals[i0]) / (vals[i0 - 1] - vals[i0]), e1 = i1 + (half - vals[i1]) / (vals[i1 + 1] - vals[i1]);
        var off = SCAN[0] + (e0 + e1) / 2 * 0.04;
        mapH(H, u + nu * off / 3, v + nv * off / 3, pt);
        mapH(H, u, v, q2);
        var x0 = q2[0], y0 = q2[1];
        mapH(H, u + nu * 0.01, v + nv * 0.01, q2);
        var dx = q2[0] - x0, dy = q2[1] - y0, n = Math.sqrt(dx * dx + dy * dy) || 1;
        obs.push({ P: facePoint(f, u, v), d: [dx / n, dy / n], x: pt[0], y: pt[1] });
      });
    });
    return obs;
  }
  // Final touch, once the fit is close: the centroid of each sticker (pixels inside its cell that
  // are bright and of its colour). Sharper than the gaps, but only right when the fit is close.
  function finish(fr, p0, iters) {
    var p = copyFit(p0);
    for (var iter = 0; iter < iters; iter++) {
      var obs = centroids(fr, p, 1);
      if (obs.length < 20) return p;
      p = fitPoints(obs, p, fr.w, fr.h, ['x', 'y', 's', 'tilt', 'yaw', 'roll', 'pz']);
    }
    return p;
  }
  function centroids(fr, p, st) {
    var w = fr.w, h = fr.h, data = fr.data, quads = angledQuads(p, w, h);
    var Hs = [squareToQuad(quads.top), squareToQuad(quads.front)], Hi = Hs.map(invH), obs = [], pt = [0, 0];
    STICKER_PTS.forEach(function (sp) {
      var k = sp.k, f = k < 9 ? 0 : 1, r = Math.floor((k % 9) / 3), c = k % 3, H = Hs[f];
      var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      [[0, 0], [1, 0], [1, 1], [0, 1]].forEach(function (u) {
        mapH(H, (c + u[0]) / 3, (r + u[1]) / 3, pt);
        x0 = Math.min(x0, pt[0]); x1 = Math.max(x1, pt[0]); y0 = Math.min(y0, pt[1]); y1 = Math.max(y1, pt[1]);
      });
      x0 = Math.max(0, Math.floor(x0)); y0 = Math.max(0, Math.floor(y0)); x1 = Math.min(w - 1, Math.ceil(x1)); y1 = Math.min(h - 1, Math.ceil(y1));
      var rs = [], gs = [], bs = [];
      [[0.5, 0.5], [0.35, 0.35], [0.65, 0.35], [0.35, 0.65], [0.65, 0.65]].forEach(function (u) {
        mapH(H, (c + u[0]) / 3, (r + u[1]) / 3, pt);
        var q0 = ((pt[1] | 0) * w + (pt[0] | 0)) * 4;
        if (q0 >= 0 && q0 < data.length) { rs.push(data[q0]); gs.push(data[q0 + 1]); bs.push(data[q0 + 2]); }
      });
      if (!rs.length) return;
      var mr = median(rs), mg = median(gs), mb = median(bs), thr = 0.5 * Math.max(mr, mg, mb), tol = 60 * 60;
      var sx = 0, sy = 0, n = 0, inv = Hi[f];
      for (var y = y0; y <= y1; y += st) for (var x = x0; x <= x1; x += st) {
        mapH(inv, x + 0.5, y + 0.5, pt);
        var u = pt[0] * 3 - c, v = pt[1] * 3 - r;
        if (u < 0.04 || u > 0.96 || v < 0.04 || v > 0.96) continue;
        var q = (y * w + x) * 4, R = data[q], G = data[q + 1], B = data[q + 2];
        if (Math.max(R, G, B) < thr || (R - mr) * (R - mr) + (G - mg) * (G - mg) + (B - mb) * (B - mb) > tol) continue;
        sx += x + 0.5; sy += y + 0.5; n++;
      }
      if (n > 4) { obs.push({ P: sp.P, d: [1, 0], x: sx / n, y: sy / n }); obs.push({ P: sp.P, d: [0, 1], x: sx / n, y: sy / n }); }
    });
    return obs;
  }
  // Cube point of (u, v) in a face's unit square: top (back row at v = 0) or front.
  function facePoint(f, u, v) { return f === 0 ? [3 * u - 1.5, 1.5, 3 * v - 1.5] : [3 * u - 1.5, 1.5 - 3 * v, 1.5]; }
  // Levenberg-Marquardt over the parameters named in keys: each point's distance across its line.
  function fitPoints(obs, p0, w, h, keys) {
    var EPS = { x: 0.5, y: 0.5, s: 0.005 * p0.s, tilt: 0.2, yaw: 0.2, roll: 0.2, pz: 0.002 };
    // The perspective is only loosely fixed by the points, so it is held near where it started
    // (one pixel of residual per 25% change).
    function resid(q) {
      var R = rotation(q), out = [];
      obs.forEach(function (o) { var m = project(q, R, w, h, o.P); out.push((m[0] - o.x) * o.d[0] + (m[1] - o.y) * o.d[1]); });
      out.push((q.pz - p0.pz) / (0.25 * p0.pz + 1e-6));
      return out;
    }
    function sq(r) { return r.reduce(function (a, v) { return a + v * v; }, 0); }
    var p = copyFit(p0), r0 = resid(p), e0 = sq(r0), lambda = 1e-3;
    for (var it = 0; it < 8; it++) {
      var J = keys.map(function (key) {
        var q = copyFit(p); q[key] += EPS[key];
        return resid(q).map(function (v, i) { return (v - r0[i]) / EPS[key]; });
      });
      var n = keys.length, M = [], g = [];
      for (var i = 0; i < n; i++) {
        M.push([]);
        g.push(-J[i].reduce(function (a, v, t) { return a + v * r0[t]; }, 0));
        for (var j = 0; j < n; j++) M[i].push(J[i].reduce(function (a, v, t) { return a + v * J[j][t]; }, 0));
      }
      var moved = false;
      for (var tries = 0; tries < 6 && !moved; tries++) {
        var A = M.map(function (row, a) { return row.map(function (v, b) { return a === b ? v * (1 + lambda) + 1e-9 : v; }); });
        var delta = solve(A, g);
        if (!delta) return p;
        var next = copyFit(p);
        keys.forEach(function (key, k) { next[key] += delta[k]; });
        Object.keys(LIMITS).forEach(function (key) { next[key] = Math.max(LIMITS[key][0], Math.min(LIMITS[key][1], next[key])); });
        var r1 = resid(next), e1 = sq(r1);
        if (e1 < e0) { p = next; r0 = r1; moved = e0 - e1 > 1e-4 * e0; e0 = e1; lambda = Math.max(1e-6, lambda / 4); if (!moved) return p; }
        else lambda *= 8;
      }
      if (!moved) return p;
    }
    return p;
  }
  function solve(M, g) {   // Gaussian elimination with partial pivoting
    var n = g.length, A = M.map(function (row, i) { return row.concat([g[i]]); });
    for (var c = 0; c < n; c++) {
      var piv = c;
      for (var r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r;
      if (Math.abs(A[piv][c]) < 1e-12) return null;
      var tmp = A[c]; A[c] = A[piv]; A[piv] = tmp;
      for (var r2 = c + 1; r2 < n; r2++) {
        var f = A[r2][c] / A[c][c];
        for (var k = c; k <= n; k++) A[r2][k] -= f * A[c][k];
      }
    }
    var x = new Array(n);
    for (var i = n - 1; i >= 0; i--) {
      var sum = A[i][n];
      for (var j = i + 1; j < n; j++) sum -= A[i][j] * x[j];
      x[i] = sum / A[i][i];
    }
    return x;
  }

  // readAngled(data, w, h, quads, opts) -> the 18 stickers of a snapped view.
  //   cells[0..8]: top face, as seen from above with its far side at the top (like a capture of
  //   that face); cells[9..17]: front face. Each is the median of the middle of the sticker (a
  //   ring for the centre, so logos don't matter).
  //   even[k], gaps (how many of the 27 places between stickers are dark), aligned (every cell even
  //   and every gap dark: a part-turned layer breaks this), confidence (0..1), letters (nearest
  //   colours, using opts.ref - this cube's scanned colours - when given).
  //   settled: aligned and steady for opts.steadyMs (250) since opts.prev, the previous result,
  //   at time opts.now (ms). since: when this steady, aligned stretch began.
  function readAngled(data, w, h, quads, opts) {
    opts = opts || {};
    var Hs = [squareToQuad(quads.top), squareToQuad(quads.front)], pt = [0, 0];
    function px(H, u, v) {
      mapH(H, u, v, pt);
      var x = Math.round(pt[0]), y = Math.round(pt[1]);
      if (x < 0 || y < 0 || x >= w || y >= h) return -1;
      return (y * w + x) * 4;
    }
    var cells = [], even = [], N = 7;
    for (var k = 0; k < 18; k++) {
      var H = Hs[k < 9 ? 0 : 1], r = Math.floor((k % 9) / 3), c = k % 3, ring = k % 9 === 4;
      var half = ring ? 0.37 : 0.25, inner = 0.22, rs = [], gs = [], bs = [], mid = [];
      for (var i = 0; i < N; i++) for (var j = 0; j < N; j++) {
        var du = (j / (N - 1) * 2 - 1) * half, dv = (i / (N - 1) * 2 - 1) * half;
        if (ring && Math.abs(du) < inner && Math.abs(dv) < inner) continue;
        var q = px(H, (c + 0.5 + du) / 3, (r + 0.5 + dv) / 3);
        if (q < 0) continue;
        rs.push(data[q]); gs.push(data[q + 1]); bs.push(data[q + 2]);
        if (Math.abs(du) <= 0.25 && Math.abs(dv) <= 0.25) mid.push(q);
      }
      var m = [median(rs), median(gs), median(bs)];
      cells.push(m);
      var near = 0;
      mid.forEach(function (q2) {
        var d0 = data[q2] - m[0], d1 = data[q2 + 1] - m[1], d2 = data[q2 + 2] - m[2];
        if (d0 * d0 + d1 * d1 + d2 * d2 < 45 * 45) near++;
      });
      even.push(mid.length ? near / mid.length : 0);
    }
    // Gaps: at three places along each, the darkest of a narrow band across it, against the darker
    // of the two stickers either side.
    var gaps = 0, contrast = 0;
    SEGMENTS.forEach(function (sg) {
      var L = sg[3], H2 = Hs[sg[0]], nu = L[1] === L[3] ? 0 : 1, nv = 1 - nu;
      var mv = Math.min(Math.max.apply(null, cells[sg[1]]), Math.max.apply(null, cells[sg[2]])), dark = 0, worst = 0;
      [0.25, 0.5, 0.75].forEach(function (t) {
        var u = L[0] + (L[2] - L[0]) * t, v = L[1] + (L[3] - L[1]) * t, lo = Infinity;
        [-0.06, -0.03, 0, 0.03, 0.06].forEach(function (a) {
          var q = px(H2, u + nu * a / 3, v + nv * a / 3);
          if (q >= 0) lo = Math.min(lo, Math.max(data[q], data[q + 1], data[q + 2]));
        });
        if (lo < 0.6 * mv) dark++;
        worst = Math.max(worst, lo);
      });
      if (dark === 3) gaps++;
      contrast += Math.max(0, Math.min(1, (mv - worst) / (mv + 1)));
    });
    var evenOk = even.every(function (e, k) { return k % 9 === 4 || e >= 0.7; });
    var aligned = evenOk && gaps === SEGMENTS.length;
    var meanEven = even.reduce(function (a, e, k) { return k % 9 === 4 ? a : a + e; }, 0) / 16;
    var confidence = Math.round(100 * meanEven * contrast / SEGMENTS.length) / 100;
    var now = opts.now || 0, prev = opts.prev, since = null;
    if (aligned) {
      since = now;
      if (prev && prev.aligned && prev.since != null && sameCells(prev.cells, cells, 8)) since = prev.since;
    }
    var steadyMs = opts.steadyMs || 250;
    return {
      cells: cells, even: even, gaps: gaps, aligned: aligned, confidence: confidence,
      letters: cells.map(function (c) { return nearestRef(c, opts.ref); }),
      since: since, settled: aligned && now - since >= steadyMs
    };
  }
  function sameCells(a, b, tol) {
    for (var k = 0; k < a.length; k++) if (dist(toLab(a[k]), toLab(b[k])) > tol) return false;
    return true;
  }

  // This cube's own colours (Lab at full brightness), from a finished scan: ref[letter].
  // captures as for assemble, state the assembled cube (white on top, green in front). Each
  // capture's rotation is the one that best matches the state's colours on that face.
  function reference(captures, state) {
    var sums = {}, counts = {};
    COLOR_LETTERS.forEach(function (c) { sums[c] = [0, 0, 0]; counts[c] = 0; });
    STEPS.forEach(function (st, k) {
      var labs = captures[k].map(function (c) { return toLab(fullBright(c)); }), best = null, bd = Infinity;
      ROT.forEach(function (map) {
        var d = 0;
        for (var j = 0; j < 9; j++) d += dist(labs[j], PALETTE_LAB[state[BASE[st.face][map[j]]]]);
        if (d < bd) { bd = d; best = map; }
      });
      for (var j = 0; j < 9; j++) {
        var col = state[BASE[st.face][best[j]]];
        for (var t = 0; t < 3; t++) sums[col][t] += labs[j][t];
        counts[col]++;
      }
    });
    var ref = {};
    COLOR_LETTERS.forEach(function (c) { ref[c] = counts[c] ? sums[c].map(function (v) { return v / counts[c]; }) : PALETTE_LAB[c]; });
    return ref;
  }
  function refLab(letter, ref) { return ref && ref[letter] ? ref[letter] : PALETTE_LAB[letter]; }
  function nearestRef(rgb, ref) {
    if (!ref) return nearestColor(rgb);
    var lab = toLab(fullBright(rgb)), best = null, bd = Infinity;
    COLOR_LETTERS.forEach(function (c) { var d = dist(lab, ref[c]); if (d < bd) { bd = d; best = c; } });
    return best;
  }

  // quickSlots(read, filled, ref) -> [step for the top face, step for the front face]. The two
  // faces shown are neighbours (never opposite colours) and different; of those pairs, the one whose
  // colours best fit the two centre readings, preferring steps that are still empty (filled[k]).
  function quickSlots(read, filled, ref) {
    var lt = toLab(fullBright(read.cells[4])), lf = toLab(fullBright(read.cells[13])), best = null, bd = Infinity;
    for (var a = 0; a < 6; a++) for (var b = 0; b < 6; b++) {
      var fa = STEPS[a].face, fb = STEPS[b].face;
      if (a === b || OPPOSITE[fa] === fb) continue;
      var d = dist(lt, refLab(fa, ref)) + dist(lf, refLab(fb, ref)) + (filled && filled[a] ? WAY_OFF : 0) + (filled && filled[b] ? WAY_OFF : 0);
      if (d < bd) { bd = d; best = [a, b]; }
    }
    return best;
  }

  // createAngledCapture() -> { feed(read, others) -> 'capture' | 'holding' | 'waiting', reset() }.
  // Like createAutoCapture, for a readAngled result: captures a view that is aligned (every sticker
  // even, every gap dark) and steady for STEADY frames, unless both faces were captured already;
  // then waits for the cube to move.
  function createAngledCapture(opts) {
    opts = opts || {};
    var STEADY = opts.steady || 3, prev = null, steady = 0, armed = true;
    return {
      feed: function (read, others) {
        var cur = read ? read.cells.map(toLab) : null, diff = Infinity;
        if (prev && cur) { diff = 0; for (var k = 0; k < 18; k++) diff = Math.max(diff, dist(prev[k], cur[k])); }
        prev = cur;
        if (!cur || diff > 25 && diff !== Infinity) armed = true;
        if (!read || !armed || !(diff < 8) || !read.aligned) { steady = 0; return 'waiting'; }
        var seen = function (cells) { return (others || []).some(function (o) { return o && sameFace(cells, o); }); };
        if (seen(read.cells.slice(0, 9)) && seen(read.cells.slice(9))) { steady = 0; return 'waiting'; }
        if (++steady < STEADY) return 'holding';
        steady = 0; armed = false;
        return 'capture';
      },
      reset: function () { prev = null; steady = 0; armed = true; }
    };
  }

  var Scan = {
    ORIENTATIONS: ORIENTATIONS,
    CENTERS: CENTERS,
    COLOR_LETTERS: COLOR_LETTERS,
    OPPOSITE: OPPOSITE,
    STEPS: STEPS,
    PALETTE: PALETTE,
    validCenters: validCenters,
    normalize: normalize,
    validate: validate,
    toLab: toLab,
    nearestColor: nearestColor,
    classify: classify,
    readingsFromCaptures: readingsFromCaptures,
    sampleGrid: sampleGrid,
    assemble: assemble,
    slotFor: slotFor,
    frameInfo: frameInfo,
    sameFace: sameFace,
    createAutoCapture: createAutoCapture,
    // Feature 9: angled view
    TILT_MIN: TILT_MIN,
    TILT_MAX: TILT_MAX,
    defaultFit: defaultFit,
    angledQuads: angledQuads,
    squareToQuad: squareToQuad,
    snapAngled: snapAngled,
    readAngled: readAngled,
    reference: reference,
    nearestRef: nearestRef,
    quickSlots: quickSlots,
    createAngledCapture: createAngledCapture
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = Scan;
  else root.Scan = Scan;
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this));
