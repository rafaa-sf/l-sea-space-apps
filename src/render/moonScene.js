/**
 * Three.js lunar south-pole scene.
 *
 * Public API (see docs/architecture.md):
 *   createMoonScene(canvas, options) -> Promise<{
 *     setTerrain, setSites, setSunDirection, setEarthDirection, setLayers,
 *     setRay, setLabels, setSelectedSite, resetView, resize, dispose
 *   }>
 *
 * `three` is imported dynamically so the main bundle stays small and machines
 * without WebGL never download it. Callers are expected to fall back to
 * `fallback2d.js` when this module rejects.
 */

import {
  boxBlurGrid,
  createPolarProjection,
  hillshadeShade,
  sRGBToLinear,
  sunDirectionVector,
  terrainColor,
} from './geo.js'
import { loadMoonTrekMosaic } from './moontrekTiles.js'

const COLOR_SPACE = 0x05070c
const COLOR_SELECTED = 0x6ee7ff
const COLOR_COMPARE = 0xffb454
const COLOR_SITE = 0x6ea8ff
const COLOR_SUN = 0xffd166
const COLOR_EARTH = 0x7fd1ff

/** Recursively release geometries, materials and textures. */
function disposeObject(object) {
  if (!object || typeof object.traverse !== 'function') return
  object.traverse((child) => {
    if (child.geometry) child.geometry.dispose()
    const materials = Array.isArray(child.material) ? child.material : child.material ? [child.material] : []
    for (const material of materials) {
      for (const key of Object.keys(material)) {
        const value = material[key]
        if (value && value.isTexture) value.dispose()
        if (value && value.isMaterial) value.dispose()
      }
      material.dispose()
    }
  })
}

/** Build a text label sprite (used for Sun/Earth indicators). */
function createLabelSprite(THREE, text, color = '#e8ecf4', scale = 1) {
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 96
  const context = canvas.getContext('2d')
  context.clearRect(0, 0, canvas.width, canvas.height)
  context.font = '600 40px Inter, system-ui, sans-serif'
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  context.fillStyle = color
  context.shadowColor = 'rgba(0,0,0,0.8)'
  context.shadowBlur = 8
  context.fillText(text, canvas.width / 2, canvas.height / 2)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false })
  const sprite = new THREE.Sprite(material)
  sprite.scale.set(1.6 * scale, 0.6 * scale, 1)
  return sprite
}

