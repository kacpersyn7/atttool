# CLAUDE.md: working on AttTool

AttTool is an educational browser tool for spacecraft attitude and LEO orbits. It uses plain ES modules and loads three.js r128 from a CDN. It has **no npm dependencies**. Keep it that way unless the user agrees otherwise.

## Commands

```bash
npm test         # node:test unit tests. Run before every commit; they must pass
npm run build    # → dist/AttTool.html (single file); must succeed
npm start        # dev server on :5173 (ES modules don't work from file://)
```

## Layer rules (do not break)

Dependencies point down only. `docs/ARCHITECTURE.md` has the details.

- `src/core/`, `src/env/`, `src/spacecraft/` and `src/sim/` are **pure JS**. They have no DOM, no three.js and no import of `state/`, and they must run in Node.
- `sim/` functions take the state as an argument, as in `attitudeAt(state, t)`. They never import the global `S`.
- `views/` and `gfx/` only draw what `sim/` computes. Physics never lives in a view.
- Views don't import each other. They coordinate through `app.js`.

## Conventions

Read `docs/CONVENTIONS.md` before touching the math. Key points:
- `C_BR` maps R → B (`v_B = C_BR · v_R`). Matrices are arrays of rows.
- Quaternions are `{w,x,y,z}` with the Shuster reading, `q2C(q) = C_BR`. The numbers match the three.js Hamilton quaternion.
- Euler sequences are intrinsic and built from passive rotations (`Rp`).
- Units are km and s in orbit and environment code, m in the spacecraft layout, rad in code, and degrees in the UI and state.
- If you change a convention or model, update both `docs/CONVENTIONS.md` and `src/ui/conventions.js`.

## Module syntax (required by scripts/build.mjs)

- Use named exports only: `export function`, `export class`, `export const`, `export { a }` and `export * from`.
- Don't use default exports, dynamic `import()`, import cycles or side-effect-only imports.
- Don't reassign an exported `let`, because the bundle has no live bindings.
- Import three as `import * as THREE from 'three'`.

## How to add things

- **Physics model:** `src/env/`, plus a test in `tests/environment.test.js`.
- **Guidance mode:** `attitudeAt` in `src/sim/guidance.js`, the controls in `src/views/orbit/orbitPanel.js`, and a test in `tests/sim.test.js`.
- **Component type:** `src/spacecraft/componentTypes.js`, a mesh in `src/gfx/spacecraftMesh.js`, and an optional rule in `src/sim/sensors.js`.
- **New setting:** add a default in `defaultState()` (`src/state/store.js`). Old saves are merged automatically. Bump `STORAGE_KEY` only for incompatible changes.
- **Spacecraft geometry change:** call `scChanged()`, not just `save()`.

## Workflow

- Put each feature on its own branch (`feat/…`, `fix/…`, `docs/…`) and open a PR to `main`. Don't push to `main` directly.
- New pure logic gets unit tests. Check physics against a known value, such as a textbook result or a reference orbit.
- The PR description says what changed, what was tested, and what still needs a visual check in the browser. Headless runs can't verify 3D rendering.
- Add a line to the top (unreleased) section of `CHANGELOG.md` in every feature or fix PR, with the issue number.
- Don't edit `legacy/`; it's a reference copy of the original single-file version. Don't commit `dist/`.
- Keep the UI text in English. Keep the existing visual style: `src/styles.css` and the `COL` colours in `gfx/primitives.js`.

## Releases

- Merging a PR does **not** change the version. A release is its own small PR, `chore/release-X.Y.Z`, that:
  - bumps `version` in `package.json` **and** `src/version.js` (a test checks they match)
  - moves the `## [Unreleased]` entries into `## [X.Y.Z] - YYYY-MM-DD`, leaves an empty Unreleased section, and updates the compare links at the bottom
- Semantic versioning: new features → minor (0.4.0 → 0.5.0), fixes only → patch (0.4.0 → 0.4.1).
- Propose a release PR after a batch of merged features, or when the user asks for one.
- After merging, the user runs **Actions → Release → Run workflow → `vX.Y.Z`**. Claude sessions can't create tags or releases.
- Builds between releases are labelled in the header (`v0.4.0 · main 0f7fc8c`) via `BUILD_LABEL` in CI and Pages.
