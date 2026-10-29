# Changelog

All notable changes to AttTool. Format based on [Keep a Changelog](https://keepachangelog.com/); versions follow [Semantic Versioning](https://semver.org/).
Every tagged version is downloadable as a single `AttTool.html` from [Releases](https://github.com/kacpersyn7/atttool/releases).

## [Unreleased]

### Added
- Build the satellite in its own frame (SCF) like a CAD model: the bus is now a part with its own position and orientation; "put the origin at a bus face" moves the whole satellite. (#5)
- **Attitude reference** card: say which SCF axis each VVLH / LVLH / VNC axis points along (or give a DCM). Arrows in the Layout view show where Earth, along-track and the orbit normal will be in nominal flight. The Orbit tab flies this as "Nominal attitude + offsets", with a new "B vs nominal" HUD row. (#5)
- Orientation of every part as yaw-pitch-roll, **DCM** (paste from MATLAB / NumPy, either direction, validity check, orthonormalise, copy as MATLAB) or quaternion. (#6)
- Corner axis widget in the Layout and Rotation Lab views; click an axis to look along it. (#5)

### Changed
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

[Unreleased]: https://github.com/kacpersyn7/atttool/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/kacpersyn7/atttool/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/kacpersyn7/atttool/releases/tag/v0.2.0
