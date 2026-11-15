/**
 * Unit tests for the full landing-zone mission metrics: thermal model, power in
 * Watts/Wh, illumination/eclipse windows, comms gaps, safety/ellipse/hazard,
 * scoring weights, mission defaults and the recomputation input signature.
 *
 * Synthetic analytic fixtures only (no dependency on `public/data`).
 */

import { describe, expect, it } from 'vitest'
import { DEG, MOON_RADIUS_M } from './geometry.js'
import { createProjectedTerrain } from './terrain.js'
import { normalizeEphemerisDataset } from './ephemeris.js'
import { normalizeMission } from './autopilot.js'
import {
  LANDING_MODEL_VERSION,
  LANDING_SCORE_WEIGHTS,
  STEFAN_BOLTZMANN,
  computeCommsMetrics,
  computeIlluminationMetrics,
  computeInputSignature,
  computeLandingMetrics,
  computePowerMetrics,
  computeSafetyMetrics,
  computeThermalMetrics,
  evaluateZoneFeasibility,
  gapStatistics,
  normalizeLandingWeights,
  surfaceEquilibriumTemperatureC,
  windowsToGaps,
} from './landingMetrics.js'

/** Build a flat (or analytic) planar DEM at the south pole. */
function makePlane({ width = 64, height = 64, bounds = 3200, elevationFn = () => 0 } = {}) {
  const pixelSizeM = (2 * bounds) / width
  const data = new Float32Array(width * height)
  for (let row = 0; row < height; row += 1) {
    for (let col = 0; col < width; col += 1) {
      data[row * width + col] = elevationFn(-bounds + (col + 0.5) * pixelSizeM, bounds - (row + 0.5) * pixelSizeM)
    }
  }
  return createProjectedTerrain(
    {
      id: 'metrics-test',
      referenceRadiusM: MOON_RADIUS_M,
      width,
      height,
      pixelSizeM,
      minX: -bounds,
      maxX: bounds,
      minY: -bounds,
      maxY: bounds,
      dtype: 'float32',
      synthetic: true,
    },
    data,
  )
}

const START = Date.parse('2026-11-01T00:00:00Z')

/**
 * Synthetic 24-hour ephemeris with caller-controlled Sun/Earth positions.
 *
 * @param {{sun?: (index: number) => {az: number, el: number}, earth?: (index: number) => {az: number, el: number}, hours?: number}} [options]
 */
function makeEphemeris({ sun, earth, hours = 24 } = {}) {
  const samples = []
  for (let index = 0; index <= (hours * 60) / 30; index += 1) {
    samples.push({
      time: new Date(START + index * 30 * 60 * 1000).toISOString(),
      sun: sun ? sun(index) : { az: 270, el: 1.5 },
      earth: earth ? earth(index) : { az: 90, el: 2 },
    })
  }
  return normalizeEphemerisDataset({ siteId: 'metrics-ephemeris', samples })
}

const SITE = { lat: -90, lon: 0, elevationM: 0 }
const ZONE = {
  id: 'zone-01',
  name: 'Landing zone 01',
  lat: -90,
  lon: 0,
  xMeters: 0,
  yMeters: 0,
  areaKm2: 2,
  meanSlopeDeg: 0,
  maxSlopeDeg: 0,
  elevationM: 0,
  reliefM: 0,
  cellCount: 200,
  suitability: 2,
}
const MISSION = { missionDays: 1, powerNeedW: 120, sunDaysNeeded: 0.5, startTime: new Date(START).toISOString() }

describe('thermal model', () => {
  it('computes the radiative equilibrium temperature', () => {
    const vertical = surfaceEquilibriumTemperatureC({
      albedo: 0.12,
      emissivity: 0.95,
      solarConstantWm2: 1361,
      solarElevationDeg: 90,
    })
    // (0.88·1361 / (0.95·σ))^0.25 − 273.15 ≈ 113–120 °C.
    expect(vertical).toBeGreaterThan(105)
    expect(vertical).toBeLessThan(125)
    expect(STEFAN_BOLTZMANN).toBeCloseTo(5.670374419e-8, 12)
  })

  it('returns null when the Sun is below the horizon', () => {
    expect(
      surfaceEquilibriumTemperatureC({ albedo: 0.12, emissivity: 0.95, solarConstantWm2: 1361, solarElevationDeg: -1 }),
    ).toBeNull()
  })

  it('flags a permanently shadowed zone and sizes the heater', () => {
    const illumination = {
      sunlitFraction: 0,
      sunlitHours: 0,
      eclipseHours: 10,
      windowHours: 24,
      eclipseCount: 1,
      sunElevationMeanDeg: -2,
      sunElevationMeanSunlitDeg: null,
    }
    const thermal = computeThermalMetrics({ illumination, mission: normalizeMission(MISSION) })
    expect(thermal.isPsr).toBe(true)
    expect(thermal.minTempC).toBe(-200)
    expect(thermal.dayTempC).toBeNull()
    expect(thermal.heaterPowerW).toBeGreaterThan(300)
    expect(thermal.heaterWh).toBeGreaterThan(0)
  })
})

