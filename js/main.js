/**
 * App wiring: scene setup, UI panels, and the rebuild loop that ties
 * slider input + loaded wind data to the building/wind-rose meshes.
 */
(function () {
  const { Building, WindRose, EPW, SampleData, Palettes } = window.App;

  // ---------- Map basemap config ----------
  // A free MapTiler API key is required for the live map basemap (both
  // Satellite and Streets) to actually display tiles — sign up free at
  // https://cloud.maptiler.com/account/keys/ (no credit card needed; the
  // free tier covers 100,000 tile loads/month, plenty for a personal
  // site) and paste the key below. Fully keyless raster providers
  // (raw OpenStreetMap, Esri's public World Imagery endpoint) turned out
  // not to be reliable for an embedded app like this in real-world
  // testing — OSM's tile server actively blocks non-compliant embedded
  // traffic, and Esri now gates their imagery behind their own API key
  // for anything beyond very light/trial use.
  //
  // Without a key, the app still runs and the building/wind rose still
  // render fully — you just won't see real map imagery underneath them.
  const MAPTILER_KEY = 'YOUR_MAPTILER_API_KEY_HERE';

  const CARDINALS = [
    { i: 0, label: 'N' }, { i: 2, label: 'NE' }, { i: 4, label: 'E' }, { i: 6, label: 'SE' },
    { i: 8, label: 'S' }, { i: 10, label: 'SW' }, { i: 12, label: 'W' }, { i: 14, label: 'NW' },
  ];

  const MONTH_NAMES = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];

  const londonDefault = SampleData.UK_LOCATIONS[0];

  const state = {
    rotationDeg: 0,
    customModel: null, // set when a user-supplied .obj replaces the procedural building
    renderStyle: 'realistic', // 'realistic' | 'flat' | 'wireframe' | 'blueprint'
    annualBinData: null, // stable "whatever location/file was loaded" source of truth
    monthlyBinData: null, // array of 12 {freq,calmPercent,total} tables, or null
    selectedMonth: 0, // 0 = All Year, 1-12 = Jan-Dec
    binData: null, // derived "currently displayed" table (annual or one month)
    locationName: '',
    source: null, // 'recorded' | 'representative' | null (user-uploaded file)
    sourceLabel: '',
    buildingGroup: null,
    windroseGroup: null,
    compassObjects: [],
    ringLabelObjects: [],
    shadowMesh: null,
    lastFitRadius: 0,
    currentPlateRadius: 0, // wind rose's current outer radius (metres) — used to frame the map consistently on location changes
    windRoseScale: 1, // user-controlled multiplier (Wind Rose Size slider) — independent of the building's own footprint
    siteLngLat: { lat: londonDefault.lat, lng: londonDefault.lon }, // real-world site position on the map
    windDataLngLat: { lat: londonDefault.lat, lng: londonDefault.lon }, // where the *loaded wind data* actually came from — compared against siteLngLat to warn when they diverge
    mapStyle: 'satellite', // see MAP_STYLES below
  };

  // ---------- Scene setup ----------
  // The building + wind rose are a MapLibre "custom layer" sharing the
  // map's own WebGL context, positioned in real-world Mercator space each
  // frame (see buildingLayer.render() below) — this is what lets the scene
  // sit correctly-scaled and correctly-placed on real map tiles instead of
  // a flat procedural ground plane.
  const mapContainer = document.getElementById('map-container');
  const scene = new THREE.Scene();

  // Fully replaced each frame by buildingLayer.render(); position/quaternion
  // stay at their default identity, only projectionMatrix carries the
  // combined map + local-model transform.
  const camera = new THREE.Camera();

  const labelRenderer = new THREE.CSS2DRenderer();
  labelRenderer.domElement.style.position = 'absolute';
  labelRenderer.domElement.style.top = '0';
  labelRenderer.domElement.style.left = '0';
  labelRenderer.domElement.style.pointerEvents = 'none';
  mapContainer.appendChild(labelRenderer.domElement);

  function sizeLabelRenderer() {
    labelRenderer.setSize(mapContainer.clientWidth, mapContainer.clientHeight);
  }
  sizeLabelRenderer();

  let renderer = null; // created once MapLibre hands us its GL context, in buildingLayer.onAdd

  // MapTiler's hosted style.json (their documented MapLibre integration
  // path) — handles sources/layers/glyphs/sprites internally, so no
  // custom raster source wiring is needed here. Style ids are MapTiler's
  // own published catalog (cloud.maptiler.com/maps/) — this session has
  // no network access to confirm every one of these against the user's
  // specific key/plan, so a bad id is handled defensively (see the
  // map.on('error', ...) handler below) rather than assumed to work.
  const MAP_STYLES = {
    satellite: { id: 'satellite', label: 'Satellite' },
    streets: { id: 'streets-v2', label: 'Streets' },
    hybrid: { id: 'hybrid', label: 'Hybrid (satellite + labels)' },
    outdoor: { id: 'outdoor-v2', label: 'Outdoor' },
    bright: { id: 'bright-v2', label: 'Bright' },
    toner: { id: 'toner-v2', label: 'Toner (B&W)' },
  };
  function mapStyleUrl(kind) {
    const styleId = (MAP_STYLES[kind] || MAP_STYLES.satellite).id;
    return `https://api.maptiler.com/maps/${styleId}/style.json?key=${MAPTILER_KEY}`;
  }

  const EMPTY_STYLE = { version: 8, sources: {}, layers: [] };

  const map = new maplibregl.Map({
    container: 'map-container',
    // Load the real MapTiler style directly — matches how this custom-
    // layer pattern normally works. An earlier version started from a
    // guaranteed-valid empty style and immediately upgraded via
    // setStyle(), to gracefully handle a missing/invalid key — but that
    // meant every single page load, even with a perfectly working key,
    // triggered a style swap that (for reasons still not fully pinned
    // down without live access to reproduce it) sometimes left the
    // building/wind rose failing to survive it: rendering once on the
    // placeholder, then vanishing for good the moment the real style
    // finished loading. Loading the real style from the start avoids
    // that swap entirely in the normal (working-key) case; the empty
    // style is now only used as an error-triggered fallback, below.
    style: mapStyleUrl(state.mapStyle),
    center: [state.siteLngLat.lng, state.siteLngLat.lat],
    zoom: 18.5,
    pitch: 0, // top-down by default; right-drag to tilt into a 3D view
    bearing: 0,
    antialias: true,
    // Needed for the screenshot button's canvas.toDataURL() to reliably
    // capture the last-rendered frame — must be set here, at context
    // creation, since the three.js renderer in buildingLayer.onAdd() only
    // wraps this same already-created context and can't change it after
    // the fact.
    preserveDrawingBuffer: true,
    attributionControl: false,
  });
  const attributionControl = new maplibregl.AttributionControl({ compact: true });
  map.addControl(attributionControl, 'top-right');
  // A compact AttributionControl starts in its expanded "compact-show"
  // state (both classes get added together on its own onAdd()) and only
  // collapses to the icon after the map's first drag — an internal
  // MapLibre detail, not a width media query — so on a fresh load (or
  // right after entering fullscreen) the full "© MapTiler © OpenStreetMap
  // contributors" text sits over the view until the user happens to pan.
  // A single removal right after addControl() was enough in this app's
  // own (offline) test environment, but real tile/attribution data
  // loading — which never happens here — fires styledata/sourcedata
  // events that could plausibly re-touch these classes through a path
  // this environment can't exercise or observe. Re-asserting on those
  // events instead of trusting one removal is robust regardless of the
  // exact trigger; the { once: true } click listener means the user's
  // own first tap on the icon permanently hands control back to
  // MapLibre's own toggle, so a deliberate expand is never fought.
  let attributionUserOpened = false;
  attributionControl._container.addEventListener('click', () => {
    attributionUserOpened = true;
  }, { once: true });
  function collapseAttribution() {
    if (attributionUserOpened) return;
    attributionControl._container.classList.remove('maplibregl-compact-show');
  }
  collapseAttribution();
  map.on('load', collapseAttribution);
  map.on('styledata', collapseAttribution);
  map.on('sourcedata', collapseAttribution);

  // Places the whole three.js scene at state.siteLngLat, scaled so 1 scene
  // unit = 1 real-world metre (matches the building's existing meter-based
  // dimensions). Recomputed every frame from state.siteLngLat directly, so
  // a location change (pin-drop, city preset, EPW upload) takes effect
  // immediately with no extra plumbing.
  const buildingLayer = {
    id: 'building-3d-layer',
    type: 'custom',
    renderingMode: '3d',
    onAdd(mapInstance, gl) {
      renderer = new THREE.WebGLRenderer({
        canvas: mapInstance.getCanvas(),
        context: gl,
        antialias: true,
      });
      renderer.autoClear = false;
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      renderer.outputEncoding = THREE.sRGBEncoding;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.08;
    },
    render(gl, matrix) {
      if (!renderer) return;
      try {
        const origin = maplibregl.MercatorCoordinate.fromLngLat(
          [state.siteLngLat.lng, state.siteLngLat.lat],
          0
        );
        const scale = origin.meterInMercatorCoordinateUnits();

        // Three.js scenes are Y-up; Mercator space is Z-up — this fixed 90°
        // rotation about X converts between the two. No extra Y-axis
        // rotation is applied, so the scene's -Z axis (already fixed as
        // "north" — see windrose.js) lines up with true Mercator north.
        const rotationX = new THREE.Matrix4().makeRotationAxis(new THREE.Vector3(1, 0, 0), Math.PI / 2);
        const m = new THREE.Matrix4().fromArray(matrix);
        const l = new THREE.Matrix4()
          .makeTranslation(origin.x, origin.y, origin.z)
          .scale(new THREE.Vector3(scale, -scale, scale))
          .multiply(rotationX);

        camera.projectionMatrix = m.multiply(l);
        // Once real basemap tiles are actually drawing (unlike this
        // sandbox's network-blocked testing, where the canvas stayed blank),
        // MapLibre's own tile rendering leaves depth-buffer values behind
        // that our building/wind rose can fail the depth test against and
        // get invisibly culled — even though CSS2D labels (plain HTML,
        // positioned by the same matrix but never depth-tested) still show.
        // Clearing the depth buffer right before our own draw guarantees the
        // 3D content always renders regardless of what the basemap left.
        // Also defensively reset scissor/stencil/viewport — MapLibre's own
        // raster-tile drawing uses the scissor test heavily for tile
        // clipping, and a leftover active scissor rect (or stencil test)
        // could silently clip our entire draw to nothing without any error.
        gl.disable(gl.SCISSOR_TEST);
        gl.disable(gl.STENCIL_TEST);
        // Also force blend off and color writes fully on — MapLibre's own
        // vector-tile rendering (labels, translucent fills, antialiased
        // lines) leaves blending enabled with its own blend func, and if
        // three.js's cached "blend is off" assumption (from resetState())
        // doesn't result in an actual gl.disable(BLEND) call before our
        // first opaque draw, that stale blend func could make our draws
        // blend into invisibility against the already-drawn map tiles.
        gl.disable(gl.BLEND);
        gl.colorMask(true, true, true, true);
        gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
        gl.clear(gl.DEPTH_BUFFER_BIT);
        renderer.resetState();
        renderer.render(scene, camera);
        labelRenderer.render(scene, camera);
      } catch (err) {
        // MapLibre swallows exceptions thrown from inside a custom layer's
        // render() internally, so without this the building/wind rose would
        // just silently stop appearing with zero visible indication why.
        if (!window.__buildingLayerErrorShown) {
          window.__buildingLayerErrorShown = true;
          console.error('buildingLayer render error:', err);
          showToast('Render error — see browser console: ' + (err && err.message || err), 'error');
        }
      }
      // No self-triggered repaint here — that was forcing a continuous,
      // unconditional 60fps render loop even while the map sat idle
      // (visible as sluggishness while panning/zooming, competing for
      // frame time with MapLibre's own work). MapLibre already calls
      // this render() on every one of its own repaints (interaction,
      // easeTo/flyTo animation); explicit map.triggerRepaint() calls
      // elsewhere cover every case where our scene changes without the
      // map's own camera moving (rebuildBuilding/rebuildWindRose, the
      // rotation slider, and the render-style switcher).
    },
  };

  // Re-adds the custom layer if it isn't already present. Defensive
  // guard against map.addLayer() throwing a "layer already exists" error
  // on a style change — kept even though it turned out not to be the
  // actual cause of the building/wind rose vanishing on load (see the
  // map style comment above); harmless to keep either way.
  function ensureBuildingLayer() {
    try {
      if (!map.getLayer(buildingLayer.id)) map.addLayer(buildingLayer);
    } catch (err) {
      console.error('Failed to add building layer:', err);
      showToast('Could not attach 3D layer — see console', 'error');
    }
  }

  let mapLoaded = false;
  map.once('load', () => {
    mapLoaded = true;
    ensureBuildingLayer();
  });

  // Fallback for a missing/invalid key or being offline: if the real
  // style hasn't finished loading within a few seconds, fall back to a
  // guaranteed-valid empty style so the building/wind rose still render
  // (just without basemap imagery), rather than waiting forever.
  setTimeout(() => {
    if (!mapLoaded) {
      map.once('load', ensureBuildingLayer);
      map.setStyle(EMPTY_STYLE);
      showToast('Add a free MapTiler API key in js/main.js to see live map imagery', 'error');
    }
  }, 6000);

  // setStyle() tears down and rebuilds the whole layer stack, so the
  // custom layer has to be re-added after every basemap switch.
  // This session has no network access to confirm every MAP_STYLES id is
  // actually available on the user's MapTiler key/plan, so a failed style
  // switch is handled defensively: revert to whatever style was working
  // before, rather than leaving the map blank/broken.
  function setMapStyle(kind) {
    const previousKind = state.mapStyle;
    state.mapStyle = kind;
    updateAccordionSummaries();

    let settled = false;
    const onLoad = () => {
      if (settled) return;
      settled = true;
      map.off('error', onError);
      ensureBuildingLayer();
    };
    const onError = () => {
      if (settled) return;
      settled = true;
      map.off('style.load', onLoad);
      if (kind !== previousKind) {
        showToast(`Couldn't load the "${MAP_STYLES[kind].label}" basemap — reverting`, 'error');
        setMapStyle(previousKind);
      }
    };
    map.once('style.load', onLoad);
    map.once('error', onError);
    map.setStyle(mapStyleUrl(kind));
  }

  // Building content (procedural or a loaded .obj) lives inside this pivot
  // so "rotate building" only ever spins around the footprint's centre.
  const buildingPivot = new THREE.Group();
  scene.add(buildingPivot);

  // ---------- Sky (gradient dome, no external texture) ----------
  // MapLibre's tilted raster plane has no real horizon/sky of its own, so
  // this still does useful work filling the space above it.
  const skyUniforms = {
    topColor: { value: new THREE.Color(0x6fa1d6) },
    bottomColor: { value: new THREE.Color(0xdce8ee) },
    offset: { value: 12 },
    exponent: { value: 0.7 },
  };
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(400, 24, 16),
    new THREE.ShaderMaterial({
      uniforms: skyUniforms,
      side: THREE.BackSide,
      fog: false,
      vertexShader: `
        varying vec3 vWorldPosition;
        void main() {
          vec4 worldPosition = modelMatrix * vec4(position, 1.0);
          vWorldPosition = worldPosition.xyz;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 topColor;
        uniform vec3 bottomColor;
        uniform float offset;
        uniform float exponent;
        varying vec3 vWorldPosition;
        void main() {
          float h = normalize(vWorldPosition + vec3(0.0, offset, 0.0)).y;
          gl_FragColor = vec4(mix(bottomColor, topColor, max(pow(max(h, 0.0), exponent), 0.0)), 1.0);
        }
      `,
    })
  );
  sky.frustumCulled = false;
  scene.add(sky);
  scene.fog = new THREE.Fog(0xcbdce6, 90, 320);

  // Lights
  scene.add(new THREE.HemisphereLight(0xdfeeff, 0x4a5a3c, 0.55));
  const sun = new THREE.DirectionalLight(0xfff2da, 1.7);
  sun.position.set(40, 55, 20);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -80;
  sun.shadow.camera.right = 80;
  sun.shadow.camera.top = 80;
  sun.shadow.camera.bottom = -80;
  sun.shadow.camera.far = 200;
  sun.shadow.bias = -0.0015;
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0xdbe7ff, 0.28);
  fill.position.set(-30, 20, -25);
  scene.add(fill);

  // Soft contact-shadow blob drawn under the building for grounding —
  // alpha-blended, so it reads fine directly over map tiles without
  // needing an opaque ground plane underneath it.
  function contactShadowTexture() {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const ctx = c.getContext('2d');
    const grad = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
    grad.addColorStop(0, 'rgba(15,20,10,0.38)');
    grad.addColorStop(0.7, 'rgba(15,20,10,0.16)');
    grad.addColorStop(1, 'rgba(15,20,10,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 256, 256);
    return new THREE.CanvasTexture(c);
  }
  const shadowTex = contactShadowTexture();

  // ---------- Rebuild helpers ----------
  // Our custom-layer camera never has a real position/orientation (only
  // projectionMatrix is set, each frame, in buildingLayer.render()) —
  // three.js's default frustum culling assumes a normal camera transform
  // to test object bounding spheres against, which this camera doesn't
  // provide, so culling is disabled on everything we add to the scene.
  function disableFrustumCulling(obj) {
    obj.traverse((o) => { o.frustumCulled = false; });
  }

  function disposeGroup(group) {
    if (!group) return;
    group.traverse((obj) => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        (Array.isArray(obj.material) ? obj.material : [obj.material]).forEach((m) => m.dispose());
      }
    });
  }

  // No model loaded yet — keeps the wind rose sized sensibly (matches the
  // old default 12x8m procedural building's proportions) until a .obj is
  // imported, without needing every rebuildWindRose()/shadow call site to
  // special-case "nothing loaded".
  const NO_MODEL_FOOTPRINT_RADIUS = 7.2;

  function rebuildBuilding() {
    if (state.buildingGroup) {
      buildingPivot.remove(state.buildingGroup);
      disposeGroup(state.buildingGroup);
    }
    if (state.shadowMesh) {
      scene.remove(state.shadowMesh);
      state.shadowMesh.geometry.dispose();
      state.shadowMesh = null;
    }

    const result = state.customModel || { group: new THREE.Group(), footprintRadius: NO_MODEL_FOOTPRINT_RADIUS, maxHeight: 0 };
    state.buildingGroup = result.group;
    state.buildingResult = result;
    buildingPivot.add(state.buildingGroup);
    Building.applyRenderStyle(state.buildingGroup, state.renderStyle);
    buildingPivot.rotation.y = THREE.MathUtils.degToRad(state.rotationDeg);
    disableFrustumCulling(state.buildingGroup);

    // Only cast a ground contact-shadow when a real model is actually
    // loaded — an empty placeholder group casting a shadow disc would
    // look like a rendering bug.
    if (state.customModel) {
      const shadowR = state.buildingResult.footprintRadius * 1.35;
      const shadowGeo = new THREE.PlaneGeometry(shadowR * 2, shadowR * 2);
      const shadowMat = new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false });
      const shadowMesh = new THREE.Mesh(shadowGeo, shadowMat);
      shadowMesh.rotation.x = -Math.PI / 2;
      shadowMesh.position.y = 0.012;
      shadowMesh.frustumCulled = false;
      state.shadowMesh = shadowMesh;
      scene.add(shadowMesh);
    }
    map.triggerRepaint(); // the scene changed independently of the map's own camera
  }

  function maxDirectionSum(freq) {
    let max = 0;
    for (const row of freq) {
      const sum = row.reduce((a, b) => a + b, 0);
      if (sum > max) max = sum;
    }
    return max || 1;
  }

  function rebuildWindRose() {
    if (state.windroseGroup) {
      scene.remove(state.windroseGroup);
      disposeGroup(state.windroseGroup);
    }
    clearCompassLabels();

    const footprintRadius = state.buildingResult.footprintRadius;
    // Both scaled by state.windRoseScale together (not just the petal
    // length) so the whole plate — hole, petals, and grid rings, which
    // all key off these same two numbers in buildWindRose() — grows
    // uniformly instead of distorting.
    const innerRadius = (footprintRadius + Math.max(2, footprintRadius * 0.18)) * state.windRoseScale;
    const desiredSpan = Math.max(6, footprintRadius * 1.35) * state.windRoseScale;
    const radialScale = desiredSpan / maxDirectionSum(state.binData.freq);
    const thickness = THREE.MathUtils.clamp(footprintRadius * 0.025, 0.18, 0.6);

    const result = WindRose.buildWindRose(state.binData, { innerRadius, radialScale, thickness });
    state.windroseGroup = result.group;
    disableFrustumCulling(state.windroseGroup);
    scene.add(state.windroseGroup);

    buildCompassLabels(result.plateRadius + 1.4);
    buildRingLabels(result.ringRadii);
    state.currentPlateRadius = result.plateRadius;
    // Scale the atmospheric fog's thresholds with the plate's current
    // radius instead of the fixed 90/320m this was originally tuned for —
    // otherwise Auto-match / Display Size / Wind Rose Size inflating the
    // scene well past those fixed distances makes the fog wash out the
    // plate's own outer rim and the shadow disc in a pale-blue ring long
    // before reaching their actual edge. Reduces to the original 90/320
    // constants at ordinary (unscaled) plate radii.
    scene.fog.near = Math.max(90, result.plateRadius * 3);
    scene.fog.far = Math.max(320, result.plateRadius * 10);
    updateSkyDomeExtent();
    ensureVisible(result.plateRadius);
    updateLegendStats();
    updateAccordionSummaries();
    map.triggerRepaint(); // the scene changed independently of the map's own camera
  }

  function clearCompassLabels() {
    state.compassObjects.forEach((obj) => scene.remove(obj));
    state.compassObjects = [];
    state.ringLabelObjects.forEach((obj) => scene.remove(obj));
    state.ringLabelObjects = [];
  }

  function buildCompassLabels(radius) {
    CARDINALS.forEach(({ i, label }) => {
      const angle = (i / EPW.DIRECTIONS) * Math.PI * 2;
      const { x, z } = WindRose.polarToXZ(radius, angle);
      const div = document.createElement('div');
      div.className = 'compass-label' + (label === 'N' ? ' cardinal' : '');
      div.textContent = label;
      if (label === 'N') div.style.color = '#b8291f';
      const obj = new THREE.CSS2DObject(div);
      obj.position.set(x, 0.4, z);
      scene.add(obj);
      state.compassObjects.push(obj);
    });
  }

  // Percentage grid-ring labels, placed along the NNE spoke so they sit
  // clear of both the North compass label and the petals themselves.
  function buildRingLabels(ringRadii) {
    const angle = (1 / EPW.DIRECTIONS) * Math.PI * 2; // between N and NE
    ringRadii.forEach(({ radius, value }) => {
      const { x, z } = WindRose.polarToXZ(radius, angle);
      const div = document.createElement('div');
      div.className = 'ring-label';
      div.textContent = value.toFixed(value < 1 ? 1 : 0) + '%';
      const obj = new THREE.CSS2DObject(div);
      obj.position.set(x, 0.05, z);
      scene.add(obj);
      state.ringLabelObjects.push(obj);
    });
  }

  // Rough Web Mercator metres-per-pixel at a given latitude/zoom — used to
  // translate "the wind rose plate needs at least this many real-world
  // metres of clearance" into a MapLibre zoom level.
  function metersPerPixel(lat, zoom) {
    return (156543.03392 * Math.cos((lat * Math.PI) / 180)) / Math.pow(2, zoom);
  }
  function zoomForMetersPerPixel(lat, mpp) {
    return Math.log2((156543.03392 * Math.cos((lat * Math.PI) / 180)) / mpp);
  }

  // Keeps the sky dome (a gradient sphere providing "sky" beyond the
  // ground content, see its setup above) sized so it always stays just
  // beyond whatever real-world ground area the *current view* actually
  // shows. That's a property of the current zoom level and viewport size
  // — NOT of the wind rose plate's own size: an earlier attempt scaled
  // this off plateRadius alone, but zooming out reveals more real-world
  // ground area for a fixed-radius dome to fall short of regardless of
  // how big the plate is, which is exactly what let the dome dominate
  // the screen ("a huge blue bubble") purely from the user zooming out
  // further — confirmed on a real deployment. Still also covers a
  // legitimately large plate (from Auto-match/Display Size/Wind Rose
  // Size), since a very large plate needs the user to zoom out further
  // to see it, and by then this recomputes against that lower zoom too.
  const SKY_DOME_BASE_RADIUS = 400; // matches the SphereGeometry(400, ...) radius above
  function updateSkyDomeExtent() {
    const mpp = metersPerPixel(state.siteLngLat.lat, map.getZoom());
    const viewportDiagonalPx = Math.hypot(mapContainer.clientWidth, mapContainer.clientHeight);
    const visibleRadius = (mpp * viewportDiagonalPx) / 2;
    const desiredRadius = Math.max(SKY_DOME_BASE_RADIUS, visibleRadius * 3, (state.currentPlateRadius || 0) * 15);
    sky.scale.setScalar(desiredRadius / SKY_DOME_BASE_RADIUS);
  }
  map.on('move', updateSkyDomeExtent); // 'move' fires for any camera change, zoom included
  updateSkyDomeExtent(); // initial sizing, before the first rebuildWindRose() call

  // How much of the viewport's shorter dimension a top-down flat plate
  // can be expected to occupy before it starts crowding the frame — this
  // shrinks as the camera pitches, since a steeply tilted view shows the
  // same ground footprint far more edge-on (its near edge swings toward
  // the camera and eats much more screen space) than a straight top-down
  // view of the same physical extent. 0.6 at pitch 0, tapering to 0.35 at
  // MapLibre's default max pitch (60°).
  function pitchDerating(pitch) {
    const t = Math.min(1, Math.max(0, pitch) / 60);
    return 0.6 - t * 0.25;
  }

  // Zoom level at which a plate of this real-world radius occupies a
  // consistent fraction of the viewport, regardless of latitude, current
  // zoom, or camera pitch — used both to keep the wind rose visible as it
  // grows (ensureVisible) and to frame it consistently on a location change.
  // Floor on how far this auto-fit will ever zoom out. Without one, an
  // unusually large plateRadius — e.g. "Auto-match nearby buildings"
  // matching against a genuinely huge nearby landmark (a government
  // building complex, a stadium) rather than an ordinary building — could
  // solve for an extremely low zoom, and MapLibre's globe projection
  // (maplibre-gl 4.7.1) renders a visibly round Earth-against-blank-space
  // silhouette well below city-district zoom levels, which looks broken
  // rather than just "zoomed out." Confirmed on a real deployment: zoom
  // 10 (a wide city-district view) is comfortably above where that
  // kicks in, while still permitting a legitimately large plate to be
  // framed sensibly rather than snapping to some arbitrary smaller size.
  const MIN_AUTO_FIT_ZOOM = 10;
  function idealZoomForPlate(lat, plateRadius) {
    const desiredDiameter = Math.max(6, plateRadius * 2.3);
    // Fit against the visible (unobstructed) width, not the full container
    // — the sidebar's left-side gutter is excluded, keeping this in sync
    // with the map padding set by syncMapPadding() below.
    const visibleWidth = Math.max(0, mapContainer.clientWidth - mapLeftPadding);
    const viewportPx = Math.min(visibleWidth, mapContainer.clientHeight) || 800;
    const targetMpp = desiredDiameter / (viewportPx * pitchDerating(map.getPitch()));
    return Math.max(MIN_AUTO_FIT_ZOOM, zoomForMetersPerPixel(lat, targetMpp));
  }

  // Checks whether the current plate still fits the *currently* available
  // screen budget (viewport size, sidebar padding, and camera pitch all
  // factored in fresh each call) and zooms out just enough to restore it
  // if not. Deliberately never zooms IN — it's a safety net against the
  // plate spilling off-screen, not a fight against a closer view the user
  // chose deliberately.
  function fitsCurrentView(plateRadius) {
    const lat = state.siteLngLat.lat;
    const visibleWidth = Math.max(0, mapContainer.clientWidth - mapLeftPadding);
    const viewportPx = Math.min(visibleWidth, mapContainer.clientHeight) || 800;
    const currentMpp = metersPerPixel(lat, map.getZoom());
    const visibleSpan = currentMpp * viewportPx * pitchDerating(map.getPitch());
    return visibleSpan >= plateRadius * 2.3;
  }

  function ensureVisible(plateRadius) {
    const desiredDiameter = plateRadius * 2.3;
    if (desiredDiameter <= state.lastFitRadius && fitsCurrentView(plateRadius)) return;
    state.lastFitRadius = Math.max(state.lastFitRadius, desiredDiameter);
    if (!fitsCurrentView(plateRadius)) {
      map.easeTo({ zoom: idealZoomForPlate(state.siteLngLat.lat, plateRadius), duration: 500 });
    }
  }

  // Re-validates the fit whenever the *available* screen budget shrinks
  // for reasons unrelated to the plate itself growing — the window being
  // resized narrower/shorter, or the camera being tilted to a steeper
  // pitch (see pitchDerating above). ensureVisible() alone doesn't catch
  // these, since its early-return is keyed off plate radius, not viewport
  // or pitch. Also a pure safety net — never zooms in.
  function refitToCurrentView() {
    if (!state.currentPlateRadius) return;
    if (!fitsCurrentView(state.currentPlateRadius)) {
      map.easeTo({ zoom: idealZoomForPlate(state.siteLngLat.lat, state.currentPlateRadius), duration: 500 });
    }
  }

  function rebuildAll() {
    rebuildBuilding();
    rebuildWindRose();
  }

  // ---------- Wind-data / site-location divergence warning ----------
  // The wind rose never reloads based on where the map/building currently
  // sits — it always shows whichever dataset was last loaded via a city
  // preset or EPW upload. state.windDataLngLat records where that dataset
  // actually came from, compared here against state.siteLngLat (the map's
  // current position) so a large mismatch is surfaced rather than silently
  // shown as if the data belonged to the current spot.
  const DATA_LOCATION_WARN_KM = 50;
  let dataLocationWarningArmed = true; // toast fires once per crossing into >50km; re-arms once back under 50km

  // Great-circle distance between two {lat,lng} points, in kilometres. A
  // plain haversine (no ellipsoid correction) — plenty accurate for a
  // coarse "is this data anywhere near here?" check.
  function haversineKm(a, b) {
    const R = 6371;
    const toRad = Math.PI / 180;
    const dLat = (b.lat - a.lat) * toRad;
    const dLng = (b.lng - a.lng) * toRad;
    const s1 = Math.sin(dLat / 2), s2 = Math.sin(dLng / 2);
    const h = s1 * s1 + Math.cos(a.lat * toRad) * Math.cos(b.lat * toRad) * s2 * s2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  // Distance (km) between the loaded wind data's origin and the current
  // site, or null when there's nothing to compare against — read by
  // updateLegendStats() to show a persistent warning line, and used here
  // to decide when to pop the one-time toast.
  state.dataLocationKm = null;

  function updateDataLocationWarning() {
    if (!state.windDataLngLat || !state.siteLngLat) {
      state.dataLocationKm = null;
      updateLegendStats();
      return;
    }
    const km = haversineKm(state.windDataLngLat, state.siteLngLat);
    state.dataLocationKm = km;
    const overThreshold = km > DATA_LOCATION_WARN_KM;
    if (overThreshold && dataLocationWarningArmed) {
      // Deferred one tick: setSiteLocation() callers (pin-drop, search) show
      // their own "Location set" toast right after calling it, which would
      // otherwise stomp this one since both land in the same synchronous
      // handler — firing on the next tick guarantees this warning is the
      // one still on screen when it matters.
      const msg = `⚠ Wind data is from ${state.locationName || 'a different location'} — ${Math.round(km)} km away`;
      setTimeout(() => showToast(msg, 'error'), 0);
      dataLocationWarningArmed = false;
    } else if (!overThreshold) {
      dataLocationWarningArmed = true;
    }
    updateLegendStats();
  }

  // ---------- Site location (map placement) ----------
  function updateLocationReadout() {
    const el = document.getElementById('loc-coords');
    if (el) el.textContent = `${state.siteLngLat.lat.toFixed(4)}°, ${state.siteLngLat.lng.toFixed(4)}°`;
  }

  function setSiteLocation(lat, lng, opts) {
    opts = opts || {};
    state.siteLngLat = { lat, lng };
    updateLocationReadout();
    updateAccordionSummaries();
    updateDataLocationWarning();
    if (opts.fly !== false) {
      // easeTo (not flyTo): flyTo's "fly" arc zooms out dramatically mid-
      // animation on long jumps (e.g. London -> Edinburgh), which briefly
      // shrinks the building to invisible — easeTo interpolates position/
      // zoom directly with no such dip.
      // Zoom to a level that frames the wind rose consistently, rather
      // than keeping whatever zoom the map happened to already be at —
      // so every location lands with the building/wind rose at a similar
      // on-screen size, not dwarfed by (or dwarfing) the surroundings.
      const zoom = state.currentPlateRadius
        ? idealZoomForPlate(lat, state.currentPlateRadius)
        : Math.max(map.getZoom(), 17);
      if (state.currentPlateRadius) state.lastFitRadius = state.currentPlateRadius * 2.3;
      map.easeTo({ center: [lng, lat], zoom, duration: 1200, essential: true });
    }
  }

  let pickingLocation = false;
  const btnSetLocation = document.getElementById('btn-set-location');
  btnSetLocation.addEventListener('click', () => {
    if (pickingLocation) return;
    pickingLocation = true;
    btnSetLocation.textContent = 'Click the map to place it…';
    btnSetLocation.disabled = true;
    map.getCanvas().style.cursor = 'crosshair';
    showToast('Click anywhere on the map to set the site location', 'ok');
    map.once('click', (e) => {
      setSiteLocation(e.lngLat.lat, e.lngLat.lng, { fly: false });
      pickingLocation = false;
      btnSetLocation.textContent = 'Set Location on Map';
      btnSetLocation.disabled = false;
      map.getCanvas().style.cursor = '';
      showToast('Location set', 'ok');
    });
  });

  createCustomSelect(
    document.getElementById('basemap-style-select-wrap'),
    Object.entries(MAP_STYLES).map(([value, s]) => ({ value, label: s.label })),
    state.mapStyle,
    (value) => setMapStyle(value)
  );

  // ---------- UI: location search box (city/address, or raw "lat, lon") ----------
  // Accepts either a place name (geocoded via MapTiler) or coordinates
  // typed directly, so one box covers both without a separate lat/lon form.
  function parseLatLon(text) {
    const m = text.trim().match(/^(-?\d+(?:\.\d+)?)\s*[,\s]\s*(-?\d+(?:\.\d+)?)$/);
    if (!m) return null;
    const lat = parseFloat(m[1]), lon = parseFloat(m[2]);
    if (!isFinite(lat) || !isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
    return { lat, lon };
  }

  async function geocodeSearch(query) {
    const url = `https://api.maptiler.com/geocoding/${encodeURIComponent(query)}.json?key=${MAPTILER_KEY}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('Search request failed');
    const data = await res.json();
    const feature = data.features && data.features[0];
    if (!feature) throw new Error(`No results for "${query}"`);
    const [lng, lat] = feature.center;
    return { lat, lng, name: feature.place_name || query };
  }

  const locSearchInput = document.getElementById('loc-search-input');
  const btnLocSearch = document.getElementById('btn-loc-search');

  async function handleLocationSearch() {
    const query = locSearchInput.value.trim();
    if (!query) return;

    const coords = parseLatLon(query);
    if (coords) {
      setSiteLocation(coords.lat, coords.lon, { fly: true });
      showToast('Location set', 'ok');
      return;
    }

    btnLocSearch.disabled = true;
    btnLocSearch.textContent = '…';
    try {
      const result = await geocodeSearch(query);
      setSiteLocation(result.lat, result.lng, { fly: true });
      showToast(result.name, 'ok');
    } catch (err) {
      showToast(err.message || 'Search failed', 'error');
    } finally {
      btnLocSearch.disabled = false;
      btnLocSearch.textContent = 'Go';
    }
  }

  btnLocSearch.addEventListener('click', handleLocationSearch);
  locSearchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); handleLocationSearch(); }
  });

  // ---------- Custom dropdown (replaces native <select>) ----------
  // A native <select>'s option-list popup is browser/OS-rendered chrome
  // outside the page's own compositing, which on some platforms flashes
  // black when opened over a WebGL canvas. This is a plain DOM/CSS
  // dropdown instead, so that entire class of bug can't happen. The list
  // is portalled onto <body> (not left inside the triggering panel),
  // since #dims-panel/#legend-panel use overflow-y:auto for scroll-safety
  // and would otherwise clip a list that doesn't fit in the remaining
  // panel space.
  function createCustomSelect(mountEl, options, initialValue, onChange) {
    mountEl.classList.add('custom-select');

    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'custom-select-trigger';
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-expanded', 'false');
    if (mountEl.id) trigger.id = mountEl.id.replace(/-wrap$/, '');

    const valueSpan = document.createElement('span');
    valueSpan.className = 'custom-select-value';
    const chevron = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    chevron.setAttribute('class', 'chevron');
    chevron.setAttribute('width', '11');
    chevron.setAttribute('height', '11');
    chevron.setAttribute('viewBox', '0 0 24 24');
    chevron.setAttribute('fill', 'none');
    chevron.innerHTML = '<path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>';
    trigger.appendChild(valueSpan);
    trigger.appendChild(chevron);
    mountEl.appendChild(trigger);

    const list = document.createElement('ul');
    list.className = 'custom-select-list';
    list.setAttribute('role', 'listbox');
    document.body.appendChild(list);

    let current = initialValue;
    let activeIndex = Math.max(0, options.findIndex((o) => o.value === current));

    function syncTrigger() {
      const opt = options.find((o) => o.value === current);
      valueSpan.textContent = opt ? opt.label : '';
    }

    function renderOptions() {
      list.innerHTML = '';
      options.forEach((opt, i) => {
        const li = document.createElement('li');
        li.setAttribute('role', 'option');
        li.dataset.value = opt.value;
        li.textContent = opt.label;
        if (opt.value === current) li.setAttribute('aria-selected', 'true');
        if (i === activeIndex) li.classList.add('active');
        li.addEventListener('click', () => select(opt.value));
        list.appendChild(li);
      });
    }

    function positionList() {
      const rect = trigger.getBoundingClientRect();
      list.style.left = rect.left + 'px';
      list.style.top = (rect.bottom + 4) + 'px';
      list.style.width = Math.max(rect.width, 110) + 'px';
    }

    function onDocClick(e) {
      if (!trigger.contains(e.target) && !list.contains(e.target)) close();
    }

    function open() {
      positionList();
      list.classList.add('open');
      mountEl.classList.add('open');
      trigger.setAttribute('aria-expanded', 'true');
      document.addEventListener('mousedown', onDocClick, true);
      window.addEventListener('scroll', close, true);
      window.addEventListener('resize', close);
    }

    function close() {
      list.classList.remove('open');
      mountEl.classList.remove('open');
      trigger.setAttribute('aria-expanded', 'false');
      document.removeEventListener('mousedown', onDocClick, true);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    }

    function isOpen() { return list.classList.contains('open'); }
    function toggle() { isOpen() ? close() : open(); }

    function select(value) {
      current = value;
      activeIndex = Math.max(0, options.findIndex((o) => o.value === current));
      syncTrigger();
      renderOptions();
      close();
      onChange(value);
    }

    trigger.addEventListener('click', toggle);
    trigger.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { close(); return; }
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); return; }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (!isOpen()) { open(); return; }
        const dir = e.key === 'ArrowDown' ? 1 : -1;
        const nextIndex = (activeIndex + dir + options.length) % options.length;
        select(options[nextIndex].value);
      }
    });

    syncTrigger();
    renderOptions();

    return {
      setValue(value) { current = value; syncTrigger(); renderOptions(); },
    };
  }

  // ---------- UI: render style (applies to the procedural building or a
  // loaded custom .obj alike — a cheap in-place material swap, no rebuild) ----------
  createCustomSelect(
    document.getElementById('render-style-select-wrap'),
    [
      { value: 'realistic', label: 'Realistic' },
      { value: 'flat', label: 'Flat Shaded' },
      { value: 'wireframe', label: 'Wireframe' },
      { value: 'blueprint', label: 'Blueprint' },
    ],
    'realistic',
    (value) => {
      state.renderStyle = value;
      Building.applyRenderStyle(state.buildingGroup, state.renderStyle);
      map.triggerRepaint();
    }
  );

  // ---------- UI: rotate building ----------
  const rotationInput = document.getElementById('rotation');
  rotationInput.addEventListener('input', () => {
    state.rotationDeg = parseFloat(rotationInput.value);
    document.getElementById('v-rotation').textContent = state.rotationDeg + '°';
    buildingPivot.rotation.y = THREE.MathUtils.degToRad(state.rotationDeg);
    map.triggerRepaint();
  });

  document.getElementById('btn-reset-dims').addEventListener('click', () => {
    state.rotationDeg = 0;
    rotationInput.value = 0;
    document.getElementById('v-rotation').textContent = '0°';
    buildingPivot.rotation.y = 0;
    map.triggerRepaint();
    showToast('Rotation reset', 'ok');
  });

  // ---------- UI: EPW loading ----------
  const fileInput = document.getElementById('epw-file-input');
  document.getElementById('btn-load-epw').addEventListener('click', () => fileInput.click());

  fileInput.addEventListener('change', () => {
    const file = fileInput.files && fileInput.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = EPW.parseEPW(String(reader.result));
        state.annualBinData = parsed.bins;
        state.monthlyBinData = parsed.monthlyBins;
        state.selectedMonth = 0;
        state.binData = state.annualBinData;
        state.locationName = [parsed.location.name, parsed.location.country].filter(Boolean).join(', ');
        state.source = null;
        state.sourceLabel = '';
        resetMonthSlider();
        if (Number.isFinite(parsed.location.latitude) && Number.isFinite(parsed.location.longitude)) {
          state.windDataLngLat = { lat: parsed.location.latitude, lng: parsed.location.longitude };
          setSiteLocation(parsed.location.latitude, parsed.location.longitude, { fly: true });
        } else {
          state.windDataLngLat = null;
          updateDataLocationWarning();
        }
        setEpwStatus(
          `<span class="loc-name">${escapeHtml(state.locationName || file.name)}</span><br>` +
          `${parsed.records.length.toLocaleString()} hourly records · ${parsed.bins.calmPercent.toFixed(1)}% calm`,
          false
        );
        rebuildWindRose();
        showToast('EPW file loaded', 'ok');
      } catch (err) {
        setEpwStatus(err.message || 'Could not parse this EPW file.', true);
        showToast('Failed to load EPW file', 'error');
      }
    };
    reader.onerror = () => {
      setEpwStatus('Could not read this file.', true);
      showToast('Failed to read file', 'error');
    };
    reader.readAsText(file);
    fileInput.value = '';
  });

  function setEpwStatus(html, isError) {
    const el = document.getElementById('epw-status');
    el.innerHTML = html;
    el.classList.toggle('error', !!isError);
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // ---------- Shared "load this city's wind data" action ----------
  // Used by the UK-locations list buttons (and by init, for the default).
  function loadCity(loc, opts) {
    opts = opts || {};
    state.annualBinData = loc.bins();
    state.monthlyBinData = loc.monthlyBins ? loc.monthlyBins() : null;
    state.selectedMonth = 0;
    state.binData = state.annualBinData;
    state.locationName = loc.name;
    state.source = loc.source;
    state.sourceLabel = loc.sourceLabel;
    resetMonthSlider();
    if (Number.isFinite(loc.lat) && Number.isFinite(loc.lon)) {
      state.windDataLngLat = { lat: loc.lat, lng: loc.lon };
      setSiteLocation(loc.lat, loc.lon, { fly: !opts.silent });
    } else {
      state.windDataLngLat = null;
      updateDataLocationWarning();
    }
    if (!opts.silent) {
      const badgeClass = loc.source === 'recorded' ? 'badge-recorded' : 'badge-representative';
      const badge = `<span class="src-badge ${badgeClass}">${loc.sourceLabel}</span>`;
      setEpwStatus(
        `<span class="loc-name">${escapeHtml(loc.name)}</span> ${badge}<br>` +
        `${state.annualBinData.total.toLocaleString()} hourly records · ${state.annualBinData.calmPercent.toFixed(1)}% calm`,
        false
      );
    }
    rebuildWindRose();
    if (!opts.silent) showToast(loc.name + ' loaded', 'ok');
  }

  // ---------- UI: embedded UK locations (no download needed) ----------
  const ukList = document.getElementById('uk-list');
  SampleData.UK_LOCATIONS.forEach((loc) => {
    const li = document.createElement('li');
    li.innerHTML =
      `<span class="city-info">
         <span class="city-name">${loc.name}</span>
         <span class="city-note">${loc.note}</span>
       </span>
       <button type="button" class="btn-load-city" data-city="${loc.name}">Load</button>`;
    li.querySelector('.btn-load-city').addEventListener('click', () => loadCity(loc));
    ukList.appendChild(li);
  });

  // ---------- UI: month slider (which slice of the loaded data to show) ----------
  const monthSlider = document.getElementById('month-slider');
  const monthSliderLabel = document.getElementById('v-month-slider');

  function syncMonthSliderLabel() {
    const v = state.selectedMonth;
    if (v === 0) {
      monthSliderLabel.textContent = 'All Year';
      return;
    }
    const name = MONTH_NAMES[v - 1];
    const monthData = state.monthlyBinData && state.monthlyBinData[v - 1];
    monthSliderLabel.textContent = (monthData && monthData.total === 0) ? `${name} — no data` : name;
  }

  // Called whenever a new location/file is loaded, to snap the slider back
  // to "All Year" for the newly-loaded data.
  function resetMonthSlider() {
    monthSlider.value = 0;
    syncMonthSliderLabel();
  }

  monthSlider.addEventListener('input', () => {
    const v = parseInt(monthSlider.value, 10);
    state.selectedMonth = v;
    state.binData = (v === 0 || !state.monthlyBinData) ? state.annualBinData : state.monthlyBinData[v - 1];
    syncMonthSliderLabel();
    rebuildWindRose();
  });

  // ---------- UI: wind rose size (independent of the building's own footprint) ----------
  const windRoseScaleInput = document.getElementById('windrose-scale');
  windRoseScaleInput.addEventListener('input', () => {
    const percent = parseFloat(windRoseScaleInput.value);
    document.getElementById('v-windrose-scale').textContent = percent + '%';
    state.windRoseScale = percent / 100;
    rebuildWindRose();
  });

  // ---------- UI: legend + palette switcher ----------
  // Rendered into two targets — the sidebar's Legend section and the
  // always-visible on-screen overlay (index.html's #legend-overlay) — from
  // the same markup, so the overlay can never drift out of sync with the
  // sidebar and callers don't need to know both exist.
  const legendTargets = [
    { list: document.getElementById('legend-list'), stats: document.getElementById('legend-stats') },
    { list: document.getElementById('legend-overlay-list'), stats: document.getElementById('legend-overlay-stats') },
  ];

  // The sidebar shares the bottom-left corner with #legend-overlay (and the
  // copyright pill beneath it). Their combined height is content-dependent
  // — number of swatches, location-name length, the divergence-warning
  // line wrapping onto its own line — so a fixed CSS max-height on
  // #sidebar can't reliably stay clear of them. Instead, keep the
  // sidebar's cap in sync with the overlay's actual current top edge
  // whenever either one's size changes, so the sidebar scrolls internally
  // rather than growing into the overlay.
  const sidebarEl = document.getElementById('sidebar');
  const legendOverlayEl = document.getElementById('legend-overlay');
  function syncSidebarMaxHeight() {
    if (window.innerWidth <= 900) { sidebarEl.style.maxHeight = ''; return; } // mobile: bottom-sheet layout, not this corner
    const overlayTop = legendOverlayEl.getBoundingClientRect().top;
    const sidebarTop = sidebarEl.getBoundingClientRect().top;
    const cap = Math.max(160, overlayTop - sidebarTop - 12);
    sidebarEl.style.maxHeight = cap + 'px';
  }
  if (window.ResizeObserver) {
    new ResizeObserver(syncSidebarMaxHeight).observe(legendOverlayEl);
  }
  window.addEventListener('resize', syncSidebarMaxHeight);

  // ---------- Map padding (keeps the site centred in the *visible* pane,
  // not the sidebar-obscured one) ----------
  // #sidebar floats over the map's left edge (left:16px, width:300px on
  // desktop — a fixed ~316px gutter); below the 900px breakpoint it
  // becomes a full-width bottom drawer with no left overlap (see the
  // @media (max-width: 900px) block in css/style.css). Without telling
  // MapLibre about this, `center` lands at the geometric centre of the
  // FULL canvas — which is partly hidden behind the sidebar — so the
  // building/wind-rose reads as pushed toward the right edge, worse the
  // smaller the fraction of the screen the sidebar leaves free. MapLibre's
  // own `padding` mechanism exists exactly for "part of my canvas is
  // obscured by UI chrome": once set via setPadding(), it's honoured by
  // subsequent easeTo/flyTo calls that don't pass their own `padding`, so
  // no other call site (setSiteLocation, ensureVisible) needs to repeat it.
  const SIDEBAR_BREAKPOINT_PX = 900; // matches css/style.css's `@media (max-width: 900px)`
  let mapLeftPadding = 0; // single source of truth, also read by idealZoomForPlate/ensureVisible below

  function computeMapLeftPadding() {
    if (window.innerWidth <= SIDEBAR_BREAKPOINT_PX) return 0; // mobile: bottom drawer, no left overlap
    const sidebarRect = sidebarEl.getBoundingClientRect();
    const containerRect = mapContainer.getBoundingClientRect();
    return Math.max(0, sidebarRect.right - containerRect.left);
  }

  function syncMapPadding() {
    mapLeftPadding = computeMapLeftPadding();
    map.setPadding({ left: mapLeftPadding, top: 0, right: 0, bottom: 0 });
    // A resize can shrink the available screen budget (narrower window,
    // or more of it now behind the sidebar) independently of the plate
    // itself changing size — re-validate the fit here too.
    refitToCurrentView();
  }
  syncMapPadding();
  // MapLibre fires its own 'resize' event (via an internal ResizeObserver
  // on the container, throttled) on any container-size change, not just a
  // window resize — the same event-driven pattern updateGizmo() uses via
  // map.on('move', ...).
  map.on('resize', syncMapPadding);
  // Tilting the camera also shrinks the effective screen budget (see
  // pitchDerating) — re-check once the pitch gesture/animation settles,
  // rather than on every intermediate frame while dragging.
  map.on('pitchend', refitToCurrentView);

  // Belt-and-suspenders resync for size changes MapLibre's own internal
  // resize detection doesn't reliably catch — e.g. this app embedded in
  // an iframe whose HOST PAGE drives a "Fullscreen" control on some
  // ancestor element: the iframe's own box changes size, but that
  // doesn't always propagate into a `window` resize event (or MapLibre's
  // own container observer) inside the iframe's document in every
  // browser. A ResizeObserver on #app catches ANY change to its actual
  // rendered box regardless of what caused it, so this covers window
  // resizes, fullscreen transitions, and the host page resizing the
  // iframe alike.
  //
  // Critically, map.resize() alone is NOT enough: our own THREE.js
  // `renderer` (created once in buildingLayer.onAdd, wrapping MapLibre's
  // canvas/gl context) caches its own internal width/height at
  // construction time. THREE.WebGLRenderer.render() applies that CACHED
  // size as its own internal viewport early in its execution, which
  // overrides the fresh `gl.viewport(0,0,gl.drawingBufferWidth,...)` call
  // buildingLayer.render() makes right before invoking it — so after a
  // real size change, our building/wind-rose renders at the OLD cached
  // size/position (small, mispositioned) even though MapLibre's own
  // transform, padding and the CSS2D labels (driven by the same shared
  // camera, but not by `renderer`'s internal cache) are all already
  // correctly updated — reproduced and confirmed via direct pixel
  // measurement. renderer.setSize() refreshes that cache to match.
  let resyncScheduled = false;
  function resyncMapSize() {
    if (resyncScheduled) return;
    resyncScheduled = true;
    requestAnimationFrame(() => {
      resyncScheduled = false;
      map.resize();
      sizeLabelRenderer();
      if (renderer) renderer.setSize(mapContainer.clientWidth, mapContainer.clientHeight, false);
      syncMapPadding(); // re-applies padding and re-validates the zoom fit
    });
  }
  if (window.ResizeObserver) {
    new ResizeObserver(resyncMapSize).observe(document.getElementById('app'));
  }
  document.addEventListener('fullscreenchange', resyncMapSize);

  function renderLegendSwatches() {
    let html = '';
    EPW.SPEED_BINS.forEach((bin) => {
      html += `<div class="legend-row"><span class="legend-swatch" style="background:${bin.color}"></span><span class="lbl">${bin.label}</span></div>`;
    });
    html += `<div class="legend-row"><span class="legend-swatch legend-calm"></span><span class="lbl">Calm (&lt; 0.5 m/s)</span></div>`;
    legendTargets.forEach((t) => { if (t.list) t.list.innerHTML = html; });
  }

  createCustomSelect(
    document.getElementById('palette-select-wrap'),
    Palettes.PALETTES.map((p) => ({ value: p.id, label: p.name })),
    'sunset',
    (value) => {
      currentPaletteName = (Palettes.PALETTES.find((p) => p.id === value) || {}).name || value;
      Palettes.applyPalette(value);
      renderLegendSwatches();
      rebuildWindRose();
    }
  );

  function updateLegendStats() {
    const bd = state.binData;
    const hours = bd.total ? bd.total.toLocaleString() : '—';
    let label = state.locationName || '';
    if (state.selectedMonth !== 0) {
      label += (label ? ' — ' : '') + MONTH_NAMES[state.selectedMonth - 1];
    }
    const showSourceNote = state.selectedMonth !== 0 && state.source === 'representative';
    // Persistent warning line when the loaded wind data's origin and the
    // current site position have drifted apart (see updateDataLocationWarning) —
    // shown here in addition to the one-time toast, so the mismatch stays
    // visible without needing to catch the toast in the moment.
    const showDivergence = state.dataLocationKm != null && state.dataLocationKm > DATA_LOCATION_WARN_KM;
    const html = `<b>${hours}</b> hours · <b>${bd.calmPercent.toFixed(1)}%</b> calm` +
      (label ? `<br>${escapeHtml(label)}` : '') +
      (showSourceNote ? `<span class="legend-source-note">Representative profile — monthly shape illustrative</span>` : '') +
      (showDivergence ? `<br><span class="legend-source-note legend-warning">⚠ Data is for ${escapeHtml(state.locationName || 'a different location')}, ${Math.round(state.dataLocationKm)} km away</span>` : '');
    legendTargets.forEach((t) => { if (t.stats) t.stats.innerHTML = html; });
  }

  // ---------- Accordion section summary chips (collapsed-row preview text) ----------
  let currentPaletteName = 'Sunset';
  function updateAccordionSummaries() {
    const styleLabel = (MAP_STYLES[state.mapStyle] || MAP_STYLES.satellite).label;
    document.getElementById('location-summary').textContent =
      `${state.siteLngLat.lat.toFixed(3)}°, ${state.siteLngLat.lng.toFixed(3)}° · ${styleLabel}`;
    document.getElementById('epw-summary').textContent = state.locationName || 'No data loaded';
    document.getElementById('dims-summary').textContent = state.customModel ? 'Custom model' : 'No model loaded';
    const hours = state.binData && state.binData.total ? state.binData.total.toLocaleString() + ' h' : '—';
    document.getElementById('legend-summary').textContent = `${currentPaletteName} · ${hours}`;
  }

  // ---------- UI: load a custom .obj model to replace the building ----------
  const objInput = document.getElementById('obj-file-input');
  document.getElementById('btn-load-obj').addEventListener('click', () => objInput.click());

  function setCustomModelStatus(html) {
    const el = document.getElementById('obj-status');
    const removeBtn = document.getElementById('btn-remove-obj');
    if (html) {
      el.innerHTML = html;
      removeBtn.style.display = '';
    } else {
      el.innerHTML = 'Insert a .obj file to see your building.';
      removeBtn.style.display = 'none';
    }
  }

  const objScaleGroup = document.getElementById('obj-scale-group');
  const objScaleInput = document.getElementById('obj-scale');

  // Re-applies obj/position/footprint from the model's auto-fit baseline
  // (computed once at load) scaled by the user's chosen percentage —
  // lets "Scale" be adjusted repeatedly without re-parsing the file.
  function applyCustomModelScale(percent) {
    const cm = state.customModel;
    if (!cm || !cm.obj) return;
    const scale = cm.baseScale * (percent / 100);
    cm.obj.scale.setScalar(scale);
    cm.obj.position.x = -cm.center.x * scale;
    cm.obj.position.z = -cm.center.z * scale;
    cm.obj.position.y = -cm.minY * scale;
    cm.footprintRadius = 0.5 * Math.hypot(cm.size.x * scale, cm.size.z * scale);
    cm.maxHeight = cm.size.y * scale + 0.5;
    rebuildAll();
  }

  objScaleInput.addEventListener('input', () => {
    const percent = parseFloat(objScaleInput.value);
    document.getElementById('v-obj-scale').textContent = percent + '%';
    applyCustomModelScale(percent);
  });

  document.getElementById('btn-remove-obj').addEventListener('click', () => {
    state.customModel = null;
    setCustomModelStatus(null);
    objScaleGroup.style.display = 'none';
    rebuildAll();
    showToast('Custom model removed', 'ok');
  });

  objInput.addEventListener('change', () => {
    const file = objInput.files && objInput.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const loader = new THREE.OBJLoader();
        const obj = loader.parse(String(reader.result));

        const box = new THREE.Box3().setFromObject(obj);
        const size = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3());
        if (!isFinite(size.x) || size.length() === 0) {
          throw new Error('This .obj file has no visible geometry.');
        }

        // Auto-fit to a sensible on-scene size and drop it onto the ground.
        const targetSpan = 16;
        const currentSpan = Math.max(size.x, size.z) || 1;
        const baseScale = targetSpan / currentSpan;
        obj.scale.setScalar(baseScale);
        obj.position.x -= center.x * baseScale;
        obj.position.z -= center.z * baseScale;
        obj.position.y -= box.min.y * baseScale;

        const neutralMat = new THREE.MeshStandardMaterial({ color: 0xcfc9ba, roughness: 0.85, metalness: 0.02 });
        obj.traverse((child) => {
          if (child.isMesh) {
            child.material = neutralMat;
            child.castShadow = true;
            child.receiveShadow = true;
          }
        });

        const wrapper = new THREE.Group();
        wrapper.add(obj);
        const footprintRadius = 0.5 * Math.hypot(size.x * baseScale, size.z * baseScale);
        const maxHeight = size.y * baseScale + 0.5;

        // obj/baseScale/center/minY/size are kept so the Scale slider can
        // re-derive the transform from this same auto-fit baseline.
        state.customModel = { group: wrapper, footprintRadius, maxHeight, obj, baseScale, center, minY: box.min.y, size };
        setCustomModelStatus(`<span class="loc-name">${escapeHtml(file.name)}</span> loaded`);
        objScaleInput.value = 100;
        document.getElementById('v-obj-scale').textContent = '100%';
        objScaleGroup.style.display = '';
        rebuildAll();
        showToast('Model loaded', 'ok');
      } catch (err) {
        showToast(err.message || 'Could not load this .obj file', 'error');
      }
    };
    reader.onerror = () => showToast('Could not read this file', 'error');
    reader.readAsText(file);
    objInput.value = '';
  });

  // ---------- Toast ----------
  let toastTimer = null;
  function showToast(msg, type) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.className = 'show ' + type;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.className = ''; }, 2600);
  }

  // ---------- Screenshot export (PNG + JPEG) ----------
  // Composites the WebGL canvas (map tiles + building, sharing one canvas)
  // with the CSS2D text-label overlays (compass letters + ring % labels),
  // which live in a separate HTML layer and wouldn't otherwise appear in a
  // plain canvas.toDataURL() capture.
  function slugify(s) {
    return (String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')) || 'wind-rose';
  }

  function drawLabelsOnCanvas(ctx, canvasRect, scale) {
    const drawOne = (obj, opts) => {
      const div = obj.element;
      const text = div && div.textContent;
      if (!div || !text) return;
      const rect = div.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) return;
      const x = (rect.left + rect.width / 2 - canvasRect.left) * scale;
      const y = (rect.top + rect.height / 2 - canvasRect.top) * scale;

      ctx.save();
      ctx.font = `${opts.weight} ${opts.size * scale}px system-ui, -apple-system, "Segoe UI", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      if (opts.pill) {
        const padX = (opts.padX != null ? opts.padX : 3) * scale;
        const textW = ctx.measureText(text).width;
        const boxH = opts.size * 1.4 * scale;
        const bx = x - textW / 2 - padX, by = y - boxH / 2, bw = textW + padX * 2;
        const pillRadius = (opts.pillRadius != null ? opts.pillRadius : 3) * scale;
        ctx.fillStyle = opts.bgColor || 'rgba(251, 251, 250, 0.8)';
        if (ctx.roundRect) {
          ctx.beginPath();
          ctx.roundRect(bx, by, bw, boxH, pillRadius);
          ctx.fill();
        } else {
          ctx.fillRect(bx, by, bw, boxH);
        }
      } else {
        ctx.shadowColor = 'rgba(255,255,255,0.85)';
        ctx.shadowBlur = 6 * scale;
      }
      ctx.fillStyle = opts.color;
      ctx.fillText(text, x, y);
      ctx.restore();
    };

    state.compassObjects.forEach((obj) => {
      const isCardinal = obj.element.classList.contains('cardinal');
      // A solid backing chip (matching .compass-label's CSS), not the old
      // translucent-halo look — legible over any imagery, not just
      // whatever happened to be underneath.
      drawOne(obj, {
        size: isCardinal ? 15 : 13, weight: 700, color: obj.element.style.color || '#24344a',
        pill: true, padX: 5, pillRadius: 4, bgColor: 'rgba(251, 251, 250, 0.82)',
      });
    });
    state.ringLabelObjects.forEach((obj) => {
      drawOne(obj, { size: 9.5, weight: 600, color: '#575f56', pill: true });
    });
  }

  // Copyright pill + on-screen legend overlay are plain HTML panels (not
  // CSS2D scene objects like the labels above), so they need their own
  // compositing pass — otherwise "captured in the picture too" wouldn't
  // actually be true, they'd just be on-screen chrome. Reads each panel's
  // real computed style/rect so the export always matches what's on screen,
  // rather than hard-coding colours/positions a second time.
  function isElVisible(el) {
    return !!(el && (el.offsetWidth || el.offsetHeight || el.getClientRects().length));
  }

  function drawFilledRoundRect(ctx, rect, canvasRect, scale, fillStyle, radiusPx) {
    const x = (rect.left - canvasRect.left) * scale;
    const y = (rect.top - canvasRect.top) * scale;
    const w = rect.width * scale, h = rect.height * scale;
    const radius = Math.min(radiusPx || 0, rect.width / 2, rect.height / 2) * scale;
    ctx.save();
    ctx.fillStyle = fillStyle;
    if (ctx.roundRect) {
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, radius);
      ctx.fill();
    } else {
      ctx.fillRect(x, y, w, h);
    }
    ctx.restore();
  }

  // Renders a text node's rendered line-wraps (innerText, which reflects
  // actual <br>-driven line breaks) at its own on-screen position — used
  // for the copyright text and the legend overlay's stats block, both of
  // which are arbitrary flowed HTML rather than a single CSS2D label.
  function drawFlowText(ctx, text, rect, canvasRect, scale, cs) {
    if (!text) return;
    const lines = String(text).split('\n');
    const fontSize = parseFloat(cs.fontSize) || 11;
    let lineHeight = parseFloat(cs.lineHeight);
    if (!Number.isFinite(lineHeight)) lineHeight = fontSize * 1.3;
    // rect is the element's own border-box; inset by its own computed
    // padding so text starts at the content box, matching where the
    // browser actually lays it out on screen (e.g. #copyright's
    // `padding: 3px 9px`, which the un-padded version of this function
    // ignored, drawing text jammed into the pill's outer corner in
    // exported screenshots). No-op for the withSwatches leaf callers
    // (.lbl/.legend-stats have no padding of their own), so this stays
    // generic rather than #copyright-specific.
    const padLeft = parseFloat(cs.paddingLeft) || 0;
    const padTop = parseFloat(cs.paddingTop) || 0;
    const x = (rect.left + padLeft - canvasRect.left) * scale;
    let y = (rect.top + padTop - canvasRect.top) * scale;
    ctx.save();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.font = `${cs.fontWeight} ${fontSize * scale}px ${cs.fontFamily}`;
    lines.forEach((line) => {
      if (line) {
        // The divergence-warning line (⚠) always renders in its warning
        // colour, matching .legend-warning on screen, regardless of the
        // paragraph's own computed colour.
        ctx.fillStyle = line.indexOf('⚠') !== -1 ? '#a3341f' : cs.color;
        ctx.fillText(line, x, y);
      }
      y += lineHeight * scale;
    });
    ctx.restore();
  }

  // Draws a self-contained text pill (currently only #copyright) whose
  // background is sized from the text as CANVAS 2D actually measures and
  // draws it, not from the DOM's own rect.width. Canvas text metrics can
  // differ subtly from the browser's own text-layout engine (font
  // resolution/kerning), which previously could leave the drawn text
  // spilling past a background sized from the DOM rect alone — sizing
  // both the background and the text from the same ctx.measureText() call
  // makes the two always agree by construction. The DOM rect is still
  // used for the pill's on-screen anchor position (top-left corner).
  function drawTextPill(ctx, el, rect, canvasRect, scale, cs) {
    const text = el.innerText;
    if (!text) return;
    const fontSize = parseFloat(cs.fontSize) || 11;
    const padLeft = parseFloat(cs.paddingLeft) || 0;
    const padTop = parseFloat(cs.paddingTop) || 0;
    const padRight = parseFloat(cs.paddingRight) || padLeft;
    const padBottom = parseFloat(cs.paddingBottom) || padTop;
    let lineHeight = parseFloat(cs.lineHeight);
    if (!Number.isFinite(lineHeight)) lineHeight = fontSize * 1.3;

    ctx.save();
    ctx.font = `${cs.fontWeight} ${fontSize * scale}px ${cs.fontFamily}`;
    const lines = String(text).split('\n');
    let maxLineWidthPx = 0; // in canvas (already-scaled) pixels
    lines.forEach((line) => { maxLineWidthPx = Math.max(maxLineWidthPx, ctx.measureText(line).width); });

    const bx = (rect.left - canvasRect.left) * scale;
    const by = (rect.top - canvasRect.top) * scale;
    const bw = maxLineWidthPx + (padLeft + padRight) * scale;
    const bh = (lines.length * lineHeight + padTop + padBottom) * scale;
    const radius = Math.min(parseFloat(cs.borderRadius) || 0, bw / 2 / scale, bh / 2 / scale) * scale;

    ctx.fillStyle = cs.backgroundColor;
    if (ctx.roundRect) {
      ctx.beginPath();
      ctx.roundRect(bx, by, bw, bh, radius);
      ctx.fill();
    } else {
      ctx.fillRect(bx, by, bw, bh);
    }

    // 'center'/'middle' (not 'left'/'top') — Canvas 2D's 'top' baseline
    // anchors to a font's ascent metric, which sits measurably above the
    // visible glyph's cap-height (internal leading/accent clearance baked
    // into the font), so a 'top'-anchored draw renders visibly low/off-
    // centre within the pill despite consistent padding math. 'middle'
    // sidesteps this by centring the font's ascent+descent span on a
    // point instead — the same approach already proven correct by
    // drawOne()'s ring-label pill branch above.
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const cx = bx + bw / 2;
    let y = by + padTop * scale + (lineHeight * scale) / 2;
    lines.forEach((line) => {
      if (line) {
        // The divergence-warning line (⚠) always renders in its warning
        // colour, matching .legend-warning on screen, regardless of the
        // paragraph's own computed colour.
        ctx.fillStyle = line.indexOf('⚠') !== -1 ? '#a3341f' : cs.color;
        ctx.fillText(line, cx, y);
      }
      y += lineHeight * scale;
    });
    ctx.restore();
  }

  function drawPanelOnCanvas(ctx, el, canvasRect, scale, opts) {
    if (!isElVisible(el)) return; // e.g. #legend-overlay is display:none on the mobile layout
    opts = opts || {};
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const cs = getComputedStyle(el);

    if (opts.withSwatches) {
      drawFilledRoundRect(ctx, rect, canvasRect, scale, cs.backgroundColor, parseFloat(cs.borderRadius));
      el.querySelectorAll('.legend-row').forEach((row) => {
        const swatchEl = row.querySelector('.legend-swatch');
        const lblEl = row.querySelector('.lbl');
        if (swatchEl) {
          const scs = getComputedStyle(swatchEl);
          drawFilledRoundRect(ctx, swatchEl.getBoundingClientRect(), canvasRect, scale, scs.backgroundColor, parseFloat(scs.borderRadius));
        }
        if (lblEl) drawFlowText(ctx, lblEl.textContent, lblEl.getBoundingClientRect(), canvasRect, scale, getComputedStyle(lblEl));
      });
      if (opts.statsEl) drawFlowText(ctx, opts.statsEl.innerText, opts.statsEl.getBoundingClientRect(), canvasRect, scale, getComputedStyle(opts.statsEl));
    } else {
      drawTextPill(ctx, el, rect, canvasRect, scale, cs);
    }
  }

  function drawOverlayPanelsOnCanvas(ctx, canvasRect, scale) {
    drawPanelOnCanvas(ctx, document.getElementById('copyright'), canvasRect, scale);
    drawPanelOnCanvas(ctx, document.getElementById('legend-overlay'), canvasRect, scale, {
      withSwatches: true,
      statsEl: document.getElementById('legend-overlay-stats'),
    });
  }

  function buildScreenshotCanvas() {
    const srcCanvas = renderer.domElement; // = map.getCanvas(); already holds the composited map + building frame
    const w = srcCanvas.width, h = srcCanvas.height;
    const canvasRect = srcCanvas.getBoundingClientRect();
    const scale = w / canvasRect.width;

    const out = document.createElement('canvas');
    out.width = w;
    out.height = h;
    const ctx = out.getContext('2d');
    ctx.drawImage(srcCanvas, 0, 0, w, h);
    drawLabelsOnCanvas(ctx, canvasRect, scale);
    drawOverlayPanelsOnCanvas(ctx, canvasRect, scale);
    return out;
  }

  // Cross-origin map tiles can taint the shared canvas for pixel readback
  // (toDataURL) unless the tile provider sends permissive CORS headers.
  // Fails soft with a toast instead of an uncaught SecurityError.
  function safeDataURL(canvas, type, quality) {
    try {
      return canvas.toDataURL(type, quality);
    } catch (err) {
      showToast('Screenshot unavailable with the current basemap — try the other Basemap style', 'error');
      return null;
    }
  }

  function triggerDownload(dataUrl, filename) {
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  // The screenshot dialog: the button opens it with a preview, and the user
  // explicitly picks PNG or JPEG. Each save button click is its own direct
  // user gesture, unlike firing two downloads at once from a single click —
  // which browsers commonly block after the first (with no visible feedback).
  let pendingScreenshot = null; // { canvas, filenameBase }
  const screenshotModal = document.getElementById('screenshot-modal');
  const screenshotPreview = document.getElementById('screenshot-preview');

  function openScreenshotModal() {
    const canvas = buildScreenshotCanvas();
    const previewUrl = safeDataURL(canvas, 'image/png');
    if (!previewUrl) return;
    const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16);
    const filenameBase = `wind-rose-${slugify(state.locationName)}-${stamp}`;
    pendingScreenshot = { canvas, filenameBase };
    screenshotPreview.src = previewUrl;
    screenshotModal.classList.add('open');
  }

  function closeScreenshotModal() {
    screenshotModal.classList.remove('open');
    pendingScreenshot = null;
    screenshotPreview.src = '';
  }

  function saveScreenshotAs(format) {
    if (!pendingScreenshot) return;
    const { canvas, filenameBase } = pendingScreenshot;
    const isPng = format === 'png';
    const dataUrl = safeDataURL(canvas, isPng ? 'image/png' : 'image/jpeg', isPng ? undefined : 0.92);
    if (!dataUrl) return;
    triggerDownload(dataUrl, `${filenameBase}.${isPng ? 'png' : 'jpg'}`);
    showToast('Screenshot saved', 'ok');
    closeScreenshotModal();
  }

  // A proper 2D/3D toggle rather than a one-way "flatten" button: the
  // label/icon always describe what clicking will do NEXT (matching the
  // existing action-labelled convention already used by Reset North),
  // and update from map.getPitch() via the same 'move' hook updateGizmo()
  // uses — so a manual right-drag tilt also flips the button, not just
  // its own clicks.
  const btnTopView = document.getElementById('btn-top-view');
  function updateViewToggleButton() {
    const is3D = map.getPitch() >= 1;
    btnTopView.title = is3D ? 'Switch to 2D' : 'Switch to 3D';
    btnTopView.setAttribute('aria-label', btnTopView.title);
    btnTopView.innerHTML = is3D
      ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M4 5h16v14H4z" stroke="currentColor" stroke-width="1.6"/><path d="M4 5 L12 10 L20 5" stroke="currentColor" stroke-width="1.3" opacity="0.45"/></svg>'
      : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M12 3 L20 7.5 L20 16.5 L12 21 L4 16.5 L4 7.5 Z" stroke="currentColor" stroke-width="1.3" opacity="0.45"/><path d="M12 3 L20 7.5 L12 12 L4 7.5 Z" fill="currentColor"/></svg>';
  }
  map.on('move', updateViewToggleButton);
  updateViewToggleButton(); // match the initial pitch:0 state before any interaction

  btnTopView.addEventListener('click', () => {
    map.easeTo({ pitch: map.getPitch() < 1 ? 45 : 0, duration: 500 });
  });

  document.getElementById('btn-reset-north').addEventListener('click', () => {
    map.easeTo({ bearing: 0, duration: 500 });
  });

  document.getElementById('btn-screenshot').addEventListener('click', () => {
    try {
      openScreenshotModal();
    } catch (err) {
      showToast('Could not build screenshot', 'error');
    }
  });
  document.getElementById('btn-save-png').addEventListener('click', () => saveScreenshotAs('png'));
  document.getElementById('btn-save-jpeg').addEventListener('click', () => saveScreenshotAs('jpeg'));
  document.getElementById('btn-close-screenshot').addEventListener('click', closeScreenshotModal);
  screenshotModal.addEventListener('click', (e) => {
    if (e.target === screenshotModal) closeScreenshotModal();
  });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && screenshotModal.classList.contains('open')) closeScreenshotModal();
  });

  // ---------- Mobile drawer toolbar (<=900px) ----------
  // Below the compact-tier breakpoint, #sidebar (the whole accordion
  // sidebar) becomes one bottom sheet, opened via this single button.
  const mobileBackdrop = document.getElementById('mobile-backdrop');
  const mobileMenuBtn = document.getElementById('mobile-menu-btn');
  const sidebar = document.getElementById('sidebar');
  let sidebarOpen = false;

  function closeDrawer() {
    if (!sidebarOpen) return;
    sidebar.classList.remove('drawer-open');
    mobileMenuBtn.classList.remove('active');
    mobileBackdrop.classList.remove('show');
    sidebarOpen = false;
  }

  function openDrawer() {
    if (sidebarOpen) { closeDrawer(); return; }
    sidebar.classList.add('drawer-open');
    mobileMenuBtn.classList.add('active');
    mobileBackdrop.classList.add('show');
    sidebarOpen = true;
  }

  mobileMenuBtn.addEventListener('click', openDrawer);
  mobileBackdrop.addEventListener('click', closeDrawer);
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeDrawer();
  });
  window.addEventListener('resize', () => {
    if (window.innerWidth > 900) closeDrawer();
  });

  // ---------- On-screen orientation gizmo ----------
  const gizmoNeedle = document.getElementById('gizmo-needle');

  function updateGizmo() {
    if (!gizmoNeedle) return;
    // MapLibre bearing: degrees clockwise the map is rotated from north-up.
    const theta = THREE.MathUtils.degToRad(map.getBearing());
    gizmoNeedle.style.transform = `rotate(${theta}rad)`;
  }
  // Any camera change (pan/zoom/rotate/pitch, including our own easeTo
  // calls) fires 'move' — driving the gizmo from this instead of a
  // continuous per-frame loop means it stays in sync with zero
  // unconditional per-frame cost.
  map.on('move', updateGizmo);

  // ---------- Resize ----------
  // Routed through the same debounced resyncMapSize() the ResizeObserver/
  // fullscreenchange hooks use above, so an ordinary window resize (which
  // also triggers that ResizeObserver, since #app tracks 100vw/100vh)
  // never calls map.resize() twice back-to-back.
  window.addEventListener('resize', resyncMapSize);

  // ---------- Init ----------
  document.getElementById('copyright').textContent = '© Karam Al-Obaidi';
  Palettes.applyPalette('sunset');
  renderLegendSwatches();
  rebuildBuilding(); // must exist before loadCity's rebuildWindRose() reads buildingResult
  loadCity(londonDefault, { silent: true });
  updateLocationReadout();
  updateAccordionSummaries();
  syncSidebarMaxHeight();
  setEpwStatus(
    `<span class="loc-name">London (St James's Park)</span> <span class="src-badge badge-recorded">Recorded — TMYx, 8,760 h</span><br>` +
    `Insert your own EPW file, or pick another UK location below.`,
    false
  );
  updateGizmo();
})();
