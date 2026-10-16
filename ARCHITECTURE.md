# Architecture

How 3D Wind Rose is put together: what lives where, how an EPW file becomes a
rose on a map, and what the tooling around it does. For what is and is not
modelled, and what a figure from it can support, read the
[method notes](docs/method-notes.html). This file is the map.

## The files

Unlike the other apps in the collection, the source is not one file.
`index.html` loads a stylesheet and six scripts by relative path. There is no
build step for development: open `index.html`, or serve the folder.
`tools/build-standalone.mjs` inlines the project's own CSS and JavaScript into
`dist/3d-wind-rose.html`, the single file that is uploaded to the website.

| File | Size | What it holds |
|---|---|---|
| `index.html` | 21 KB | The markup, the two tab icons as base64 PNGs (4 KB), and the About panel's script |
| `css/style.css` | 24 KB | All styling. System fonts only, so there is no web font to fetch. |
| `js/epw.js` | 4 KB | The EPW parser and the binning |
| `js/palettes.js` | 2 KB | The three colour palettes |
| `js/sample-data.js` | 30 KB | The three built-in UK locations, already binned |
| `js/building.js` | 3 KB | The four render styles for a loaded model |
| `js/windrose.js` | 9 KB | The rose's geometry |
| `js/main.js` | 94 KB | The map, the scene, the interface and the exports, about 2,000 lines |
| `dist/3d-wind-rose.html` | 187 KB | The single-file build of all of the above |

Four libraries load from jsDelivr at run time, in this order: three.js r128
(`three@0.128.0`) with its `CSS2DRenderer` and `OBJLoader` examples, and
MapLibre GL JS 4.7.1 with its stylesheet. Neither the source nor the build
contains their code, so the app needs a connection.

## Conventions

- One scene unit is one metre. three.js is Y-up; north is −Z and east is +X
  (`polarToXZ`, `dirToAngle`).
- Wind direction is the direction the wind blows **from**, as EPW records it.
- 16 sectors of 22.5°, each centred on its compass point:
  `Math.round(dir / 22.5) % 16`, so north spans 348.75° to 11.25°.
- Calm is `speed < 0.5` m/s, whatever the direction.
- Speed bins (`SPEED_BINS`) are 0–2, 2–4, 4–6, 6–8 and 8+ m/s; an hour goes
  in the first bin whose upper limit it is below.
- Each cell's percentage is its count over **all** records, calm included, so
  the petals and the calm percentage together make 100.
- The release is written in several places: the header comment of
  `index.html`, the About button's `data-version` and `data-released` and its
  `v1.1.0` label, the header comment of the stylesheet and each script, the
  README, `CITATION.cff` and the bylines of both method notes. The build
  copies them into `dist/`. The release guard checks every copy.

## The modules

Each script adds one member to `window.App`; `main.js` reads them all.