describe('illumination windows and eclipses', () => {
  it('finds the eclipse gap and sun elevation statistics', () => {
    // Sun visible for the first 12 h (el +2°), then below the horizon (−2°).
    const ephemeris = makeEphemeris({
      sun: (index) => ({ az: 270, el: index < 24 ? 2 : -2 }),
    })
    const terrain = makePlane()
    const mission = normalizeMission(MISSION)
    const window = { startMs: START, endMs: START + 24 * 3600 * 1000, days: 1, clamped: false }
    const illumination = computeIlluminationMetrics({ terrain, site: SITE, ephemeris, mission, window, profile: null })
    expect(illumination.sunlitFraction).toBeCloseTo(0.5, 1)
    expect(illumination.longestEclipseHours).toBeGreaterThan(11)
    expect(illumination.longestEclipseHours).toBeLessThan(13)
    expect(illumination.sunElevationMaxDeg).toBeCloseTo(2, 6)
    expect(illumination.sunElevationMinDeg).toBeCloseTo(-2, 6)
    expect(illumination.continuousSunDays).toBeGreaterThan(0.4)
    expect(illumination.eclipseHours).toBeGreaterThan(11)
  })

  it('computes gaps between visibility windows', () => {
    const windows = [
      { from: new Date(START).toISOString(), to: new Date(START + 3600 * 1000).toISOString() },
      { from: new Date(START + 7200 * 1000).toISOString(), to: new Date(START + 10800 * 1000).toISOString() },
    ]
    const gaps = windowsToGaps(windows, START, START + 14400 * 1000)
    expect(gaps.length).toBe(2)
    expect(gaps[0].durationSeconds).toBe(3600)
    expect(gaps[1].durationSeconds).toBeCloseTo(3600, 0)
    const stats = gapStatistics(gaps)
    expect(stats.longestGapHours).toBeCloseTo(1, 0)
    expect(stats.gapCount).toBe(2)
  })
})

describe('power and battery sizing', () => {
  it('computes average/max/min Watts and the eclipse battery requirement', () => {
    const ephemeris = makeEphemeris({ sun: (index) => ({ az: 270, el: index < 24 ? 2 : -2 }) })
    const terrain = makePlane()
    const mission = normalizeMission(MISSION)
    const window = { startMs: START, endMs: START + 24 * 3600 * 1000, days: 1, clamped: false }
    const illumination = computeIlluminationMetrics({ terrain, site: SITE, ephemeris, mission, window, profile: null })
    const thermal = computeThermalMetrics({ illumination, mission })
    const power = computePowerMetrics({ terrain, site: SITE, ephemeris, mission, window, profile: null, illumination, thermal })
    expect(power.averageW).toBeGreaterThan(100)
    expect(power.maxW).toBeGreaterThan(power.averageW)
    expect(power.minW).toBe(0)
    expect(power.eclipseHours).toBeGreaterThan(11)
    expect(power.requiredBatteryWh).toBeGreaterThan(0)
    // Closed-form: (powerNeedW + heaterPowerW)·eclipseHours / (η·DoD).
    const expected = ((120 + thermal.heaterPowerW) * power.eclipseHours) / (0.9 * 0.8)
    expect(power.requiredBatteryWh).toBeCloseTo(expected, 0)
    expect(power.meetsPowerNeed).toBe(true)
  })
})

describe('comms gaps and data budget', () => {
  it('measures the longest Earth line-of-sight gap', () => {
    const ephemeris = makeEphemeris({ earth: (index) => ({ az: 90, el: index < 24 ? 2 : -2 }) })
    const terrain = makePlane()
    const mission = normalizeMission(MISSION)
    const window = { startMs: START, endMs: START + 24 * 3600 * 1000, days: 1, clamped: false }
    const comms = computeCommsMetrics({ terrain, site: SITE, ephemeris, mission, window, profile: null })
    expect(comms.directEarthVisibleFraction).toBeCloseTo(0.5, 1)
    expect(comms.maxLosGapHours).toBeGreaterThan(11)
    expect(comms.maxLosGapHours).toBeLessThan(13)
    expect(comms.dataBudgetMb).toBeGreaterThan(0)
    expect(comms.meetsDataNeed).toBeNull()
    expect(comms.relayInOrbit).toBe(false)
  })
})

