// scan.js - Feature 4 logic (no DOM): validating a hand-entered or scanned state, mapping webcam
// captures to facelets, and classifying sticker colours.
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
  var STEPS = [
    { face: 'F', rot: [], title: 'Front',
      text: 'Hold any face toward the camera. Keep the same side on top for the next three steps.' },
    { face: 'R', rot: ['y'], title: 'Right',
      text: 'Turn the whole cube a quarter turn to the left, so the right side faces the camera.' },
    { face: 'B', rot: ['y2'], title: 'Back',
      text: 'Another quarter turn to the left.' },
    { face: 'L', rot: ["y'"], title: 'Left',
      text: 'Another quarter turn to the left.' },
    { face: 'U', rot: ["x'"], title: 'Up',
      text: 'One more quarter turn left (the front faces you again), then tip the top toward the camera.' },
    { face: 'D', rot: ['x'], title: 'Down',
      text: 'Tip the cube over half a turn, so the bottom faces the camera.' }
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
    var centerLab = CENTERS.map(function (i) { return labs[i]; });
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
        var rs = [], gs = [], bs = [];
        var step = Math.max(1, Math.floor(half / 6));
        for (var y = Math.round(cy - half); y < cy + half; y += step) {
          for (var x = Math.round(cx - half); x < cx + half; x += step) {
            if (x < 0 || y < 0 || x >= w || y >= h) continue;
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

  // assemble(captures) -> { state, rearranged }. captures[j] = 9 [r,g,b] in camera cell order.
  // The guided order is tried first. Otherwise each capture's face comes from its centre colour
  // and its rotation from the shared pieces. Step 1 ends up as the front, with the side at the top
  // of its picture up.
  function assemble(captures) {
    var guided = classify(readingsFromCaptures(captures));
    if (validate(guided).ok) return { state: guided, rearranged: false };
    var guidedScore = validCenters(guided) ? score(normalize(guided).state) : -1;

    var flat = [];
    captures.forEach(function (c) { c.forEach(function (rgb) { flat.push(fullBright(rgb)); }); });
    var labs = balance(flat).map(toLab);   // labs[j * 9 + k]
    // Colour frame: the capture whose centre is colour f goes on face f, so the centres are solved.
    var cands = PERMS.map(function (perm) {   // perm[j] = face (= centre colour) of capture j
      var cost = 0;
      for (var j = 0; j < 6; j++) cost += dist(labs[j * 9 + 4], PALETTE_LAB[perm[j]]);
      return { perm: perm, cost: cost };
    }).sort(function (a, b) { return a.cost - b.cost; }).slice(0, 6);

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
        if (!best || sc > best.score) best = { score: sc, state: s.slice(), perm: perm, r: r.slice() };
      }
    });
    if (!best || best.score <= guidedScore) return { state: guided, rearranged: false };

    // Orient: step 1's face to the front, the face across the top edge of its picture up.
    var f0 = best.perm[0], top = BASE[f0][ROT[best.r[0]][1]], pos = FL[top].pos, up = null;
    FL.forEach(function (f, i) {
      if (i !== top && f.pos.join() === pos.join()) up = faceOfNormal(f.normal);
    });
    var o = ORIENTATIONS.filter(function (x) { return x.centers[2] === f0 && x.centers[0] === up; })[0];
    return { state: Cube.applyAlg(best.state, o.alg), rearranged: true };
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
      if (!info.even.every(function (e) { return e >= 0.7; })) return false;
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
    frameInfo: frameInfo,
    sameFace: sameFace,
    createAutoCapture: createAutoCapture
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = Scan;
  else root.Scan = Scan;
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this));
