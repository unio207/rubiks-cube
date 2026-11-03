// angled-scene.js - browser helper for the Feature 9 tests: renders the cube as a webcam in front of
// it and a little above would see it, with Three.js r128 in the app's style (near-black body, inset
// stickers, the app's colours). Needs THREE and Cube. Defines window.AngledScene.
(function () {
  'use strict';
  // As in src/view3d.js, except that the stickers sit on the plane of the cube's outer faces (at
  // 1.5 pitches, as on a real cube) instead of 0.02 below it, so the true corners are well defined.
  var BODY = 0.96, STICKER = 0.8, OFF = 0.5;

  function rng(seed) {
    var s = seed >>> 0 || 1;
    return function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  }

  var LIGHTS = {
    neutral: { color: 0xffffff, k: 1 },
    warm: { color: 0xffcf98, k: 0.95 },
    cool: { color: 0xc4d8ff, k: 0.95 },
    dim: { color: 0xfff0e0, k: 0.42 }
  };

  function logoTexture() {
    var c = document.createElement('canvas'); c.width = 128; c.height = 64;
    var g = c.getContext('2d');
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, 128, 64);
    g.fillStyle = '#3a4a6a'; g.font = 'bold 44px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('GAN', 64, 34);
    return new THREE.CanvasTexture(c);
  }

  function create(w, h) {
    var canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    var renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(1);
    renderer.setSize(w, h, false);
    var scene = new THREE.Scene();
    var camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 200);
    var ambient = new THREE.AmbientLight(0xffffff, 0.55), dir = new THREE.DirectionalLight(0xffffff, 0.75);
    scene.add(ambient); scene.add(dir); scene.add(dir.target);
    var bodyGeo = new THREE.BoxGeometry(BODY, BODY, BODY), bodyMat = new THREE.MeshLambertMaterial({ color: 0x111111 });
    var stGeo = new THREE.PlaneGeometry(STICKER, STICKER), logoGeo = new THREE.PlaneGeometry(0.5, 0.25);
    var logoMat = new THREE.MeshLambertMaterial({ map: logoTexture() });
    var cube = new THREE.Group(), pivot = new THREE.Group();
    scene.add(cube); cube.add(pivot);
    var cubies = [];
    for (var x = -1; x <= 1; x++) for (var y = -1; y <= 1; y++) for (var z = -1; z <= 1; z++) {
      var g = new THREE.Group(), stickers = [];
      g.position.set(x, y, z);
      g.add(new THREE.Mesh(bodyGeo, bodyMat));
      [[x, 0, 0], [0, y, 0], [0, 0, z]].forEach(function (n) {
        if (!n[0] && !n[1] && !n[2]) return;
        var mat = new THREE.MeshLambertMaterial({ color: 0 }), m = new THREE.Mesh(stGeo, mat);
        var v = new THREE.Vector3(n[0], n[1], n[2]);
        m.position.copy(v).multiplyScalar(OFF);
        m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), v);
        var logo = new THREE.Mesh(logoGeo, logoMat);
        logo.position.set(0, 0, 0.003); logo.visible = false;
        m.add(logo);
        g.add(m);
        stickers.push({ mesh: m, logo: logo, idx: Cube.faceletIndex([x, y, z], n) });
      });
      cube.add(g);
      cubies.push({ obj: g, pos: [x, y, z], stickers: stickers });
    }

    // o: { state, tilt, yaw, roll (degrees), dist (pitches), tx, ty (pitches, camera frame),
    //      light, bg, logo, turn: { axis 'x'|'y'|'z', layer -1|0|1, deg }, noise, seed }
    // -> { data (RGBA), front, top: true corners [[x,y] x4] in the order of Scan.angledQuads }
    function render(o) {
      var L = LIGHTS[o.light || 'neutral'];
      ambient.color.setHex(L.color); ambient.intensity = 0.55 * L.k;
      dir.color.setHex(L.color); dir.intensity = 0.75 * L.k;
      dir.position.set(0.4, 3, 1.2); dir.target.position.set(o.tx || 0, o.ty || 0, -o.dist);
      scene.background = new THREE.Color(o.bg === undefined ? 0x202226 : o.bg);
      cubies.forEach(function (c) {
        cube.add(c.obj);   // every cubie back home (a part-turned layer from the last frame too)
        c.obj.position.set(c.pos[0], c.pos[1], c.pos[2]);
        c.obj.rotation.set(0, 0, 0);
        c.stickers.forEach(function (st) {
          st.mesh.material.color.setHex(Cube.COLOR_HEX[o.state[st.idx]]);
          st.logo.visible = !!o.logo && st.idx % 9 === 4 && o.state[st.idx] === 'U';
        });
      });
      pivot.rotation.set(0, 0, 0);
      cube.position.set(o.tx || 0, o.ty || 0, -o.dist);
      cube.rotation.set((o.tilt || 0) * Math.PI / 180, (o.yaw || 0) * Math.PI / 180, (o.roll || 0) * Math.PI / 180, 'ZXY');
      if (o.turn) {
        var ai = { x: 0, y: 1, z: 2 }[o.turn.axis];
        cubies.forEach(function (c) { if (c.pos[ai] === o.turn.layer) pivot.attach(c.obj); });
        pivot.rotation[o.turn.axis] = o.turn.deg * Math.PI / 180;
      }
      cube.updateMatrixWorld(true);
      renderer.render(scene, camera);
      var c2 = document.createElement('canvas'); c2.width = w; c2.height = h;
      var g2 = c2.getContext('2d');
      g2.drawImage(canvas, 0, 0);
      var img = g2.getImageData(0, 0, w, h), d = img.data;
      if (o.noise) {
        var r = rng(o.seed || 7);
        for (var i = 0; i < d.length; i += 4) {
          for (var j = 0; j < 3; j++) {
            var n = (r() + r() + r() - 1.5) * 2 * o.noise;   // roughly normal, sd ~ noise
            d[i + j] = Math.max(0, Math.min(255, d[i + j] + n));
          }
        }
      }
      function proj(P) {
        var v = new THREE.Vector3(P[0], P[1], P[2]).applyMatrix4(cube.matrixWorld).project(camera);
        return [(v.x + 1) / 2 * w, (1 - v.y) / 2 * h];
      }
      return {
        data: d, proj: proj,
        front: [proj([-1.5, 1.5, 1.5]), proj([1.5, 1.5, 1.5]), proj([1.5, -1.5, 1.5]), proj([-1.5, -1.5, 1.5])],
        top: [proj([-1.5, 1.5, -1.5]), proj([1.5, 1.5, -1.5]), proj([1.5, 1.5, 1.5]), proj([-1.5, 1.5, 1.5])]
      };
    }
    return { render: render, canvas: canvas, rng: rng };
  }

  // The 18 true colours a view shows, in readAngled order: top (far row first), then front.
  function trueLetters(state) {
    var out = [];
    for (var k = 0; k < 9; k++) out.push(state[k]);          // U: seen from above, B at the top
    for (var k2 = 0; k2 < 9; k2++) out.push(state[18 + k2]); // F
    return out;
  }

  // The cube's tilt against the camera's axis for a downward view of `view` degrees onto the top
  // face, as seen along the line from the camera to the top face's centre (cube at height ty,
  // distance dist, in pitches).
  function modelTilt(view, ty, dist) {
    var t = view;
    for (var i = 0; i < 4; i++) {
      var a = t * Math.PI / 180;
      t = view + Math.atan2(ty + 1.5 * Math.cos(a), dist - 1.5 * Math.sin(a)) * 180 / Math.PI;
    }
    return t;
  }

  // The cube turned as a whole so that the face with centre colour `top` is on top and the one
  // with centre colour `front` faces the camera (two neighbouring faces fix the hold).
  function holdState(state, top, front) {
    for (var i = 0; i < Scan.ORIENTATIONS.length; i++) {
      var s = Cube.applyAlg(state, Scan.ORIENTATIONS[i].alg);
      if (s[4] === top && s[22] === front) return s;
    }
    return null;
  }

  window.AngledScene = { create: create, rng: rng, trueLetters: trueLetters, modelTilt: modelTilt, holdState: holdState };
})();