describe('safety metrics', () => {
  it('computes slope statistics, ellipse fit and crater hazard', () => {
    const terrain = makePlane()
    const mission = normalizeMission(MISSION)
    const safety = computeSafetyMetrics({
      terrain,
      zone: ZONE,
      mission,
      craters: [{ lat: -90, lon: 1, diameterM: 300, depthM: 50 }],
      cratersAvailable: true,
      slopeGateDeg: 8,
    })
    expect(safety.ellipse.fitRatio).toBe(1)
    expect(safety.ellipse.requiredRadiusM).toBe(500)
    expect(safety.ellipse.marginM).toBeGreaterThan(0)
    expect(safety.hazard.nearestCraterDistanceM).toBeLessThan(100000)
    expect(safety.hazard.craterHazard).toBeGreaterThanOrEqual(0)
    expect(safety.flatFraction).toBeGreaterThan(0.9)
    expect(Number.isFinite(safety.stdSlopeDeg)).toBe(true)
  })
})

describe('component weights and mission defaults', () => {
  it('normalizes weights to sum to one', () => {
    const weights = normalizeLandingWeights({ power: 2, sun: 1 })
    const sum = Object.values(weights).reduce((total, value) => total + value, 0)
    expect(sum).toBeCloseTo(1, 10)
    // Overridden keys are kept relative to the remaining default weights.
    const rawTotal = 2 + 1 + (LANDING_SCORE_WEIGHTS.comms + LANDING_SCORE_WEIGHTS.safety + LANDING_SCORE_WEIGHTS.thermal + LANDING_SCORE_WEIGHTS.logistics + LANDING_SCORE_WEIGHTS.science)
    expect(weights.power).toBeCloseTo(2 / rawTotal, 6)
    expect(Object.keys(weights).sort()).toEqual(Object.keys(LANDING_SCORE_WEIGHTS).sort())
  })

  it('extends the mission defaults backward-compatibly', () => {
    const legacy = normalizeMission({ missionDays: 14, powerNeedW: 120 })
    expect(legacy.batteryCapacityWh).toBe(40000)
    expect(legacy.batterySpecified).toBe(false)
    expect(legacy.powerSource).toBe('solar')
    expect(legacy.rtgPowerW).toBeNull()
    expect(legacy.dataNeedMb).toBeNull()
    expect(legacy.batteryRoundTripEfficiency).toBe(0.9)
    expect(legacy.batteryDepthOfDischarge).toBe(0.8)
    expect(legacy.heaterMaxW).toBeGreaterThan(0)
    expect(legacy.minOperatingTemperatureC).toBe(-40)
    expect(legacy.maxOperatingTemperatureC).toBe(50)
    expect(legacy.landingEllipseRadiusM).toBe(500)
    expect(legacy.thermal.psrTemperatureC).toBe(-200)
    expect(legacy.missionDays).toBe(14)
  })

  it('honours explicit battery and thermal mission inputs', () => {
    const mission = normalizeMission({
      missionDays: 3,
      batteryCapacityWh: 5000,
      heaterMaxW: 250,
      minOperatingTemperatureC: -30,
      thermal: { nightTemperatureC: -160, psrTemperatureC: -190 },
      weights: { power: 1, sun: 0 },
    })
    expect(mission.batteryCapacityWh).toBe(5000)
    expect(mission.heaterMaxW).toBe(250)
    expect(mission.minOperatingTemperatureC).toBe(-30)
    expect(mission.thermal.minOperatingC).toBe(-30)
    expect(mission.thermal.nightTemperatureC).toBe(-160)
    expect(mission.weights).toEqual({ power: 1, sun: 0 })
    const rtg = normalizeMission({ powerSource: 'rtg', rtgPowerW: 850 })
    expect(rtg.powerSource).toBe('rtg')
    expect(rtg.rtgPowerW).toBe(850)
    expect(rtg.batterySpecified).toBe(false)
  })
})