| Script | Defines | What it does |
|---|---|---|
| `epw.js` | `App.EPW` | `parseEPW` checks the `LOCATION` line, reads its name and coordinates, then reads month (field 2), direction (field 21) and speed (field 22) from line 9 on. It drops rows with a speed of 999 or more (EPW's missing value), and rows with a direction outside 0–360° unless the hour is calm. `binGroup` makes the 16 × 5 table and the calm percentage; `binRecordsByMonth` makes one per month from the EPW month field. |
| `palettes.js` | `App.Palettes` | Sunset (the default), Ocean and Classic, five colours each. `applyPalette` recolours `SPEED_BINS` in place. |
| `sample-data.js` | `App.SampleData` | `UK_LOCATIONS`: London (St James's Park, WMO 037700), Sheffield (Doncaster Airport, WMO 034054) and Edinburgh (Turnhouse Airport, WMO 031600). Each is binned from a TMYx EPW of 8,760 hours and stored as the annual table and twelve monthly tables, not as hourly data. |
| `building.js` | `App.Building` | `applyRenderStyle`: Realistic, Flat Shaded, Wireframe and Blueprint. It does not read OBJ files; `main.js` does. |
| `windrose.js` | `App.WindRose` | `buildWindRose` stacks each sector's speed bins outward from an inner radius as flat extruded wedges, so frequency sets length and every petal has the same thickness. It draws the rim, the percentage rings and 16 spokes. |
| `main.js` | (nothing) | Everything else, in sections headed `// ---------- … ----------`: map basemap config, scene setup, sky, rebuild helpers, the wind-data/site divergence warning, site location, location search, the controls, map padding, OBJ loading, toast, screenshot export, high-resolution capture, the mobile drawer, the orientation gizmo, resize and init. |

## From a file to a rose

1. The libraries load, then the six scripts in order.
2. `main.js` creates the three.js scene and a `WebGLRenderer` on its own
   canvas, `#three-overlay`, laid over the map with its own WebGL context
   (since 1.0.1; sharing the map's broke on some Android browsers).
3. It creates the MapLibre map on the Streets style, centred on the London
   preset. Once the map loads, `ensureBuildingLayer` adds `buildingLayer`, a
   custom layer that only passes the map's camera matrix to the three.js
   camera, placing the scene at the site with `MercatorCoordinate`.
4. `independentDrawLoop` calls `drawFrame` on every animation frame.
5. Init applies the Sunset palette, builds the empty model group and calls
   `loadCity` for London.
6. An uploaded EPW is read with `FileReader` and binned by `EPW.parseEPW`. If
   the file has coordinates, the map flies there.
7. `rebuildWindRose` takes the chosen month's table and sizes the rose from
   the model's footprint (`NO_MODEL_FOOTPRINT_RADIUS`, 7.2 m, when nothing is
   loaded). It scales the longest direction to the same length whatever the
   data, so only the proportions within one rose carry information.
8. `updateDataLocationWarning` compares where the wind data came from with the
   map centre (`haversineKm`) and warns past `DATA_LOCATION_WARN_KM`, 50 km.
9. The month slider, the rose size and the palette rebuild the rose; Rotate
   turns only the building.

## A loaded building

The `.obj` is read locally and parsed with three.js's `OBJLoader`. It is
fitted so its larger plan dimension is 16 m, centred, set on the ground and
given a neutral material. Scale (25–300%) and Rotate (0–355°) act on it. It
never enters the binning: `epw.js` and `windrose.js` take only
`{dir, speed, month}` records.

## What leaves the browser

| When | Request |
|---|---|
| On load | three.js, its two examples and MapLibre GL JS from `cdn.jsdelivr.net` |
| On load, and on each basemap change | A MapTiler style (`satellite`, `streets-v2`, `hybrid`, `outdoor-v2`, `bright-v2`, `toner-v2`), then the tiles, glyphs and sprites it names |
| On a search that is not a typed "lat, lon" | MapTiler geocoding, `api.maptiler.com/geocoding/…` |

EPW and OBJ files are read in the browser and never uploaded.

The MapTiler key is `MAPTILER_KEY` in `js/main.js`, and the repository keeps
it as the placeholder `YOUR_MAPTILER_API_KEY_HERE`. `build-standalone.mjs
--key` writes a keyed copy to `deploy/`, which is gitignored, so a page
carrying the key cannot become a commit. If no map data has arrived after 6
seconds, the map falls back to a blank style, a toast says the imagery did not
load, and the rose and the building still render.

## What the browser stores

Nothing: no `localStorage`, `sessionStorage`, IndexedDB or cookies.

## Exports

A screenshot, as PNG or JPEG, at twice the screen resolution (capped at
4,096 px on the long edge). It draws the map, the scene, the compass and ring
labels, the copyright pill and the legend with its hours, calm percentage,
location, month and any divergence warning.

## About

The version tag opens the licence, the credits, the release and how to cite.
Its script is inline in `index.html`, ahead of the CDN libraries, so it still
opens when three.js fails to load. It reads the release from the button's
`data-version` and `data-released`, and cites the concept DOI.

## The repository

```
index.html                    the page: markup, icons, About script
css/style.css                 all styling
js/                           epw, palettes, sample-data, building, windrose, main
dist/3d-wind-rose.html        the single-file build (placeholder key)
deploy/                       a keyed build, gitignored, never committed
docs/method-notes.html        method notes (website HTML widget)
docs/method-notes-summary.html  the method in brief
tools/build-standalone.mjs    the single-file build
tools/check-release-metadata.mjs  the release guard
CITATION.cff · .zenodo.json · LICENSE · DOCS-LICENCE.md · THIRD-PARTY-NOTICES.md · README.md
ARCHITECTURE.md · CHANGELOG.md · DESIGN.md
```

## Testing and release

There is no automated test suite. `node tools/check-release-metadata.mjs` is
the release guard: 24 checks that the version, the date and the DOI agree
everywhere they are written, including the built `dist/` file. Until Zenodo
mints a release's version DOI, the notes must cite the concept DOI; the guard
derives that rule from `CITATION.cff`.

Release order: bump every stamp, rebuild `dist/` with
`node tools/build-standalone.mjs`, run the guard, push, cut the GitHub release
(tag `vX.Y.Z`), then record the version DOI that Zenodo mints in a separate
commit.

Some comments in `main.js` describe earlier states of the code: a scene that
shared the map's WebGL context, a "procedural building", "Auto-match nearby
buildings" and "Display Size" controls, and a vendored MapLibre. None of
these exists now. The README's "No build step, no bundler" predates the
optional single-file build.
