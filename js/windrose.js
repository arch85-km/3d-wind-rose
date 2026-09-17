/**
 * 3D Wind Rose — windrose.js
 * Version 1.0.1 — 2026-09-17
 *
 * 3D wind rose: a stack of ring-sector ("wedge") meshes radiating out
 * from the building, presented on an instrument-style circular plate with
 * a percentage grid (concentric rings + radial spokes) so it reads as a
 * measurement device rather than a decorative flower.
 *
 * Compass convention: EPW wind direction is "from" direction, degrees
 * clockwise from north. North is mapped to -Z, east to +X, matching
 * the compass labels drawn around the rose.
 */
window.App = window.App || {};

(function () {
  const THREE = window.THREE;

  function dirToAngle(sectorIndex, directions) {
    // sector 0 = North = -Z axis; increases clockwise when viewed from above.
    return (sectorIndex / directions) * Math.PI * 2;
  }

  function polarToXZ(radius, angle) {
    // angle=0 -> -Z (north), angle=PI/2 -> +X (east)
    return { x: Math.sin(angle) * radius, z: -Math.cos(angle) * radius };
  }

  // Picks a "nice" grid step (1/2/5 x10^n) so ring labels read as round
  // percentages rather than arbitrary fractions.
  function niceStep(roughStep) {
    const mag = Math.pow(10, Math.floor(Math.log10(roughStep)));
    const norm = roughStep / mag;
    const step = norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10;
    return step * mag;
  }

  function buildWindRose(binData, opts) {
    const { EPW } = App;
    const { freq } = binData;
    const directions = EPW.DIRECTIONS;
    const sectorAngle = (Math.PI * 2) / directions;
    const gapAngle = sectorAngle * 0.14; // small gap between petals

    const group = new THREE.Group();
    group.name = 'windrose';

    const thickness = opts.thickness || 0.35;
    const innerRadius = opts.innerRadius;
    const radialScale = opts.radialScale;

    let maxOuter = innerRadius;
    let maxValueSum = 0;

    for (let d = 0; d < directions; d++) {
      let r0 = innerRadius;
      let valueSum = 0;
      const startAngle = dirToAngle(d, directions) - sectorAngle / 2 + gapAngle / 2;
      const endAngle = dirToAngle(d, directions) + sectorAngle / 2 - gapAngle / 2;

      for (let s = 0; s < EPW.SPEED_BINS.length; s++) {
        const value = freq[d][s];
        if (value <= 0.0001) continue;
        valueSum += value;
        const segLen = value * radialScale;
        const r1 = r0 + segLen;

        const mesh = makeWedge(r0, r1, startAngle, endAngle, thickness, EPW.SPEED_BINS[s].color);
        group.add(mesh);

        r0 = r1;
      }
      if (r0 > maxOuter) maxOuter = r0;
      if (valueSum > maxValueSum) maxValueSum = valueSum;
    }

    const plateRadius = maxOuter + Math.max(1.2, innerRadius * 0.12);

    // No opaque instrument plate beneath the rose — the real map basemap
    // shows through instead. The grid (rim, percentage rings, spokes) is
    // drawn fully solid (opacity 1, not blended) in white with a dark
    // halo just underneath each line, so it reads clearly against any
    // real-world imagery — light or dark — not just a plain backdrop.
    const GRID_COLOR = 0xffffff;
    const HALO_COLOR = 0x14171a;
    const HALO_Y = 0.019; // beneath the main line's y, so they don't z-fight
    const MAIN_Y = 0.021;

    function addRing(radius, width) {
      group.add(makeCircle(radius, width * 1.6, HALO_COLOR, 0.65, HALO_Y));
      group.add(makeCircle(radius, width, GRID_COLOR, 1, MAIN_Y));
    }
    function addSpoke(r0, r1, angle, width) {
      group.add(makeSpokeMesh(r0, r1, angle, width * 1.6, HALO_COLOR, 0.65, HALO_Y));
      group.add(makeSpokeMesh(r0, r1, angle, width, GRID_COLOR, 1, MAIN_Y));
    }

    // Widths are noticeably heavier than a first pass, since a fixed
    // real-world-metre width naturally reads as thin/faint in pixels once
    // the camera is zoomed further out than the auto-framed level.
    // Rim line around the plate edge.
    addRing(plateRadius - 0.02, 0.18);

    // Percentage grid: concentric rings from the building edge out to the
    // furthest petal, stepped to a round number, plus 16 radial spokes.
    const step = niceStep((maxValueSum) / 4 || 1);
    const ringRadii = [];
    for (let v = step; v <= maxValueSum + step * 0.5; v += step) {
      const r = innerRadius + v * radialScale;
      if (r > plateRadius - 0.05) break;
      ringRadii.push({ radius: r, value: v });
      addRing(r, 0.13);
    }

    for (let d = 0; d < directions; d++) {
      const angle = dirToAngle(d, directions);
      const isCardinal = d % 2 === 0;
      addSpoke(innerRadius * 0.35, plateRadius - 0.06, angle, isCardinal ? 0.14 : 0.1);
    }

    group.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = false;
        o.receiveShadow = true;
      }
    });

    return { group, outerRadius: maxOuter, plateRadius, ringRadii };
  }

  function makeWedge(r0, r1, a0, a1, thickness, colorHex) {
    const shape = new THREE.Shape();
    const segs = 8;
    // The shape is built in (x, -z) so that after the rotateX(-90deg)
    // extrude-to-ground-plane transform below, points land back on their
    // intended world (x, z) — rotateX negates the shape's y-coordinate.
    for (let i = 0; i <= segs; i++) {
      const a = a0 + (a1 - a0) * (i / segs);
      const p = polarToXZ(r1, a);
      if (i === 0) shape.moveTo(p.x, -p.z); else shape.lineTo(p.x, -p.z);
    }
    for (let i = segs; i >= 0; i--) {
      const a = a0 + (a1 - a0) * (i / segs);
      const p = polarToXZ(r0, a);
      shape.lineTo(p.x, -p.z);
    }
    shape.closePath();

    // Shape() lineTo works in an XY plane; extrude along Z then rotate
    // that extrusion axis to become world Y (up), laying the wedge flat.
    const geo = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false, steps: 1 });
    geo.rotateX(-Math.PI / 2);
    geo.computeVertexNormals();

    // Unlit (not MeshStandardMaterial): the petals are a data-visualisation
    // legend, not a physically-lit object — scene lighting + ACES tone
    // mapping was washing the palette colours out toward pastel. This
    // guarantees each speed bin renders at exactly its specified colour.
    const mat = new THREE.MeshBasicMaterial({ color: colorHex, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geo, mat);

    // Crisp dark outline so each speed-bin segment reads distinctly,
    // matching the flat legend swatches instead of blending together.
    const edges = new THREE.EdgesGeometry(geo, 25);
    const line = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0x14171a, transparent: true, opacity: 0.35 }));
    mesh.add(line);

    return mesh;
  }

  function makeCircle(radius, lineWidth, colorHex, opacity, y) {
    // A thin flat ring (not a wireframe loop) so it reads at any camera angle.
    const geo = new THREE.RingGeometry(radius - lineWidth / 2, radius + lineWidth / 2, 96);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({
      color: colorHex, side: THREE.DoubleSide,
      transparent: opacity < 1, opacity, depthWrite: opacity >= 1,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.y = y != null ? y : 0.021;
    return mesh;
  }

  // A real solid-width line segment (a thin flat quad, not a THREE.Line —
  // WebGL ignores LineBasicMaterial's linewidth on most platforms, so a
  // true Line can never render thicker than 1px regardless of settings).
  // Built from plain vector math (perpendicular offset at each endpoint)
  // rather than composing THREE.js rotations, so its orientation can't
  // be thrown off by an unexpected rotation-order interaction.
  function makeSpokeMesh(r0, r1, angle, width, colorHex, opacity, y) {
    const p0 = polarToXZ(r0, angle);
    const p1 = polarToXZ(r1, angle);
    const dx = p1.x - p0.x, dz = p1.z - p0.z;
    const len = Math.hypot(dx, dz) || 1;
    const nx = -dz / len, nz = dx / len; // unit vector perpendicular to the spoke, in the XZ plane
    const hw = width / 2;
    const positions = new Float32Array([
      p0.x + nx * hw, 0, p0.z + nz * hw,
      p0.x - nx * hw, 0, p0.z - nz * hw,
      p1.x + nx * hw, 0, p1.z + nz * hw,
      p1.x - nx * hw, 0, p1.z - nz * hw,
    ]);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setIndex([0, 1, 2, 2, 1, 3]);
    const mat = new THREE.MeshBasicMaterial({
      color: colorHex, side: THREE.DoubleSide,
      transparent: opacity < 1, opacity, depthWrite: opacity >= 1,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.y = y != null ? y : 0.02;
    return mesh;
  }

  App.WindRose = { buildWindRose, polarToXZ, dirToAngle };
})();