describe('computeLandingMetrics integration', () => {
  const terrain = makePlane()
  const ephemeris = makeEphemeris()

  it('returns every grouped mission metric with the documented units', () => {
    const result = computeLandingMetrics({
      terrain,
      zone: ZONE,
      zones: [ZONE],
      ephemeris,
      site: SITE,
      mission: MISSION,
      nearestSite: { site: { id: 'anchor', lat: -89.9, lon: 0 }, distanceM: 11000 },
      craters: [],
      cratersAvailable: false,
      options: { maxSlopeDeg: 8 },
    })
    expect(result.score).toBeGreaterThanOrEqual(0)
    expect(result.score).toBeLessThanOrEqual(100)
    expect(result.grade).toBeTruthy()
    expect(result.modelVersion).toBe(LANDING_MODEL_VERSION)
    expect(result.inputSignature).toMatch(/^[0-9a-f]{8}$/)
    expect(result.weights.power).toBeCloseTo(LANDING_SCORE_WEIGHTS.power, 2)

    // Illumination
    expect(result.metrics.illumination.sunlitFraction).toBeCloseTo(1, 1)
    expect(result.metrics.illumination.continuousSunDays).toBeGreaterThan(0.5)
    expect(Number.isFinite(result.metrics.illumination.sunElevationMeanDeg)).toBe(true)
    // Power
    expect(result.metrics.power.averageW).toBeGreaterThan(0)
    expect(result.metrics.power.maxW).toBeGreaterThanOrEqual(result.metrics.power.averageW)
    expect(result.metrics.power.minW).toBeGreaterThanOrEqual(0)
    expect(result.metrics.power.powerNeedW).toBe(120)
    expect(Number.isFinite(result.metrics.power.requiredBatteryWh)).toBe(true)
    expect(result.metrics.power.meetsPowerNeed).toBe(true)
    // Thermal
    expect(result.metrics.thermal.minTempC).toBeLessThan(result.metrics.thermal.maxTempC)
    expect(result.metrics.thermal.isPsr).toBe(false)
    expect(result.metrics.thermal.heaterPowerW).toBeGreaterThan(0)
    // Comms
    expect(result.metrics.comms.earthVisibleFraction).toBeGreaterThan(0.9)
    expect(result.metrics.comms.maxLosGapHours).toBeGreaterThanOrEqual(0)
    expect(result.metrics.comms.dataBudgetMb).toBeGreaterThan(0)
    // Safety / logistics / science
    expect(result.metrics.safety.ellipse.fitRatio).toBe(1)
    expect(Number.isFinite(result.metrics.safety.hazard.craterHazard)).toBe(true)
    expect(result.metrics.logistics.nearestCuratedSiteId).toBe('anchor')
    expect(result.metrics.logistics.nearestCuratedSiteDistanceM).toBeCloseTo(11000, 0)
    expect(result.metrics.science).toBeTypeOf('object')
    // Legacy flat fields remain for backward compatibility.
    expect(result.metrics.averageW).toBe(result.metrics.power.averageW)
    expect(result.metrics.meanSlopeDeg).toBe(result.metrics.safety.meanSlopeDeg)
    expect(result.metrics.zoneAreaKm2).toBe(2)
    expect(result.components.terrain).toBe(result.components.safety)
    // Reasons cover the mission variables.
    const codes = result.reasons.map((reason) => reason.code)
    expect(codes).toContain('illumination.sunlit')
    expect(codes).toContain('power.margin')
    expect(codes).toContain('thermal.operating')
    expect(codes).toContain('comms.directGood')
    expect(codes).toContain('safety.slope')
  })

  it('marks a permanently shadowed zone and reports its battery/thermal load', () => {
    const shadowed = makeEphemeris({ sun: () => ({ az: 270, el: -3 }) })
    const result = computeLandingMetrics({
      terrain,
      zone: ZONE,
      zones: [ZONE],
      ephemeris: shadowed,
      site: SITE,
      mission: MISSION,
    })
    expect(result.metrics.illumination.sunlitFraction).toBe(0)
    expect(result.metrics.thermal.isPsr).toBe(true)
    expect(result.metrics.power.averageW).toBe(0)
    expect(result.metrics.power.minW).toBe(0)
    expect(result.metrics.power.requiredBatteryWh).toBeGreaterThan(0)
    expect(result.warnings.map((warning) => warning.code)).toContain('zone.is-psr')
    expect(result.components.power).toBeLessThan(result.components.safety)
  })

  it('degrades gracefully without an ephemeris', () => {
    const result = computeLandingMetrics({ terrain, zone: ZONE, zones: [ZONE], ephemeris: null, mission: MISSION })
    expect(result.metrics.power.averageW).toBe(0)
    expect(result.metrics.comms.earthVisibleFraction).toBe(0)
    expect(result.warnings.map((warning) => warning.code)).toContain('data.ephemerisMissing')
    expect(result.confidence).toBeLessThan(1)
  })

  it('keeps a deterministic input signature and changes it with the inputs', () => {
    const base = computeInputSignature({ terrain, mission: normalizeMission(MISSION), ephemeris, options: { maxZones: 8 } })
    const same = computeInputSignature({ terrain, mission: normalizeMission(MISSION), ephemeris, options: { maxZones: 8 } })
    expect(same).toBe(base)
    expect(base).toMatch(/^[0-9a-f]{8}$/)

    const otherMission = computeInputSignature({
      terrain,
      mission: normalizeMission({ ...MISSION, powerNeedW: 250 }),
      ephemeris,
      options: { maxZones: 8 },
    })
    expect(otherMission).not.toBe(base)
    const otherTime = computeInputSignature({
      terrain,
      mission: normalizeMission({ ...MISSION, startTime: '2026-11-02T00:00:00Z' }),
      ephemeris,
      options: { maxZones: 8 },
    })
    expect(otherTime).not.toBe(base)
    const otherTerrain = computeInputSignature({
      terrain: { ...terrain, id: 'other-region' },
      mission: normalizeMission(MISSION),
      ephemeris,
      options: { maxZones: 8 },
    })
    expect(otherTerrain).not.toBe(base)
  })

  it('covers the crater-avoidance detection options in the input signature', () => {
    const signature = (options) => computeInputSignature({
      terrain,
      mission: normalizeMission(MISSION),
      ephemeris,
      options,
    })
    const plain = signature({ maxZones: 8 })
    const avoiding = signature({ maxZones: 8, avoidCraters: true })
    const notAvoiding = signature({ maxZones: 8, avoidCraters: false })
    expect(avoiding).not.toBe(plain)
    expect(avoiding).not.toBe(notAvoiding)
    expect(signature({ maxZones: 8, avoidCraters: true })).toBe(avoiding)

    const withClearance = signature({ maxZones: 8, avoidCraters: true, craterClearanceM: 400 })
    expect(withClearance).not.toBe(avoiding)
    expect(signature({ maxZones: 8, avoidCraters: true, craterClearanceM: 400 })).toBe(withClearance)

    const largerCraters = signature({ maxZones: 8, avoidCraters: true, craterMinDiameterM: 800 })
    expect(largerCraters).not.toBe(avoiding)
  })
})


