// view3d.js - Three.js r128 cube renderer (main cube and mini cubes).
// Browser: defines window.CubeView (needs global THREE and window.Cube).
// Node: require('./src/view3d.js') gives the pure mapping helpers only (no THREE needed).
(function (root) {
  'use strict';

  var Cube = root.Cube || (typeof require === 'function' ? require('./core.js') : null);
  var AXIS_I = { x: 0, y: 1, z: 2 };
  var IDENTITY = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];

  // ---------------------------------------------------------------------------
  // Pure mapping helpers. A "model" is 27 cubie records:
  //   { home:[x,y,z], pos:[x,y,z], rot:3x3 int matrix (rows), stickers:[{local:[nx,ny,nz], color}] }
  // A sticker's world normal is rot * local; with pos it names one core facelet.
  // ---------------------------------------------------------------------------

  // Integer rotation matrix for q quarter turns about axis (same convention as Cube.rotateVec
  // and as a Three.js rotation of q*PI/2). Columns are the rotated basis vectors.
  function rotationMatrix(axis, q) {
    var cols = [[1, 0, 0], [0, 1, 0], [0, 0, 1]].map(function (e) { return Cube.rotateVec(e, axis, q); });
    return [0, 1, 2].map(function (r) { return [cols[0][r], cols[1][r], cols[2][r]]; });
  }

  function mulMat(a, b) {
    return [0, 1, 2].map(function (r) {
      return [0, 1, 2].map(function (c) { return a[r][0] * b[0][c] + a[r][1] * b[1][c] + a[r][2] * b[2][c]; });
    });
  }

  function mulVec(m, v) {
    return [0, 1, 2].map(function (r) { return m[r][0] * v[0] + m[r][1] * v[1] + m[r][2] * v[2] + 0; });
  }

  // Round a column-major 4x4 element array (Three.js Matrix4.elements) to an integer 3x3 rotation.
  function snapRotation(elements) {
    return [0, 1, 2].map(function (r) {
      return [0, 1, 2].map(function (c) { return Math.round(elements[c * 4 + r]) + 0; });
    });
  }

  function cubiePositions() {
    var out = [];
    for (var x = -1; x <= 1; x++) for (var y = -1; y <= 1; y++) for (var z = -1; z <= 1; z++) out.push([x, y, z]);
    return out;
  }

  // Model with every cubie at home, identity rotation, sticker colors read from a core state.
  function createModel(state) {
    return cubiePositions().map(function (p) {
      var stickers = [];
      ['x', 'y', 'z'].forEach(function (a, i) {
        if (p[i] === 0) return;
        var n = [0, 0, 0]; n[i] = p[i];
        stickers.push({ local: n, color: state[Cube.faceletIndex(p, n)] });
      });
      return { home: p.slice(), pos: p.slice(), rot: IDENTITY.map(function (r) { return r.slice(); }), stickers: stickers };
    });
  }

  function inLayer(pos, move) { return move.layers.indexOf(pos[AXIS_I[move.axis]]) >= 0; }

  // Turn the model in place with integer math (used by tests; the browser snaps from Three instead).
  function applyMoveToModel(model, move) {
    move = Cube.parseMove(move);
    var R = rotationMatrix(move.axis, move.amount);
    model.forEach(function (c) {
      if (!inLayer(c.pos, move)) return;
      c.pos = mulVec(R, c.pos);
      c.rot = mulMat(R, c.rot);
    });
    return model;
  }

  // Read the 54-sticker core state back out of a model.
  function deriveState(model) {
    var s = new Array(54);
    model.forEach(function (c) {
      c.stickers.forEach(function (st) {
        var i = Cube.faceletIndex(c.pos, mulVec(c.rot, st.local));
        if (i < 0) throw new Error('view mapping: sticker off the cube at ' + c.pos + ' ' + st.local);
        s[i] = st.color;
      });
    });
    return s;
  }

  var mapping = {
    rotationMatrix: rotationMatrix, snapRotation: snapRotation, createModel: createModel,
    applyMoveToModel: applyMoveToModel, deriveState: deriveState, mulVec: mulVec, mulMat: mulMat
  };

  // ---------------------------------------------------------------------------
  // Three.js view (browser only).
  // ---------------------------------------------------------------------------
  var SPACING = 1;
  var BODY = 0.96;          // cubie body size
  var STICKER = 0.8;        // sticker size (inset from the body edge)
  var STICKER_OFF = BODY / 2 + 0.002;
  var Z_AXIS = [0, 0, 1];

  function easeInOut(t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }

  // opts:
  //   interactive  drag to orbit (default true)
  //   width/height fixed pixel size; omit to fill the container and follow resizes
  //   duration     ms per turn (default 160); fastDuration ms per turn when {fast} (default 45)
  //   background   clear color (default 0x15171c); null = transparent
  //   distance     camera distance (default 9); theta/phi initial view angles in radians
  //   state        initial core state (default Cube.solvedState())
  //   onMoveDone   function (move, state) called after each turn finishes
  function createCubeView(container, opts) {
    opts = opts || {};
    var THREE = root.THREE;
    if (!THREE) throw new Error('createCubeView: THREE is not loaded');
    var duration = opts.duration || 160;
    var fastDuration = opts.fastDuration || 45;
    var interactive = opts.interactive !== false;
    var fixedSize = opts.width && opts.height;
    var bg = opts.background === undefined ? 0x15171c : opts.background;

    var renderer = new THREE.WebGLRenderer({ antialias: true, alpha: bg === null });
    renderer.setPixelRatio(Math.min(root.devicePixelRatio || 1, 2));
    if (bg === null) renderer.setClearColor(0x000000, 0); else renderer.setClearColor(bg, 1);
    container.appendChild(renderer.domElement);
    renderer.domElement.style.display = 'block';
    if (interactive) { renderer.domElement.style.touchAction = 'none'; renderer.domElement.style.cursor = 'grab'; }

    var scene = new THREE.Scene();
    var camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
    scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    var light = new THREE.DirectionalLight(0xffffff, 0.75);
    scene.add(light);

    var cubeRoot = new THREE.Group();
    var pivot = new THREE.Group();
    scene.add(cubeRoot);
    cubeRoot.add(pivot);

    // Shared geometry/materials; one material per sticker so colors can change.
    var bodyGeo = new THREE.BoxGeometry(BODY, BODY, BODY);
    var bodyMat = new THREE.MeshLambertMaterial({ color: 0x111111 });
    var stickerGeo = new THREE.PlaneGeometry(STICKER, STICKER);
    var materials = [bodyMat];

    // records: { obj, pos, rot, stickers:[{ local, color, mesh }] } - same shape as the pure model.
    var records = createModel(Cube.solvedState()).map(function (c) {
      var obj = new THREE.Group();
      obj.add(new THREE.Mesh(bodyGeo, bodyMat));
      c.stickers.forEach(function (st) {
        var mat = new THREE.MeshLambertMaterial({ color: 0x000000, side: THREE.FrontSide });
        materials.push(mat);
        var mesh = new THREE.Mesh(stickerGeo, mat);
        var n = new THREE.Vector3(st.local[0], st.local[1], st.local[2]);
        mesh.position.copy(n).multiplyScalar(STICKER_OFF);
        mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
        obj.add(mesh);
        st.mesh = mesh;
      });
      cubeRoot.add(obj);
      c.obj = obj;
      return c;
    });

    var state;            // core state, updated on every completed turn
    var queue = [];       // pending { move, fast }
    var current = null;   // { move, fast, start, dur, objs }
    var dirty = true;
    var disposed = false;
    var highlight = null;

    var view = {
      onMoveDone: opts.onMoveDone || null,
      setState: setState,
      getState: function () { return state.slice(); },
      getViewState: function () { return deriveState(records); },
      enqueue: enqueue,
      isIdle: function () { return !current && queue.length === 0; },
      clearQueue: function () { queue = []; },
      highlightLayer: highlightLayer,
      selfCheck: selfCheck,
      resize: resize,
      dispose: dispose,
      canvas: renderer.domElement
    };

    // Set an object's Three transform from an integer pos/rot.
    function placeObj(rec) {
      rec.obj.position.set(rec.pos[0] * SPACING, rec.pos[1] * SPACING, rec.pos[2] * SPACING);
      var r = rec.rot, m = new THREE.Matrix4();
      m.set(r[0][0], r[0][1], r[0][2], 0, r[1][0], r[1][1], r[1][2], 0, r[2][0], r[2][1], r[2][2], 0, 0, 0, 0, 1);
      rec.obj.quaternion.setFromRotationMatrix(m);
    }

    // Instantly show a core state: all cubies back home, stickers recolored. Drops any queue/animation.
    function setState(s) {
      state = s.slice();
      queue = [];
      if (current) { current.objs.forEach(function (o) { cubeRoot.attach(o); }); current = null; }
      pivot.rotation.set(0, 0, 0);
      records.forEach(function (rec) {
        rec.pos = rec.home.slice();
        rec.rot = IDENTITY.map(function (r) { return r.slice(); });
        rec.stickers.forEach(function (st) {
          st.color = state[Cube.faceletIndex(rec.home, st.local)];
          st.mesh.material.color.setHex(Cube.COLOR_HEX[st.color]);
        });
        placeObj(rec);
      });
      dirty = true;
    }

    // moves: a move token, move object, alg string, or array of these.
    function enqueue(moves, o) {
      var fast = !!(o && o.fast);
      var list = (typeof moves === 'object' && !Array.isArray(moves)) ? [moves] : moves;
      Cube.parseAlg(list).forEach(function (m) { queue.push({ move: m, fast: fast }); });
    }

    function startNext(now) {
      var item = queue.shift();
      var objs = [];
      records.forEach(function (rec) { if (inLayer(rec.pos, item.move)) objs.push(rec.obj); });
      pivot.rotation.set(0, 0, 0);
      objs.forEach(function (o) { pivot.attach(o); });
      current = { move: item.move, start: now, dur: item.fast ? fastDuration : duration, objs: objs };
    }

    // Leave the pivot at the final angle, move cubies back to cubeRoot and snap them to exact values
    // read from their Three transforms. The core state advances with the same move.
    function finishTurn(move, objs) {
      pivot.rotation.set(0, 0, 0);
      pivot.rotation[move.axis] = move.amount * Math.PI / 2;
      pivot.updateMatrixWorld(true);
      objs.forEach(function (o) { cubeRoot.attach(o); });
      pivot.rotation.set(0, 0, 0);
      var m4 = new THREE.Matrix4();
      records.forEach(function (rec) {
        if (objs.indexOf(rec.obj) < 0) return;
        rec.pos = [rec.obj.position.x, rec.obj.position.y, rec.obj.position.z].map(function (v) { return Math.round(v / SPACING) + 0; });
        m4.makeRotationFromQuaternion(rec.obj.quaternion);
        rec.rot = snapRotation(m4.elements);
        placeObj(rec);
      });
      state = Cube.applyMove(state, move);
      dirty = true;
    }

    function step(now) {
      if (!current && queue.length) startNext(now);
      while (current) {
        var t = (now - current.start) / current.dur;
        if (t < 1) {
          pivot.rotation.set(0, 0, 0);
          pivot.rotation[current.move.axis] = current.move.amount * Math.PI / 2 * easeInOut(Math.max(0, t));
          dirty = true;
          break;
        }
        var done = current;
        finishTurn(done.move, done.objs);
        current = null;
        if (view.onMoveDone) view.onMoveDone(done.move, state.slice());
        if (disposed) return;
        if (queue.length) startNext(done.start + done.dur);
      }
    }

    // Highlight the layer(s) a move turns, or clear with null.
    function highlightLayer(move) {
      if (highlight) {
        cubeRoot.remove(highlight);
        highlight.children.forEach(function (ch) { ch.geometry.dispose(); ch.material.dispose(); });
        highlight = null;
      }
      if (move) {
        move = Cube.parseMove(move);
        var ai = AXIS_I[move.axis];
        var size = [3.08, 3.08, 3.08];
        size[ai] = move.layers.length + 0.08;
        var center = [0, 0, 0];
        center[ai] = move.layers.reduce(function (a, b) { return a + b; }, 0) / move.layers.length;
        var box = new THREE.BoxGeometry(size[0] * SPACING, size[1] * SPACING, size[2] * SPACING);
        highlight = new THREE.Group();
        highlight.add(new THREE.Mesh(box, new THREE.MeshBasicMaterial({ color: 0x4da3ff, transparent: true, opacity: 0.14, depthWrite: false })));
        highlight.add(new THREE.LineSegments(new THREE.EdgesGeometry(box), new THREE.LineBasicMaterial({ color: 0x4da3ff })));
        highlight.position.set(center[0] * SPACING, center[1] * SPACING, center[2] * SPACING);
        cubeRoot.add(highlight);
      }
      dirty = true;
    }

    // ---- camera orbit ----
    var theta = opts.theta === undefined ? Math.PI / 5 : opts.theta;   // azimuth, + shows the R side
    var phi = opts.phi === undefined ? Math.PI / 6 : opts.phi;          // elevation
    var dist = opts.distance || 9;
    var PHI_MAX = Math.PI / 2 - 0.05;

    function updateCamera() {
      phi = Math.max(-PHI_MAX, Math.min(PHI_MAX, phi));
      camera.position.set(dist * Math.cos(phi) * Math.sin(theta), dist * Math.sin(phi), dist * Math.cos(phi) * Math.cos(theta));
      camera.lookAt(0, 0, 0);
      light.position.copy(camera.position);
      dirty = true;
    }

    var drag = null;
    function onDown(e) {
      drag = { x: e.clientX, y: e.clientY, id: e.pointerId };
      try { renderer.domElement.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      renderer.domElement.style.cursor = 'grabbing';
    }
    function onMove(e) {
      if (!drag || e.pointerId !== drag.id) return;
      theta -= (e.clientX - drag.x) * 0.008;
      phi += (e.clientY - drag.y) * 0.008;
      drag.x = e.clientX; drag.y = e.clientY;
      updateCamera();
    }
    function onUp(e) {
      if (!drag || e.pointerId !== drag.id) return;
      drag = null;
      renderer.domElement.style.cursor = 'grab';
    }
    if (interactive) {
      renderer.domElement.addEventListener('pointerdown', onDown);
      renderer.domElement.addEventListener('pointermove', onMove);
      renderer.domElement.addEventListener('pointerup', onUp);
      renderer.domElement.addEventListener('pointercancel', onUp);
    }

    // ---- sizing ----
    function resize() {
      var w = fixedSize ? opts.width : container.clientWidth;
      var h = fixedSize ? opts.height : container.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      dirty = true;
    }
    var ro = null;
    if (!fixedSize) {
      root.addEventListener('resize', resize);
      if (root.ResizeObserver) { ro = new root.ResizeObserver(resize); ro.observe(container); }
    }

    // ---- loop ----
    var raf = 0;
    function frame(now) {
      if (disposed) return;
      step(now);
      if (dirty) { renderer.render(scene, camera); dirty = false; }
      raf = root.requestAnimationFrame(frame);
    }

    // Read colors straight from the sticker meshes' world transforms (independent of `records`).
    function readMeshState() {
      cubeRoot.updateMatrixWorld(true);
      var s = new Array(54), byHex = {};
      Object.keys(Cube.COLOR_HEX).forEach(function (k) { byHex[Cube.COLOR_HEX[k]] = k; });
      var wp = new THREE.Vector3(), wq = new THREE.Quaternion(), n = new THREE.Vector3();
      records.forEach(function (rec) {
        rec.obj.getWorldPosition(wp);
        var pos = [wp.x, wp.y, wp.z].map(function (v) { return Math.round(v / SPACING) + 0; });
        rec.stickers.forEach(function (st) {
          st.mesh.getWorldQuaternion(wq);
          n.set(Z_AXIS[0], Z_AXIS[1], Z_AXIS[2]).applyQuaternion(wq);
          var i = Cube.faceletIndex(pos, [Math.round(n.x) + 0, Math.round(n.y) + 0, Math.round(n.z) + 0]);
          if (i >= 0) s[i] = byHex[st.mesh.material.color.getHex()];
        });
      });
      return s;
    }

    // For every move token (all bases, plain/prime/double), from a mixed start state, turn the real
    // Three objects through finishTurn and compare mesh-derived colors with core. Restores the view.
    function selfCheck() {
      if (!view.isIdle()) return { ok: false, failures: ['view is busy; run selfCheck when idle'] };
      var saved = state.slice(), failures = [], count = 0;
      var start = Cube.applyAlg(Cube.solvedState(), "R U' F2 M r' D2 x L b' y' u B2 z d' f l2");
      Object.keys(Cube.BASE_MOVES).forEach(function (b) {
        [b, b + "'", b + '2'].forEach(function (tok) {
          var m = Cube.parseMove(tok);
          setState(start);
          var objs = [];
          records.forEach(function (rec) { if (inLayer(rec.pos, m)) objs.push(rec.obj); });
          objs.forEach(function (o) { pivot.attach(o); });
          finishTurn(m, objs);
          var expect = Cube.applyMove(start, m);
          count++;
          if (!Cube.isEqual(readMeshState(), expect)) failures.push(tok + ': mesh colors differ from core');
          if (!Cube.isEqual(deriveState(records), expect)) failures.push(tok + ': record mapping differs from core');
          if (!Cube.isEqual(state, expect)) failures.push(tok + ': view state differs from core');
        });
      });
      setState(saved);
      var res = { ok: failures.length === 0, checked: count, failures: failures };
      if (root.console) console.log('CubeView selfCheck: ' + (res.ok ? 'OK, ' + count + ' moves' : failures.join('; ')));
      return res;
    }

    function dispose() {
      disposed = true;
      root.cancelAnimationFrame(raf);
      highlightLayer(null);
      root.removeEventListener('resize', resize);
      if (ro) ro.disconnect();
      bodyGeo.dispose(); stickerGeo.dispose();
      materials.forEach(function (m) { m.dispose(); });
      renderer.dispose();
      if (renderer.forceContextLoss) renderer.forceContextLoss();
      if (renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement);
    }

    setState(opts.state || Cube.solvedState());
    resize();
    updateCamera();
    raf = root.requestAnimationFrame(frame);
    return view;
  }

  var CubeView = { createCubeView: createCubeView, mapping: mapping };
  if (typeof module !== 'undefined' && module.exports) module.exports = CubeView;
  else root.CubeView = CubeView;
})(typeof window !== 'undefined' ? window : this);
