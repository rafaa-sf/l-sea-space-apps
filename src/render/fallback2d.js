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

import {
  boxBlurGrid,
  createPolarProjection,
  hillshadeShade,
  sunDirectionVector,
  terrainColor,
} from './geo.js'
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
  const labels = { sun: 'Sun', earth: 'Earth', ...(options.labels ?? {}) }

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
  let zoom = 1
  let raster = null
  let overlayEntries = []
  let overlayToken = 0
  let placedLabels = []
  let drawQueued = false
  let disposed = false
  let lastViewInfo = { visibleMeters: Number.NaN }

  function sampleElevation(lat, lon) {
    if (typeof options.sampleElevation === 'function') {
      const value = Number(options.sampleElevation(lat, lon))
      return Number.isFinite(value) ? value : 0
    }
    return 0
  }

  /** Mask-aware box blur (two passes) for the fallback raster. */
  function smoothElevations(elevations, valid, size, passes = 2) {
    let source = Float32Array.from(elevations)
    let target = new Float32Array(source.length)
    for (let pass = 0; pass < passes; pass += 1) {
      for (let py = 0; py < size; py += 1) {
        for (let px = 0; px < size; px += 1) {
          const index = py * size + px
          if (!valid[index] || px === 0 || py === 0 || px === size - 1 || py === size - 1) {
            target[index] = source[index]
            continue
          }
          let sum = 0
          let count = 0
          for (let dy = -1; dy <= 1; dy += 1) {
            for (let dx = -1; dx <= 1; dx += 1) {
              const sample = (py + dy) * size + (px + dx)
              if (!valid[sample]) continue
              sum += source[sample]
              count += 1
            }
          }
          target[index] = count > 0 ? sum / count : source[index]
        }
      }
      const swap = source
      source = target
      target = swap
    }
    return source
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

    // De-noise the sampled elevation field before colour and gradient work.
    const smoothed = smoothElevations(elevations, valid, size, 2)
    const stats = options.terrainStats?.(terrain) ?? { minM: 0, maxM: 1 }
    const spanMeters = projectionData.spanMeters ?? 150000
    const cellMeters = (2 * spanMeters) / size
    const gradientX = new Float32Array(size * size)
    const gradientZ = new Float32Array(size * size)
    for (let py = 1; py < size - 1; py += 1) {
      for (let px = 1; px < size - 1; px += 1) {
        const index = py * size + px
        if (!valid[index]) continue
        const left = valid[index - 1] ? smoothed[index - 1] : smoothed[index]
        const right = valid[index + 1] ? smoothed[index + 1] : smoothed[index]
        const up = valid[index - size] ? smoothed[index - size] : smoothed[index]
        const down = valid[index + size] ? smoothed[index + size] : smoothed[index]
        gradientX[index] = (right - left) / (2 * cellMeters)
        gradientZ[index] = (down - up) / (2 * cellMeters)
      }
    }

    raster = { offscreen, offContext, image, elevations: smoothed, gradientX, gradientZ, valid, stats, size }
    computeShading()
  }

  function computeShading() {
    if (!raster) return
    const { size, image, valid, gradientX, gradientZ, stats } = raster
    const sun = sunDirectionVector(sunDirection?.az ?? 0, sunDirection?.el ?? 0)
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
        const normal = { x: nx / length, y: ny / length, z: nz / length }
        const shade = hillshadeShade(normal, sun, sunVisible, { ambient: 0.3, diffuse: 1.35, flatShade: 0.4 })
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

  /**
   * Draw a label if its measured box does not overlap any placed label.
   * Greedy collision detection with a subtle dark halo for legibility.
   */
  function tryLabel(text, x, y, color, font) {
    if (!text) return false
    if (x < 6 || y < 8 || x > width - 6 || y > height - 8) return false
    context.font = font
    const metrics = context.measureText(text)
    const textWidth = metrics.width
    const boxHeight = 13
    if (x + textWidth > width - 6) return false
    const rect = { left: x - 1, top: y - boxHeight / 2, right: x + textWidth + 1, bottom: y + boxHeight / 2 }
    for (const placed of placedLabels) {
      if (
        rect.left < placed.right + 3 &&
        rect.right > placed.left - 3 &&
        rect.top < placed.bottom + 2 &&
        rect.bottom > placed.top - 2
      ) {
        return false
      }
    }
    placedLabels.push(rect)
    context.textAlign = 'left'
    context.textBaseline = 'middle'
    context.lineWidth = 3
    context.strokeStyle = 'rgba(5, 7, 11, 0.72)'
    context.strokeText(text, x, y)
    context.fillStyle = color
    context.fillText(text, x, y)
    return true
  }

  /** Try the four natural label positions around a marker, nearest first. */
  function placeSiteLabel(text, point, radius, color, font) {
    const candidates = [
      [point.x + radius + 5, point.y - 1],
      [point.x - radius - 5, point.y - 1],
      [point.x + radius + 5, point.y + 13],
      [point.x + radius + 5, point.y - 15],
    ]
    for (const [x, y] of candidates) {
      if (tryLabel(text, x, y, color, font)) return true
    }
    return false
  }

  function drawSphereBackground() {
    const gradient = context.createRadialGradient(center.x, center.y, mapRadius * 0.3, center.x, center.y, Math.max(width, height) * 0.72)
    gradient.addColorStop(0, '#0a0d12')
    gradient.addColorStop(1, '#06080b')
    context.fillStyle = gradient
    context.fillRect(0, 0, width, height)
  }

  function drawMarkers() {
    if (!projectionData) return
    const selectedPoint = selectedSite ? toScreen(selectedSite.lat, selectedSite.lon) : { x: center.x, y: center.y }
    const priority = (site) =>
      site.id === selection.selectedId ? 0 : (selection.compareIds ?? []).includes(site.id) ? 1 : 2
    const distance = (site) => {
      const point = toScreen(site.lat, site.lon)
      return Math.hypot(point.x - selectedPoint.x, point.y - selectedPoint.y)
    }
    const ordered = [...sites].sort((a, b) => {
      const rank = priority(a) - priority(b)
      return rank !== 0 ? rank : distance(a) - distance(b)
    })

    // Pass 1: all markers (so later markers never paint over earlier labels).
    for (const site of ordered) {
      const point = toScreen(site.lat, site.lon)
      if (Math.hypot(point.x - center.x, point.y - center.y) > mapRadius * 1.01) continue
      const isSelected = site.id === selection.selectedId
      const isCompared = (selection.compareIds ?? []).includes(site.id)
      const radius = isSelected ? 5.5 : 4
      context.beginPath()
      context.arc(point.x, point.y, radius, 0, Math.PI * 2)
      context.fillStyle = isSelected ? COLOR_SELECTED : isCompared ? COLOR_COMPARE : COLOR_SITE
      context.fill()
      context.lineWidth = isSelected ? 2 : 1
      context.strokeStyle = 'rgba(5, 7, 12, 0.9)'
      context.stroke()
      if (isSelected) {
        context.beginPath()
        context.arc(point.x, point.y, radius + 4, 0, Math.PI * 2)
        context.strokeStyle = COLOR_SELECTED
        context.lineWidth = 1.5
        context.stroke()
      }
    }

    // Pass 2: labels, greedy, selected first, then compare sites, then nearest.
    // When the cap is dense only the selected site plus its nearest neighbours
    // are labelled to avoid a wall of text.
    const maxLabels = sites.length > 7 ? 7 : sites.length
    let labelled = 0
    for (const site of ordered) {
      const isSelected = site.id === selection.selectedId
      const isCompared = (selection.compareIds ?? []).includes(site.id)
      if (!isSelected && labelled >= maxLabels) break
      const point = toScreen(site.lat, site.lon)
      if (Math.hypot(point.x - center.x, point.y - center.y) > mapRadius * 1.01) continue
      const label = site.displayName ?? site.name
      if (!label) continue
      const color = isSelected ? COLOR_SELECTED : isCompared ? COLOR_COMPARE : '#c6d0e2'
      const font = isSelected ? '600 12px Inter, system-ui, sans-serif' : '11px Inter, system-ui, sans-serif'
      const radius = isSelected ? 5.5 : 4
      if (placeSiteLabel(label, point, radius, color, font)) labelled += 1
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

  function notifyView(force = false) {
    if (!projectionData || width <= 1 || mapRadius <= 0) return
    const rhoMaxM = projectionData.radius / Math.max(1e-9, projectionData.unitsPerMeter)
    const visibleMeters = (rhoMaxM / mapRadius) * width
    const next = { visibleMeters, widthPx: width, heightPx: height, azimuthDeg: 0 }
    if (
      !force &&
      Number.isFinite(lastViewInfo.visibleMeters) &&
      Math.abs(next.visibleMeters - lastViewInfo.visibleMeters) < next.visibleMeters * 0.01
    ) {
      return
    }
    lastViewInfo = next
    options.onViewChange?.(next)
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
      context.strokeStyle = 'rgba(148, 158, 172, 0.4)'
      context.lineWidth = 1.2
      context.stroke()
    }
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
    const cssWidth = canvas.clientWidth || 1
    const cssHeight = canvas.clientHeight || 1
    const size = Math.max(1, Math.min(cssWidth, cssHeight))
    width = size
    height = size
    canvas.width = Math.round(size * dpr)
    canvas.height = Math.round(size * dpr)
    canvas.style.width = `${size}px`
    canvas.style.height = `${size}px`
    center = { x: size / 2, y: size / 2 }
    mapRadius = size * 0.46 * zoom
    notifyView(true)
  }

  function onWheel(event) {
    if (disposed) return
    event.preventDefault()
    const factor = Math.exp(-event.deltaY * 0.0015)
    zoom = Math.min(2.6, Math.max(0.55, zoom * factor))
    mapRadius = Math.min(width, height) * 0.46 * zoom
    notifyView(true)
    requestDraw()
  }

  function setTerrain(nextTerrain) {
    if (!nextTerrain || !nextTerrain.data) return
    terrain = nextTerrain
    projectionData = createPolarProjection(terrain, { radius: 1, exaggeration: 1 })
    projectionData.spanMeters = terrainSpan(terrain)
    buildRaster()
    notifyView(true)
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
    zoom = 1
    mapRadius = Math.min(width, height) * 0.46
    notifyView(true)
    requestDraw()
  }

  function resize() {
    computeLayout()
    requestDraw()
  }

  canvas.addEventListener('pointerup', onPointerUp)
  canvas.addEventListener('pointermove', onPointerMove)
  canvas.addEventListener('wheel', onWheel, { passive: false })
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
    canvas.removeEventListener('wheel', onWheel)
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
