# Changelog

All notable changes to AttTool. Format based on [Keep a Changelog](https://keepachangelog.com/); versions follow [Semantic Versioning](https://semver.org/).
Every tagged version is downloadable as a single `AttTool.html` from [Releases](https://github.com/kacpersyn7/atttool/releases).

## [Unreleased]

### Added
- **Table view** in the Layout tab ("3D | Table" switch): every part in one sortable, filterable table with position, +Z axis, yaw-pitch-roll, mass, parameters and the axis angles to Earth / along-track / orbit normal in nominal flight. Expand a row for the DCM, quaternion and MATLAB lines; copy the table for Excel; warnings for duplicate names, clashing export names, parts at the same spot and parts without mass; "Edit" opens the part in the 3D editor. (#22)
- **Edit the table in Excel and import it back**: "Import edits…" (or Layout → Save & share → "Import part data…") reads the copied table, with positions, masses and orientations. For orientation it uses whichever of yaw-pitch-roll / quaternion / DCM you edited (two edited differently is reported); only edited fields are written back; decimal commas work, and "Copy table" uses them automatically in comma locales. Edits to display-only columns (type, axis, parameters, angles) are reported as ignored; cells Excel turned into dates or text are reported with a hint. (#22)
- Import part data also sets **masses** (`NAME_mass = 0.4`, or `"mass"` in JSON). (#22)
- Header shows which build you are running between releases (e.g. `v0.4.0 · main 0f7fc8c`); release downloads show just the version.

## [0.4.0] - 2026-10-31

### Added
- **Import orientations & positions** (Layout → Save & share): paste or load DCMs, quaternions and positions per part (with worked examples for positions in the dialog), matched by name. MATLAB (`STR_1 = [a b c; d e f; g h i];`), NumPy, JSON, a full AttTool configuration, or AttTool's own exports. Choice of matrix direction and quaternion order, preview of what changes (degrees / mm), unmatched names and invalid matrices reported, nothing changes until Apply. (#7)
- **Copy as MATLAB**: the whole layout as a MATLAB script (C_CB, q_BC, positions, bus, nominal alignment, wheel matrix, mass properties). (#7)
- Build the satellite in its own frame (SCF) like a CAD model: the bus is now a part with its own position and orientation; "put the origin at a bus face" moves the whole satellite. (#5)
- **Attitude reference** card: say which SCF axis each VVLH / LVLH / VNC axis points along (or give a DCM). Arrows in the Layout view show where Earth, along-track and the orbit normal will be in nominal flight. The Orbit tab flies this as "Nominal attitude + offsets", with a new "B vs nominal" HUD row. (#5)
- Orientation of every part as yaw-pitch-roll, **DCM** (paste from MATLAB / NumPy, either direction, validity check, orthonormalise, copy as MATLAB) or quaternion. (#6)
- Corner axis widget in the Layout and Rotation Lab views; click an axis to look along it. (#5)
- Layout view follows the CAD convention: +Z up on screen, grid = SCF XY plane through the origin. (#5)
- The example spacecraft stands on the grid: its bus −Z face is at the SCF origin (affects new layouts and "Reset to example" only). (#5)

### Changed
- Python export: variable names keep axis signs apart (`CSS-+X` → `CSS_pX`, `CSS--X` → `CSS_mX`; previously both were `CSS_X`), and positions have 6 decimals. Both exports import back unchanged. (#7)
- Escape closes dialogs even while typing in them.
- The Orbit tab's "Orbital frame" selector is now "Shown orbital frame" (triad and HUD only); the nominal attitude comes from the spacecraft. Saved layouts and v0.3 settings migrate unchanged.

## [0.3.0] - 2026-10-20

### Changed
- Orbital frames follow STK: the frame previously called "LVLH" is **VVLH**; added STK **LVLH** and **VNC**. The reference frame for attitude offsets, the drawn triad and the HUD angles is selectable; the default (VVLH) keeps nadir pointing unchanged. Old saves are migrated. (#4)

### Added
- Version number in the app header, this changelog.
- GitHub Actions: tests and build on every pull request; automatic releases with `AttTool.html` attached; GitHub Pages deployment with every released version kept side by side. (#2, #3)
- Running the Release workflow manually with a new tag creates that tag on `main` first.

## [0.2.0] - 2026-10-17

### Changed
- Split the single-file tool into ES modules (`core`, `env`, `spacecraft`, `sim`, `state`, `ui`, `gfx`, `views`). Behaviour identical to the original.

### Added
- 40 unit tests (`npm test`), zero-dependency dev server and single-file build, architecture and conventions docs. Original kept in `legacy/`.

[Unreleased]: https://github.com/kacpersyn7/atttool/compare/v0.4.0...HEAD
[0.4.0]: https://github.com/kacpersyn7/atttool/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/kacpersyn7/atttool/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/kacpersyn7/atttool/releases/tag/v0.2.0
