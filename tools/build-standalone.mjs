#!/usr/bin/env node
/**
 * Bundle the app into one self-contained HTML file at dist/3d-wind-rose.html.
 *
 * This project is the only one of the set that is not already a single file:
 * index.html pulls in a stylesheet and six scripts by relative path, so the
 * page is unusable on its own. Uploading one file to a host, or handing one to
 * a reader, means inlining this project's own CSS and JavaScript.
 *
 * The two third-party libraries are deliberately NOT inlined. three.js and
 * MapLibre GL JS still load from the CDN, as they do in index.html, so the
 * bundle redistributes none of their code and THIRD-PARTY-NOTICES.md stays
 * true: an internet connection is still required to run it.
 *
 * Version and date are read from index.html, which is where they are declared.
 *
 * The MapTiler key is NOT in the repository and must not be: index.html and
 * js/main.js both keep the placeholder. A bundle built without --key therefore
 * carries the placeholder too, and the map imagery will be absent — which is
 * exactly what happens if you replace a keyed copy on a server with a fresh
 * build. Pass the key to get a deployable file, written outside dist/ so a
 * keyed page is never a candidate for a commit.
 *
 * Usage:
 *   node tools/build-standalone.mjs                 dist/, placeholder key
 *   node tools/build-standalone.mjs --key YOUR_KEY  deploy/, your key
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

const html = read('index.html');

const version = (html.match(/^\s*Version\s+([0-9][0-9.]*)\s+—\s+(\d{4}-\d{2}-\d{2})/m) || [])[1];
const released = (html.match(/^\s*Version\s+[0-9][0-9.]*\s+—\s+(\d{4}-\d{2}-\d{2})/m) || [])[1];
if (!version || !released) throw new Error('index.html: no "Version x.y.z — YYYY-MM-DD" header found');

/* The order these are listed in index.html is the order they must run in:
   main.js reads globals the others define. Read it from the file rather than
   repeating it here, so adding a script cannot silently leave the bundle a
   file behind. */
const scripts = [...html.matchAll(/<script src="(js\/[^"]+)"><\/script>/g)].map((m) => m[1]);
if (!scripts.length) throw new Error('index.html: no local <script src="js/..."> tags found');

let out = html;

// The stylesheet. The MapLibre one above it is left alone.
out = out.replace('<link rel="stylesheet" href="css/style.css" />',
  '<style>\n' + read('css/style.css').trimEnd() + '\n</style>');
if (out.includes('href="css/')) throw new Error('a css/ reference survived inlining');

// The scripts, in place of the first one, with the rest removed.
const inlined = scripts.map((s) =>
  `<!-- ${s} -->\n<script>\n${read(s).trimEnd()}\n</script>`).join('\n\n');
out = out.replace(`<script src="${scripts[0]}"></script>`, inlined);
for (const s of scripts.slice(1)) out = out.replace(`<script src="${s}"></script>\n`, '');
if (out.includes('src="js/')) throw new Error('a js/ reference survived inlining');

out = out.replace(/^(\s*Version\s+[0-9][0-9.]*\s+—\s+\d{4}-\d{2}-\d{2})/m,
  '$1\n  Single-file build — this project\'s own CSS and JavaScript are inlined;\n' +
  '  three.js and MapLibre GL JS still load from the CDN, so a connection is needed.');

const PLACEHOLDER = 'YOUR_MAPTILER_API_KEY_HERE';
const keyArg = process.argv.indexOf('--key');
const key = keyArg > -1 ? process.argv[keyArg + 1] : '';
if (keyArg > -1 && !key) throw new Error('--key given with no key after it');

if (key) {
  if (!out.includes(PLACEHOLDER)) throw new Error('no placeholder to substitute — has the key leaked into the source?');
  out = out.split(PLACEHOLDER).join(key);
}

// A keyed page goes to deploy/, never dist/, so the two cannot be confused and
// a key-bearing file is not sitting in a directory anyone would commit.
const dir = key ? 'deploy' : 'dist';
mkdirSync(join(ROOT, dir), { recursive: true });
writeFileSync(join(ROOT, dir, '3d-wind-rose.html'), out);
console.log(`built ${dir}/3d-wind-rose.html  v${version} (${released})  ` +
  `${scripts.length} scripts + 1 stylesheet inlined, ${(out.length / 1024).toFixed(1)} KB` +
  (key ? '  — with your MapTiler key' : '  — placeholder key, no map imagery'));
