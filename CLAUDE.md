# Rubik's cube game

A single-file browser Rubik's cube game: a 3D cube with CFOP hints, an Algorithms tab, a csTimer-style timer and a Scan tab (hand-entered or webcam-scanned real cube). It's published on GitHub Pages from `main` (`index.html` redirects to `rubiks-cube.html`). Remote: github.com/unio207/rubiks-cube.

- **Requirements:** `spec.md`, the source of truth for behaviour. New features get a spec section *before* they are built. The user's rules live there too: no unsolicited features, make implementation choices yourself, keep reports concise.
- **core.js API:** `src/CONTRACT.md` (state format, facelet indexing, move notation).

## Progress (update this when something changes)

| Feature | Spec section | Status |
|---|---|---|
| Baseline 3D cube, keys, Scramble/Reset | Baseline | Done, on `main` |
| Scroll / pinch zoom | Baseline (added later) | Done, on `main` |
| 1. CFOP hints (stages 1-8, worker solver) | Feature 1 | Done, on `main` |
| Solve button plays a short CFOP solution (`Solver.solve`), not a history rewind | Baseline "Solve" (changed later) | Done, on `main` |
| 2. Algorithms tab, 20 algs, All/F2L/OLL/PLL filter | Feature 2 | Done, on `main` |
| 3. Timer (inspection, ao5/ao12, localStorage) | Feature 3 | Done, on `main` |
| 4. Scan tab: net editor, validator, webcam scan | Feature 4 | Done, on `main` (merged 2026-11-02) |
| 5. Low-effort scanning: auto-capture, any order/rotation, exposure lock | Feature 5 | Done on branch `claude/auto-scan-discussion-z453a0`, not merged |

Open items:
- Feature 4 has **not been tried with a real webcam and a physical cube**. It was verified with unit tests and in Chrome with a fake canvas camera stream (see Testing). Real lighting is the remaining risk; red/orange is the hard pair.
- Don't push without being asked.
- Known nit (left alone on purpose): after "Load onto cube", the timer panel still shows its previous scramble text.

## Handoff: where the conversation stood (2026-11-02)

The user moved to a cloud session so work continues with their PC off. The local transcript doesn't carry over; this section does.

- **User feedback from real scanning:** red/orange kept getting mixed up, and yellow was often read as green. Root cause: matching used absolute brightness, and webcams expose dark (dim yellow is olive, which is nearer green; dim orange is nearer red). Fixed in f49c193 (`fullBright` in `src/scan.js`: readings are scaled to full brightness before matching, in both the live tint and `classify`), with two regression tests. **Not yet re-tested by the user on a real webcam.** If it still misreads, ask them to run `copy(JSON.stringify(rubiksApp.scanTab.captures()))` in the console after scanning and paste the result, so tests can use their real readings.
- **Feature 5 (low-effort scanning)** was agreed and built (spec section "Feature 5"): auto-capture when a face is held steady (`Scan.createAutoCapture`, `Scan.frameInfo`), auto-advance, faces accepted in any order and rotation (`Scan.assemble`: guided order first, else centre colours plus a 4^6 rotation search that maximises real pieces), and a best-effort exposure/white-balance lock after the first capture. Verified with unit tests and headless Chromium with a fake canvas camera (shuffled, turned faces, no clicks). **Not yet tried on a real webcam.** The user decided against AI for finding the cube in the frame.
- **AI vs algorithmic:** staying algorithmic (instant, offline, private, fits the static page).

## Layout

`src/` holds the modules; `tools/build.js` inlines them into `rubiks-cube.html`.

| File | Role | Runs in |
|---|---|---|
| `src/shell.html` | Page skeleton, CSS, `<!-- INLINE:src/x.js -->` markers | — |
| `src/core.js` | Sticker state, moves, algs (`window.Cube`), pure | page, worker, Node |
| `src/solver.js` | CFOP hints + `solve()`. Inlined as `type="text/plain"` and run in a Web Worker built from the core + solver text | worker, Node |
| `src/view3d.js` | Three.js r128 renderer (`CubeView`) | page |
| `src/baseline.js` | Main cube controller: keys, buttons, history | page |
| `src/timer.js` | Timer logic + panel | page, Node (logic) |
| `src/algtab.js` | Algorithms tab | page, Node (diagrams) |
| `src/scan.js` | Feature 4 logic: `validate`, `STEPS` (capture-to-facelet mapping), `classify`, `sampleGrid` | page, Node |
| `src/scanui.js` | Scan tab UI (`ScanTab.mount`) | page |
| `src/app.js` | Wires it all together; tabs; loaded last | page |

## Build and test

- **Never edit `rubiks-cube.html` by hand.** Edit `src/`, then run `node tools/build.js`. Commit the rebuilt `rubiks-cube.html`, because GitHub Pages serves it.
- There's no package.json. Run every test with:
  `for f in test/*.js; do node $f 2>&1 | tail -1; done`
  Each file prints `N passed, 0 failed`. About 10,000 checks in total. `acceptance-build` also rebuilds the page.
- `test/acceptance-build.test.js` asserts the inlined module count (9) and the top-bar button count (7). Update both when adding a module or a button.
- Tests use seeded RNGs, so failures are reproducible.

## Gotchas

- `src/app.js`, `algtab.js`, `baseline.js` and `view3d.js` have **CRLF** line endings, and the other files LF. Scripted find/replace on the CRLF files must normalise `\r\n` first, or use the Edit tool.
- Keep the page single-file. The only external script allowed is cdnjs Three.js r128.
- Space is reserved for the timer, and top-bar buttons have `tabindex="-1"` and blur on click so Space never presses them.
- Feature 4 colour logic: centres choose the orientation (of 24 standard-scheme orientations, chirality settles red vs orange); then there's a grey-world balance (every cube has 9 of each colour), then a balanced Lab assignment refined against each colour's mean. Painting a centre in the editor swaps two colours everywhere.
- `Scan.STEPS[k].cells` is derived by applying the step's whole-cube rotation to an index state, so the instruction text and the mapping can't drift apart. `test/scan.test.js` checks both.

## Browser verification

- The Claude-in-Chrome extension can't open `file://`. Serve the folder with `npx --yes http-server -p 8765 -c-1 -s .` and open `http://localhost:8765/rubiks-cube.html`. Stop the server afterwards.
- To fake a webcam, override `navigator.mediaDevices.getUserMedia` to return `canvas.captureStream()` of a canvas that draws a face. Redraw it with **`setInterval`, not `requestAnimationFrame`** (rAF is throttled in the automated tab, which freezes the stream), and wait about 1 s between captures. `window.rubiksApp.scanTab` exposes `getNet()`, `captures()`, `validate()` and `isCameraOn()` for checks.
