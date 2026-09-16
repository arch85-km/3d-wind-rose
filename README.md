# 3D Wind Rose

**3D Wind Rose: a browser-based climate data and building context viewer.**

A self-contained Three.js + MapLibre GL JS app that renders an interactive
3D wind rose over a live satellite/street map, sized against either a small
default footprint or a building you import as a `.obj` model (with Scale and
Rotate controls). Wind data comes from an uploaded EPW file or one of three
built-in UK city presets (London, Sheffield, Edinburgh).

No build step, no bundler — `index.html` loads Three.js and MapLibre GL JS
from a CDN, plus this repo's own `css/style.css` and `js/*.js` files.

## A note on this repo's history

The first commit in this repo introduces the app already complete,
rather than building it up commit by commit — it's a reconstruction
from a working build, not the original development history. The
app's actual step-by-step development happened earlier, in a
different environment, and that history no longer exists to bring
across. Every commit after the first one *is* genuine incremental
history, made directly in this repo.

## Version

**1.0.0** — 2026-09-15

## Setup

The live map basemap (Satellite, Streets, Hybrid, Outdoor, Bright, Toner)
needs a free MapTiler API key to display real tiles:

1. Sign up free at <https://cloud.maptiler.com/account/keys/> (no credit
   card needed; the free tier covers 100,000 tile loads/month).
2. Open `js/main.js` and replace `YOUR_MAPTILER_API_KEY_HERE` on the
   `MAPTILER_KEY` line with your key.
3. Open `index.html` in a browser — as a local file, or served over
   `http(s)://` (e.g. `python3 -m http.server`).

Without a key, the app still runs and the wind rose/building still render
fully — you just won't see real map imagery underneath them.

**Do not commit your API key.** Keep `js/main.js`'s `MAPTILER_KEY` as the
placeholder in anything you push back to this repo.

## License

- **Code** (`index.html`, `css/`, `js/`) is licensed under the [MIT
  License](LICENSE).
- **Accompanying material** — documentation pages, screenshots, and
  exercises — is licensed under [CC BY 4.0](LICENSE-CONTENT).

Copyright © Karam Al-Obaidi.
