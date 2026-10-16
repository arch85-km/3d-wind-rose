#!/usr/bin/env node
/**
 * Release-metadata consistency.
 *
 * The version is written in several places that nothing builds from and no
 * other test reads, so they drift silently. .zenodo.json is the dangerous one:
 * Zenodo's GitHub integration reads it in preference to the release tag and to
 * CITATION.cff, so a stale version there publishes the archive under the wrong
 * label with a correct new DOI — a failure that looks like success.
 *
 * Dependency-free and runnable on a bare Node: node tools/check-release-metadata.mjs
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  cond ? pass++ : fail++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? '  —  ' + detail : ''}`);
};
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const has = (p) => existsSync(join(ROOT, p));

/* --- the files that name a version ------------------------------------- */
const versions = {};
if (has('package.json')) versions['package.json'] = JSON.parse(read('package.json')).version;
if (has('.zenodo.json')) versions['.zenodo.json'] = JSON.parse(read('.zenodo.json')).version;

let cff = null, cffVersion = null, cffDois = [];
if (has('CITATION.cff')) {
  cff = read('CITATION.cff');
  cffVersion = (cff.match(/^version:[ \t]*"?([^"\s]+)"?/m) || [])[1];
  versions['CITATION.cff'] = cffVersion;
  cffDois = [...cff.matchAll(/10\.5281\/zenodo\.(\d+)/g)].map((m) => m[0]);
}

const names = Object.keys(versions);
const distinct = [...new Set(Object.values(versions))];
ok(`${names.join(', ')} agree on the version`, distinct.length === 1,
  names.map((n) => `${n} ${versions[n]}`).join(' · '));
const VERSION = distinct[0];

/* --- the documents that print it ---------------------------------------- */
const docs = [];
for (const dir of ['docs', '.']) {
  const full = join(ROOT, dir);
  if (!existsSync(full)) continue;
  for (const f of readdirSync(full)) {
    if (/method-notes.*\.html$/.test(f)) docs.push(dir === '.' ? f : `${dir}/${f}`);
  }
}
ok('the method notes were found', docs.length > 0, docs.join(', ') || 'none');

