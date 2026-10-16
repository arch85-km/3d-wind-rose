# Changelog

Each release is archived on Zenodo with its own version DOI. The concept DOI,
[10.5281/zenodo.22802663](https://doi.org/10.5281/zenodo.22802663), always
resolves to the newest version. The full notes for each release are on the
[releases page](https://github.com/arch85-km/3d-wind-rose/releases).

## Unreleased

- **Added** — the About panel opens with "What it is for": a teaching tool
  whose results are indicative, not for compliance or certification.
- **Changed** — the cube device, the icon and logo, is reserved: neither the
  MIT licence nor CC BY 4.0 grants any right to use it. Stated in the licence
  file and the app's licence panel.
- **Fixed** — an hour with a missing wind direction (999 in an EPW file) but
  a valid speed was counted as wind from the west. It is now dropped, as a
  missing speed already was; a calm hour needs no direction and still counts
  as calm. The built-in locations were not affected.
- **Tests** — the release guard also checks the release date, the stamps in
  `index.html`, its About button, the stylesheet and script headers, the
  built `dist/` file, the README, `.zenodo.json` and the notes' citations.
  9 → 24 checks.
- **Docs** — the method notes no longer say the repository carries a MapTiler
  key or that the tool works with no network at all: the repository keeps a
  placeholder, and the libraries load from a CDN.
- **Docs** — `ARCHITECTURE.md`, `CHANGELOG.md` and `DESIGN.md` added, and a
  statement of how the app is developed added to the README, the method
  notes and a new `.zenodo.json`.

## [1.1.0](https://github.com/arch85-km/3d-wind-rose/releases/tag/v1.1.0) — 4 October 2026

Version DOI [10.5281/zenodo.23144896](https://doi.org/10.5281/zenodo.23144896).

- **Added** — a single-file build. `node tools/build-standalone.mjs` writes
  `dist/3d-wind-rose.html` with the project's own CSS and JavaScript inlined.
  three.js and MapLibre GL JS still load from the CDN, so a connection is
  still required. With `--key` the keyed file goes to the gitignored
  `deploy/`, so a page carrying a MapTiler key cannot become a commit.
- **Added** — the licence, credits, release and how to cite, behind the
  version tag. It is wired independently of the main script, so it still
  opens when three.js fails to load.
- **Added** — the method notes in brief, a short companion to the full notes.
- **Changed** — the tab icon is carried inside the HTML, so a copy opened
  from disk or another domain shows the same mark.
- **Fixed** — `THIRD-PARTY-NOTICES.md` described a single-file build that
  inlined both libraries, which did not exist. The clause is removed.
- **Fixed** — the message shown when no basemap loads named a file the
  single-file build lacks and guessed the cause. It now says what was
  observed: the imagery did not load, the key and the connection are worth
  checking, and the wind rose works without it.
- **Docs** — exercise 3 asked for a comparison the presets cannot show; it is
  corrected. The provenance and reference details now say where they came
  from rather than what they are not.

## [1.0.1](https://github.com/arch85-km/3d-wind-rose/releases/tag/v1.0.1) — 17 September 2026

Version DOI [10.5281/zenodo.22812055](https://doi.org/10.5281/zenodo.22812055).
A bug-fix release.

- **Fixed** — the wind rose failed to render or stay visible on some Android
  browsers (Chrome, Samsung Internet, Opera). It now renders on its own
  canvas instead of sharing the map's.
- **Fixed** — a "ghosting" trail when tilting into the 3D view.
- **Docs** — three.js and MapLibre GL JS documented in
  `THIRD-PARTY-NOTICES.md`.

## [1.0.0](https://github.com/arch85-km/3d-wind-rose/releases/tag/v1.0.0) — 16 September 2026

Version DOI [10.5281/zenodo.22802664](https://doi.org/10.5281/zenodo.22802664).
First public release.

- A browser-based 3D wind rose viewer: EPW climate data binned into a
  16-direction frequency table and drawn over a live map, with an optional
  imported `.obj` building for visual context. The building plays no part in
  the calculation.
- Wind data from an uploaded EPW file or one of three built-in UK presets:
  London, Sheffield (Doncaster Airport) and Edinburgh (Turnhouse Airport).
- A month-by-month breakdown, calm hours, and six basemap styles.
- `.obj` import with scale and rotate controls and four render styles.
- Screenshot export at twice the screen resolution.
- Method notes in `docs/method-notes.html`.