describe('hard feasibility gating', () => {
  const terrain = makePlane()

  it('caps and downgrades an under-powered zone', () => {
    const result = computeLandingMetrics({
      terrain,
      zone: ZONE,
      zones: [ZONE],
      ephemeris: makeEphemeris(),
      site: SITE,
      mission: { ...MISSION, powerNeedW: 1000 },
    })
    expect(result.feasible).toBe(false)
    expect(result.feasibility.status).toBe('infeasible')
    expect(result.feasibility.powerFeasible).toBe(false)
    expect(result.feasibility.violations.map((violation) => violation.code)).toContain('feasibility.powerDeficit')
    expect(result.reasons.map((reasonCode) => reasonCode.code)).toContain('feasibility.powerDeficit')
    expect(result.score).toBeLessThanOrEqual(55)
    expect(result.rawScore).toBeGreaterThan(result.score)
    expect(result.scoreCapApplied).toBe(true)
    expect(['conditional', 'poor']).toContain(result.grade)
    expect(result.gradeCode).toMatch(/grade\.(conditional|poor)/)
  })

  it('flags an insufficient mission battery', () => {
    const halfEclipse = makeEphemeris({ sun: (index) => ({ az: 270, el: index < 24 ? 2 : -2 }) })
    const result = computeLandingMetrics({
      terrain,
      zone: ZONE,
      zones: [ZONE],
      ephemeris: halfEclipse,
      site: SITE,
      mission: { ...MISSION, batteryCapacityWh: 1000 },
    })
    expect(result.feasible).toBe(false)
    expect(result.feasibility.batteryFeasible).toBe(false)
    expect(result.feasibility.violations.map((violation) => violation.code)).toContain(
      'feasibility.batteryInsufficient',
    )
    expect(result.metrics.power.requiredBatteryWh).toBeGreaterThan(1000)
    expect(result.metrics.power.batteryCoverage).toBeLessThan(1)
  })

  it('flags thermal cold beyond heater capacity', () => {
    const result = computeLandingMetrics({
      terrain,
      zone: ZONE,
      zones: [ZONE],
      ephemeris: makeEphemeris(),
      site: SITE,
      mission: { ...MISSION, heaterMaxW: 10 },
    })
    expect(result.feasibility.thermalFeasible).toBe(false)
    expect(result.feasibility.violations.map((violation) => violation.code)).toContain(
      'feasibility.thermalCold',
    )
    expect(result.metrics.thermal.heatedMinTempC).toBeLessThan(
      result.metrics.thermal.minOperatingC,
    )
  })

  it('flags thermal hot above the operating limit', () => {
    const result = computeLandingMetrics({
      terrain,
      zone: ZONE,
      zones: [ZONE],
      ephemeris: makeEphemeris(),
      site: SITE,
      mission: { ...MISSION, maxOperatingTemperatureC: -120 },
    })
    expect(result.feasibility.thermalFeasible).toBe(false)
    expect(result.feasibility.violations.map((violation) => violation.code)).toContain(
      'feasibility.thermalHot',
    )
  })

  it('treats missing data as undetermined and capped', () => {
    const result = computeLandingMetrics({ terrain, zone: ZONE, zones: [ZONE], ephemeris: null, mission: MISSION })
    expect(result.feasible).toBe(false)
    expect(result.feasibility.status).toBe('undetermined')
    expect(result.feasibility.violations.map((violation) => violation.code)).toContain(
      'feasibility.undetermined',
    )
    expect(result.score).toBeLessThanOrEqual(55)
  })

  it('gates the data budget only when the mission demands data', () => {
    const result = computeLandingMetrics({
      terrain,
      zone: ZONE,
      zones: [ZONE],
      ephemeris: makeEphemeris({ earth: (index) => ({ az: 90, el: index < 24 ? 2 : -2 }) }),
      site: SITE,
      mission: { ...MISSION, dataNeedMb: 1e9 },
    })
    expect(result.feasibility.dataFeasible).toBe(false)
    expect(result.feasibility.violations.map((violation) => violation.code)).toContain(
      'feasibility.dataInsufficient',
    )
    expect(result.feasible).toBe(false)
  })

  it('exposes the feasibility gates as a standalone function', () => {
    const mission = normalizeMission({ ...MISSION, powerNeedW: 1000 })
    const feasibility = evaluateZoneFeasibility({
      power: { powerMarginW: -500, averageW: 300, heaterAveragePowerW: 50, requiredBatteryWh: 0 },
      thermal: { heatedMinTempC: -40, maxTempC: 10, heaterPowerSizedW: 280 },
      comms: { dataBudgetCoverage: null },
      illumination: { continuousSunDays: 5 },
      mission,
      ephemerisAvailable: true,
      terrainAvailable: true,
    })
    expect(feasibility.status).toBe('infeasible')
    expect(feasibility.scoreCap).toBe(55)
  })
})

