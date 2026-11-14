/**
 * The 13 Monte Carlo logic invariants (SPEC §3), as tagged checks.
 *
 * Each check returns `{ tag, status, detail }` where status is one of
 * pass / fail / warn / skip. A failing case records the seed and index, which
 * the runner exposes as a reproducible `--seed <seed> --case <index>` command.
 *
 * @module logic/lib/checks
 */

/** Canonical invariant order and tags (must match tags.json @inv namespace). */
export const INVARIANTS = [
  '@inv/no-nan',
  '@inv/bounds',
  '@inv/roundtrip',
  '@inv/horizon-consistency',
  '@inv/horizon-monotonicity',
  '@inv/visibility-consistency',
  '@inv/set-events',
  '@inv/windows',
  '@inv/power',
  '@inv/comms',
  '@inv/scoring',
  '@inv/ranking',
  '@inv/cache-neutrality',
]

/** Documented tolerances (reported in the run metadata). */
export const TOLERANCES = {
  roundtripDeg: 1e-9,
  // Horizon profiles store angles in a Float32Array (documented HorizonProfile
  // shape), so the comparison with the float64 direct computation has a
  // ~1e-6 relative precision floor; 1e-4 deg is far tighter than any physical
  // tolerance while ignoring float32 storage noise.
  horizonConsistencyDeg: 1e-4,
  monotonicityHorizonDeg: 6,
  monotonicityDecisionDeg: 6,
  eventMarginDeg: 0.25,
  visibilityMarginDeg: 1e-9,
  nanDepth: 8,
}

const finite = (value) => typeof value === 'number' && Number.isFinite(value)
const status = (tag, pass, detail = '') => ({ tag, status: pass ? 'pass' : 'fail', detail: pass ? '' : detail })
const round = (value, digits = 3) => (finite(value) ? Number(value.toFixed(digits)) : String(value))

/**
 * Recursively find non-finite numbers in an output object.
 * @param {*} value
 * @param {string} path
 * @param {Array<{path: string, value: string}>} out
 * @param {number} depth
 * @returns {Array<{path: string, value: string}>}
 */
export function findNonFinite(value, path = '$', out = [], depth = 0) {
  if (out.length >= 10 || depth > TOLERANCES.nanDepth) return out
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) out.push({ path, value: String(value) })
    return out
  }
  if (value == null || typeof value === 'boolean' || typeof value === 'string') return out
  if (ArrayBuffer.isView(value)) {
    for (let i = 0; i < value.length; i++) {
      if (!Number.isFinite(value[i])) out.push({ path: `${path}[${i}]`, value: String(value[i]) })
      if (out.length >= 10) break
    }
    return out
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length && out.length < 10; i++) findNonFinite(value[i], `${path}[${i}]`, out, depth + 1)
    return out
  }
  if (typeof value === 'object') {
    for (const key of Object.keys(value)) {
      if (out.length >= 10) break
      findNonFinite(value[key], `${path}.${key}`, out, depth + 1)
    }
  }
  return out
}

/** Deep equality for plain JSON-ish data (used by determinism checks). */
export function deepEqual(a, b) {
  if (a === b) return true
  if (typeof a !== typeof b || a == null || b == null) return false
  if (typeof a !== 'object') return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  const keysA = Object.keys(a)
  const keysB = Object.keys(b)
  if (keysA.length !== keysB.length) return false
  return keysA.every((key) => deepEqual(a[key], b[key]))
}

/**
 * Run the 13 invariants for one scenario.
 *
 * @param {Object} ctx
 * @param {Object} ctx.core Imported `src/core/index.js` namespace.
 * @param {Object} ctx.scenario Generated scenario.
 * @param {Object|null} ctx.terrain Terrain grid covering the site (or null degraded).
 * @param {Array<Object>} ctx.terrains All loaded terrain grids (high-res first).
 * @param {Object|null} ctx.dataset Nearest ephemeris dataset (or null degraded).
 * @param {Object} ctx.pois Curated POIs (for the ranking check).
 * @param {Map<string, Object>} ctx.ephemerisBySite Dataset per POI id.
 * @returns {{tags: string[], inputs: Object, checks: Object[], durationMs: number}}
 */
