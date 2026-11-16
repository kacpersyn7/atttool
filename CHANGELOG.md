# Changelog

All notable changes to AttTool. Format based on [Keep a Changelog](https://keepachangelog.com/); versions follow [Semantic Versioning](https://semver.org/).
Every tagged version is downloadable as a single `AttTool.html` from [Releases](https://github.com/kacpersyn7/atttool/releases).

## [Unreleased]

### Added
- **Edit the schedule on the timeline** (#56): on the Mode band, click a block to pick its change (as clicking its row), drag its left edge to move its start in whole seconds (the time is shown while dragging; Undo takes it back), and double-click to add a change there with the settings in force. The band no longer seeks; the other rows still do.
- **Repeat ground track orbits** (#73): a fourth way to define the orbit, *Repeat track*: R orbits in D days, the LTAN and the longitude where reference orbit 1 crosses the equator. Altitude and inclination are solved so the orbit is sun-synchronous and repeats its ground track (Sentinel-2's 143/10 comes out at 786.1 km, as published); buttons set Sentinel-2, Sentinel-1, Landsat 8/9 and Sentinel-3. Readouts: orbits per day, altitude, inclination, period, track spacing, when orbit 1 crosses the reference longitude, and how well the track closes.
- **Max slew rate and automatic slew times** (#57): a spacecraft has a *Max slew rate* (Spacecraft Layout, Actuator authority; 1°/s by default). A schedule change can slew *auto*: its turn at the start ÷ that rate, rounded up to whole seconds, worked out again when the schedule, the orbit or the spacecraft changes. New changes are automatic. A fixed slew time that needs more than the max rate is marked ⚠. Still kinematics: a rate cap, no wheel dynamics.
- **Mode schedule: names and editing helpers** (#55): a change can have a name, shown in its row, the timeline Mode band and the status chip (*Now: Image Warsaw (Target)*). ⏮ / ⏭ next to Play jump to the previous or next change. The selected change can be duplicated (at the current time) or moved by ±1 min, and *Undo* takes back schedule edits (adding, deleting, moving, naming, slew or mode of a change); a change's other settings keep their current values.
- **Scenario import: preview, report and replace** (#59): the import dialog shows what a scenario would be before it is added (name, orbit, epoch, mode and schedule, which spacecraft it would fly) and lists what could not be taken as it was: values reset to the default, schedule changes dropped and why. A scenario with the same name can be replaced instead of added as a copy.
- **Files** (#60): *Download* saves a scenario (Orbit) or a spacecraft (Layout) as a .json file; the import dialogs can *Open file…*, and a file can be dropped on the dialog, the Scenario card or the *Save & share* card.
- **Play the whole scenario** (#67): *▶ Scenario* in the Time card plays from the scenario's start to its end at the chosen speed and pauses there (or loops), with a progress bar. A new scenario setting, *Scenario ends (UTC)*, sets the end; *Auto* ends it when the last schedule change has finished its slew (the attitude stops moving there), plus 5 min (one orbit without a schedule). New speeds 10× and 30×.
- **Target tracking slews at rise and set** (#65): instead of jumping to the target when it rises, the spacecraft slews to it before the rise, so tracking starts as it rises, and back to the nominal attitude after the set. The time is a new target setting, *Slew to/from* (60 s by default, per schedule change); 0 keeps the jump.

### Changed
- **J2 drift of the mean anomaly** (#72): with J2 on, the mean anomaly now drifts at its first-order secular rate too, as the node and perigee did. Along-track timing moves by up to ~30 km per orbit in LEO (28 km, 3.7 s, at SSO 550 km; 5 km for the ISS), so **saved scenarios with J2 on reach their targets at slightly different times**. A TLE is flown at exactly the mean motion it states (its semi-major axis is the first-order Kozai→Brouwer one, within 0.1 m of SGP4's).

## [0.9.0] - 2026-11-08

### Added
- **Mode schedule** (#39): change the guidance mode at set times within a scenario. Each change slews from the attitude before it over its own slew time (60 s by default, slerp with both attitudes worked out at each moment, so scrubbing works) and keeps its own mode settings and ground target. Times are UTC. The timeline shows a mode band with the slews, and the Mode schedule card lists the changes, marks the one flying and edits the one you pick. Kinematics only.
- **Mode schedule: easier editing** (#39): a typed start applies on Enter or on leaving the field (Esc undoes it), so the list no longer reorders while a date is half typed. The editor shows the start as T+ from the epoch and the turn a change asks for at its start, with its mean rate over the slew. Changes that start during the slew before them, or at the same moment as another, are marked; a slew of 0 s reads "jump". Each change now has its own pointing payload too (it was shared by the whole scenario), and the payload readouts follow the one flying; the Initial row says until when it flies.
- **Scenario JSON format 2** (#39): a scenario with a mode schedule is copied as format 2, so AttTool 0.8 and older refuse it ("comes from a newer version") instead of importing it without its schedule. Scenarios without a schedule stay format 1.

### Fixed
- The time slider behaved differently at the start than after a jump: T+0 was at the left end on load but in the middle after coming back to it. The slider now shows pages counted from the epoch, on the same pages as the availability timeline with the Orbit span; releasing at either end turns to the next or the previous page. (#49)

## [0.8.0] - 2026-11-06

### Added
- **Current time, separate from the epoch** (#47): the epoch now sits in the Orbit card as part of the orbit definition, and the Time card has a current UTC you can type. Time can run past 72 h and before the epoch, without moving the orbit; the slider follows it, 3 days at a time. Editing the epoch keeps the current UTC. Typed dates are limited to 1900–2200.
- **Scenario library** (#38): keep named scenarios and switch between them in the Orbit tab (new, duplicate, rename, delete). A scenario keeps the orbit, epoch, time, guidance, target and which spacecraft flies it; display options stay shared. *Copy JSON* and *Import* move a scenario to another computer: the JSON holds the scenario and names its spacecraft, which is found by name in the library (spacecraft have their own JSON in *Spacecraft Layout*). Older saves become a library of one.
- **More orbit presets** (#44): SSO at LTAN 11:00, 12:00, 13:30, 18:00 and 22:30 (Sentinel-2-like), polar, 53° and equatorial LEO, GPS-like MEO and GTO.
- **Finer time slider** (#49): it has a full-width row and shows one orbit, a day or 3 days (one orbit by default), so you can scrub within an orbit. Playback waits while you hold the thumb; arrow keys step 1 min (with Shift 1 s), Page Up / Down a tenth of the span.

### Fixed
- The LTAN readout could show an hour too little: 10:00 for LTAN 11:00, 05:00 for the dawn–dusk preset. The orbit itself was right. (#44)

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

[Unreleased]: https://github.com/kacpersyn7/atttool/compare/v0.9.0...HEAD
[0.9.0]: https://github.com/kacpersyn7/atttool/compare/v0.8.0...v0.9.0
[0.8.0]: https://github.com/kacpersyn7/atttool/compare/v0.7.0...v0.8.0
[0.7.0]: https://github.com/kacpersyn7/atttool/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/kacpersyn7/atttool/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/kacpersyn7/atttool/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/kacpersyn7/atttool/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/kacpersyn7/atttool/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/kacpersyn7/atttool/releases/tag/v0.2.0
