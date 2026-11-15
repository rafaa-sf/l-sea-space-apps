/**
 * Canvas 2D fallback renderer (rectangular planar DEM).
 *
 * Same public API as `moonScene.js`:
 *   setTerrain, setSites, setSelectedSite, setSunDirection, setEarthDirection,
 *   setLayers, setRay, setLabels, resetView, resize, dispose.
 *
 * The map shows the full rectangular LOLA DEM extent with the same horizontal
 * scale as the 3D view, a Sun-driven hillshade and the hypsometric tint. Wheel
 * zoom is supported and the scale is reported through `options.onViewChange`.
 */

import {
  boxBlurGrid,
  createPlanarTerrain,
  hillshadeShade,
  lonLatToPlanarMeters,
  planarToLonLat,
  sunDirectionVector,
  terrainColor,
} from './geo.js'
import { coverageKm, intersectBounds, loadMoonTrekMosaic, parseLayerBounds } from './moontrekTiles.js'

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
  let planar = null
  let sites = []
  let selection = { selectedId: null, compareIds: [] }
  let selectedSite = null
  let sunDirection = { az: 0, el: 0 }
  let earthDirection = { az: 0, el: 0 }
  let sunVisible = true
  let earthVisible = true
  let rayInfo = null
  let zoom = 1
  let widthPx = 1
  let heightPx = 1
  let dpr = 1
  let mapRect = { x: 0, y: 0, w: 1, h: 1 }
  let scale = 1
  let raster = null
  let overlayEntries = []
  let overlayFootprints = []
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

  function samplePlanar(xMeters, yMeters) {
    if (!planar) return 0
    const { bounds, cols, rows, data } = planar
    const fx = Math.min(cols - 1, Math.max(0, ((xMeters - bounds.minX) / Math.max(1e-9, planar.widthM)) * (cols - 1)))
    const fy = Math.min(rows - 1, Math.max(0, ((bounds.maxY - yMeters) / Math.max(1e-9, planar.heightM)) * (rows - 1)))
    const x0 = Math.floor(fx)
    const y0 = Math.floor(fy)
    const x1 = Math.min(x0 + 1, cols - 1)
    const y1 = Math.min(y0 + 1, rows - 1)
    const tx = fx - x0
    const ty = fy - y0
    const top = data[y0 * cols + x0] + (data[y0 * cols + x1] - data[y0 * cols + x0]) * tx
    const bottom = data[y1 * cols + x0] + (data[y1 * cols + x1] - data[y1 * cols + x0]) * tx
    return top + (bottom - top) * ty
  }

  function planarPoint(lat, lon) {
    return lonLatToPlanarMeters(lat, lon, planar?.datum ?? 1737400)
  }

  function toScreen(lat, lon) {
    if (!planar) return { x: 0, y: 0 }
    const point = planarPoint(lat, lon)
    return {
      x: mapRect.x + (point.x - planar.bounds.minX) * scale,
      y: mapRect.y + (planar.bounds.maxY - point.y) * scale,
    }
  }

  function fromScreen(px, py) {
    if (!planar) return null
    if (px < mapRect.x || py < mapRect.y || px > mapRect.x + mapRect.w || py > mapRect.y + mapRect.h) return null
    const xMeters = planar.bounds.minX + (px - mapRect.x) / scale
    const yMeters = planar.bounds.maxY - (py - mapRect.y) / scale
    return planarToLonLat(xMeters, yMeters, planar.datum)
  }

  function updateMapRect() {
    if (!planar) return
    scale = Math.min(widthPx / planar.widthM, heightPx / planar.heightM) * zoom
    const w = planar.widthM * scale
    const h = planar.heightM * scale
    mapRect = { x: (widthPx - w) / 2, y: (heightPx - h) / 2, w, h }
    if (zoom > 1.001 && planar) {
      const selected = sites.find((site) => site.id === selection.selectedId)
      if (selected) {
        const point = planarPoint(selected.lat, selected.lon)
        mapRect.x = widthPx / 2 - (point.x - planar.bounds.minX) * scale
        mapRect.y = heightPx / 2 - (planar.bounds.maxY - point.y) * scale
      }
    }
  }

  function notifyView(force = false) {
    if (!planar || widthPx <= 1) return
    const visibleMeters = widthPx / scale
    const next = { visibleMeters, widthPx, heightPx, azimuthDeg: 0 }
    if (!force && Number.isFinite(lastViewInfo.visibleMeters)) {
      if (Math.abs(next.visibleMeters - lastViewInfo.visibleMeters) < next.visibleMeters * 0.01) return
    }
    lastViewInfo = next
    options.onViewChange?.(next)
  }

  function smoothGrid(values, width, height, passes = 2) {
    let source = Float32Array.from(values)
    let target = new Float32Array(source.length)
    for (let pass = 0; pass < passes; pass += 1) {
      for (let row = 0; row < height; row += 1) {
        for (let col = 0; col < width; col += 1) {
          const index = row * width + col
          let sum = 0
          let count = 0
          for (let dy = -1; dy <= 1; dy += 1) {
            for (let dx = -1; dx <= 1; dx += 1) {
              const rr = Math.min(height - 1, Math.max(0, row + dy))
              const cc = Math.min(width - 1, Math.max(0, col + dx))
              sum += source[rr * width + cc]
              count += 1
            }
          }
          target[index] = sum / count
        }
      }
      const swap = source
      source = target
      target = swap
    }
    return source
  }

  function buildRaster() {
    if (!planar) return
    const rasterW = Math.max(64, Math.min(960, Math.round(widthPx)))
    const rasterH = Math.max(64, Math.min(960, Math.round(rasterW * (heightPx / Math.max(1, widthPx)))))
    const offscreen = document.createElement('canvas')
    offscreen.width = rasterW
    offscreen.height = rasterH
    const offContext = offscreen.getContext('2d')
    const image = offContext.createImageData(rasterW, rasterH)
    const factorX = rasterW / Math.max(1, widthPx)
    const factorY = rasterH / Math.max(1, heightPx)
    const rasterRect = { x: mapRect.x * factorX, y: mapRect.y * factorY, w: mapRect.w * factorX, h: mapRect.h * factorY }
    const elevations = new Float32Array(rasterW * rasterH)
    const valid = new Uint8Array(rasterW * rasterH)
    for (let py = 0; py < rasterH; py += 1) {
      const yMeters = planar.bounds.maxY - (py - rasterRect.y) / (scale * factorY)
      for (let px = 0; px < rasterW; px += 1) {
        if (px < rasterRect.x - 1 || px > rasterRect.x + rasterRect.w + 1 || py < rasterRect.y - 1 || py > rasterRect.y + rasterRect.h + 1) continue
        const xMeters = planar.bounds.minX + (px - rasterRect.x) / (scale * factorX)
        const index = py * rasterW + px
        elevations[index] = samplePlanar(xMeters, yMeters)
        valid[index] = 1
      }
    }
    const smoothed = smoothGrid(elevations, rasterW, rasterH, 2)
    const stats = options.terrainStats?.(terrain) ?? { minM: 0, maxM: 1 }
    const cellX = 1 / (scale * factorX)
    const cellY = 1 / (scale * factorY)
    const gradientX = new Float32Array(rasterW * rasterH)
    const gradientZ = new Float32Array(rasterW * rasterH)
    for (let py = 1; py < rasterH - 1; py += 1) {
      for (let px = 1; px < rasterW - 1; px += 1) {
        const index = py * rasterW + px
        if (!valid[index]) continue
        gradientX[index] = (smoothed[index + 1] - smoothed[index - 1]) / (2 * cellX)
        gradientZ[index] = (smoothed[index + rasterW] - smoothed[index - rasterW]) / (2 * cellY)
      }
    }
    raster = { offscreen, offContext, image, elevations: smoothed, gradientX, gradientZ, valid, stats, width: rasterW, height: rasterH }
    computeShading()
  }

  function computeShading() {
    if (!raster) return
    const { width: rasterW, height: rasterH, image, valid, gradientX, gradientZ, stats } = raster
    // Fixed cartographic light: stable when the selected POI/date changes.
    const sun = sunDirectionVector(315, 45)
    const color = image.data
    for (let index = 0; index < rasterW * rasterH; index += 1) {
      const offset = index * 4
      if (!valid[index]) {
        color[offset + 3] = 0
        continue
      }
      const [r, g, b] = terrainColor(raster.elevations[index], stats.minM, stats.maxM)
      const nx = -gradientX[index]
      const ny = 1
      const nz = -gradientZ[index]
      const length = Math.hypot(nx, ny, nz) || 1
      const normal = { x: nx / length, y: ny / length, z: nz / length }
      const shade = hillshadeShade(normal, sun, true, { ambient: 0.3, diffuse: 1.35, flatShade: 0.4 })
      color[offset] = Math.min(255, r * 255 * shade)
      color[offset + 1] = Math.min(255, g * 255 * shade)
      color[offset + 2] = Math.min(255, b * 255 * shade)
      color[offset + 3] = 255
    }
    raster.offContext.putImageData(image, 0, 0)
  }

  function tryLabel(text, x, y, color, font) {
    if (!text || x < 6 || y < 10 || x > widthPx - 6 || y > heightPx - 10) return false
    context.font = font
    const textWidth = context.measureText(text).width
    if (x + textWidth > widthPx - 6) return false
    const box = { left: x - 1, top: y - 7, right: x + textWidth + 1, bottom: y + 7 }
    for (const placed of placedLabels) {
      if (box.left < placed.right + 3 && box.right > placed.left - 3 && box.top < placed.bottom + 2 && box.bottom > placed.top - 2) return false
    }
    placedLabels.push(box)
    context.textAlign = 'left'
    context.textBaseline = 'middle'
    context.lineWidth = 3
    context.strokeStyle = 'rgba(5, 7, 11, 0.75)'
    context.strokeText(text, x, y)
    context.fillStyle = color
    context.fillText(text, x, y)
    return true
  }

  function placeLabel(text, point, radius, color, font) {
    const candidates = [
      [point.x + radius + 5, point.y - 1],
      [point.x - radius - 5, point.y - 1],
      [point.x + radius + 5, point.y + 13],
      [point.x + radius + 5, point.y - 15],
    ]
    for (const [x, y] of candidates) if (tryLabel(text, x, y, color, font)) return true
    return false
  }

  function drawBackground() {
    const gradient = context.createLinearGradient(0, 0, 0, heightPx)
    gradient.addColorStop(0, '#0a0d12')
    gradient.addColorStop(1, '#06080b')
    context.fillStyle = gradient
    context.fillRect(0, 0, widthPx, heightPx)
  }

  function drawMarkers() {
    if (!planar) return
    const selectedPoint = selectedSite ? toScreen(selectedSite.lat, selectedSite.lon) : { x: widthPx / 2, y: heightPx / 2 }
    const priority = (site) => (site.id === selection.selectedId ? 0 : (selection.compareIds ?? []).includes(site.id) ? 1 : 2)
    const ordered = [...sites].sort((a, b) => {
      const rank = priority(a) - priority(b)
      if (rank !== 0) return rank
      const pa = toScreen(a.lat, a.lon)
      const pb = toScreen(b.lat, b.lon)
      return Math.hypot(pa.x - selectedPoint.x, pa.y - selectedPoint.y) - Math.hypot(pb.x - selectedPoint.x, pb.y - selectedPoint.y)
    })
    for (const site of ordered) {
      const point = toScreen(site.lat, site.lon)
      if (point.x < mapRect.x || point.x > mapRect.x + mapRect.w || point.y < mapRect.y || point.y > mapRect.y + mapRect.h) continue
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
    const maxLabels = sites.length > 7 ? 7 : sites.length
    let labelled = 0
    for (const site of ordered) {
      if (site.id !== selection.selectedId && labelled >= maxLabels) break
      const point = toScreen(site.lat, site.lon)
      if (point.x < mapRect.x || point.x > mapRect.x + mapRect.w || point.y < mapRect.y || point.y > mapRect.y + mapRect.h) continue
      const isSelected = site.id === selection.selectedId
      const isCompared = (selection.compareIds ?? []).includes(site.id)
      const label = site.displayName ?? site.name
      if (!label) continue
      const color = isSelected ? COLOR_SELECTED : isCompared ? COLOR_COMPARE : '#c6d0e2'
      const font = isSelected ? '600 12px Inter, system-ui, sans-serif' : '11px Inter, system-ui, sans-serif'
      if (placeLabel(label, point, isSelected ? 5.5 : 4, color, font)) labelled += 1
    }
  }

  function drawDirectionArrow(direction, color, text, visible, distanceFactor) {
    if (!selectedSite) return
    const origin = toScreen(selectedSite.lat, selectedSite.lon)
    const az = (direction.az * Math.PI) / 180
    const length = Math.min(mapRect.w, mapRect.h) * distanceFactor * Math.max(0.35, visible ? 1 : 0.7)
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
    if (!tryLabel(text, tip.x + 6, tip.y + 3, color, font)) tryLabel(text, tip.x + 6, tip.y - 11, color, font)
  }

  function drawRay() {
    if (!rayInfo || !selectedSite) return
    const origin = toScreen(selectedSite.lat, selectedSite.lon)
    let endpoint
    if (rayInfo.hit && Number.isFinite(rayInfo.hit.lat)) endpoint = toScreen(rayInfo.hit.lat, rayInfo.hit.lon)
    else {
      const az = (rayInfo.azimuth * Math.PI) / 180
      const length = Math.min(mapRect.w, mapRect.h) * 0.55
      endpoint = { x: origin.x + Math.sin(az) * length, y: origin.y - Math.cos(az) * length }
    }
    context.setLineDash([4, 4])
    context.strokeStyle = rayInfo.hit ? '#ff9e64' : 'rgba(255, 209, 102, 0.8)'
    context.lineWidth = 1.3
    context.beginPath()
    context.moveTo(origin.x, origin.y)
    context.lineTo(endpoint.x, endpoint.y)
    context.stroke()
    context.setLineDash([])
    if (rayInfo.hit) {
      context.beginPath()
      context.arc(endpoint.x, endpoint.y, 3, 0, Math.PI * 2)
      context.fillStyle = '#ff9e64'
      context.fill()
    }
  }

  function draw() {
    if (disposed) return
    drawQueued = false
    context.setTransform(dpr, 0, 0, dpr, 0, 0)
    placedLabels = []
    drawBackground()
    if (raster) context.drawImage(raster.offscreen, mapRect.x, mapRect.y, mapRect.w, mapRect.h)
    if (planar) {
      for (const entry of overlayEntries) {
        const bounds = entry.mosaic.boundsM
        const x0 = mapRect.x + (bounds.minX - planar.bounds.minX) * scale
        const x1 = mapRect.x + (bounds.maxX - planar.bounds.minX) * scale
        const y0 = mapRect.y + (planar.bounds.maxY - bounds.maxY) * scale
        const y1 = mapRect.y + (planar.bounds.maxY - bounds.minY) * scale
        context.globalAlpha = entry.layer.opacity ?? 0.7
        context.drawImage(entry.mosaic.canvas, x0, y0, x1 - x0, y1 - y0)
      }
      context.globalAlpha = 1
      for (const footprint of overlayFootprints) {
        const bounds = footprint.bounds
        const x0 = mapRect.x + (bounds.minX - planar.bounds.minX) * scale
        const x1 = mapRect.x + (bounds.maxX - planar.bounds.minX) * scale
        const y0 = mapRect.y + (planar.bounds.maxY - bounds.maxY) * scale
        const y1 = mapRect.y + (planar.bounds.maxY - bounds.minY) * scale
        context.setLineDash([5, 4])
        context.strokeStyle = 'rgba(190, 202, 216, 0.55)'
        context.lineWidth = 1
        context.strokeRect(x0, y0, x1 - x0, y1 - y0)
        context.setLineDash([])
      }
      context.strokeStyle = 'rgba(150, 162, 176, 0.55)'
      context.lineWidth = 1
      context.strokeRect(mapRect.x, mapRect.y, mapRect.w, mapRect.h)
    }
    drawRay()
    drawMarkers()
    if (sunDirection) drawDirectionArrow(sunDirection, COLOR_SUN, labels.sun, sunVisible, 0.3)
    if (earthDirection) drawDirectionArrow(earthDirection, COLOR_EARTH, labels.earth, earthVisible, 0.24)
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
    widthPx = Math.max(1, cssWidth)
    heightPx = Math.max(1, cssHeight)
    canvas.width = Math.round(widthPx * dpr)
    canvas.height = Math.round(heightPx * dpr)
    updateMapRect()
    notifyView(true)
  }

  function onWheel(event) {
    if (disposed) return
    event.preventDefault()
    zoom = Math.min(2.6, Math.max(0.55, zoom * Math.exp(-event.deltaY * 0.0015)))
    updateMapRect()
    notifyView(true)
    requestDraw()
  }

  function setTerrain(nextTerrain) {
    if (!nextTerrain || !nextTerrain.data) return
    terrain = nextTerrain
    planar = createPlanarTerrain(nextTerrain, { maxSamples: 65536 })
    if (!planar) return
    updateMapRect()
    buildRaster()
    notifyView(true)
    requestDraw()
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
    // Terrain shading is fixed; only the Sun/Earth overlays update.
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
    overlayFootprints = []
    requestDraw()
    if (!planar) return
    const enabled = new Set(enabledIds)
    const region = planar.bounds
    for (const layer of layers) {
      if (!enabled.has(layer.id)) continue
      if (layer.type !== 'wmts' || !layer.available) continue
      const layerBounds = parseLayerBounds(layer)
      const visibleBounds = layerBounds ? intersectBounds(layerBounds, region) : region
      if (!visibleBounds) {
        options.onLayerStatus?.(layer.id, { available: false, reason: 'no-overlap' })
        continue
      }
      overlayFootprints.push({ layerId: layer.id, bounds: visibleBounds })
      options.onLayerStatus?.(layer.id, { available: false, loading: true })
      loadMoonTrekMosaic(layer, region, { maxTiles: 64 })
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
            coverageKm: mosaic.coverageKm,
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
    if (disposed) return
    canvas.style.cursor = findMarker(pointerPosition(event)) ? 'pointer' : 'crosshair'
  }

  function getZoom() {
    return Math.min(1, Math.max(0, (zoom - 0.55) / (2.6 - 0.55)))
  }

  function setZoom(ratio) {
    const clamped = Math.min(1, Math.max(0, Number(ratio) || 0))
    zoom = 0.55 + clamped * (2.6 - 0.55)
    updateMapRect()
    notifyView(true)
    requestDraw()
  }

  function zoomBy(step) {
    setZoom(getZoom() + Number(step || 0))
  }

  function resetView() {
    zoom = 1
    updateMapRect()
    notifyView(true)
    requestDraw()
  }

  function resize() {
    computeLayout()
    buildRaster()
    requestDraw()
  }

  canvas.addEventListener('pointerup', onPointerUp)
  canvas.addEventListener('pointermove', onPointerMove)
  canvas.addEventListener('wheel', onWheel, { passive: false })
  canvas.style.cursor = 'crosshair'
  const resizeObserver = new ResizeObserver(() => resize())
  resizeObserver.observe(canvas)
  computeLayout()

  function dispose() {
    disposed = true
    overlayToken += 1
    resizeObserver.disconnect()
    canvas.removeEventListener('pointerup', onPointerUp)
    canvas.removeEventListener('pointermove', onPointerMove)
    canvas.removeEventListener('wheel', onWheel)
    raster = null
    sites = []
    terrain = null
    overlayEntries = []
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
