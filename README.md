# AttTool — attitude workbench
WARN, totally vibecoded app

An educational 3D tool for spacecraft attitude and LEO orbit geometry. It runs in the browser and has three workspaces:

| Key | Workspace | What it's for |
|---|---|---|
| `1` | **Rotation Lab** | Euler angles (all 12 sequences), quaternions, axis-angle and DCMs side by side, with step-by-step animations and gimbal-lock warnings |
| `2` | **Orbit & Frames** | Keplerian + J2 orbit, ECI / ECEF / VVLH / LVLH / VNC / body frames (STK definitions), Sun, eclipse, dipole B-field, guidance modes (nadir, target tracking, Sun pointing, inertial), sensor availability timeline |
| `3` | **Spacecraft Layout** | Build the satellite in its own frame like a CAD model (bus and parts, orientations as YPR / DCM / quaternion), set its nominal attitude relative to LVLH / VVLH / VNC, import orientations from MATLAB / JSON by name, mounting matrices, mass properties, actuator authority, JSON / NumPy export |

**Live:** https://kacpersyn7.github.io/atttool/ (latest) · [all versions](https://kacpersyn7.github.io/atttool/versions.html) · [download a single-file release](https://github.com/kacpersyn7/atttool/releases)

## Quick start

You need [Node.js](https://nodejs.org) 18 or newer. There are **no npm dependencies**, so you don't need `npm install`.

```bash
npm start          # dev server → http://localhost:5173  (edit files, reload the browser)
npm test           # unit tests for the math, orbit, spacecraft and guidance code
npm run build      # → dist/AttTool.html, one self-contained file you can double-click or share
```

Without Node, any static server works too, for example `python3 -m http.server 5173`.

> Opening `index.html` directly from disk (`file://`) **won't work**, because browsers block ES modules there. Use `npm start`, or open the built `dist/AttTool.html`, which works from disk.

three.js r128 loads from a CDN, so the app needs an internet connection the first time.

## Project layout

```
index.html            page shell + import map for three.js
src/
  main.js             entry: waits for fonts, starts the app
  app.js              tabs, control rail, keyboard, resize, animation loop
  styles.css
  core/               pure math: vectors, matrices, quaternions, Euler, TRIAD   ← no DOM, testable
  env/                Earth & space environment: orbit, time, Sun, frames, B-field ← no DOM, testable
  spacecraft/         component data model, example S/C, mass properties, export ← no DOM, testable
  sim/                scenario & presets, attitude guidance, sensor checks, timeline ← no DOM, testable
  state/store.js      the single app state object + localStorage persistence
  ui/                 tiny DOM toolkit (widgets, bindings), formatting, modal/toast
  gfx/                three.js helpers: renderer/views, arrows/labels, Earth, spacecraft mesh
  data/coastlines.js  coarse coastline polygons for the Earth texture
  views/              the three workspaces (rotationLab, orbit/*, layout)
tests/                node:test unit tests (run with `npm test`)
scripts/              serve.mjs (dev server), build.mjs (single-file build)
docs/                 ARCHITECTURE.md, CONVENTIONS.md
legacy/               the original single-file version, kept for reference
dist/                 build output (git-ignored)
```

The rule that keeps this maintainable is that **physics never imports graphics**. `core/`, `env/`, `spacecraft/` and `sim/` are plain functions of plain data, so they run in Node and can be tested. `views/` and `gfx/` only *draw* what `sim/` computes.

## Where to start

- **Changing a model** (for example, adding drag or a better Sun ephemeris): `src/env/`, plus a test in `tests/environment.test.js`.
- **Adding a guidance mode**: `src/sim/guidance.js` (`attitudeAt`) and the mode controls in `src/views/orbit/orbitPanel.js`.
- **Adding a component type**: `src/spacecraft/componentTypes.js`, a mesh in `src/gfx/spacecraftMesh.js`, and an optional sensor rule in `src/sim/sensors.js`.
- **Adding a workspace**: copy the shape of `views/rotationLab.js`, register it in `app.js` `VIEWS`, and add a tab button in `index.html`.

[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) covers the data flow and the view interface. [docs/CONVENTIONS.md](docs/CONVENTIONS.md) defines every frame, DCM and quaternion convention, so read it before touching the math.

## Versions and releases

Every released version stays available, both as a downloadable `AttTool.html` on the Releases page and live at `https://kacpersyn7.github.io/atttool/vX.Y.Z/`.

To release:
1. Make sure `version` in `package.json`, `src/version.js` and the top entry of `CHANGELOG.md` agree (a test checks), and merge to `main`.
2. Tag it, in any of three ways:
   - **Actions → Release → Run workflow → `v0.3.0`.** This is the simplest, and it creates the tag on `main`.
   - Releases → Draft a new release → new tag `v0.3.0`.
   - `git tag v0.3.0 && git push origin v0.3.0`.
3. The Release workflow builds and tests the code, attaches `AttTool.html` and redeploys the live site.

Workflows (`.github/workflows/`): **CI** tests and builds every pull request, **Release** handles tags, and **Pages** deploys the live site.

## Version control

`.gitignore` already excludes `dist/` and OS clutter.
