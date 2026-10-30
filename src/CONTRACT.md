# core.js contract

`src/core.js` is a plain script. In the browser it defines `window.Cube`; in Node, `require('./src/core.js')` returns the same object. It does not use the DOM or Three.js. Every function is pure: none of them mutates its inputs.

## Coordinates
- Same axes as Three.js: **+x = R**, **+y = U**, **+z = F**. Cubie coordinates are in {-1, 0, 1}.
- `NORMALS = { U:[0,1,0], D:[0,-1,0], R:[1,0,0], L:[-1,0,0], F:[0,0,1], B:[0,0,-1] }`.

## State
- A state is an array of 54 single-character strings.
- Each entry is a **color**, written as the letter of the face that color belongs to on the starting cube: `'U'` white, `'D'` yellow, `'F'` green, `'B'` blue, `'R'` red, `'L'` orange.
- Color names and hex values: `COLOR_NAME[letter]` (e.g. `'white'`) and `COLOR_HEX[letter]` (a number, e.g. `0xffffff`).
- Index = `face * 9 + row * 3 + col`, with faces in the order `FACES = ['U','R','F','D','L','B']` (U 0-8, R 9-17, F 18-26, D 27-35, L 36-44, B 45-53). The centers are at 4, 13, 22, 31, 40 and 49.
- **Facelet positions are fixed in space**, so index 4 is always "whatever sticker is on top". Centers move with x/y/z/M/wide moves, which means the center colors tell you the cube's orientation. After a `z2`, for example, `state[4] === 'D'` (yellow is on top).
- How each face's row and column are read (row 0 at the top, col 0 at the left, looking at the face from outside):
  - U: seen from above, with B at the top. Facelet (r,c) is at `[c-1, 1, r-1]`.
  - D: seen from below, with F at the top. Facelet (r,c) is at `[c-1, -1, 1-r]`.
  - F: `[c-1, 1-r, 1]`. B: `[1-c, 1-r, -1]`. R: `[1, 1-r, 1-c]`. L: `[-1, 1-r, c-1]`.
- `FACELETS[i] = { face, pos:[x,y,z], normal:[nx,ny,nz] }` gives the geometry of each index.
- `faceletIndex(pos, normal)` returns the index, or -1 if there is none.
- `at(state, pos, normal)` returns the color at that facelet.
- `centerColor(state, face)` returns the color of a face's center.

## Moves
- Tokens: `U D L R F B`, `M` (follows L), `x y z` (follow R / U / F), and the wide moves `r l u d f b` (two layers). A token can take the suffix `'` or `2`; `2'` is read as `2`.
- `parseMove(tokenOrMove)` returns a move object:
  ```
  { name: "R'", base: 'R', turns: -1,     // turns: 1 | -1 | 2
    axis: 'x', layers: [1], amount: 1 }   // animation metadata
  ```
  - `axis`: `'x' | 'y' | 'z'`.
  - `layers`: the coordinate values on that axis whose cubies turn. Examples: R = `[1]`, M = `[0]`, r = `[0,1]`, l = `[-1,0]`, x = `[-1,0,1]`.
  - `amount`: signed quarter turns about the **+axis**, using the right-hand rule. Positive means counterclockwise when you look from the +axis side toward the origin. To animate, rotate the layer by `amount * Math.PI / 2` about the world axis (same sign as a Three.js rotation).
  - A plain clockwise move ("clockwise looking at that face") has amount -1 for U, R, F, r, u, f, x, y, z and +1 for D, L, B, M, l, d, b. A prime move flips the sign; a 2 move doubles it (e.g. R2 = -2, L2 = +2).
- `parseAlg(stringOrArray)` returns an array of move objects. Tokens are split on whitespace and parentheses are ignored. An unknown token throws an `Error`.
- `invertMove(m)` returns the inverse move object (an X2 stays X2). `invertAlg(alg)` returns an array of move objects, reversed and inverted.
- `algToString(alg)` returns the alg as a string, e.g. `"R U R' U'"`.
- `applyMove(state, move)` and `applyAlg(state, alg)` return a **new** state. `move` can be a string or a move object; `alg` can be a string or an array.
- `BASE_MOVES[base] = { axis, layers, dir }`, where `dir` is the amount of the plain move.
- `rotateVec(v, axis, q)` rotates an integer vector by q quarter turns, using the same convention as `amount`.

## State helpers
- `solvedState()`: the solved cube with white U, green F and red R.
- `solvedCfop()`: `solvedState()` after `z2`, giving white D, yellow U, green F and orange R.
- `clone(state)`: a copy of the state. `isEqual(a, b)`: whether two states match.
- `isSolved(state)`: true when every face is a single color, in any whole-cube orientation.

## Scramble and history
- `randomScramble(n, opts)` returns an array of move names.
  - The default is quarter turns of U, D, L, R, F and B, never the same face twice in a row. The baseline uses `randomScramble(25)`.
  - `opts.half: true` adds the `'` and `2` suffixes and also forbids three moves in a row on one axis (e.g. R L R). The timer uses `randomScramble(20, {half:true})`.
  - `opts.random` replaces `Math.random`.
- `pushHistory(history, move)` returns a new array of move names. If `move` is the inverse of the last entry (R then R', or R2 then R2), that entry is removed instead of adding the move. Otherwise the move's name is appended. R followed by R stays as `['R','R']`. To solve, play `invertAlg(history)`.

## Algorithms
- `ALGS` holds 20 entries: `{ id, name, group, target, alg, hint }`.
  - `group`: `'F2L' | 'OLL edges' | 'OLL corners' | 'PLL corners' | 'PLL edges'`.
  - `target`:
    - `'slotFR'`: the cross plus the FR corner and edge are solved.
    - `'uFace'`: the first two layers are solved and the whole U face is one color.
    - `'cube'`: `isSolved`.
  - `hint`: plain-words recognition and hold notes, worked out from the case state.
  - Every alg assumes the CFOP hold: cross color on D.
  - ids: `f2l-1..4`, `oll-line`, `oll-l`, `oll-dot`, `oll-sune`, `oll-antisune`, `oll-h`, `oll-pi`, `oll-headlights`, `oll-chameleon`, `oll-bowtie`, `pll-t`, `pll-y`, `pll-ua`, `pll-ub`, `pll-h`, `pll-z`.
- `caseState(alg)`: `solvedCfop()` with the inverse of `alg` applied. Use this for diagrams and mini cubes.
- `targetSolved(state, target)`: checks a target relative to the current centers.
- `verifyAlg(algEntry)`: true when the alg, played from its own case state, solves its target, allowing one final U, U', U2 or no turn.
- `cubiesSolved(state, positions)`: true when every sticker of the cubies at those positions matches the center of the face it points toward.