export async function createMoonScene(canvas, options = {}) {
  const [THREE, controlsModule] = await Promise.all([
    import('three'),
    import('three/addons/controls/OrbitControls.js'),
  ])
  const OrbitControls = controlsModule.OrbitControls

  const labels = {
    sun: options.labels?.sun ?? 'Sun',
    earth: options.labels?.earth ?? 'Earth',
    ...(options.labels ?? {}),
  }

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: false,
    powerPreference: 'high-performance',
  })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
  renderer.setClearColor(COLOR_SPACE, 1)
  renderer.outputColorSpace = THREE.SRGBColorSpace

  const scene = new THREE.Scene()
  scene.background = new THREE.Color(COLOR_SPACE)

  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 800)
  // Nearly top-down: the polar cap reads as a clean circle instead of an ellipse.
  camera.position.set(0, 28, 7)

  const controls = new OrbitControls(camera, canvas)
  controls.enableDamping = true
  controls.dampingFactor = 0.075
  controls.minDistance = 4
  controls.maxDistance = 70
  controls.maxPolarAngle = Math.PI * 0.52
  controls.target.set(0, 0, 0)

  // The terrain uses baked cartographic shading (hypsometric tint x hillshade),
  // so the scene itself needs no dynamic light sources.

  const terrainGroup = new THREE.Group()
  const markerGroup = new THREE.Group()
  const overlayGroup = new THREE.Group()
  const helperGroup = new THREE.Group()
  scene.add(terrainGroup, markerGroup, overlayGroup, helperGroup)

  let projection = null
  let terrainMesh = null
  let terrainGeometry = null
  let terrainNormals = null
  let terrainTints = null
  let terrainStats = { minM: 0, maxM: 1 }
  let lastTerrain = null
  let sites = []
  let sitesOptions = { selectedId: null, compareIds: [] }
  let selectedSite = null
  let sunDirection = null
  let earthDirection = null
  let sunVisible = true
  let earthVisible = true
  let rayInfo = null

  const pickables = []

  const sunArrow = new THREE.ArrowHelper(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 0), 4, COLOR_SUN, 1.1, 0.55)
  const earthArrow = new THREE.ArrowHelper(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 0), 3.4, COLOR_EARTH, 0.9, 0.45)
  const sunLabel = createLabelSprite(THREE, labels.sun, '#d8b156', 0.82)
  const earthLabel = createLabelSprite(THREE, labels.earth, '#6fa8d8', 0.82)
  helperGroup.add(sunArrow, earthArrow, sunLabel, earthLabel)

  const rayGroup = new THREE.Group()
  helperGroup.add(rayGroup)

  let lastViewInfo = { azimuthDeg: Number.NaN, visibleMeters: Number.NaN }

  function computeViewInfo() {
    if (!projection) return null
    const size = Math.max(1, Math.min(canvas.clientWidth || 1, canvas.clientHeight || 1))
    const distance = camera.position.distanceTo(controls.target)
    const visibleMeters =
      (2 * distance * Math.tan((camera.fov * Math.PI) / 360)) / Math.max(1e-9, projection.unitsPerMeter)
    const azimuthDeg =
      (Math.atan2(camera.position.x - controls.target.x, camera.position.z - controls.target.z) * 180) / Math.PI
    return { visibleMeters, widthPx: size, heightPx: size, azimuthDeg }
  }

  function notifyViewChange(force = false) {
    const info = computeViewInfo()
    if (!info) return
    const azimuthChanged = Math.abs(info.azimuthDeg - lastViewInfo.azimuthDeg) > 0.5
    const scaleChanged = Math.abs(info.visibleMeters - lastViewInfo.visibleMeters) > info.visibleMeters * 0.01
    if (!force && !azimuthChanged && !scaleChanged) return
    lastViewInfo = { azimuthDeg: info.azimuthDeg, visibleMeters: info.visibleMeters }
    options.onViewChange?.(info)
  }

  // Always render a square canvas with a 1:1 camera aspect, so the polar cap is
  // never stretched by the container aspect ratio.
  function cameraFrame() {
    const cssWidth = canvas.clientWidth || 1
    const cssHeight = canvas.clientHeight || 1
    const size = Math.max(1, Math.min(cssWidth, cssHeight))
    renderer.setSize(size, size, false)
    canvas.style.width = `${size}px`
    canvas.style.height = `${size}px`
    camera.aspect = 1
    camera.updateProjectionMatrix()
    notifyViewChange(true)
  }

  function sampleElevation(lat, lon) {
    if (typeof options.sampleElevation === 'function') {
      const value = Number(options.sampleElevation(lat, lon))
      return Number.isFinite(value) ? value : 0
    }
    return 0
  }

  function sitePosition(site) {
    if (!site || !projection) return new THREE.Vector3(0, 0.2, 0)
    const point = projection.project(site.lat, site.lon, sampleElevation(site.lat, site.lon))
    return new THREE.Vector3(point.x, point.y + 0.25, point.z)
  }

  function updateHelpers() {
    const origin = selectedSite ? sitePosition(selectedSite) : new THREE.Vector3(0, 0.3, 0)
    if (sunDirection) {
      const vector = new THREE.Vector3(
        Math.sin((sunDirection.az * Math.PI) / 180) * Math.cos((sunDirection.el * Math.PI) / 180),
        Math.sin((sunDirection.el * Math.PI) / 180),
        Math.cos((sunDirection.az * Math.PI) / 180) * Math.cos((sunDirection.el * Math.PI) / 180),
      ).normalize()
      const length = sunVisible ? 3.2 : 2.2
      sunArrow.position.copy(origin)
      sunArrow.setDirection(vector)
      sunArrow.setLength(length, 0.7, 0.34)
      sunArrow.setColor(new THREE.Color(COLOR_SUN))
      sunArrow.visible = true
      sunLabel.position.copy(origin.clone().add(vector.clone().multiplyScalar(length + 0.8)))
      sunLabel.visible = true
    } else {
      sunArrow.visible = false
      sunLabel.visible = false
    }

    if (earthDirection) {
      const vector = new THREE.Vector3(
        Math.sin((earthDirection.az * Math.PI) / 180) * Math.cos((earthDirection.el * Math.PI) / 180),
        Math.max(0.02, Math.sin((earthDirection.el * Math.PI) / 180)),
        Math.cos((earthDirection.az * Math.PI) / 180) * Math.cos((earthDirection.el * Math.PI) / 180),
      ).normalize()
      const length = earthVisible ? 2.4 : 1.8
      earthArrow.position.copy(origin)
      earthArrow.setDirection(vector)
      earthArrow.setLength(length, 0.6, 0.3)
      earthArrow.visible = true
      earthLabel.position.copy(origin.clone().add(vector.clone().multiplyScalar(length + 0.7)))
      earthLabel.visible = true
    } else {
      earthArrow.visible = false
      earthLabel.visible = false
    }

    // Simple declutter: separate the Sun/Earth sprite labels when their anchor
    // points are close in scene space.
    if (sunLabel.visible && earthLabel.visible) {
      const separation = sunLabel.position.distanceTo(earthLabel.position)
      if (Number.isFinite(separation) && separation < 1.1) {
        earthLabel.position.y += 0.8
      }
    }

    updateRay()
  }

  function updateRay() {
    disposeObject(rayGroup)
    rayGroup.clear()
    if (!rayInfo || !projection) return
    const origin = selectedSite ? sitePosition(selectedSite) : new THREE.Vector3(0, 0.3, 0)
    let endpoint
    if (rayInfo.hit && Number.isFinite(rayInfo.hit.lat) && Number.isFinite(rayInfo.hit.lon)) {
      const point = projection.project(rayInfo.hit.lat, rayInfo.hit.lon, rayInfo.hit.elevationM ?? 0)
      endpoint = new THREE.Vector3(point.x, point.y + 0.08, point.z)
    } else {
      const distanceM = Math.min(Number(rayInfo.distanceM ?? 240000), 300000)
      const horizontalM = distanceM * Math.cos(((rayInfo.elevation ?? 0) * Math.PI) / 180)
      const verticalM = distanceM * Math.sin(((rayInfo.elevation ?? 0) * Math.PI) / 180) - (distanceM * distanceM) / (2 * 1737400)
      const east = Math.sin(((rayInfo.azimuth ?? 0) * Math.PI) / 180) * horizontalM * projection.unitsPerMeter
      const north = Math.cos(((rayInfo.azimuth ?? 0) * Math.PI) / 180) * horizontalM * projection.unitsPerMeter
      endpoint = new THREE.Vector3(
        origin.x + east,
        origin.y + verticalM * projection.elevationScale,
        origin.z + north,
      )
    }
    const geometry = new THREE.BufferGeometry().setFromPoints([origin, endpoint])
    const material = new THREE.LineBasicMaterial({
      color: rayInfo.hit ? 0xff9e64 : 0xffd166,
      transparent: true,
      opacity: 0.95,
      depthTest: false,
      depthWrite: false,
    })
    const line = new THREE.Line(geometry, material)
    line.renderOrder = 20
    rayGroup.add(line)

    const endMarker = new THREE.Mesh(
      new THREE.SphereGeometry(rayInfo.hit ? 0.14 : 0.1, 12, 12),
      new THREE.MeshBasicMaterial({ color: rayInfo.hit ? 0xff9e64 : 0xffd166, depthTest: false, depthWrite: false }),
    )
    endMarker.renderOrder = 20
    endMarker.position.copy(endpoint)
    rayGroup.add(endMarker)
  }

  /**
   * Build the cap mesh from a de-noised (box-blurred) elevation field.
   * Returns positions, per-vertex Sun-independent hypsometric tints and smooth
   * surface normals; the colour attribute is filled by `applyHillshade()`.
   */
  function buildTerrainGeometry(terrain) {
    const maxVertices = options.maxVertices ?? 90000
    const step = Math.max(1, Math.ceil(Math.sqrt((terrain.width * terrain.height) / maxVertices)))
    const wrap = Math.abs(terrain.lon1 - terrain.lon0) >= 359.5
    const cols = wrap ? Math.floor((terrain.width - 1) / step) : Math.floor((terrain.width - 1) / step) + 1
    const rows = Math.floor((terrain.height - 1) / step) + 1
    const smoothed = boxBlurGrid(terrain.data, terrain.width, terrain.height, 1, 1)
    const positions = new Float32Array(cols * rows * 3)
    const colors = new Float32Array(cols * rows * 3)
    const uvs = new Float32Array(cols * rows * 2)
    const normals = new Float32Array(cols * rows * 3)
    const tints = new Float32Array(cols * rows * 3)
    const latSpan = terrain.lat1 - terrain.lat0
    const lonSpan = terrain.lon1 - terrain.lon0

    let index = 0
    for (let row = 0; row < rows; row += 1) {
      const sourceRow = Math.min(row * step, terrain.height - 1)
      const lat = terrain.lat0 + (latSpan * sourceRow) / (terrain.height - 1)
      for (let col = 0; col < cols; col += 1) {
        const sourceCol = Math.min(col * step, terrain.width - 1)
        const lon = terrain.lon0 + (lonSpan * sourceCol) / (terrain.width - 1)
        const elevation = smoothed[sourceRow * terrain.width + sourceCol] ?? 0
        const point = projection.project(lat, lon, elevation)
        positions[index * 3] = point.x
        positions[index * 3 + 1] = point.y
        positions[index * 3 + 2] = point.z
        const [r, g, b] = terrainColor(elevation, terrainStats.minM, terrainStats.maxM)
        tints[index * 3] = r
        tints[index * 3 + 1] = g
        tints[index * 3 + 2] = b
        uvs[index * 2] = lonSpan > 0 ? (lon - terrain.lon0) / lonSpan : 0
        uvs[index * 2 + 1] = latSpan > 0 ? (lat - terrain.lat0) / latSpan : 0
        index += 1
      }
    }

    // Smooth vertex normals from the de-noised height field. Shading uses the
    // *true* terrain slopes (metres per metre), not the exaggerated geometry, so
    // the 3D hillshade matches the 2D cartographic raster while the vertical
    // exaggeration only affects the perspective relief.
    const spacingScene = (2 * projection.radius) / Math.max(1, Math.max(cols - 1, rows - 1))
    const spacingMeters = spacingScene / Math.max(1e-12, projection.unitsPerMeter)
    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        const index3 = (row * cols + col) * 3
        const leftCol = wrap ? (col === 0 ? cols - 1 : col - 1) : Math.max(0, col - 1)
        const rightCol = wrap ? (col === cols - 1 ? 0 : col + 1) : Math.min(cols - 1, col + 1)
        const upRow = Math.max(0, row - 1)
        const downRow = Math.min(rows - 1, row + 1)
        const left = (row * cols + leftCol) * 3
        const right = (row * cols + rightCol) * 3
        const up = (upRow * cols + col) * 3
        const down = (downRow * cols + col) * 3
        const dhdx =
          (positions[right + 1] - positions[left + 1]) /
          Math.max(1e-12, projection.elevationScale) /
          (2 * spacingMeters)
        const dhdz =
          (positions[down + 1] - positions[up + 1]) /
          Math.max(1e-12, projection.elevationScale) /
          (2 * spacingMeters)
        let nx = -dhdx
        let ny = 1
        let nz = -dhdz
        const length = Math.hypot(nx, ny, nz)
        if (length < 1e-9) {
          nx = 0
          ny = 1
          nz = 0
        } else {
          nx /= length
          ny /= length
          nz /= length
        }
        normals[index3] = nx
        normals[index3 + 1] = ny
        normals[index3 + 2] = nz
      }
    }

    const indices = []
    const columnCount = wrap ? cols : cols - 1
    for (let row = 0; row < rows - 1; row += 1) {
      for (let col = 0; col < columnCount; col += 1) {
        const nextCol = wrap && col === cols - 1 ? 0 : col + 1
        const a = row * cols + col
        const b = row * cols + nextCol
        const c = (row + 1) * cols + col
        const d = (row + 1) * cols + nextCol
        indices.push(a, c, b, b, c, d)
      }
    }

    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
    geometry.setIndex(indices)

    return { geometry, positions, normals, tints, rows, cols }
  }

  /** Thin neutral rim that closes the cut edge of the polar cap. */
  function buildCapRim(positions, rows, cols) {
    const rimDepth = Math.max(0.25, projection.radius * 0.05)
    const vertices = []
    const indices = []
    const wrap = Math.abs((lastTerrain?.lon1 ?? 0) - (lastTerrain?.lon0 ?? 0)) >= 359.5
    const columnCount = wrap ? cols : cols - 1
    for (let col = 0; col < columnCount; col += 1) {
      const nextCol = wrap && col === cols - 1 ? 0 : col + 1
      const i = ((rows - 1) * cols + col) * 3
      const j = ((rows - 1) * cols + nextCol) * 3
      const base = vertices.length / 3
      vertices.push(
        positions[i], positions[i + 1], positions[i + 2],
        positions[i], positions[i + 1] - rimDepth, positions[i + 2],
        positions[j], positions[j + 1], positions[j + 2],
        positions[j], positions[j + 1] - rimDepth, positions[j + 2],
      )
      indices.push(base, base + 1, base + 2, base + 2, base + 1, base + 3)
    }
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3))
    geometry.setIndex(indices)
    return new THREE.Mesh(
      geometry,
      new THREE.MeshBasicMaterial({ color: 0x262b31, side: THREE.DoubleSide }),
    )
  }

  /** Recompute vertex colours from the smoothed normals and the current Sun. */
  function applyHillshade() {
    if (!terrainGeometry || !terrainNormals || !terrainTints) return
    const colorAttribute = terrainGeometry.getAttribute('color')
    if (!colorAttribute) return
    const colors = colorAttribute.array
    const sun = sunDirection
      ? sunDirectionVector(sunDirection.az, sunDirection.el)
      : sunDirectionVector(0, 90)
    const visible = Boolean(sunDirection) && sunVisible
    const vertexCount = colorAttribute.count
    for (let index = 0; index < vertexCount; index += 1) {
      const offset = index * 3
      const normal = {
        x: terrainNormals[offset],
        y: terrainNormals[offset + 1],
        z: terrainNormals[offset + 2],
      }
      const shade = sunDirection
        ? hillshadeShade(normal, sun, visible, { ambient: 0.3, diffuse: 1.35, flatShade: 0.4 })
        : 0.9
      colors[offset] = sRGBToLinear(Math.min(1, terrainTints[offset] * shade))
      colors[offset + 1] = sRGBToLinear(Math.min(1, terrainTints[offset + 1] * shade))
      colors[offset + 2] = sRGBToLinear(Math.min(1, terrainTints[offset + 2] * shade))
    }
    colorAttribute.needsUpdate = true
  }

  function clearTerrain() {
    disposeObject(terrainGroup)
    terrainGroup.clear()
    terrainMesh = null
    terrainGeometry = null
    terrainNormals = null
    terrainTints = null
    pickables.length = 0
  }

  function setTerrain(terrain) {
    if (!terrain || !terrain.data) return
    lastTerrain = terrain
    terrainStats = options.terrainStats?.(terrain) ?? { minM: 0, maxM: 1 }
    projection = createPolarProjection(terrain, { radius: options.radius ?? 10, exaggeration: options.exaggeration ?? 3.5 })
    clearTerrain()

    const built = buildTerrainGeometry(terrain)
    terrainGeometry = built.geometry
    terrainNormals = built.normals
    terrainTints = built.tints
    applyHillshade()

    const material = new THREE.MeshBasicMaterial({ vertexColors: true })
    terrainMesh = new THREE.Mesh(terrainGeometry, material)
    terrainMesh.userData.pickTerrain = true
    terrainGroup.add(terrainMesh)
    pickables.push(terrainMesh)

    // Close the cut cap edge so the disc does not look like a paper cut-out.
    terrainGroup.add(buildCapRim(built.positions, built.rows, built.cols))

    layerToken += 1
    clearOverlays()
    renderSites()
    updateHelpers()
    // The scale depends on the projection, which only exists once the terrain
    // is set: force a view report so the scale bar appears deterministically on
    // load instead of waiting for a resize or a camera interaction.
    notifyViewChange(true)
  }

  function clearSites() {
    disposeObject(markerGroup)
    markerGroup.clear()
    const terrainIndex = pickables.findIndex((entry) => entry.userData.pickTerrain)
    pickables.length = terrainIndex >= 0 ? terrainIndex + 1 : 0
  }

  function renderSites() {
    clearSites()
    const selectedId = sitesOptions.selectedId
    const compareIds = sitesOptions.compareIds ?? []
    for (const site of sites) {
      const isSelected = site.id === selectedId
      const isCompared = compareIds.includes(site.id)
      const position = sitePosition(site)
      const color = isSelected ? COLOR_SELECTED : isCompared ? COLOR_COMPARE : COLOR_SITE
      const radius = isSelected ? 0.14 : 0.09
      const geometry = new THREE.OctahedronGeometry(radius, 0)
      const material = new THREE.MeshBasicMaterial({ color })
      const marker = new THREE.Mesh(geometry, material)
      marker.position.copy(position)
      marker.userData.pickSiteId = site.id
      markerGroup.add(marker)
      pickables.push(marker)

      if (isSelected) {
        const ringGeometry = new THREE.RingGeometry(0.19, 0.25, 40)
        const ringMaterial = new THREE.MeshBasicMaterial({ color: COLOR_SELECTED, transparent: true, opacity: 0.8, side: THREE.DoubleSide })
        const ring = new THREE.Mesh(ringGeometry, ringMaterial)
        ring.rotation.x = -Math.PI / 2
        ring.position.copy(position).add(new THREE.Vector3(0, -0.12, 0))
        markerGroup.add(ring)

      }
    }
    updateHelpers()
  }

  function setSites(nextSites, nextOptions = {}) {
    sites = Array.isArray(nextSites) ? nextSites : []
    sitesOptions = {
      selectedId: nextOptions.selectedId ?? sitesOptions.selectedId,
      compareIds: nextOptions.compareIds ?? sitesOptions.compareIds ?? [],
    }
    selectedSite = sites.find((site) => site.id === sitesOptions.selectedId) ?? null
    renderSites()
  }

  function setSelectedSite(id) {
    sitesOptions.selectedId = id
    selectedSite = sites.find((site) => site.id === id) ?? null
    renderSites()
  }

  function setSunDirection(sun, visible = true) {
    sunDirection = sun ? { az: Number(sun.az) || 0, el: Number(sun.el) || 0 } : null
    sunVisible = Boolean(visible)
    applyHillshade()
    updateHelpers()
  }

  function setEarthDirection(earth, visible = true) {
    earthDirection = earth ? { az: Number(earth.az) || 0, el: Number(earth.el) || 0 } : null
    earthVisible = Boolean(visible)
    updateHelpers()
  }

  function setRay(nextRay) {
    rayInfo = nextRay
    updateRay()
  }

  function setLabels(nextLabels) {
    Object.assign(labels, nextLabels ?? {})
    // Cheap approach: rebuild the sprites with the translated text.
    disposeObject(sunLabel)
    disposeObject(earthLabel)
    helperGroup.remove(sunLabel, earthLabel)
    sunLabel.material.map = null
    const freshSun = createLabelSprite(THREE, labels.sun, '#ffd166')
    const freshEarth = createLabelSprite(THREE, labels.earth, '#7fd1ff')
    sunLabel.material = freshSun.material
    sunLabel.map = undefined
    sunLabel.scale.copy(freshSun.scale)
    earthLabel.material = freshEarth.material
    earthLabel.scale.copy(freshEarth.scale)
    helperGroup.add(sunLabel, earthLabel)
    updateHelpers()
  }

  let layerToken = 0
  let overlayEntries = []

  function clearOverlays() {
    disposeObject(overlayGroup)
    overlayGroup.clear()
    overlayEntries = []
  }

  function regionBoundsM() {
    if (!projection) return null
    const rhoMax = projection.radius / Math.max(1e-9, projection.unitsPerMeter)
    return { minX: -rhoMax, maxX: rhoMax, minY: -rhoMax, maxY: rhoMax }
  }

  function overlayMaterial(layer, texture) {
    texture.colorSpace = THREE.SRGBColorSpace
    texture.minFilter = THREE.LinearFilter
    texture.magFilter = THREE.LinearFilter
    texture.wrapS = THREE.ClampToEdgeWrapping
    texture.wrapT = THREE.ClampToEdgeWrapping
    return new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      opacity: layer.opacity ?? 0.7,
      depthWrite: false,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    })
  }

  function addTileOverlay(layer, mosaic) {
    if (!terrainGeometry) return
    const positions = terrainGeometry.getAttribute('position')
    const index = terrainGeometry.getIndex()
    if (!positions || !index) return
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', positions.clone())
    geometry.setIndex(index.clone())
    const uv = new Float32Array((positions.count ?? positions.array.length / 3) * 2)
    const { minX, maxX, minY, maxY } = mosaic.boundsM
    const spanX = Math.max(1, maxX - minX)
    const spanY = Math.max(1, maxY - minY)
    const unitsPerMeter = Math.max(1e-12, projection.unitsPerMeter)
    for (let vertex = 0; vertex < uv.length / 2; vertex += 1) {
      const xMeters = positions.array[vertex * 3] / unitsPerMeter
      const yMeters = positions.array[vertex * 3 + 2] / unitsPerMeter
      uv[vertex * 2] = (xMeters - minX) / spanX
      uv[vertex * 2 + 1] = (maxY - yMeters) / spanY
    }
    geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
    const texture = new THREE.CanvasTexture(mosaic.canvas)
    const material = overlayMaterial(layer, texture)
    const mesh = new THREE.Mesh(geometry, material)
    mesh.renderOrder = 2
    overlayGroup.add(mesh)
    overlayEntries.push({ id: layer.id, mesh })
  }

  function addWMTSOverlay(layer, token) {
    const bounds = regionBoundsM()
    if (!bounds) return
    options.onLayerStatus?.(layer.id, { available: false, loading: true })
    loadMoonTrekMosaic(layer, bounds, { maxTiles: 25 })
      .then((mosaic) => {
        if (token !== layerToken) return
        if (!mosaic) {
          options.onLayerStatus?.(layer.id, { available: false, reason: 'tiles' })
          return
        }
        addTileOverlay(layer, mosaic)
        options.onLayerStatus?.(layer.id, {
          available: true,
          zoom: mosaic.zoom,
          tiles: `${mosaic.loaded}/${mosaic.total}`,
        })
      })
      .catch(() => {
        if (token === layerToken) options.onLayerStatus?.(layer.id, { available: false, reason: 'tiles' })
      })
  }

  function wmsUrl(layer) {
    if (!layer?.url) return null
    const bounds = lastTerrain
      ? [
          Number(lastTerrain.lon0).toFixed(4),
          Number(lastTerrain.lat0).toFixed(4),
          Number(lastTerrain.lon1).toFixed(4),
          Number(lastTerrain.lat1).toFixed(4),
        ].join(',')
      : '-180,-90,180,90'
    if (layer.url.includes('{bbox}')) return layer.url.replaceAll('{bbox}', bounds)
    const params = new URLSearchParams({
      SERVICE: 'WMS',
      VERSION: '1.1.1',
      REQUEST: 'GetMap',
      LAYERS: String(layer.wmsLayer ?? layer.id),
      STYLES: '',
      FORMAT: 'image/png',
      SRS: 'EPSG:4326',
      BBOX: bounds,
      WIDTH: '1024',
      HEIGHT: '1024',
    })
    return `${layer.url}${layer.url.includes('?') ? '&' : '?'}${params.toString()}`
  }

  function addImageOverlay(layer) {
    const url = layer.type === 'wms' ? wmsUrl(layer) : layer.url
    if (!url || !terrainGeometry) {
      options.onLayerStatus?.(layer.id, { available: false, reason: 'no-url' })
      return
    }
    const textureLoader = new THREE.TextureLoader()
    textureLoader.setCrossOrigin('anonymous')
    textureLoader.load(
      url,
      (texture) => {
        if (!terrainGeometry) return
        const geometry = new THREE.BufferGeometry()
        geometry.setAttribute('position', terrainGeometry.getAttribute('position').clone())
        const uvSource = terrainGeometry.getAttribute('uv')
        geometry.setAttribute('uv', uvSource ? uvSource.clone() : new THREE.BufferAttribute(new Float32Array(geometry.getAttribute('position').count * 2), 2))
        geometry.setIndex(terrainGeometry.getIndex().clone())
        const mesh = new THREE.Mesh(geometry, overlayMaterial(layer, texture))
        mesh.renderOrder = 2
        overlayGroup.add(mesh)
        overlayEntries.push({ id: layer.id, mesh })
        options.onLayerStatus?.(layer.id, { available: true })
      },
      undefined,
      () => {
        options.onLayerStatus?.(layer.id, { available: false, reason: 'texture-load' })
      },
    )
  }

  function setLayers(layers = [], enabledIds = []) {
    const token = (layerToken += 1)
    clearOverlays()
    if (!terrainGeometry || !projection) return
    const enabled = new Set(enabledIds)
    for (const layer of layers) {
      if (!enabled.has(layer.id)) continue
      if (!layer.available) {
        options.onLayerStatus?.(layer.id, { available: false, reason: 'unavailable' })
        continue
      }
      if (layer.type === 'wmts') {
        addWMTSOverlay(layer, token)
      } else if (['wms', 'xyz', 'image'].includes(layer.type)) {
        addImageOverlay(layer)
      } else {
        options.onLayerStatus?.(layer.id, { available: false, reason: 'reference-only' })
      }
    }
  }

  function resetView() {
    camera.position.set(0, 28, 7)
    controls.target.set(0, 0, 0)
    controls.update()
    notifyViewChange(true)
  }

  /* ------------------------------ interaction ----------------------------- */

  const raycaster = new THREE.Raycaster()
  const pointer = new THREE.Vector2()
  let pointerDown = null
  let hoverFrame = null

  function pointerToNdc(event) {
    const rect = canvas.getBoundingClientRect()
    pointer.x = ((event.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1
    pointer.y = -((event.clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1
  }

  function pickMarker(event) {
    pointerToNdc(event)
    raycaster.setFromCamera(pointer, camera)
    const markerMeshes = markerGroup.children.filter((child) => child.userData.pickSiteId)
    const hits = raycaster.intersectObjects(markerMeshes, false)
    return hits.length ? hits[0].object.userData.pickSiteId : null
  }

  function pickLocation(event) {
    if (!terrainMesh || !projection) return null
    pointerToNdc(event)
    raycaster.setFromCamera(pointer, camera)
    const hits = raycaster.intersectObject(terrainMesh, false)
    if (!hits.length) return null
    return projection.unproject(hits[0].point.x, hits[0].point.z)
  }

  function onPointerDown(event) {
    pointerDown = { x: event.clientX, y: event.clientY }
  }

  function onPointerUp(event) {
    if (!pointerDown) return
    const moved = Math.hypot(event.clientX - pointerDown.x, event.clientY - pointerDown.y)
    pointerDown = null
    if (moved > 6) return
    const siteId = pickMarker(event)
    if (siteId) {
      options.onPickSite?.(siteId)
      return
    }
    const coordinates = pickLocation(event)
    if (coordinates) options.onPickLocation?.(coordinates)
  }

  function onPointerMove(event) {
    if (hoverFrame) return
    hoverFrame = requestAnimationFrame(() => {
      hoverFrame = null
      const siteId = pickMarker(event)
      canvas.style.cursor = siteId ? 'pointer' : 'grab'
    })
  }

  canvas.addEventListener('pointerdown', onPointerDown)
  canvas.addEventListener('pointerup', onPointerUp)
  canvas.addEventListener('pointermove', onPointerMove)
  canvas.addEventListener('pointerleave', () => {
    canvas.style.cursor = 'grab'
  })
  canvas.style.cursor = 'grab'

  /* -------------------------------- lifecycle ------------------------------ */

  const resizeObserver = new ResizeObserver(() => {
    cameraFrame()
    updateHelpers()
  })
  resizeObserver.observe(canvas)
  cameraFrame()

  let frameId = null
  function animate() {
    frameId = requestAnimationFrame(animate)
    controls.update()
    notifyViewChange(false)
    renderer.render(scene, camera)
  }
  animate()

  function dispose() {
    layerToken += 1
    if (frameId) cancelAnimationFrame(frameId)
    if (hoverFrame) cancelAnimationFrame(hoverFrame)
    resizeObserver.disconnect()
    canvas.removeEventListener('pointerdown', onPointerDown)
    canvas.removeEventListener('pointerup', onPointerUp)
    canvas.removeEventListener('pointermove', onPointerMove)
    disposeObject(scene)
    scene.clear()
    controls.dispose()
    renderer.dispose()
  }

  return {
    kind: '3d',
    setTerrain,
    setSites,
    setSelectedSite,
    setSunDirection,
    setEarthDirection,
    setLayers,
    setRay,
    setLabels,
    resetView,
    resize: cameraFrame,
    dispose,
  }
}
