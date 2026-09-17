/**
 * 3D Wind Rose — epw.js
 * Version 1.0.1 — 2026-09-17
 *
 * EPW (EnergyPlus Weather) file parsing.
 *
 * EPW files have 8 header lines followed by one CSV line per hour.
 * Column 21 (index 20) is wind direction in degrees, column 22
 * (index 21) is wind speed in m/s. See the "EnergyPlus Weather File
 * (EPW) Data Dictionary" for the full column layout.
 */
window.App = window.App || {};

(function () {
  const DIRECTIONS = 16; // 22.5 degree compass sectors

  // Speed-bin colours (kept to 5 bins topping out at 8+ m/s — realistic for
  // UK climate data). This is the "Sunset" palette's colour set — kept in
  // sync with js/palettes.js's `sunset` entry so the app looks right even
  // if that file fails to load; js/main.js also applies it explicitly on
  // startup.
  const SPEED_BINS = [
    { label: '0–2 m/s', max: 2, color: '#343f50' },
    { label: '2–4 m/s', max: 4, color: '#286825' },
    { label: '4–6 m/s', max: 6, color: '#9c881b' },
    { label: '6–8 m/s', max: 8, color: '#8f4119' },
    { label: '8+ m/s', max: Infinity, color: '#7a241a' },
  ];

  const CALM_COLOR = '#c3c2b7';

  function parseEPW(text) {
    const lines = text.split(/\r?\n/);
    if (lines.length < 9) {
      throw new Error('This does not look like a valid EPW file (too few lines).');
    }

    const loc = lines[0].split(',');
    if ((loc[0] || '').trim().toUpperCase() !== 'LOCATION') {
      throw new Error('This does not look like a valid EPW file (missing LOCATION header).');
    }
    const location = {
      name: loc[1] || 'Unknown location',
      region: loc[2] || '',
      country: loc[3] || '',
      latitude: parseFloat(loc[6]),
      longitude: parseFloat(loc[7]),
    };

    const records = [];
    for (let i = 8; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      const f = line.split(',');
      if (f.length < 22) continue;
      const dir = parseFloat(f[20]);
      const speed = parseFloat(f[21]);
      if (Number.isNaN(dir) || Number.isNaN(speed)) continue;
      if (speed >= 999) continue; // EPW missing-data sentinel
      const month = parseInt(f[1], 10);
      records.push({ dir, speed, month });
    }

    if (records.length === 0) {
      throw new Error('No usable wind speed/direction rows were found in this file.');
    }

    return { location, records, bins: binGroup(records), monthlyBins: binRecordsByMonth(records) };
  }

  // Bins an arbitrary list of {dir, speed} records into a 16-direction x
  // speed-bin frequency table. Used for both the annual aggregate and each
  // month's slice. A total of 0 (an empty group) degrades safely to an
  // all-zero table instead of dividing by zero.
  function binGroup(records) {
    const table = Array.from({ length: DIRECTIONS }, () => new Array(SPEED_BINS.length).fill(0));
    let calm = 0;

    for (const { dir, speed } of records) {
      if (speed < 0.5) {
        calm++;
        continue;
      }
      const sectorSize = 360 / DIRECTIONS;
      let sector = Math.round(dir / sectorSize) % DIRECTIONS;
      if (sector < 0) sector += DIRECTIONS;

      let sIdx = SPEED_BINS.findIndex((b) => speed < b.max);
      if (sIdx === -1) sIdx = SPEED_BINS.length - 1;

      table[sector][sIdx]++;
    }

    const total = records.length;
    const freq = total
      ? table.map((dirBins) => dirBins.map((count) => (count / total) * 100))
      : table;
    return { freq, calmPercent: total ? (calm / total) * 100 : 0, total };
  }

  function binRecords(records) {
    return binGroup(records);
  }

  // Groups records by EPW month (1-12) and bins each month separately, so
  // the month slider can show a specific month's wind climate. Records with
  // a missing/out-of-range month still count toward the annual `binGroup`
  // above, just not toward any monthly bucket.
  function binRecordsByMonth(records) {
    const buckets = Array.from({ length: 12 }, () => []);
    for (const rec of records) {
      const m = rec.month;
      if (!Number.isInteger(m) || m < 1 || m > 12) continue;
      buckets[m - 1].push(rec);
    }
    return buckets.map(binGroup);
  }

  App.EPW = { DIRECTIONS, SPEED_BINS, CALM_COLOR, parseEPW };
})();