describe('metric audit (unambiguous keys and units)', () => {
  const terrain = makePlane()
  const alternatingEphemeris = makeEphemeris({
    sun: (index) => ({ az: 270, el: index < 12 || (index >= 24 && index < 36) ? 2 : -2 }),
    earth: (index) => ({ az: 90, el: index < 24 ? 2 : -2 }),
  })

  it('keeps total and longest eclipse distinct and heater sizing explicit', () => {
    const result = computeLandingMetrics({
      terrain,
      zone: ZONE,
      zones: [ZONE],
      ephemeris: alternatingEphemeris,
      site: SITE,
      mission: { ...MISSION, relayInOrbit: true, comms: { relayCoverage: 1 }, dataNeedMb: 100 },
    })
    const { illumination, thermal, comms, safety, missionInputs } = result.metrics
    expect(illumination.totalEclipseHours).toBeGreaterThan(illumination.longestEclipseHours)
    expect(illumination.totalEclipseHours).not.toBe(illumination.longestEclipseHours)
    expect(illumination.sunElevationMeanWindowDeg).not.toBe(illumination.sunElevationMeanSunlitDeg)
    expect(thermal.heaterPowerSizedW).toBeGreaterThan(thermal.heaterAveragePowerW)
    expect(thermal.heaterPowerSizedW).toBeGreaterThan(0)
    expect(thermal.heaterAveragePowerW).toBeGreaterThan(0)

    // Effective availability (relay) vs direct LOS and their gaps.
    expect(comms.earthVisibleFraction).toBe(1)
    expect(comms.directEarthVisibleFraction).toBeLessThan(1)
    expect(comms.maxLosGapHours).toBe(0)
    expect(comms.directMaxLosGapHours).toBeGreaterThan(0)
    expect(typeof comms.dataBudgetRatio).toBe('number')
    expect(comms.dataBudgetRatio).toBeGreaterThan(1)
    expect(comms.dataBudgetFraction).toBe(comms.dataBudgetRatio)
    expect(comms.dataBudgetCoverage).toBe(1)

    // Explicit area units for the landing ellipse.
    expect(safety.ellipse.requiredAreaKm2).toBeGreaterThan(0)
    expect(Math.abs(safety.ellipse.requiredAreaM2 - safety.ellipse.requiredAreaKm2 * 1e6)).toBeLessThan(1000)
    expect(Math.abs(safety.ellipse.availableAreaM2 - safety.ellipse.availableAreaKm2 * 1e6)).toBeLessThan(1000)

    // The exact scored mission inputs are echoed for the UI.
    expect(missionInputs.powerNeedW).toBe(120)
    expect(missionInputs.batteryCapacityWh).toBe(40000)
    expect(missionInputs.batterySpecified).toBe(false)
    expect(missionInputs.powerSource).toBe('solar')
    expect(missionInputs.startTime).toBe(MISSION.startTime)
  })

  it('changes the input signature for battery, heater and thermal edits', () => {
    const base = computeInputSignature({ terrain, mission: normalizeMission(MISSION), ephemeris: makeEphemeris(), options: { maxZones: 8 } })
    for (const patch of [
      { batteryCapacityWh: 1000 },
      { heaterMaxW: 100 },
      { minOperatingTemperatureC: -20 },
      { thermal: { nightTemperatureC: -160 } },
    ]) {
      const changed = computeInputSignature({
        terrain,
        mission: normalizeMission({ ...MISSION, ...patch }),
        ephemeris: makeEphemeris(),
        options: { maxZones: 8 },
      })
      expect(changed).not.toBe(base)
    }
  })
})


