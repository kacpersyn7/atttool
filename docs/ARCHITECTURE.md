# Architecture

## Layers

```
            ┌──────────────────────────── browser only ───────────────────────────┐
  main.js → app.js ─┬─ views/rotationLab.js ─┐
                    ├─ views/orbit/*  ───────┼─→ gfx/ (three.js)   ui/ (DOM)
                    └─ views/layout.js ──────┘          │
                                 │                      │
                                 ▼                      ▼
            ┌──────────── pure JS: runs in Node, unit-tested ─────────────┐
            │  state/store.js   sim/   spacecraft/   env/   core/          │
            └──────────────────────────────────────────────────────────────┘
```

Dependencies point **down only**:

| Layer | May import | Must not import |
|---|---|---|
| `core/` | nothing | anything else |
| `env/` | `core/` | `spacecraft/`, `sim/`, DOM, three |
| `spacecraft/` | `core/` | `env/`, `sim/`, DOM, three |
| `sim/` | `core/`, `env/`, `spacecraft/` | DOM, three, `state/` (state is passed in as an argument) |
| `state/` | `core/`, `spacecraft/`, `sim/scenario.js` | DOM (except `localStorage`), three |
| `ui/` | `core/` | three, `views/` |
| `gfx/` | `core/`, `spacecraft/`, `data/`, three | `views/`, `state/` |
| `views/` | everything below | other views (coordinate through `app.js`) |

Keeping `sim/` independent of the global state is deliberate. Functions such as `attitudeAt(state, t)` take the state object as an argument, so the tests can build a small state by hand (see `tests/sim.test.js`). It also means a future batch or offline analysis mode can reuse the same code.

## State

`state/store.js` exports one object `S`, which is plain JSON and is persisted to `localStorage` under `atttool.v1`.

- Mutate it in place, then call `save()`, which is debounced.
- If you change spacecraft geometry (`S.sc`), call `scChanged()` instead. It bumps `scVersion()`, and each view compares that number with the version it last built, then rebuilds its 3D model.
- New settings: add a default in `defaultState()`. `load()` merges stored state over the defaults, so old saves pick up new keys automatically. Bump `STORAGE_KEY` only for incompatible changes.

## UI: rail, bindings and HUD

The left rail is rebuilt from scratch by `renderRail()` when its *structure* changes (tab switch, mode change, selection). Widgets don't keep their own copy of a value. Each takes `get`/`set` closures over `S`:

- `onSync` registrations push state into inputs. `syncAll()` runs them after any programmatic change (presets, buttons, timeline clicks).
- `liveText(fn)` spans are re-evaluated about 10 times per second by `tickLive()` for readouts.

`resetBindings()` clears both registries before a rebuild.

## Views

Each workspace is created by a factory `createXxx({ renderRail })` and returns:

```js
{
  V,            // { scene, camera, controls } from gfx/renderer.js mkView()
  update(dt),   // advance animation/state, update scene objects   (every frame, active view only)
  render(),     // draw (renderFull(V) or custom, e.g. inset viewport)
  panel(),      // → array of rail cards (DOM nodes)
  hud(),        // append overlays into #hudTL / #hudTR
  init?(),      // once at boot
  enter?(), leave?(),  // tab switched to / away
  tick?(),      // ~10 Hz while active (e.g. timeline redraw)
}
```

One `WebGLRenderer` is shared. Only the active view updates and renders.

## Orbit workspace data flow

```
S.orbit ──orbitElements()──► elements ──propagate()──► r, v
   │                                                 │
   └── mode, offsets ──► attitudeAt(S, t) ◄──────────┘  + sunECI, orbitFrame, triad,
                              ▲                            nominal attitude (S.sc.align)
                              │
                              ├──► orbitView.update(): moves S/C, frames, vectors, footprint
                              ├──► bodyInset.update(): Sun/Earth/B seen from the body frame
                              ├──► orbitPanel / HUD readouts (sensorEval, bodyRate)
                              └──► computeTimeline(): one orbit of samples, cached by key
```

## Build

`scripts/build.mjs` is a small bundler (about 100 lines) written for this code style. It wraps each module in a function scope, orders them so dependencies come first, and inlines the CSS. It also swaps the import map for the three.js UMD scripts. It fails loudly on unsupported syntax: default exports, dynamic `import()`, and import cycles.

If the project outgrows it, for example when moving to TypeScript or npm packages, switch to Vite. The source already uses standard ES modules and the bare `'three'` specifier, so `npm i three@0.128.0 vite` plus a `vite.config.js` is all it takes.

## Ideas for next steps

- Upgrade three.js (r128 → current). Watch for lighting intensity changes since r155, and for `TransformControls` becoming a helper in r169+.
- Attitude dynamics: integrate Euler's equations with the inertia from the Layout workspace, plus wheel and magnetorquer torques and a simple controller.
- Disturbance torques: gravity gradient, aerodynamic, SRP, residual dipole.
- TLE / SGP4 propagation, so you can load a real satellite.
- Ground stations and contact windows on the timeline.
- Export timeline data as CSV.
