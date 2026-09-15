/**
 * 3D Wind Rose — building.js
 * Version 1.0.0 — 2026-09-15
 *
 * Render-style helper shared by whatever 3D model is currently loaded
 * (only a user-supplied .obj model now — the earlier procedural building
 * generator was removed). Restyles an already-built group in place, so
 * switching styles is a cheap material swap, not a geometry rebuild.
 */
window.App = window.App || {};

(function () {
  const THREE = window.THREE;

  // ---------- Render styles (Realistic / Flat Shaded / Wireframe / Blueprint) ----------
  // Maps each "Realistic" material instance to its real colour, for Flat
  // Shaded (a loaded .obj gets a single flat neutral material, so this map
  // is mostly exercised via the FLAT_FALLBACK_COLOR below).
  const FLAT_COLOR_BY_MATERIAL = new WeakMap();
  const FLAT_FALLBACK_COLOR = 0xcfc9ba; // untagged geometry, e.g. a custom .obj

  // Shared singleton materials, reused across every mesh/rebuild.
  const wireframeMat = new THREE.MeshBasicMaterial({ color: 0x2a4a6b, wireframe: true });
  const blueprintFillMat = new THREE.MeshBasicMaterial({ color: 0x0b3d66 });
  const blueprintLineMat = new THREE.LineBasicMaterial({ color: 0xbfe3ff });

  // Restyles an already-built group in place — used for a loaded custom
  // .obj model, so switching styles is a cheap material swap, not a
  // geometry rebuild.
  function applyRenderStyle(group, style) {
    if (!group) return;

    // Remove any previously-added Blueprint edge-line overlays first, so
    // switching away from Blueprint doesn't leave stale lines behind.
    const staleOverlays = [];
    group.traverse((obj) => { if (obj.userData && obj.userData.isStyleOverlay) staleOverlays.push(obj); });
    staleOverlays.forEach((obj) => {
      if (obj.parent) obj.parent.remove(obj);
      obj.geometry.dispose();
      obj.material.dispose();
    });

    group.traverse((mesh) => {
      if (!mesh.isMesh) return;
      if (!mesh.userData.originalMaterial) mesh.userData.originalMaterial = mesh.material;
      const original = mesh.userData.originalMaterial;

      if (style === 'flat') {
        if (!mesh.userData.flatMaterial) {
          const color = FLAT_COLOR_BY_MATERIAL.has(original) ? FLAT_COLOR_BY_MATERIAL.get(original) : FLAT_FALLBACK_COLOR;
          mesh.userData.flatMaterial = new THREE.MeshToonMaterial({ color });
        }
        mesh.material = mesh.userData.flatMaterial;
      } else if (style === 'wireframe') {
        mesh.material = wireframeMat;
      } else if (style === 'blueprint') {
        mesh.material = blueprintFillMat;
        const edges = new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry, 15), blueprintLineMat);
        edges.userData.isStyleOverlay = true;
        mesh.add(edges);
      } else {
        mesh.material = original;
      }
    });
  }

  App.Building = { applyRenderStyle };
})();