/* The concept DOI is the one CITATION.cff carries as its top-level `doi:`. */
const conceptDoi = cff
  ? ((cff.match(/^doi:[ \t]*(\S+)/m) || [])[1] || '').replace(/^["']|["']$/g, '') || null
  : null;

/* Whether a version DOI for THIS release exists yet.
   Zenodo mints one only when the release is archived, which happens after the
   tag is cut. Between bumping the version and archiving it there is no version
   DOI to cite, and the documents must fall back to the concept DOI.
   This check used to read "cites a version DOI, not the concept DOI" flatly,
   which made that unavoidable interval look like an error and told whoever saw
   it to go and put a DOI that does not exist into a citation. The identifier's
   description names the release it is frozen on - "Version DOI - 1.0.1" - so
   the rule is derived from that instead of assumed. */
const idEntries = cff
  // Quotes are optional in CFF and both styles are in use across these repos.
  // Without the `"?` this matched nothing in a quoted file, which left the guard
  // silently certain no version DOI had been minted - a check passing on an empty
  // list rather than on the facts.
  ? [...cff.matchAll(/value:[ \t]*"?(10\.5281\/zenodo\.\d+)"?\s*\n\s*description:[ \t]*"?([^"\n]*?)"?[ \t]*$/gm)]
      .map((m) => ({ doi: m[1], desc: m[2] }))
  : [];
const verRe = new RegExp('version doi\\s*[\\u2014-]\\s*' +
                         String(VERSION).replace(/\./g, '\\.') + '(?!\\d)', 'i');
const releaseDoi = (idEntries.find((e) => verRe.test(e.desc)) || {}).doi || null;
ok(`a version DOI for ${VERSION} ${releaseDoi ? 'is declared' : 'is not minted yet'}`,
  true,
  releaseDoi || `documents cite the concept DOI ${conceptDoi} until Zenodo mints one`);

/* --- the date that goes with it, and every other copy ---------------------
   Ported from Solar Analysis Lab, where 1.2.0 shipped with the old date in its
   About panel: the version bumped and the date stayed behind, because no check
   read the date at all. Here the release is declared in index.html's header
   comment and in the About button's data attributes; each stylesheet and
   script repeats it in its own header, the single-file build copies it into
   dist/, the README carries a short stamp, and the notes spell the date long
   in their bylines. Every one of those is a copy that can drift. */
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
                'August', 'September', 'October', 'November', 'December'];
const cffDate = cff
  ? ((cff.match(/^date-released:[ \t]*"?(\d{4}-\d{2}-\d{2})"?/m) || [])[1] || null)
  : null;
const longDate = (iso) => {
  const d = new Date(iso + 'T00:00:00Z');
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
};
const header = (text) => {
  const m = text.match(/^\s*\*?\s*Version\s+([0-9][0-9.]*)\s+—\s+(\d{4}-\d{2}-\d{2})/m) || [];
  return { v: m[1] || null, d: m[2] || null };
};
const aboutButton = (html) => {
  const tag = (html.match(/<button[^>]*id="btn-about"[^>]*>[^<]*<\/button>/) || [''])[0];
  return {
    v: (tag.match(/data-version="([^"]*)"/) || [])[1] || null,
    d: (tag.match(/data-released="([^"]*)"/) || [])[1] || null,
    label: (tag.match(/>v?([0-9][0-9.]*)<\/button>/) || [])[1] || null,
  };
};

if (cffDate && has('.zenodo.json')) {
  const z = JSON.parse(read('.zenodo.json')).publication_date;
  ok(".zenodo.json's publication_date agrees with CITATION.cff", z === cffDate,
    `.zenodo.json ${z}, CITATION.cff ${cffDate}`);
}

for (const [file, label] of [['index.html', 'index.html'], ['dist/3d-wind-rose.html', 'the built dist/3d-wind-rose.html']]) {
  if (!has(file)) continue;
  const html = read(file);
  const h = header(html), b = aboutButton(html);
  ok(`${label}'s header names ${VERSION} and ${cffDate}`, h.v === VERSION && h.d === cffDate,
    `header ${h.v} — ${h.d}` +
    (file.startsWith('dist/') && (h.v !== VERSION || h.d !== cffDate) ? ' - rebuild with node tools/build-standalone.mjs' : ''));
  ok(`${label}'s About button names ${VERSION} and ${cffDate}`,
    b.v === VERSION && b.d === cffDate && b.label === VERSION,
    `data-version ${b.v}, data-released ${b.d}, label v${b.label}`);
  // The About panel builds its citation from the button's version and a DOI
  // written into the page; that DOI must be one CITATION.cff declares.
  const aboutDoi = (html.match(/doi\.org\/(10\.5281\/zenodo\.\d+)';/) || [])[1];
  ok(`${label}'s About citation names a DOI that CITATION.cff declares`,
    !!aboutDoi && cffDois.includes(aboutDoi), `${aboutDoi || '(none)'}`);
}

const ownFiles = has('index.html')
  ? [...read('index.html').matchAll(/(?:href|src)="((?:css|js)\/[^"]+)"/g)].map((m) => m[1])
  : [];
const stale = ownFiles.filter((f) => { const h = header(read(f)); return h.v !== VERSION || h.d !== cffDate; });
ok(`the ${ownFiles.length} stylesheet and script headers name ${VERSION} and ${cffDate}`,
  ownFiles.length > 0 && stale.length === 0, stale.length ? `stale: ${stale.join(', ')}` : ownFiles.join(', '));

if (has('README.md')) {
  const stamp = read('README.md').match(/^\*\*([0-9][0-9.]*)\*\*\s+—\s+(\d{4}-\d{2}-\d{2})/m) || [];
  ok("README's version stamp agrees with CITATION.cff", stamp[1] === VERSION && stamp[2] === cffDate,
    `README ${stamp[1]} — ${stamp[2]}, CITATION.cff ${VERSION} — ${cffDate}`);
}

for (const doc of docs) {
  const html = read(doc);
  const byline = (html.match(/Version<\/b>[^0-9]*([0-9][0-9.]*)/) || [])[1];
  ok(`${doc} byline names ${VERSION}`, byline === VERSION, `byline ${byline}`);

  if (cffDate) {
    const bylineDate = (html.match(/Version<\/b>[^0-9]*[0-9][0-9.]*\s*(?:&middot;|·)\s*([^<]+)/) || [])[1];
    ok(`${doc} byline is dated ${longDate(cffDate)}`,
      (bylineDate || '').trim() === longDate(cffDate), `byline dated ${(bylineDate || '(none)').trim()}`);
  }
  const apa = (html.match(/\(Version ([0-9][0-9.]*)\) \[Computer software\]/) || [])[1];
  const bibVersion = (html.match(/version\s*=\s*\{([^}]+)\}/) || [])[1];
  ok(`${doc}'s APA and BibTeX citations name ${VERSION}`, apa === VERSION && bibVersion === VERSION,
    `APA ${apa}, BibTeX ${bibVersion}`);

  const bibDoi = (html.match(/doi\s*=\s*\{([^}]+)\}/) || [])[1];
  if (bibDoi) {
    const want = releaseDoi || conceptDoi;
    ok(`${doc} cites ${releaseDoi ? 'this release\'s version DOI' : 'the concept DOI, as it must until one is minted'}`,
      !!want && bibDoi.trim() === want.trim(),
      `BibTeX doi ${bibDoi}, wanted ${want}`);
    // The paragraph under the citation says which release the version DOI is
    // frozen on, so it has to move with the DOI.
    const frozen = (html.match(/frozen on ([0-9][0-9.]*[0-9])/) || [])[1];
    if (frozen || releaseDoi) ok(`${doc} says the DOI is frozen on ${VERSION}`,
      releaseDoi ? frozen === VERSION : !frozen, `frozen on ${frozen || '(not said)'}`);
    ok(`${doc} cites a DOI that CITATION.cff declares`,
      cffDois.some((d) => bibDoi.includes(d)),
      `${bibDoi} vs ${cffDois.join(', ') || 'none declared'}`);
  }
}

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
