/**
 * Landing-zone ranking integration.
 *
 * Coder's modules (`src/core/zones.js`, `src/core/zoneAutopilot.js`) are loaded
 * lazily through `moduleBridge`, so the UI keeps working (graceful fallback) if
 * they are not present yet. Zone entries follow the agreed contract:
 *   { zone: { id, name, lat, lon, areaKm2, meanSlopeDeg, maxSlopeDeg,
 *             elevationM, reliefM, cellCount, ... },
 *     rank, score, grade, reasons, warnings, ephemerisSiteId, ... }
 */

import { detectedModules, loadCore } from './moduleBridge.js'

let apiPromise = null

/** Feature-detect coder's landing-zone API. Resolves to `{ available, ... }`. */
export function getLandingZonesApi() {
  if (!apiPromise) {
    apiPromise = Promise.all([loadCore('zones'), loadCore('zoneAutopilot')]).then(([zones, zoneAutopilot]) => {
      const available = typeof zoneAutopilot?.rankLandingZones === 'function'
      if (!available) {
        console.warn('[lsea] landing zones unavailable', {
          zones: Boolean(zones),
          zoneAutopilot: Boolean(zoneAutopilot),
          core: detectedModules().core,
        })
      }
      return {
      available,
      detectLandingZones: zones?.detectLandingZones ?? null,
      rankLandingZones: zoneAutopilot?.rankLandingZones ?? null,
      landingZoneToSite: zoneAutopilot?.landingZoneToSite ?? null,
      }
    })
  }
  return apiPromise
}

/** Local fallback: circular site equivalent for a landing zone. */
export function fallbackLandingZoneToSite(zone, { mastM = 10 } = {}) {
  const areaM2 = Math.max(1000, (Number(zone?.areaKm2) || 1) * 1e6)
  return {
    id: `zone-${zone?.id ?? 'unknown'}`,
    name: zone?.name ?? zone?.id ?? 'Landing zone',
    lat: Number(zone?.lat) || 0,
    lon: Number(zone?.lon) || 0,
    elevationM: Number.isFinite(Number(zone?.elevationM)) ? Number(zone.elevationM) : null,
    source: 'custom',
    perimeterM: Math.round(2 * Math.sqrt(Math.PI * areaM2)),
    mastM,
    zoneId: zone?.id ?? null,
  }
}

/** Resolve the coder's `landingZoneToSite` when present, else the fallback. */
export async function zoneToSite(zone, options = {}) {
  const api = await getLandingZonesApi()
  if (typeof api.landingZoneToSite === 'function') {
    try {
      const site = api.landingZoneToSite(zone, options)
      if (site) return { ...site, zoneId: zone?.id ?? null }
    } catch (error) {
      console.warn('[lsea] landingZoneToSite failed, using fallback', error)
    }
  }
  return fallbackLandingZoneToSite(zone, options)
}
