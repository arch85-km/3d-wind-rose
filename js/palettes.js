/**
 * Named colour palettes for the wind speed bins. Switching palettes mutates
 * App.EPW.SPEED_BINS[i].color in place — every consumer (the wind rose mesh
 * builder, the legend renderer) reads .color fresh at build/render time, so
 * nothing needs to be told a palette changed beyond re-running those two.
 */
window.App = window.App || {};

(function () {
  // Each palette is 5 colours, one per SPEED_BINS entry, low speed -> high.
  const PALETTES = [
    {
      id: 'sunset',
      name: 'Sunset',
      // Kept in sync with js/epw.js's SPEED_BINS defaults — see the comment there.
      // Darkened ~15% from the original set for stronger contrast, now
      // that petals render unlit (MeshBasicMaterial) and show these
      // exact values instead of being lightened by scene lighting.
      colors: ['#343f50', '#286825', '#9c881b', '#8f4119', '#7a241a'],
    },
    {
      id: 'ocean',
      name: 'Ocean',
      // A true sequential (monotonic-lightness) teal -> navy ramp.
      colors: ['#438f8f', '#287a94', '#1a5e85', '#1e3c68', '#182546'],
    },
    {
      id: 'classic',
      name: 'Classic',
      // Darker take on the traditional Beaufort-style green -> red scale.
      colors: ['#285d31', '#5b7a28', '#9d751a', '#8f441a', '#681f14'],
    },
  ];

  function applyPalette(id) {
    const palette = PALETTES.find((p) => p.id === id) || PALETTES[0];
    const bins = App.EPW.SPEED_BINS;
    palette.colors.forEach((color, i) => {
      if (bins[i]) bins[i].color = color;
    });
    return palette;
  }

  App.Palettes = { PALETTES, applyPalette };
})();
