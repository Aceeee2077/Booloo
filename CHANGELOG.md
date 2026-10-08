# Changelog

Notable changes to Booloo. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[semantic versioning](https://semver.org/spec/v2.0.0.html).

Two notes on this file's history:

- **0.6.15 was built but never published.** It was a local packaging run; 0.6.16
  is the next release after 0.6.14.
- **Entries below 0.6.16 are a summary, written after the fact.** The
  authoritative record for older builds is the
  [Releases page](https://github.com/Aceeee2077/Booloo/releases), and this file
  is accurate from 0.6.16 onwards.

## [Unreleased]

## [0.6.16] - 2026-10-08

### Added

- **Outline the picture pet** — an optional white silhouette around an imported
  picture. A cutout that is not pixel-perfect reads as ragged against a busy
  desktop; tracing the edge makes it look deliberate instead. Off by default.

### Changed

- **The automatic cutout now lives in one place.** The settings preview asks the
  Rust side for the composited picture instead of keying the photo in the
  renderer, so the preview, the manual editor and the saved PNG can no longer
  disagree about the tolerance — they used to run two different algorithms with
  two different thresholds.
- **The walking body bob is locked to the leg clock.** It ran on a free 628 ms
  sine against a 500 ms four-frame stride, so it drifted through the legs and
  read as floating rather than walking. It is now two dips per stride, in phase.
- **The manual cutout editor moved behind an "advanced" disclosure** on the
  import preview, so the default path is just "does this look right? then use it".

### Fixed

- **Importing a large photo no longer freezes the settings window.** The commit
  that composites the cutout now runs off the main thread.
- The imported-picture renderer no longer re-keys an image that the cutout editor
  already saved with baked transparency.

### Removed

- The duplicate background-keying implementation in the renderer (`lite-image.ts`),
  which was the source of the two-threshold disagreement above.

## [0.6.14] - 2026-09-30

Summary only — see [Releases](https://github.com/Aceeee2077/Booloo/releases).

- Tauri 2 / Rust rewrite of the desktop shell.
- Local cutout editor with erase / restore brushes and undo.
- Affinity, the click heatmap, the health plan and reminder signs.
- CPU / memory / battery reactions.
- Signed auto-update channel, with macOS `.dmg` builds published alongside the
  Windows installer.

## Earlier

- **0.5.1** — first signed Tauri update. Packages were still named Prismoo.
- **0.4.0** — the Electron build: wardrobe, PetPack, AI chat, weather. Linux
  AppImage and deb were published here, and no later release has shipped Linux
  bundles — see the *Build* workflow for the artifacts that exist today.
- **0.3.1 / earlier** — the project was called Petric.
