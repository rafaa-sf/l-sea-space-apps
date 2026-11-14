/**
 * Canvas 2D fallback renderer for machines without WebGL.
 *
 * Implements the same setter interface as `moonScene.js`:
 *   setTerrain, setSites, setSelectedSite, setSunDirection, setEarthDirection,
 *   setLayers, setRay, setLabels, resetView, resize, dispose.
 *
 * The map is a top-down polar-stereographic view of the south pole with
 * hillshaded terrain, site markers and Sun/Earth azimuth indicators. The
 * elevation raster is computed once per terrain; only the shading is recomputed
 * when the Sun moves.
 */

import { createPolarProjection, createRandom, terrainColor } from './geo.js'
import { loadMoonTrekMosaic } from './moontrekTiles.js'

const COLOR_SELECTED = '#6ee7ff'
const COLOR_COMPARE = '#ffb454'
const COLOR_SITE = '#6ea8ff'
const COLOR_SUN = '#ffd166'
const COLOR_EARTH = '#7fd1ff'
const RASTER_SIZE = 480

export function createFallback2D(canvas, options = {}) {
  const context = canvas.getContext('2d')
  if (!context) throw new Error('2D canvas context is unavailable')
  const labels = { sun: 'Sun', earth: 'Earth', scaleKm: '50 km', ...(options.labels ?? {}) }

  let terrain = null
  let projectionData = null
  let sites = []
  let selection = { selectedId: null, compareIds: [] }
  let selectedSite = null
  let sunDirection = { az: 0, el: 0 }
  let earthDirection = { az: 0, el: 0 }
  let sunVisible = true
  let earthVisible = true
  let rayInfo = null
  let mapRadius = 1
  let center = { x: 0, y: 0 }
  let dpr = 1
  let width = 1
  let height = 1
  let stars = []
  let raster = null
  let overlayEntries = []
  let overlayToken = 0
  let placedLabels = []
  let drawQueued = false
  let disposed = false

  const random = createRandom(776655)

  function sampleElevation(lat, lon) {
    if (typeof options.sampleElevation === 'function') {
      const value = Number(options.sampleElevation(lat, lon))
      return Number.isFinite(value) ? value : 0
    }
    return 0
  }

  function buildRaster() {
    if (!projectionData) return
    const size = RASTER_SIZE
    const offscreen = document.createElement('canvas')
    offscreen.width = size
    offscreen.height = size
    const offContext = offscreen.getContext('2d')
    const image = offContext.createImageData(size, size)
    const elevations = new Float32Array(size * size)
    const valid = new Uint8Array(size * size)

    for (let py = 0; py < size; py += 1) {
      const sceneZ = (1 - (py + 0.5) / size) * 2 - 1
      for (let px = 0; px < size; px += 1) {
        const sceneX = ((px + 0.5) / size) * 2 - 1
        const index = py * size + px
        if (Math.hypot(sceneX, sceneZ) > 1.02) continue
        const { lat, lon } = projectionData.unproject(sceneX * projectionData.radius, sceneZ * projectionData.radius)
        elevations[index] = sampleElevation(lat, lon)
        valid[index] = 1
      }
    }

    const stats = options.terrainStats?.(terrain) ?? { minM: 0, maxM: 1 }
    const spanMeters = projectionData.spanMeters ?? 150000
    const cellMeters = (2 * spanMeters) / size
    const gradientX = new Float32Array(size * size)
    const gradientZ = new Float32Array(size * size)
    for (let py = 1; py < size - 1; py += 1) {
      for (let px = 1; px < size - 1; px += 1) {
        const index = py * size + px
        if (!valid[index]) continue
        const left = valid[index - 1] ? elevations[index - 1] : elevations[index]
        const right = valid[index + 1] ? elevations[index + 1] : elevations[index]
        const up = valid[index - size] ? elevations[index - size] : elevations[index]
        const down = valid[index + size] ? elevations[index + size] : elevations[index]
        gradientX[index] = (right - left) / (2 * cellMeters)
        gradientZ[index] = (down - up) / (2 * cellMeters)
      }
    }

    raster = { offscreen, offContext, image, elevations, gradientX, gradientZ, valid, stats, size }
    computeShading()
  }

  function computeShading() {
    if (!raster) return
    const { size, image, valid, gradientX, gradientZ, stats } = raster
    const az = (sunDirection?.az ?? 0) * (Math.PI / 180)
    const el = (sunDirection?.el ?? 0) * (Math.PI / 180)
    const light = {
      x: Math.sin(az) * Math.cos(el),
      y: Math.sin(el),
      z: Math.cos(az) * Math.cos(el),
    }
    const color = image.data
    for (let py = 0; py < size; py += 1) {
      for (let px = 0; px < size; px += 1) {
        const index = py * size + px
        const offset = index * 4
        if (!valid[index]) {
          color[offset + 3] = 0
          continue
        }
        const elevation = raster.elevations[index]
        const [r, g, b] = terrainColor(elevation, stats.minM, stats.maxM)
        const nx = -gradientX[index]
        const ny = 1
        const nz = -gradientZ[index]
        const length = Math.hypot(nx, ny, nz) || 1
        const normalY = ny / length
        const lambert = Math.max(0, (nx / length) * light.x + normalY * light.y + (nz / length) * light.z)
        const shade = 0.42 + 0.62 * lambert + 0.18 * normalY
        color[offset] = Math.min(255, r * 255 * shade)
        color[offset + 1] = Math.min(255, g * 255 * shade)
        color[offset + 2] = Math.min(255, b * 255 * shade)
        color[offset + 3] = 255
      }
    }
    raster.offContext.putImageData(image, 0, 0)
  }

  function toScreen(lat, lon) {
    const point = projectionData.project(lat, lon, 0)
    return {
      x: center.x + (point.x / projectionData.radius) * mapRadius,
      y: center.y - (point.z / projectionData.radius) * mapRadius,
    }
  }

  function fromScreen(px, py) {
    if (!projectionData) return null
    const sceneX = ((px - center.x) / mapRadius) * projectionData.radius
    const sceneZ = (-(py - center.y) / mapRadius) * projectionData.radius
    if (Math.hypot(sceneX, sceneZ) > projectionData.radius * 1.02) return null
    return projectionData.unproject(sceneX, sceneZ)
  }

  function tryLabel(text, x, y, color, font, align = 'left') {
    if (!text) return false
    context.font = font
    const width = context.measureText(text).width
    const height = 12
    const left = align === 'center' ? x - width / 2 : x
    const rect = { left, top: y - height / 2, right: left + width, bottom: y + height / 2 }
    for (const placed of placedLabels) {
      if (rect.left < placed.right + 2 && rect.right > placed.left - 2 && rect.top < placed.bottom + 1 && rect.bottom > placed.top - 1) {
        return false
      }
    }
    placedLabels.push(rect)
    context.fillStyle = color
    context.textAlign = align
    context.textBaseline = 'middle'
    context.fillText(text, x, y)
    return true
  }

  function drawSphereBackground() {
    const gradient = context.createRadialGradient(center.x, center.y, mapRadius * 0.2, center.x, center.y, Math.max(width, height) * 0.8)
    gradient.addColorStop(0, '#0d1320')
    gradient.addColorStop(1, '#05070c')
    context.fillStyle = gradient
    context.fillRect(0, 0, width, height)
    context.fillStyle = 'rgba(159, 180, 216, 0.8)'
    for (const star of stars) {
      context.beginPath()
      context.arc(star.x, star.y, star.r, 0, Math.PI * 2)
      context.fill()
    }
  }

  function drawMarkers() {
    if (!projectionData) return
    const ordered = [...sites].sort((a, b) => {
      const rank = (site) => (site.id === selection.selectedId ? 0 : (selection.compareIds ?? []).includes(site.id) ? 1 : 2)
      return rank(a) - rank(b)
    })
    for (const site of ordered) {
      const point = toScreen(site.lat, site.lon)
      const isSelected = site.id === selection.selectedId
      const isCompared = (selection.compareIds ?? []).includes(site.id)
      const radius = isSelected ? 7 : 5
      context.beginPath()
      context.arc(point.x, point.y, radius, 0, Math.PI * 2)
      context.fillStyle = isSelected ? COLOR_SELECTED : isCompared ? COLOR_COMPARE : COLOR_SITE
      context.fill()
      context.lineWidth = isSelected ? 2 : 1
      context.strokeStyle = 'rgba(5, 7, 12, 0.9)'
      context.stroke()

      if (isSelected) {
        context.beginPath()
        context.arc(point.x, point.y, radius + 6, 0, Math.PI * 2)
        context.strokeStyle = COLOR_SELECTED
        context.lineWidth = 1.5
        context.stroke()
      }

      const label = site.displayName ?? site.name
      if (!label) continue
      const color = isSelected ? COLOR_SELECTED : isCompared ? COLOR_COMPARE : '#c6d0e2'
      const font = isSelected ? '600 12px Inter, system-ui, sans-serif' : '11px Inter, system-ui, sans-serif'
      if (!tryLabel(label, point.x + radius + 5, point.y - 1, color, font)) {
        if (isSelected || isCompared) tryLabel(label, point.x + radius + 5, point.y + 13, color, font)
      }
    }
  }

  function drawDirectionArrow(direction, color, text, visible, distanceFactor) {
    if (!selectedSite || !projectionData) return
    const origin = toScreen(selectedSite.lat, selectedSite.lon)
    const az = (direction.az * Math.PI) / 180
    const length = mapRadius * distanceFactor * Math.max(0.35, visible ? 1 : 0.7)
    const dx = Math.sin(az) * length
    const dy = -Math.cos(az) * length
    const tip = { x: origin.x + dx, y: origin.y + dy }
    context.setLineDash(visible ? [] : [5, 5])
    context.strokeStyle = color
    context.lineWidth = 1.2
    context.beginPath()
    context.moveTo(origin.x, origin.y)
    context.lineTo(tip.x, tip.y)
    context.stroke()
    context.setLineDash([])
    const angle = Math.atan2(dy, dx)
    context.beginPath()
    context.moveTo(tip.x, tip.y)
    context.lineTo(tip.x - 9 * Math.cos(angle - 0.4), tip.y - 9 * Math.sin(angle - 0.4))
    context.lineTo(tip.x - 9 * Math.cos(angle + 0.4), tip.y - 9 * Math.sin(angle + 0.4))
    context.closePath()
    context.fillStyle = color
    context.fill()
    const font = '600 11px Inter, system-ui, sans-serif'
    if (!tryLabel(text, tip.x + 6, tip.y + 3, color, font)) {
      tryLabel(text, tip.x + 6, tip.y - 11, color, font)
    }
  }

  function drawRay() {
    if (!rayInfo || !selectedSite || !projectionData) return
    const origin = toScreen(selectedSite.lat, selectedSite.lon)
    let endpoint
    if (rayInfo.hit && Number.isFinite(rayInfo.hit.lat)) {
      endpoint = toScreen(rayInfo.hit.lat, rayInfo.hit.lon)
    } else {
      const az = (rayInfo.azimuth * Math.PI) / 180
      const length = mapRadius * 0.55
      endpoint = { x: origin.x + Math.sin(az) * length, y: origin.y - Math.cos(az) * length }
    }
    context.setLineDash([4, 4])
    context.strokeStyle = rayInfo.hit ? '#ff9e64' : 'rgba(255, 209, 102, 0.8)'
    context.lineWidth = 1.4
    context.beginPath()
    context.moveTo(origin.x, origin.y)
    context.lineTo(endpoint.x, endpoint.y)
    context.stroke()
    context.setLineDash([])
    if (rayInfo.hit) {
      context.beginPath()
      context.arc(endpoint.x, endpoint.y, 3.5, 0, Math.PI * 2)
      context.fillStyle = '#ff9e64'
      context.fill()
    }
  }

  function drawReference() {
    if (!projectionData) return
    for (const fraction of [0.33, 0.66, 1]) {
      context.beginPath()
      context.arc(center.x, center.y, mapRadius * fraction, 0, Math.PI * 2)
      context.strokeStyle = 'rgba(110, 168, 255, 0.16)'
      context.lineWidth = 1
      context.stroke()
    }
    // Scale bar: 50 km (or a tenth of the map width, whichever is smaller).
    const spanMeters = projectionData.spanMeters ?? 150000
    const barMeters = 50000
    const barPx = (barMeters / (spanMeters / 2)) * mapRadius
    const startX = 18
    const startY = height - 26
    context.strokeStyle = 'rgba(232, 236, 244, 0.75)'
    context.lineWidth = 1.5
    context.beginPath()
    context.moveTo(startX, startY)
    context.lineTo(startX + barPx, startY)
    context.moveTo(startX, startY - 4)
    context.lineTo(startX, startY + 4)
    context.moveTo(startX + barPx, startY - 4)
    context.lineTo(startX + barPx, startY + 4)
    context.stroke()
    context.font = '11px Inter, system-ui, sans-serif'
    context.fillStyle = 'rgba(232, 236, 244, 0.8)'
    context.textAlign = 'left'
    context.fillText(labels.scaleKm, startX + 2, startY - 9)
  }

  function draw() {
    if (disposed) return
    drawQueued = false
    context.setTransform(dpr, 0, 0, dpr, 0, 0)
    placedLabels = []
    drawSphereBackground()
    if (raster) {
      context.save()
      context.beginPath()
      context.arc(center.x, center.y, mapRadius, 0, Math.PI * 2)
      context.clip()
      context.imageSmoothingEnabled = true
      context.drawImage(raster.offscreen, center.x - mapRadius, center.y - mapRadius, mapRadius * 2, mapRadius * 2)
      const rhoMax = projectionData.radius / Math.max(1e-9, projectionData.unitsPerMeter)
      for (const entry of overlayEntries) {
        const bounds = entry.mosaic.boundsM
        const x0 = center.x + (bounds.minX / rhoMax) * mapRadius
        const x1 = center.x + (bounds.maxX / rhoMax) * mapRadius
        const y0 = center.y - (bounds.maxY / rhoMax) * mapRadius
        const y1 = center.y - (bounds.minY / rhoMax) * mapRadius
        context.globalAlpha = entry.layer.opacity ?? 0.7
        context.drawImage(entry.mosaic.canvas, x0, y0, x1 - x0, y1 - y0)
      }
      context.globalAlpha = 1
      context.restore()
      context.beginPath()
      context.arc(center.x, center.y, mapRadius, 0, Math.PI * 2)
      context.strokeStyle = 'rgba(110, 168, 255, 0.5)'
      context.lineWidth = 1.5
      context.stroke()
    }
    drawReference()
    drawRay()
    drawMarkers()
    if (sunDirection) drawDirectionArrow(sunDirection, COLOR_SUN, labels.sun, sunVisible, 0.28)
    if (earthDirection) drawDirectionArrow(earthDirection, COLOR_EARTH, labels.earth, earthVisible, 0.22)
  }

  function requestDraw() {
    if (drawQueued || disposed) return
    drawQueued = true
    requestAnimationFrame(draw)
  }

  function computeLayout() {
    dpr = Math.min(window.devicePixelRatio || 1, 2)
    width = canvas.clientWidth || 1
    height = canvas.clientHeight || 1
    canvas.width = Math.round(width * dpr)
    canvas.height = Math.round(height * dpr)
    center = { x: width / 2, y: height / 2 }
    mapRadius = Math.min(width, height) * 0.46
    stars = []
    for (let i = 0; i < 90; i += 1) {
      stars.push({ x: random() * width, y: random() * height, r: random() * 1.2 + 0.3 })
    }
  }

  function setTerrain(nextTerrain) {
    if (!nextTerrain || !nextTerrain.data) return
    terrain = nextTerrain
    projectionData = createPolarProjection(terrain, { radius: 1, exaggeration: 1 })
    projectionData.spanMeters = terrainSpan(terrain)
    buildRaster()
    requestDraw()
  }

  function terrainSpan(nextTerrain) {
    const extent = projectionData
      ? 2 * 1737400 * Math.tan(((projectionData.maxColat * Math.PI) / 180) / 2)
      : 150000
    return extent
  }

  function setSites(nextSites, nextOptions = {}) {
    sites = Array.isArray(nextSites) ? nextSites : []
    selection = {
      selectedId: nextOptions.selectedId ?? selection.selectedId,
      compareIds: nextOptions.compareIds ?? selection.compareIds ?? [],
    }
    selectedSite = sites.find((site) => site.id === selection.selectedId) ?? null
    requestDraw()
  }

  function setSelectedSite(id) {
    selection.selectedId = id
    selectedSite = sites.find((site) => site.id === id) ?? null
    requestDraw()
  }

  function setSunDirection(sun, visible = true) {
    sunDirection = sun ? { az: Number(sun.az) || 0, el: Number(sun.el) || 0 } : null
    sunVisible = Boolean(visible)
    computeShading()
    requestDraw()
  }

  function setEarthDirection(earth, visible = true) {
    earthDirection = earth ? { az: Number(earth.az) || 0, el: Number(earth.el) || 0 } : null
    earthVisible = Boolean(visible)
    requestDraw()
  }

  function setRay(nextRay) {
    rayInfo = nextRay
    requestDraw()
  }

  function setLayers(layers = [], enabledIds = []) {
    const token = (overlayToken += 1)
    overlayEntries = []
    requestDraw()
    if (!projectionData) return
    const enabled = new Set(enabledIds)
    const rhoMax = projectionData.radius / Math.max(1e-9, projectionData.unitsPerMeter)
    const bounds = { minX: -rhoMax, maxX: rhoMax, minY: -rhoMax, maxY: rhoMax }
    for (const layer of layers) {
      if (!enabled.has(layer.id)) continue
      if (layer.type !== 'wmts' || !layer.available) continue
      options.onLayerStatus?.(layer.id, { available: false, loading: true })
      loadMoonTrekMosaic(layer, bounds, { maxTiles: 16 })
        .then((mosaic) => {
          if (token !== overlayToken) return
          if (!mosaic) {
            options.onLayerStatus?.(layer.id, { available: false, reason: 'tiles' })
            return
          }
          overlayEntries.push({ layer, mosaic })
          options.onLayerStatus?.(layer.id, {
            available: true,
            zoom: mosaic.zoom,
            tiles: `${mosaic.loaded}/${mosaic.total}`,
          })
          requestDraw()
        })
        .catch(() => {
          if (token === overlayToken) options.onLayerStatus?.(layer.id, { available: false, reason: 'tiles' })
        })
    }
  }

  function setLabels(nextLabels) {
    Object.assign(labels, nextLabels ?? {})
    requestDraw()
  }

  function pointerPosition(event) {
    const rect = canvas.getBoundingClientRect()
    return { x: event.clientX - rect.left, y: event.clientY - rect.top }
  }

  function findMarker(point) {
    let best = null
    let bestDistance = 16
    for (const site of sites) {
      const screen = toScreen(site.lat, site.lon)
      const distance = Math.hypot(screen.x - point.x, screen.y - point.y)
      if (distance < bestDistance) {
        best = site
        bestDistance = distance
      }
    }
    return best
  }

  function onPointerUp(event) {
    const point = pointerPosition(event)
    const site = findMarker(point)
    if (site) {
      options.onPickSite?.(site.id)
      return
    }
    const coordinates = fromScreen(point.x, point.y)
    if (coordinates) options.onPickLocation?.(coordinates)
  }

  function onPointerMove(event) {
    if (!disposed) {
      const point = pointerPosition(event)
      canvas.style.cursor = findMarker(point) ? 'pointer' : 'crosshair'
    }
  }

  function resetView() {
    requestDraw()
  }

  function resize() {
    computeLayout()
    requestDraw()
  }

  canvas.addEventListener('pointerup', onPointerUp)
  canvas.addEventListener('pointermove', onPointerMove)
  canvas.style.cursor = 'crosshair'
  const resizeObserver = new ResizeObserver(() => resize())
  resizeObserver.observe(canvas)
  computeLayout()
  requestDraw()

  function dispose() {
    disposed = true
    resizeObserver.disconnect()
    canvas.removeEventListener('pointerup', onPointerUp)
    canvas.removeEventListener('pointermove', onPointerMove)
    raster = null
    sites = []
    terrain = null
    overlayEntries = []
    overlayToken += 1
  }

  return {
    kind: '2d',
    setTerrain,
    setSites,
    setSelectedSite,
    setSunDirection,
    setEarthDirection,
    setLayers,
    setRay,
    setLabels,
    resetView,
    resize,
    dispose,
  }
}
