# Changelog

All notable changes to AttTool. Format based on [Keep a Changelog](https://keepachangelog.com/); versions follow [Semantic Versioning](https://semver.org/).
Every tagged version is downloadable as a single `AttTool.html` from [Releases](https://github.com/kacpersyn7/atttool/releases).

## [Unreleased]

## [0.7.0] - 2026-11-03

### Added
- **Payload view** (#10): a picture-in-picture camera along the payload boresight, stacked above the body-frame view: projected lat/lon grid, ground track, payload FOV circle, ground target, along-track / right-of-track arrows, scale bar and pointing-error readouts. Drawn as a 2D projection (sharp at any scale). A **Payload pointing** card shows the error against the ground target in every guidance mode — angle, along / cross-track (°) and ground distance (km) — and the target can be set outside target mode. New plot signals: pointing error and ground error vs target. Toggle *Payload view*.
- **Map in the payload view** (#35): Natural Earth 1:50m land, lakes, rivers, country and province borders and labelled cities under the grid, track and target, so you can see what the payload is looking at. Offline, public-domain data built into the file (the single-file build grows from ~0.3 MB to ~0.8 MB). Schematic (good to a few km). Toggles *Map borders* and *Map cities*. The 3D Earth uses the same data: sharper coastlines, lakes and country borders.
- **Target height** (#34): the ground target has a height above the sphere (*Height m*, −500 to 9000; default 0, older saves unchanged). Guidance and the pointing error use it. The payload view marks the point under the target and the *Payload pointing* card shows the **relief displacement** (≈ h·tan(incidence), e.g. about 1.3 km for 2 km of height seen 30° off nadir).
- **Spacecraft library** (#37): keep several spacecraft and choose which one is active, in *Spacecraft Layout* (new, duplicate, rename, delete) and in the Orbit tab. Each remembers its own pointing axis. Import JSON can add a new spacecraft or replace the active one, and the copied JSON now carries the name. Older saves become a library of one.

### Fixed
- Layout: mass properties now update on every change, also after visiting Table view; the rail and the exported mounting matrices could show old values. (#37)
- Import JSON: a part without a position, name or orientation, or with an invalid mass, now gets a readable error instead of being accepted and stopping the app from starting on the next load. (#37)
- Layout table: the type filter resets when that type isn't on the spacecraft. (#37)

## [0.6.0] - 2026-11-01

### Added
- **Orbit from a state vector or a TLE** (Orbit tab → Orbit → *Defined by: Elements | r, v (J2000) | TLE*). r, v at the epoch are converted exactly to elements (circular / equatorial cases handled; open or sub-surface orbits reported); a pasted TLE is checked (checksums) and sets the epoch. Switching definitions keeps the orbit. *State now* shows r, v at the current time, with *Make this the initial state* and *Copy r, v (MATLAB)*. TLEs are flown with Keplerian + J2, not SGP4 (stated in the UI). (#8)
- The epoch can have seconds.
- **Signal plots** above the Orbit timeline: up to four strip charts of q_BI, q vs the orbital frame or nominal, Euler angles, body rate, Sun / nadir / B-field in body, β angle, altitude, and per-part Sun and Earth-limb angles. Quaternions stay sign-continuous; eclipse is shaded. Off by default. Window: one orbit (lined up with the timeline) or the last 5–90 min. Hover to read values, click to jump; **CSV** downloads the window at a 1 s step (decimal-comma option). Plots and timeline sit in a panel docked below the 3D view (which shrinks instead of being covered): drag its top edge to resize, ▾ to collapse. (#9)
- **Moon in star-tracker availability**: low-precision Moon ephemeris (~0.3°), seen from the spacecraft (~1° parallax in LEO). Star trackers have a *Moon excl.* angle (default 15°; parts in older saves get it automatically) and are Moon-blinded when the Moon is inside it and not behind the Earth: violet in the STR timeline rows, "Moon-blinded" in the Orbit panel. The Moon itself in the 3D view (true size and distance, lit by the Sun so it shows its phase) and in the body-frame inset (hidden while behind the Earth), with a Moon vector in both (toggle *Moon + vector*; **Moon view** button flies the camera there), "Moon in body" in the HUD, Moon exclusion cone with the Sun one in Layout, and *Moon direction in body* / *STR · Moon angle* signals (a gap while the Moon is behind the Earth). (#15)

### Fixed
- Body frame view: the spacecraft no longer intersects the Earth; the Earth keeps its true apparent size but sits beyond the camera's reach. (#27)

## [0.5.0] - 2026-10-31

### Added
- **Table view** in the Layout tab ("3D | Table" switch): every part in one sortable, filterable table with position, +Z axis, yaw-pitch-roll, mass, parameters and the axis angles to Earth / along-track / orbit normal in nominal flight. Expand a row for the DCM, quaternion and MATLAB lines; copy the table for Excel; warnings for duplicate names, clashing export names, parts at the same spot and parts without mass; "Edit" opens the part in the 3D editor. (#22)
- **Edit the table in Excel and import it back**: "Import edits…" (or Layout → Save & share → "Import part data…") reads the copied table, with positions, masses and orientations. For orientation it uses whichever of yaw-pitch-roll / quaternion / DCM you edited (two edited differently is reported); only edited fields are written back; decimal commas work, and "Copy table" uses them automatically in comma locales. Edits to display-only columns (type, axis, parameters, angles) are reported as ignored; cells Excel turned into dates or text are reported with a hint. (#22)
- Import part data also sets **masses** (`NAME_mass = 0.4`, or `"mass"` in JSON). (#22)
- Header shows which build you are running between releases (e.g. `v0.4.0 · main 0f7fc8c`); release downloads show just the version.

### Fixed
- CI workflow failed to load since v0.4.0 (an unquoted `#` in the build-label expression); a test now guards against it.

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

[Unreleased]: https://github.com/kacpersyn7/atttool/compare/v0.7.0...HEAD
[0.7.0]: https://github.com/kacpersyn7/atttool/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/kacpersyn7/atttool/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/kacpersyn7/atttool/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/kacpersyn7/atttool/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/kacpersyn7/atttool/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/kacpersyn7/atttool/releases/tag/v0.2.0
