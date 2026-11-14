/**
 * Compute engine adapter. Loads the coder's `src/core/*.js` modules when they
 * are present and delegates every documented function to them; otherwise it
 * uses the local implementations in `./localCore.js`. A function that throws at
 * runtime also falls back, so one bug in a single core function cannot break
 * the whole UI.
 */

import { detectedModules, loadCore, withFallback } from './moduleBridge.js'
import * as localCore from './localCore.js'

let enginePromise = null

function buildEngine() {
  return Promise.all([
    loadCore('terrain'),
    loadCore('engine'),
    loadCore('ephemeris'),
    loadCore('power'),
    loadCore('comms'),
    loadCore('autopilot'),
  ]).then(([terrainMod, engineMod, ephemerisMod, powerMod, commsMod, autopilotMod]) => {
    const detected = detectedModules()
    const capability = {
      terrain: Boolean(terrainMod),
      engine: Boolean(engineMod),
      ephemeris: Boolean(ephemerisMod),
      power: Boolean(powerMod),
      comms: Boolean(commsMod),
      autopilot: Boolean(autopilotMod),
    }
    const modules = {
      core: detected.core,
      services: detected.services,
      workers: detected.workers,
      capability,
    }

    return {
      modules,
      sampleElevation: withFallback(terrainMod, 'sampleElevation'),
      slopeAt: withFallback(terrainMod, 'slopeAt'),
      findCraters: withFallback(terrainMod, 'findCraters'),
      horizonAngle: withFallback(engineMod, 'horizonAngle'),
      rayTerrainIntersection: withFallback(engineMod, 'rayTerrainIntersection', 'rayTerrainIntersection', { nullable: true }),
      isSunVisible: withFallback(engineMod, 'isSunVisible'),
      isEarthVisible: withFallback(engineMod, 'isEarthVisible'),
      sampleAt: withFallback(ephemerisMod, 'sampleAt'),
      nextSetEvent: withFallback(ephemerisMod, 'nextSetEvent', 'nextSetEvent', { nullable: true }),
      visibilityWindows: withFallback(ephemerisMod, 'visibilityWindows'),
      solarPowerEstimate: withFallback(powerMod, 'solarPowerEstimate'),
      commWindows: withFallback(commsMod, 'commWindows'),
      dataBudget: withFallback(commsMod, 'dataBudget'),
      rankSites: withFallback(autopilotMod, 'rankSites'),
      scoreSite: withFallback(autopilotMod, 'scoreSite'),
      // Local helpers that are always safe to call.
      terrainStats: localCore.terrainStats,
      createFallbackTerrain: localCore.createFallbackTerrain,
      createSyntheticEphemeris: localCore.createSyntheticEphemeris,
      normalizeTerrain: localCore.normalizeTerrain,
      normalizeEphemeris: localCore.normalizeEphemeris,
      terrainSpanMeters: localCore.terrainSpanMeters,
      reduceTerrain: localCore.reduceTerrain,
      angleDelta: localCore.angleDelta,
      localCore,
    }
  })
}

/** Resolve (once) the compute engine used by the app. */
export function getCompute() {
  if (!enginePromise) {
    enginePromise = buildEngine().catch((error) => {
      console.error('[lsea] compute engine initialisation failed', error)
      return buildEngine()
    })
  }
  return enginePromise
}
