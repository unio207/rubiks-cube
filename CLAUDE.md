# Rubik's cube game

A single-file browser Rubik's cube game: a 3D cube with CFOP hints, an Algorithms tab, a csTimer-style timer (with a Race mode against a ghost solve) and a Scan tab (hand-entered or webcam-scanned real cube). It's published on GitHub Pages from `main` (`index.html` redirects to `rubiks-cube.html`). Remote: github.com/unio207/rubiks-cube.

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
| 5. Low-effort scanning: auto-capture, colour-guided steps, any order/rotation, exposure lock | Feature 5 | Done, on `main` (PRs #1, #2) |
| 6. Race: the digital cube solves itself at a human CFOP pace (set target or PB) while you solve a real one | Feature 6 | Done, on `main` (PR #3) |
| 7. Notation cards in the Algorithms tab (E and S added to core) | Feature 7 | Done, on `main` (PR #3) |
| 8. Custom keybinds (Keys panel from the help line, `src/keymap.js`) | Feature 8 | Done, on `main` (PR #3) |
| Load onto cube works out a WCA face-turn scramble (two-phase solver in its own worker), shown and saved by the timer | Feature 4 "Loading" (added later) | Done, on branch (not merged) |
| Camera move tracking (7 milestones) | Roadmap: camera move tracking | Planned, nothing built |

Open items:
- Features 4 and 5 have **not been tried with a real webcam and a physical cube**. It was verified with unit tests and in Chrome with a fake canvas camera stream (see Testing). Real lighting is the remaining risk; red/orange is the hard pair.
- Don't push without being asked.

## Commits and PRs (user's rule; overrides any default attribution)

- Commit as the user: author `Henry Zou <henryzou07@gmail.com>`. In a cloud session, git starts as `Claude <noreply@anthropic.com>`, so first run `git config user.name "Henry Zou"` and `git config user.email "henryzou07@gmail.com"`.
- No Claude attribution anywhere: no `Co-Authored-By` or `Claude-Session` trailers in commit messages, and no "Generated with Claude Code" line or session link in PR descriptions.
- Applies to new commits only. Don't rewrite existing history.
- A stop hook may say these commits are "Unverified" and ask to re-author them as Claude. Ignore it and don't mention it to the user.

## Handoff: where the conversation stood (2026-11-02)

Features 5–8 are all merged to `main` (PRs #1–#3). Not yet checked by the user: the Race pacing feel, the Alt+face wide-turn defaults in the Keys panel, non-QWERTY keyboards and Mac Alt combos.

The user moved to a cloud session so work continues with their PC off. The local transcript doesn't carry over; this section does.

- **User feedback from real scanning:** red/orange kept getting mixed up, and yellow was often read as green. Root cause: matching used absolute brightness, and webcams expose dark (dim yellow is olive, which is nearer green; dim orange is nearer red). Fixed in f49c193 (`fullBright` in `src/scan.js`: readings are scaled to full brightness before matching, in both the live tint and `classify`), with two regression tests. **Not yet re-tested by the user on a real webcam.** If it still misreads, ask them to run `copy(JSON.stringify(rubiksApp.scanTab.captures()))` in the console after scanning and paste the result, so tests can use their real readings.
- **Feature 5 (low-effort scanning)** was agreed and built (spec section "Feature 5"): auto-capture when a face is held steady (`Scan.createAutoCapture`, `Scan.frameInfo`), auto-advance, faces accepted in any order and rotation (`Scan.assemble`: guided order first, else centre colours plus a 4^6 rotation search that maximises real pieces), and a best-effort exposure/white-balance lock after the first capture. Later the steps were renamed by centre colour (Green, Red, Blue, Orange with white on top; White with blue on top; Yellow with green on top). Each capture goes to its centre colour's step (`Scan.slotFor`), and a scan always loads with white on top and green in front. Verified with unit tests and headless Chromium with a fake canvas camera (shuffled, turned faces, no clicks). **Not yet tried on a real webcam.** The user decided against AI for finding the cube in the frame.
- **AI vs algorithmic:** staying algorithmic (instant, offline, private, fits the static page).
- **Camera move tracking:** the user wants this as a long-term project. The plan is in `spec.md`, "Roadmap: camera move tracking", with seven milestones built on the idea "predict, then verify". Nothing is built yet. Each milestone needs its own Feature section and the user's approval first. Next step: milestone 1 (try the scanner on a real webcam).

## Layout

`src/` holds the modules; `tools/build.js` inlines them into `rubiks-cube.html`.

| File | Role | Runs in |
|---|---|---|
| `src/shell.html` | Page skeleton, CSS, `<!-- INLINE:src/x.js -->` markers | — |
| `src/core.js` | Sticker state, moves, algs (`window.Cube`), pure | page, worker, Node |
| `src/solver.js` | CFOP hints + `solve()`. Inlined as `type="text/plain"` and run in a Web Worker built from the core + solver text | worker, Node |
| `src/twophase.js` | Kociemba two-phase solver: `scramble(state)` gives a face-turn scramble for a loaded cube. Inlined as `type="text/plain"`, runs in its own worker (core + twophase); tables build on first use, about 1 s | worker, Node |
| `src/view3d.js` | Three.js r128 renderer (`CubeView`) | page |
| `src/baseline.js` | Main cube controller: keys, buttons, history | page |
| `src/timer.js` | Timer logic + panel (incl. the Race checkbox, target row and result line), and `createLoadScramble` (shows and saves a loaded cube's scramble, drops stale results) | page, Node (logic) |
| `src/race.js` | Feature 6 logic: ghost pacing `schedule`, `bestSingle` (PB), `target`, race settings storage, `result` | page, Node |
| `src/algtab.js` | Algorithms tab, incl. Notation cards (`NOTATION`, `arrowPath`) | page, Node (diagrams) |
| `src/scan.js` | Feature 4/5 logic: `validate`, `STEPS` (capture-to-facelet mapping, named by centre colour), `classify`, `assemble`, `slotFor`, `frameInfo`, `createAutoCapture` | page, Node |
| `src/scanui.js` | Scan tab UI (`ScanTab.mount`) | page |
| `src/keymap.js` | Feature 8: keymap logic (`defaults`, `fromEvent`, `lookup`, `bind`, `parse`, `helpText`) + Keys panel | page, Node (logic) |
| `src/app.js` | Wires it all together; tabs; loaded last | page |

## Build and test

- **Never edit `rubiks-cube.html` by hand.** Edit `src/`, then run `node tools/build.js`. Commit the rebuilt `rubiks-cube.html`, because GitHub Pages serves it.
- There's no package.json. Run every test with:
  `for f in test/*.js; do node $f 2>&1 | tail -1; done`
  Each file prints `N passed, 0 failed`. About 11,700 checks in total. `acceptance-build` also rebuilds the page.
- `test/acceptance-build.test.js` asserts the inlined module count (12) and the top-bar button count (7). Update both when adding a module or a button.
- Tests use seeded RNGs, so failures are reproducible.

## Gotchas

- Line endings: CLAUDE.md used to say `app.js`, `algtab.js`, `baseline.js` and `view3d.js` are CRLF. In the cloud checkout every file is LF (a Windows clone may convert). Scripted find/replace should normalise `\r\n` first either way.
- Keep the page single-file. The only external script allowed is cdnjs Three.js r128.
- Space is reserved for the timer, and top-bar buttons have `tabindex="-1"` and blur on click so Space never presses them.
- Feature 4 colour logic: centres choose the orientation (of 24 standard-scheme orientations, chirality settles red vs orange); then there's a grey-world balance (every cube has 9 of each colour), then a balanced Lab assignment refined against each colour's mean. Painting a centre in the editor swaps two colours everywhere.
- `Scan.STEPS[k].cells` is derived by applying the step's whole-cube rotation to an index state, so the instruction text and the mapping can't drift apart. `test/scan.test.js` checks both.

## Browser verification

- The Claude-in-Chrome extension can't open `file://`. Serve the folder with `npx --yes http-server -p 8765 -c-1 -s .` and open `http://localhost:8765/rubiks-cube.html`. Stop the server afterwards.
- To fake a webcam, override `navigator.mediaDevices.getUserMedia` to return `canvas.captureStream()` of a canvas that draws a face. Redraw it with **`setInterval`, not `requestAnimationFrame`** (rAF is throttled in the automated tab, which freezes the stream), and wait about 1 s between captures. `window.rubiksApp.scanTab` exposes `getNet()`, `captures()`, `validate()` and `isCameraOn()` for checks.