export function runCase(ctx) {
  const started = performance.now()
  const { core, scenario, terrain, terrains, dataset, pois, ephemerisBySite } = ctx
  const site = { ...scenario.site }
  const missionBase = scenario.mission
  const profileStepDeg = scenario.profileStepDeg
  const mission = { ...missionBase, profileStepDeg }
  const datasetRange = dataset ? core.datasetRange(dataset) : null
  const fromMs = datasetRange ? Math.max(scenario.dateMs, datasetRange.startMs) : scenario.dateMs
  const toMs = datasetRange ? Math.min(fromMs + 2 * 86400 * 1000, datasetRange.endMs) : fromMs + 2 * 86400 * 1000
  const outputs = {}
  const results = {}
  const checks = []
  /** Run one check function, catching unexpected throws as failures. */
  const run = (tag, fn) => {
    let entry
    try {
      entry = fn()
    } catch (error) {
      entry = { tag, status: 'fail', detail: `threw ${error?.name ?? 'Error'}: ${String(error?.message ?? error).slice(0, 220)}` }
    }
    checks.push(entry)
    results[tag] = entry
    return entry
  }

  const profile = terrain ? core.horizonProfile(terrain, site, { stepDeg: profileStepDeg }) : null
  // SPEC: profile resolution >= 36 azimuths must give the same visibility result
  // as 72 azimuths. The reference is therefore always the *other* resolution,
  // exactly 72 vs 36 (5 deg vs 10 deg azimuth spacing).
  const referenceStepDeg = profileStepDeg > 6 ? 360 / 72 : 360 / 36
  const referenceProfile = terrain
    ? core.horizonProfile(terrain, site, { stepDeg: referenceStepDeg })
    : null
  outputs.profileAngleSample = profile ? [profile.angles[0], profile.angles[Math.floor(profile.count / 2)]] : []
  outputs.profileMeta = profile ? { count: profile.count, stepDeg: profile.stepDeg, maxDistanceM: profile.maxDistanceM } : null

  // ------------------------------------------------------------------ bounds
  run('@inv/bounds', () => {
    const problems = []
    if (!(site.lat >= -90 && site.lat <= 90)) problems.push(`site.lat ${site.lat}`)
    const normalizedLon = ((site.lon % 360) + 360) % 360
    if (!(normalizedLon >= 0 && normalizedLon < 360)) problems.push(`site.lon normalized ${normalizedLon}`)
    if (profile) {
      const minA = Math.min(...profile.angles)
      const maxA = Math.max(...profile.angles)
      if (!(minA >= -90 && maxA <= 90)) problems.push(`horizon range [${round(minA)}, ${round(maxA)}]`)
      outputs.profileAngleRange = [minA, maxA]
    }
    const slope = terrain ? core.slopeAt(terrain, site.lat, site.lon) : null
    outputs.slope = slope
    if (slope && (!(slope.slopeDeg >= 0 && slope.slopeDeg <= 90) || !(slope.aspectDeg >= 0 && slope.aspectDeg < 360))) {
      problems.push(`slope ${round(slope.slopeDeg)} aspect ${round(slope.aspectDeg)}`)
    }
    const scoreResult = core.scoreSite({ site, terrain: terrain ? [terrain] : null, ephemeris: dataset, mission })
    outputs.scorePrimary = scoreResult
    if (!(scoreResult.score >= 0 && scoreResult.score <= 100)) problems.push(`score ${scoreResult.score}`)
    if (!['excellent', 'good', 'fair', 'poor', 'unknown'].includes(scoreResult.grade)) problems.push(`grade ${scoreResult.grade}`)
    for (const [component, value] of Object.entries(scoreResult.components ?? {})) {
      if (!(value >= 0 && value <= 100)) problems.push(`component ${component}=${value}`)
    }
    if (!(scoreResult.confidence >= 0 && scoreResult.confidence <= 1)) problems.push(`confidence ${scoreResult.confidence}`)
    return status('@inv/bounds', problems.length === 0, problems.join('; '))
  })

  // --------------------------------------------------------------- roundtrip
  run('@inv/roundtrip', () => {
    const probes = [
      { lat: site.lat, lon: site.lon },
      { lat: scenario.seed % 180 - 90, lon: (scenario.seed * 7) % 360 },
      { lat: -89.9999, lon: 359.5 },
    ]
    const problems = []
    for (const probe of probes) {
      const { x, y } = core.lonLatToXY(probe.lat, probe.lon)
      const back = core.xyToLonLat(x, y)
      const latErr = Math.abs(back.latDeg - probe.lat)
      if (!(latErr < TOLERANCES.roundtripDeg)) problems.push(`lat err ${latErr} at ${probe.lat},${probe.lon}`)
      // Longitude is undefined exactly at a pole (all meridians meet there):
      // exact-pole probes only check the latitude round trip.
      if (Math.abs(Math.abs(probe.lat) - 90) > 1e-9) {
        const lonErr = Math.abs(((back.lonDeg - probe.lon + 540) % 360) - 180)
        if (!(lonErr < TOLERANCES.roundtripDeg)) problems.push(`lon err ${lonErr} at ${probe.lat},${probe.lon}`)
      }
    }
    if (terrain) {
      const elevation = core.sampleElevation(terrain, site.lat, site.lon)
      outputs.sampleElevation = elevation
      if (!finite(elevation)) problems.push('sampleElevation not finite inside terrain')
    }
    return status('@inv/roundtrip', problems.length === 0, problems.join('; '))
  })

  // -------------------------------------------------------------- no NaN last
  run('@inv/horizon-consistency', () => {
    if (!profile || !terrain) return { tag: '@inv/horizon-consistency', status: 'skip', detail: 'no terrain profile (degraded case)' }
    const problems = []
    for (let k = 0; k < 3; k++) {
      const idx = Math.floor(((k + 1) / 4) * profile.count) % profile.count
      const az = idx * profile.stepDeg
      const direct = core.horizonAngle(terrain, site, az)
      const fromProfile = core.horizonAngleAt(profile, az)
      outputs[`horizon${k}`] = { az, direct, fromProfile }
      if (!(Math.abs(direct - fromProfile) < TOLERANCES.horizonConsistencyDeg)) {
        problems.push(`az ${round(az)}: profile ${round(fromProfile)} vs direct ${round(direct)}`)
      }
    }
    return status('@inv/horizon-consistency', problems.length === 0, problems.join('; '))
  })

  run('@inv/horizon-monotonicity', () => {
    if (!profile || !referenceProfile || !terrain) return { tag: '@inv/horizon-monotonicity', status: 'skip', detail: 'no terrain profile (degraded case)' }
    const problems = []
    const bodyKey = scenario.index % 2 === 0 ? 'sun' : 'earth'
    const sample = dataset ? core.sampleAt(dataset, scenario.dateMs) : null
    const body = sample ? sample[bodyKey] : { az: (scenario.index * 37) % 360, el: 0 }
    const hProfile = core.horizonAngleAt(profile, body.az)
    const hReference = core.horizonAngleAt(referenceProfile, body.az)
    const deltaH = Math.abs(hProfile - hReference)
    outputs.monotonicity = { az: body.az, profileDeg: profile.stepDeg, referenceDeg: referenceProfile.stepDeg, hProfile, hReference, deltaH }
    if (!(deltaH <= TOLERANCES.monotonicityHorizonDeg)) {
      problems.push(`${round(profile.stepDeg)}deg vs ${round(referenceProfile.stepDeg)}deg horizon delta ${round(deltaH)} deg at az ${round(body.az)} (${round(hProfile)} vs ${round(hReference)})`)
    }
    const marginProfile = body.el - hProfile
    const marginReference = body.el - hReference
    const visibleProfile = marginProfile > 0
    const visibleReference = marginReference > 0
    if (visibleProfile !== visibleReference && Math.abs(marginProfile) > TOLERANCES.monotonicityDecisionDeg) {
      problems.push(`visibility decision differs at az ${round(body.az)}: margin ${round(marginProfile)} vs ${round(marginReference)}`)
    }
    if (problems.length > 0 && (scenario.edgeTags.includes('region-edge') || scenario.edgeTags.includes('outside-terrain'))) {
      return { tag: '@inv/horizon-monotonicity', status: 'warn', detail: `DEM-boundary sampling: ${problems.join('; ')}` }
    }
    return status('@inv/horizon-monotonicity', problems.length === 0, problems.join('; '))
  })

  run('@inv/visibility-consistency', () => {
    if (!terrain || !dataset) return { tag: '@inv/visibility-consistency', status: 'skip', detail: 'missing terrain or ephemeris (degraded case)' }
    const sample = core.sampleAt(dataset, scenario.dateMs)
    const problems = []
    for (const bodyKey of ['sun', 'earth']) {
      const body = sample[bodyKey]
      if (!body) continue
      const evaluation = core.evaluateBodyVisibility(terrain, site, body, { profile })
      const isFn = bodyKey === 'sun' ? core.isSunVisible : core.isEarthVisible
      const convFn = bodyKey === 'sun' ? core.sunVisibility : core.earthVisibility
      const isVisible = isFn(terrain, site, body, { profile })
      const conventional = convFn(terrain, site, body, { profile })
      const predicted = body.el > core.horizonAngleAt(profile, body.az)
      const marginPred = (body.el - core.horizonAngleAt(profile, body.az)) > 0
      const state = core.bodyStateAt(dataset, site, terrain, bodyKey, scenario.dateMs, { profile })
      outputs[`visibility_${bodyKey}`] = { visible: evaluation.visible, isVisible, conventional: conventional.visible, predicted, margin: evaluation.marginDeg, stateVisible: state?.visible }
      if (isVisible !== evaluation.visible) problems.push(`${bodyKey}: isVisible ${isVisible} != evaluate ${evaluation.visible}`)
      if (conventional.visible !== evaluation.visible) problems.push(`${bodyKey}: conventional ${conventional.visible} != evaluate ${evaluation.visible}`)
      if (predicted !== evaluation.visible) problems.push(`${bodyKey}: el>horizon ${predicted} != evaluate ${evaluation.visible}`)
      if (state && state.visible !== evaluation.visible) problems.push(`${bodyKey}: bodyStateAt ${state.visible} != evaluate ${evaluation.visible}`)
      if (!(Math.abs(evaluation.marginDeg - (body.el - evaluation.horizonDeg)) < TOLERANCES.visibilityMarginDeg)) {
        problems.push(`${bodyKey}: margin ${evaluation.marginDeg} != el-horizon ${body.el - evaluation.horizonDeg}`)
      }
      if (marginPred !== evaluation.visible && Math.abs(evaluation.marginDeg) > TOLERANCES.monotonicityDecisionDeg) {
        problems.push(`${bodyKey}: inconsistent decision outside tolerance`)
      }
    }
    return status('@inv/visibility-consistency', problems.length === 0, problems.join('; '))
  })

  run('@inv/set-events', () => {
    if (!terrain || !dataset) return { tag: '@inv/set-events', status: 'skip', detail: 'missing terrain or ephemeris (degraded case)' }
    const body = scenario.index % 2 === 0 ? 'sun' : 'earth'
    const problems = []
    const options = { profile, stepSeconds: 900, maxSearchDays: 5 }
    const from = scenario.dateISO
    const setEvent = core.nextSetEvent(dataset, site, terrain, body, from, options)
    outputs.setEvent = setEvent
    if (setEvent) {
      const eventMs = Date.parse(setEvent.time)
      if (!(eventMs >= Date.parse(from))) problems.push(`set event ${setEvent.time} < from ${from}`)
      if (setEvent.type !== 'set') problems.push(`set event type ${setEvent.type}`)
      const sample = core.sampleAt(dataset, eventMs)
      const evaluation = core.evaluateBodyVisibility(terrain, site, sample[body], { profile })
      outputs.setEventMargin = evaluation.marginDeg
      if (!(evaluation.marginDeg <= TOLERANCES.eventMarginDeg)) {
        problems.push(`body still visible at set event: margin ${round(evaluation.marginDeg)}`)
      }
      const remaining = (eventMs - Date.parse(from)) / 1000
      if (!(Math.abs(setEvent.remainingSeconds - remaining) <= Math.max(2, remaining * 0.01))) {
        problems.push(`remainingSeconds ${round(setEvent.remainingSeconds)} vs ${round(remaining)}`)
      }
    }
    const riseEvent = core.nextRiseEvent(dataset, site, terrain, body, from, options)
    outputs.riseEvent = riseEvent
    if (riseEvent) {
      const eventMs = Date.parse(riseEvent.time)
      if (!(eventMs >= Date.parse(from))) problems.push(`rise event ${riseEvent.time} < from ${from}`)
      const sample = core.sampleAt(dataset, eventMs)
      const evaluation = core.evaluateBodyVisibility(terrain, site, sample[body], { profile })
      if (!(evaluation.marginDeg >= -TOLERANCES.eventMarginDeg)) {
        problems.push(`body not visible at rise event: margin ${round(evaluation.marginDeg)}`)
      }
    }
    if (!setEvent && !riseEvent) return { tag: '@inv/set-events', status: 'pass', detail: 'no transition within search window' }
    return status('@inv/set-events', problems.length === 0, problems.join('; '))
  })

  run('@inv/windows', () => {
    if (!terrain || !dataset) return { tag: '@inv/windows', status: 'skip', detail: 'missing terrain or ephemeris (degraded case)' }
    const body = scenario.index % 2 === 0 ? 'sun' : 'earth'
    const problems = []
    const stats = core.visibilityStatistics(dataset, site, terrain, body, fromMs, toMs, {
      profile,
      stepSeconds: 900,
    })
    const windows = stats.windows
    outputs.windows = windows
    const spanSeconds = (toMs - fromMs) / 1000
    let previousTo = -Infinity
    let total = 0
    for (const window of windows) {
      const start = Date.parse(window.from)
      const end = Date.parse(window.to)
      if (!(Number.isFinite(start) && Number.isFinite(end))) problems.push('window has invalid timestamps')
      if (!(start <= end)) problems.push(`window start>end ${window.from}..${window.to}`)
      if (!(start >= fromMs - 1 && end <= toMs + 1)) problems.push(`window outside interval ${window.from}..${window.to}`)
      if (!(start >= previousTo - 1)) problems.push(`windows overlap/unsorted at ${window.from}`)
      if (!(window.durationSeconds >= 0)) problems.push(`negative duration ${window.durationSeconds}`)
      total += window.durationSeconds
      previousTo = end
    }
    if (!(total <= spanSeconds + 1)) problems.push(`total ${round(total)} > span ${round(spanSeconds)}`)
    outputs.windowStats = stats
    if (!(stats.fraction >= 0 && stats.fraction <= 1)) problems.push(`fraction ${stats.fraction}`)
    if (!(stats.visibleSeconds >= 0)) problems.push(`visibleSeconds ${stats.visibleSeconds}`)
    if (!(Math.abs(stats.visibleSeconds - total) <= 1)) problems.push(`stats total ${round(stats.visibleSeconds)} != sum ${round(total)}`)
    return status('@inv/windows', problems.length === 0, problems.join('; '))
  })

  run('@inv/power', () => {
    const missionFast = { ...mission, stepSeconds: 1200 }
    const power = core.solarPowerEstimate(site, terrain, dataset, missionFast)
    outputs.power = power
    const problems = []
    for (const key of ['averageW', 'peakW', 'dailyWh', 'sunlitFraction', 'sunlitSeconds', 'totalEnergyWh']) {
      if (!finite(power[key])) problems.push(`${key} not finite (${power[key]})`)
    }
    if (!(power.averageW <= power.peakW + 1e-9)) problems.push(`averageW ${round(power.averageW)} > peakW ${round(power.peakW)}`)
    if (!(power.averageW >= 0 && power.peakW >= 0 && power.dailyWh >= 0)) problems.push('negative power value')
    if (!(power.sunlitFraction >= 0 && power.sunlitFraction <= 1)) problems.push(`sunlitFraction ${power.sunlitFraction}`)
    if (!dataset && power.unavailable !== true) problems.push('missing ephemeris did not set unavailable flag')
    return status('@inv/power', problems.length === 0, problems.join('; '))
  })

  run('@inv/comms', () => {
    if (!dataset) return { tag: '@inv/comms', status: 'skip', detail: 'missing ephemeris (degraded case)' }
    const missionFast = { ...mission, stepSeconds: 900 }
    const windows = core.commWindows(site, terrain, dataset, missionFast, fromMs, toMs)
    const budget = core.dataBudget(windows, missionFast)
    const spanSeconds = (toMs - fromMs) / 1000
    const availabilityFraction = spanSeconds > 0 ? Math.min(1, budget.totalSeconds / spanSeconds) : 0
    outputs.comms = { windows, budget: { totalSeconds: budget.totalSeconds, estimatedMb: budget.estimatedMb }, availabilityFraction }
    const problems = []
    let previousTo = -Infinity
    for (const window of windows) {
      const start = Date.parse(window.from)
      const end = Date.parse(window.to)
      if (!(start <= end)) problems.push('window start>end')
      if (!(start >= previousTo - 1)) problems.push('windows unsorted/overlapping')
      previousTo = end
      if (!Number.isFinite(window.durationSeconds) || window.durationSeconds < 0) problems.push('bad duration')
      if (!['earth', 'relay'].includes(window.source)) problems.push(`bad source ${window.source}`)
    }
    if (!(budget.totalSeconds >= 0)) problems.push(`totalSeconds ${budget.totalSeconds}`)
    if (!(budget.estimatedMb >= 0)) problems.push(`estimatedMb ${budget.estimatedMb}`)
    if (!(budget.averageMbps >= 0)) problems.push(`averageMbps ${budget.averageMbps}`)
    if (!(availabilityFraction >= 0 && availabilityFraction <= 1)) problems.push(`availabilityFraction ${availabilityFraction}`)
    return status('@inv/comms', problems.length === 0, problems.join('; '))
  })

  run('@inv/scoring', () => {
    const scoreResult = outputs.scorePrimary ?? core.scoreSite({ site, terrain: terrain ? [terrain] : null, ephemeris: dataset, mission })
    outputs.scorePrimary = scoreResult
    const problems = []
    if (!finite(scoreResult.score) || scoreResult.score < 0 || scoreResult.score > 100) problems.push(`score ${scoreResult.score}`)
    if (!['excellent', 'good', 'fair', 'poor', 'unknown'].includes(scoreResult.grade)) problems.push(`grade ${scoreResult.grade}`)
    if (!Array.isArray(scoreResult.warnings)) problems.push('warnings is not an array')
    if (!finite(scoreResult.confidence) || scoreResult.confidence < 0 || scoreResult.confidence > 1) problems.push(`confidence ${scoreResult.confidence}`)
    if (terrain && dataset && scoreResult.rank !== undefined) problems.push('unexpected rank on scoreSite result')
    // Degraded paths must never throw and must stay structurally complete.
    if (scenario.degraded === 'no-terrain' || scenario.degraded === 'both') {
      const degraded = core.scoreSite({ site, terrain: null, ephemeris: dataset, mission })
      outputs.scoreNoTerrain = degraded
      if (!finite(degraded.score) || degraded.score < 0 || degraded.score > 100) problems.push(`score without terrain ${degraded.score}`)
      if (!degraded.warnings.some((warning) => warning.code === 'data.terrainMissing')) problems.push('missing terrain warning not reported')
      if (!(degraded.confidence < 1)) problems.push(`degraded confidence ${degraded.confidence}`)
    }
    if (scenario.degraded === 'no-ephemeris' || scenario.degraded === 'both') {
      const noEphemeris = core.scoreSite({ site, terrain: terrain ? [terrain] : null, ephemeris: null, mission })
      outputs.scoreNoEphemeris = noEphemeris
      if (!finite(noEphemeris.score)) problems.push(`score without ephemeris ${noEphemeris.score}`)
      if (!noEphemeris.warnings.some((warning) => warning.code.startsWith('data.ephemeris'))) problems.push('missing ephemeris warning not reported')
    }
    return status('@inv/scoring', problems.length === 0, problems.join('; '))
  })

  run('@inv/ranking', () => {
    if (pois.length < 2) return { tag: '@inv/ranking', status: 'skip', detail: 'not enough POIs for ranking' }
    const rankingMission = {
      ...mission,
      missionDays: 1,
      stepSeconds: 1800,
      profileStepDeg: 30,
      startTime: scenario.dateISO,
    }
    const picked = [pois[(scenario.index + 1) % pois.length], pois[(scenario.index + 2) % pois.length]]
    const sites = [site, ...picked.map((poi) => ({ ...poi, id: `rank-${poi.id}` }))]
    const ranked = core.rankSites({
      sites,
      terrain: terrains,
      ephemeris: ephemerisBySite,
      mission: rankingMission,
    })
    outputs.ranking = ranked.map((entry) => ({ siteId: entry.siteId, score: entry.score, rank: entry.rank }))
    const problems = []
    const scored = ranked.filter((entry) => entry.score != null)
    for (let i = 1; i < scored.length; i++) {
      if (!(scored[i - 1].score >= scored[i].score)) problems.push(`not sorted at ${i}: ${scored[i - 1].score} < ${scored[i].score}`)
    }
    scored.forEach((entry, i) => {
      if (entry.rank !== i + 1) problems.push(`rank ${entry.rank} at position ${i + 1}`)
    })
    const summary = core.rankingSummary(ranked)
    outputs.rankingSummary = summary
    if (summary.count !== ranked.length) problems.push(`summary.count ${summary.count} != ${ranked.length}`)
    if (summary.scoredCount !== scored.length) problems.push(`summary.scoredCount ${summary.scoredCount} != ${scored.length}`)
    if (scored.length > 0 && summary.recommended !== scored[0].siteId) problems.push('recommended site mismatch')
    return status('@inv/ranking', problems.length === 0, problems.join('; '))
  })

  run('@inv/cache-neutrality', () => {
    const first = outputs.scorePrimary ?? core.scoreSite({ site, terrain: terrain ? [terrain] : null, ephemeris: dataset, mission })
    // clearHorizonCache is a documented no-op in the current engine, but the
    // invariant is still meaningful: recomputation must be bit-identical.
    core.clearHorizonCache()
    const second = core.scoreSite({ site, terrain: terrain ? [terrain] : null, ephemeris: dataset, mission })
    outputs.scoreSecond = second
    const problems = []
    if (!deepEqual(first.score, second.score)) problems.push(`score ${first.score} -> ${second.score}`)
    if (!deepEqual(first.components, second.components)) problems.push('components changed after clearHorizonCache')
    if (first.grade !== second.grade) problems.push('grade changed after clearHorizonCache')
    if (first.confidence !== second.confidence) problems.push('confidence changed after clearHorizonCache')
    if (profile) {
      const rebuilt = core.horizonProfile(terrain, site, { stepDeg: profileStepDeg })
      for (let i = 0; i < profile.count; i++) {
        if (rebuilt.angles[i] !== profile.angles[i]) {
          problems.push(`profile angle ${i} changed (${profile.angles[i]} -> ${rebuilt.angles[i]})`)
          break
        }
      }
    }
    return status('@inv/cache-neutrality', problems.length === 0, problems.join('; '))
  })

  // no-nan last: it inspects every collected output from the checks above.
  run('@inv/no-nan', () => {
    const nonFinite = findNonFinite(outputs)
    return status('@inv/no-nan', nonFinite.length === 0, nonFinite.map((entry) => `${entry.path}=${entry.value}`).join('; '))
  })

  // Canonical order; also build feature tags from the inputs/checks.
  checks.sort((a, b) => INVARIANTS.indexOf(a.tag) - INVARIANTS.indexOf(b.tag))

  const featureTags = new Set(['@feature/geometry', '@feature/sites'])
  if (terrain) featureTags.add('@feature/terrain')
  if (profile) featureTags.add('@feature/horizon')
  if (dataset) {
    featureTags.add('@feature/ephemeris')
    featureTags.add('@feature/power')
    featureTags.add('@feature/comms')
  }
  featureTags.add('@feature/autopilot')

  const failed = checks.filter((entry) => entry.status === 'fail')
  const warned = checks.filter((entry) => entry.status === 'warn')
  const skipped = checks.filter((entry) => entry.status === 'skip')
  const caseStatus = failed.length > 0 ? 'fail' : warned.length > 0 ? 'warn' : 'pass'

  const inputs = {
    site: scenario.site,
    regionId: scenario.regionId,
    datasetSiteId: dataset?.siteId ?? scenario.datasetSiteId ?? null,
    dateISO: scenario.dateISO,
    offGrid: scenario.offGrid,
    mission: missionBase,
    degraded: scenario.degraded,
    edge: scenario.edgeTags,
  }

  return {
    index: scenario.index,
    caseSeed: scenario.caseSeed,
    status: caseStatus,
    durationMs: Math.round((performance.now() - started) * 100) / 100,
    tags: [
      ...scenario.tags,
      ...featureTags,
      '@seed/' + scenario.seed,
      ...checks.map((entry) => entry.tag),
      '@status/' + caseStatus,
    ],
    inputs,
    checks,
    failedInvariants: failed.map((entry) => entry.tag),
    skippedInvariants: skipped.map((entry) => entry.tag),
  }
}