describe('eclipse battery sizing, illumination gate and RTG power source (task-24)', () => {
  const terrain = makePlane()

  // The local makeEphemeris helper passes the 30-min SAMPLE INDEX to the body
  // functions. Two eclipses: 10 h (index 200-219) and 59 h (index 528-645).
  const twoEclipses = (index) => {
    const inEclipse = (index >= 200 && index < 220) || (index >= 528 && index < 646)
    return { az: 270, el: inEclipse ? -2 : 2 }
  }

  it('sizes the battery from the LONGEST eclipse, not the total eclipse time', () => {
    const result = computeLandingMetrics({
      terrain,
      zone: ZONE,
      zones: [ZONE],
      ephemeris: makeEphemeris({ sun: twoEclipses, hours: 14 * 24 }),
      site: SITE,
      mission: {
        ...MISSION,
        missionDays: 14,
        sunDaysNeeded: 0.5,
        batteryCapacityWh: 200000,
      },
    })
    const power = result.metrics.power
    const heater = result.metrics.thermal.heaterPowerSizedW
    expect(power.longestEclipseHours).toBeCloseTo(59, 0)
    expect(power.totalEclipseHours).toBeCloseTo(69, 0)
    expect(power.eclipseDeficitWh).toBeCloseTo((120 + heater) * 59, 0)
    expect(power.totalEclipseEnergyWh).toBeCloseTo((120 + heater) * 69, 0)
    expect(power.totalEclipseEnergyWh).toBeGreaterThan(power.eclipseDeficitWh)
    expect(power.requiredBatteryWh).toBeCloseTo(((120 + heater) * 59) / (0.9 * 0.8), 0)
    expect(result.feasible).toBe(true)
  })

  it("does not rank the user's ~30,000 Wh / 59 h eclipse case as feasible", () => {
    const result = computeLandingMetrics({
      terrain,
      zone: ZONE,
      zones: [ZONE],
      ephemeris: makeEphemeris({ sun: twoEclipses, hours: 14 * 24 }),
      site: SITE,
      mission: {
        ...MISSION,
        missionDays: 14,
        sunDaysNeeded: 5, // longest continuous sun here is ~6.4 days
        powerNeedW: 228, // 228 W load + 280 W heater = 508 W over 59 h ≈ 30 kWh
        batteryCapacityWh: 40000,
      },
    })
    expect(result.metrics.power.longestEclipseHours).toBeCloseTo(59, 0)
    expect(result.metrics.power.eclipseDeficitWh).toBeGreaterThan(29000)
    expect(result.metrics.power.eclipseDeficitWh).toBeLessThan(31000)
    expect(result.metrics.power.requiredBatteryWh).toBeGreaterThan(40000)
    expect(result.feasible).toBe(false)
    expect(result.feasibility.violations.map((violation) => violation.code)).toContain(
      'feasibility.batteryInsufficient',
    )
    expect(result.score).toBeLessThanOrEqual(55)
    expect(['conditional', 'poor']).toContain(result.grade)

    // The same terrain is feasible with a battery large enough for that eclipse.
    const withBigBattery = computeLandingMetrics({
      terrain,
      zone: ZONE,
      zones: [ZONE],
      ephemeris: makeEphemeris({ sun: twoEclipses, hours: 14 * 24 }),
      site: SITE,
      mission: {
        ...MISSION,
        missionDays: 14,
        sunDaysNeeded: 5,
        powerNeedW: 228,
        batteryCapacityWh: 60000,
      },
    })
    expect(withBigBattery.feasible).toBe(true)
  })

  it('enforces the continuous-sun requirement as a hard gate', () => {
    const result = computeLandingMetrics({
      terrain,
      zone: ZONE,
      zones: [ZONE],
      ephemeris: makeEphemeris({
        sun: (hour) => ({ az: 270, el: Math.floor(hour / 120) % 2 === 0 ? 2 : -2 }),
        hours: 14 * 24,
      }),
      site: SITE,
      mission: { ...MISSION, missionDays: 14, sunDaysNeeded: 10, batteryCapacityWh: 200000 },
    })
    expect(result.metrics.illumination.continuousSunDays).toBeLessThan(10)
    expect(result.feasible).toBe(false)
    expect(result.feasibility.illuminationFeasible).toBe(false)
    expect(result.feasibility.violations.map((violation) => violation.code)).toContain(
      'feasibility.illuminationInsufficient',
    )
    expect(result.feasibility.illuminationMeetsRequirement).toBe(false)

    // sunDaysNeeded = 0 disables the requirement.
    const disabled = computeLandingMetrics({
      terrain,
      zone: ZONE,
      zones: [ZONE],
      ephemeris: makeEphemeris({
        sun: (hour) => ({ az: 270, el: Math.floor(hour / 120) % 2 === 0 ? 2 : -2 }),
        hours: 14 * 24,
      }),
      site: SITE,
      mission: { ...MISSION, missionDays: 14, sunDaysNeeded: 0, batteryCapacityWh: 200000 },
    })
    expect(disabled.feasibility.illuminationFeasible).toBe(true)
  })

  it('treats an unspecified battery as the documented 40 kWh default and warns', () => {
    const result = computeLandingMetrics({
      terrain,
      zone: ZONE,
      zones: [ZONE],
      ephemeris: makeEphemeris(),
      site: SITE,
      mission: { ...MISSION, batterySpecified: undefined, batteryCapacityWh: undefined },
    })
    expect(result.metrics.missionInputs.batteryCapacityWh).toBe(40000)
    expect(result.metrics.missionInputs.batterySpecified).toBe(false)
    expect(result.feasibility.violations.map((violation) => violation.code)).toContain(
      'feasibility.batteryNotSpecified',
    )
    expect(result.feasible).toBe(true)
  })

  it('makes an RTG power source feasible in a permanently shadowed zone', () => {
    const shadowed = makeEphemeris({ sun: () => ({ az: 270, el: -3 }) })
    const result = computeLandingMetrics({
      terrain,
      zone: ZONE,
      zones: [ZONE],
      ephemeris: shadowed,
      site: SITE,
      mission: {
        ...MISSION,
        powerSource: 'rtg',
        rtgPowerW: 1000,
        powerNeedW: 120,
        sunDaysNeeded: 10,
      },
    })
    expect(result.feasibility.powerSource).toBe('rtg')
    expect(result.feasibility.rtgFeasible).toBe(true)
    expect(result.feasibility.illuminationFeasible).toBe(true) // not required for RTG
    expect(result.feasibility.illuminationMeetsRequirement).toBe(true)
    expect(result.feasibility.powerFeasible).toBe(true)
    expect(result.feasibility.batteryFeasible).toBe(true)
    expect(result.metrics.power.source).toBe('rtg')
    expect(result.metrics.power.averageW).toBe(1000)
    expect(result.metrics.power.requiredBatteryWh).toBe(0)
    expect(result.metrics.power.eclipseDeficitWh).toBe(0)
    expect(result.feasible).toBe(true)
    const codes = result.feasibility.violations.map((violation) => violation.code)
    expect(codes).not.toContain('feasibility.illuminationInsufficient')
    expect(codes).not.toContain('feasibility.powerDeficit')
    expect(codes).not.toContain('feasibility.batteryInsufficient')
  })

  it('flags an insufficient RTG', () => {
    const shadowed = makeEphemeris({ sun: () => ({ az: 270, el: -3 }) })
    const result = computeLandingMetrics({
      terrain,
      zone: ZONE,
      zones: [ZONE],
      ephemeris: shadowed,
      site: SITE,
      mission: { ...MISSION, powerSource: 'rtg', rtgPowerW: 50, powerNeedW: 120 },
    })
    expect(result.feasible).toBe(false)
    expect(result.feasibility.rtgFeasible).toBe(false)
    expect(result.feasibility.violations.map((violation) => violation.code)).toContain(
      'feasibility.rtgInsufficient',
    )
    expect(result.score).toBeLessThanOrEqual(55)
  })

  it('keeps the unspecified-battery flag through repeated normalisation', () => {
    const once = normalizeMission({ missionDays: 14, powerNeedW: 120 })
    const twice = normalizeMission(once)
    expect(twice.batterySpecified).toBe(false)
    expect(twice.batteryCapacityWh).toBe(40000)
    expect(normalizeMission({ batteryCapacityWh: 5000 }).batterySpecified).toBe(true)
  })

  it('changes the input signature for power source and RTG edits', () => {
    const ephemeris = makeEphemeris()
    const base = computeInputSignature({ terrain, mission: normalizeMission(MISSION), ephemeris, options: { maxZones: 8 } })
    for (const patch of [{ powerSource: 'rtg', rtgPowerW: 900 }, { batteryCapacityWh: 5000 }]) {
      const changed = computeInputSignature({
        terrain,
        mission: normalizeMission({ ...MISSION, ...patch }),
        ephemeris,
        options: { maxZones: 8 },
      })
      expect(changed).not.toBe(base)
    }
  })
})
