# Changelog

All notable changes to AttTool. Format based on [Keep a Changelog](https://keepachangelog.com/); versions follow [Semantic Versioning](https://semver.org/).
Every tagged version is downloadable as a single `AttTool.html` from [Releases](https://github.com/kacpersyn7/atttool/releases).

## [0.3.0] - unreleased

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

[0.3.0]: https://github.com/kacpersyn7/atttool/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/kacpersyn7/atttool/releases/tag/v0.2.0
