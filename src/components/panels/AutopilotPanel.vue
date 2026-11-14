<script setup>
/**
 * Autopilot panel: mission-profile inputs and the ranked site results returned
 * by the background worker (or the main-thread fallback).
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import PanelCard from '../ui/PanelCard.vue'
import { actions, state } from '../composables/useAppState.js'
import { reasonText, siteDisplayName } from '../composables/labels.js'
import { formatAngle, formatDistance, formatDuration, formatLat, formatLon, formatMeters, formatNumber, formatUtc } from '../composables/format.js'

const { t, te } = useI18n()

const landingAvailable = computed(() => !state.landingZonesStatus.unavailable)
const zones = computed(() => state.landingZones ?? [])
const activeStatus = computed(() => (landingAvailable.value ? state.landingZonesStatus : state.autopilot))
const running = computed(() => activeStatus.value.status === 'running')
const selectedZoneId = computed(() => state.landingZoneEntry?.zone?.id ?? null)

function isZoneSelected(entry) {
  return (
    entry?.zone?.id === selectedZoneId.value ||
    state.selectedSiteId === `zone-${entry?.zone?.id}` ||
    state.landingZoneSite?.zoneId === entry?.zone?.id
  )
}

async function runRanking() {
  if (running.value) return
  if (landingAvailable.value) await actions.runLandingZones()
  else await actions.runAutopilot()
}

function maybeRunLandingZones() {
  if (!landingAvailable.value) return
  if (!state.terrain) return
  if (!['idle', 'stale'].includes(state.landingZonesStatus.status)) return
  actions.runLandingZones().catch(() => {})
}

onMounted(async () => {
  await actions.detectLandingZoneSupport()
  maybeRunLandingZones()
})

// The panel can mount before the DEM/worker are ready; run once terrain lands.
watch(() => state.terrain, () => maybeRunLandingZones())
watch(() => state.landingZonesStatus.status, (status) => {
  if (status === 'stale') maybeRunLandingZones()
})

const expandedZoneId = ref(null)
function toggleZone(id) {
  expandedZoneId.value = expandedZoneId.value === id ? null : id
}

const zonesMeta = computed(() => state.landingZonesMeta ?? {})
const feasibleCount = computed(() => {
  const value = Number(zonesMeta.value.feasibleZones)
  return Number.isFinite(value) ? value : null
})
const noFeasibleZone = computed(() => {
  if (!zones.value.length) return false
  if (zonesMeta.value.hasFeasibleZones === false) return true
  return feasibleCount.value === 0
})

function isRtg(entry) {
  return (entry?.metrics?.power?.source ?? entry?.feasibility?.powerSource ?? state.mission.powerSource) === 'rtg'
}

function sunRequirement(entry) {
  const offered = Number(entry?.metrics?.illumination?.continuousSunDays)
  const needed = Number(state.mission.sunDaysNeeded)
  if (!Number.isFinite(offered) || !Number.isFinite(needed)) return null
  return { offered, needed, met: offered >= needed, deficit: Math.max(0, needed - offered) }
}

function visibleViolations(entry) {
  const violations = Array.isArray(entry?.feasibility?.violations) ? entry.feasibility.violations : []
  if (!isRtg(entry)) return violations
  return violations.filter((violation) => !/(batteryInsufficient|illuminationInsufficient|powerDeficit|batteryNotSpecified)/.test(violation.code ?? ''))
}

function isInfeasible(entry) {
  if (typeof entry?.feasible === 'boolean') return !entry.feasible
  return Boolean(entry?.feasibility && entry.feasibility.feasible === false)
}

function feasibilityBadge(entry) {
  if (!entry) return null
  const status = entry.feasibility?.status
  if (typeof entry.feasible === 'boolean') {
    if (entry.feasible) return { label: t('autopilot.feasible'), tone: 'ok' }
    return { label: status === 'undetermined' ? t('autopilot.conditional') : t('autopilot.notFeasible'), tone: 'danger' }
  }
  if (!entry.feasibility) return null
  if (entry.feasibility.feasible) return { label: t('autopilot.feasible'), tone: 'ok' }
  return { label: status === 'undetermined' ? t('autopilot.conditional') : t('autopilot.notFeasible'), tone: 'danger' }
}

const ALIAS_METRIC_KEYS = new Set([
  'eclipseHours',
  'sunElevationMeanDeg',
  'heaterPowerW',
  'averageHeaterPowerW',
  'dataBudgetFraction',
])

function violationText(violation) {
  if (!violation) return ''
  const code = violation.code ?? violation.reason ?? ''
  const candidates = [`autopilot.violations.${code}`, `autopilot.${code}`]
  const key = candidates.find((candidate) => te(candidate))
  if (key) return t(key)
  if (violation.text) return violation.text
  return code
}
const zoneSignature = computed(() =>
  String(zonesMeta.value.inputSignature ?? zonesMeta.value.signature ?? state.landingZonesStatus.inputSignature ?? ''),
)
const computeMs = computed(() => {
  const meta = state.landingZonesMeta ?? {}
  const ms = Number(meta.computeMs ?? meta.rankingMs ?? Number.NaN)
  return Number.isFinite(ms) ? Math.round(ms) : null
})

const computedAt = computed(() => {
  const raw = zonesMeta.value.computedAt ?? zonesMeta.value.finishedAt ?? state.landingZonesStatus.ranAt
  if (!raw) return t('common.notAvailable')
  const date = new Date(raw)
  return Number.isNaN(date.getTime()) ? String(raw) : formatUtc(date.toISOString())
})

const MISSION_FIELD_SPECS = [
  { key: 'missionDays', min: 1, max: 60, step: 1 },
  { key: 'powerNeedW', min: 10, max: 2000, step: 10 },
  { key: 'sunDaysNeeded', min: 0, max: 60, step: 1 },
  { key: 'dataNeedMb', min: 0, max: 100000, step: 10 },
  { key: 'perimeterM', min: 10, max: 5000, step: 10 },
  { key: 'mastM', min: 1, max: 100, step: 1 },
  { key: 'panelAreaM2', min: 0.2, max: 20, step: 0.1 },
  { key: 'bitrateMbps', min: 0.1, max: 1000, step: 0.1 },
  { key: 'batteryCapacityWh', min: 0, max: 50000, step: 100 },
  { key: 'heaterMaxW', min: 0, max: 2000, step: 10 },
  { key: 'heaterWPerK', min: 0, max: 50, step: 0.5 },
  { key: 'minOperatingTemperatureC', min: -200, max: 50, step: 5 },
  { key: 'maxOperatingTemperatureC', min: -50, max: 200, step: 5 },
]
const powerSource = computed({
  get: () => state.mission.powerSource ?? 'solar',
  set: (value) => actions.updateMission({ powerSource: value }),
})
const rtgPowerW = computed({
  get: () => state.mission.rtgPowerW ?? 0,
  set: (value) => actions.updateMission({ rtgPowerW: Number(value) }),
})

const extraMissionFields = computed(() =>
  MISSION_FIELD_SPECS.filter(
    (spec) => Object.prototype.hasOwnProperty.call(state.mission, spec.key) && !['powerNeedW', 'sunDaysNeeded', 'perimeterM', 'mastM'].includes(spec.key),
  ),
)

const GROUP_KEYS = ['safety', 'illumination', 'power', 'thermal', 'comms', 'logistics', 'science']
const GROUP_LABELS = {
  safety: 'autopilot.groups.safety',
  illumination: 'autopilot.groups.illumination',
  power: 'autopilot.groups.power',
  thermal: 'autopilot.groups.thermal',
  comms: 'autopilot.groups.comms',
  logistics: 'autopilot.groups.logistics',
  science: 'autopilot.groups.science',
  general: 'autopilot.groups.general',
  missionInputs: 'autopilot.groups.missionInputs',
}
const METRIC_LABELS = {
  meanSlopeDeg: 'meanSlopeDeg',
  maxSlopeDeg: 'maxSlopeDeg',
  stdSlopeDeg: 'stdSlopeDeg',
  reliefM: 'reliefM',
  roughnessM: 'roughnessM',
  flatFraction: 'flatFraction',
  slopeGateDeg: 'slopeGateDeg',
  'ellipse.fitRatio': 'ellipseFit',
  'ellipse.marginM': 'ellipseMarginM',
  'ellipse.requiredRadiusM': 'ellipseRadiusM',
  'hazard.nearestCraterDistanceM': 'nearestCraterDistanceM',
  'hazard.craterHazard': 'craterHazard',
  totalEclipseHours: 'totalEclipseH',
  longestEclipseHours: 'longestEclipseH',
  sunElevationMeanWindowDeg: 'meanSunElevationDeg',
  sunElevationMeanSunlitDeg: 'meanSunElevationSunlitDeg',
  heaterPowerSizedW: 'heaterPowerSizedW',
  heaterAveragePowerW: 'averageHeaterPowerW',
  heatedMinTempC: 'heatedMinTempC',
  withinUnheatedOperatingRange: 'withinUnheatedOperatingRange',
  directMaxLosGapHours: 'directMaxLosGapHours',
  dataBudgetRatio: 'dataBudgetRatio',
  dataBudgetCoverage: 'dataBudgetCoverage',
  requiredAreaM2: 'ellipseRequiredAreaM2',
  availableAreaM2: 'ellipseAvailableAreaM2',
  sunlitFraction: 'sunlitFraction',
  sunlitHours: 'sunlitHours',
  continuousSunDays: 'continuousSunDays',
  longestEclipseHours: 'longestEclipseH',
  sunElevationMinDeg: 'minSunElevationDeg',
  sunElevationMaxDeg: 'maxSunElevationDeg',
  sunElevationMeanDeg: 'meanSunElevationDeg',
  sunElevationMeanSunlitDeg: 'meanSunElevationSunlitDeg',
  sunsetCount: 'sunsetCount',
  sunriseCount: 'sunriseCount',
  eclipseCount: 'eclipseCount',
  averageW: 'averageW',
  maxW: 'maxW',
  minW: 'minW',
  peakW: 'peakW',
  eclipseAverageW: 'eclipseAverageW',
  eclipseHours: 'eclipseHours',
  requiredBatteryWh: 'requiredBatteryWh',
  eclipseDeficitWh: 'eclipseDeficitWh',
  totalEclipseHours: 'totalEclipseHours',
  totalEclipseEnergyWh: 'totalEclipseEnergyWh',
  heaterLongestEclipseWh: 'heaterLongestEclipseWh',
  longestEclipseHours: 'longestEclipseBattery',
  rtgPowerW: 'rtgPowerW',
  rtgMarginW: 'rtgMarginW',
  powerSource: 'powerSourceMetric',
  batterySpecified: 'batterySpecified',
  heaterWh: 'heaterWh',
  heaterPowerW: 'heaterPowerW',
  powerNeedW: 'powerNeedW',
  powerMarginW: 'powerMarginW',
  powerMarginFraction: 'powerMarginFraction',
  batteryCapacityWh: 'batteryCapacityWh',
  batteryCoverage: 'batteryCoverage',
  meetsPowerNeed: 'meetsPowerNeed',
  dailyWh: 'dailyWh',
  dayTempC: 'dayTempC',
  nightTempC: 'nightTempC',
  psrTempC: 'psrTempC',
  minTempC: 'minTempC',
  maxTempC: 'maxTempC',
  thermalCyclingDeltaTC: 'thermalCyclingDeltaTC',
  isPsr: 'isPsr',
  minOperatingC: 'minOperatingC',
  maxOperatingC: 'maxOperatingC',
  withinOperatingRange: 'withinOperatingRange',
  earthVisibleFraction: 'earthVisibleEffective',
  directEarthVisibleFraction: 'directEarthVisibleFraction',
  maxLosGapHours: 'maxLosGapHours',
  relayCoverage: 'relayCoverage',
  relayBenefitHours: 'relayBenefitHours',
  relayBenefitFraction: 'relayBenefitFraction',
  dataBudgetMb: 'dataBudgetMb',
  dataBudgetFraction: 'dataBudgetFraction',
  meetsDataNeed: 'meetsDataNeed',
  mastBenefitDeg: 'mastBenefitDeg',
  nearestCuratedSiteDistanceM: 'nearestCuratedSiteDistanceM',
  nearestFlatPadDistanceM: 'nearestFlatPadDistanceM',
  traverseDistanceM: 'traverseDistanceM',
  traverseDifficulty: 'traverseDifficulty',
  equivalentPerimeterM: 'perimeterM',
  nearestCraterDistanceM: 'nearestCraterDistanceM',
  nearestCraterDiameterM: 'nearestCraterDiameterM',
  cratersWithinReach: 'cratersWithinReach',
  craterProximityScore: 'craterProximityScore',
  psrProximityScore: 'psrProximityScore',
  scienceDistanceM: 'scienceDistanceM',
  batteryWh: 'batteryWh',
  zoneAreaKm2: 'zoneArea',
  zoneMeanSlopeDeg: 'meanSlopeDeg',
  zoneMaxSlopeDeg: 'maxSlopeDeg',
  zoneReliefM: 'reliefM',
  meanSlopeDeg: 'meanSlopeDeg',
  maxSlopeDeg: 'maxSlopeDeg',
  slopeStdDeg: 'slopeStdDeg',
  roughnessM: 'roughnessM',
  hazardDistanceM: 'hazardDistanceM',
  usableFraction: 'usablePct',
  averageW: 'avgPowerW',
  avgW: 'avgPowerW',
  minW: 'minPowerW',
  maxW: 'maxPowerW',
  batteryWh: 'batteryWh',
  requiredBatteryWh: 'batteryWh',
  heaterWh: 'heaterWh',
  heaterW: 'heaterW',
  marginW: 'marginW',
  powerMarginW: 'marginW',
  deficitWh: 'deficitWh',
  sunlitFraction: 'sunlitPct',
  sunlitPct: 'sunlitPct',
  continuousSunDays: 'continuousSunDays',
  longestEclipseH: 'longestEclipseH',
  minSunElevationDeg: 'minSunElevationDeg',
  meanSunElevationDeg: 'meanSunElevationDeg',
  dayTempC: 'dayTempC',
  nightTempC: 'nightTempC',
  psrTempC: 'psrTempC',
  cyclingDeltaTC: 'cyclingDeltaT',
  earthVisibilityFraction: 'earthVisibilityPct',
  earthVisibilityPct: 'earthVisibilityPct',
  maxGapMin: 'maxGapMin',
  dataBudgetPct: 'dataBudgetPct',
  dataNeedMb: 'dataNeedMb',
  relayBenefit: 'relayBenefit',
  mastBenefit: 'mastBenefit',
  nearestSiteDistanceM: 'nearestSiteDistanceM',
  scienceProximityM: 'scienceProximityM',
  traverseDifficulty: 'traverseDifficulty',
  meanElevationM: 'meanElevationM',
  requiredAreaKm2: 'ellipseRequiredAreaKm2',
  availableAreaKm2: 'ellipseAvailableAreaKm2',
  requiredRadiusM: 'ellipseRadiusM',
  equivalentRadiusM: 'ellipseEquivalentRadiusM',
  nearestCraterDepthM: 'nearestCraterDepthM',
  reachM: 'hazardReachM',
  sunElevationMeanSunlitDeg: 'meanSunElevationSunlitDeg',
  totalEnergyWh: 'totalEnergyWh',
  sunlitEnergyWh: 'sunlitEnergyWh',
  averageHeaterPowerW: 'averageHeaterPowerW',
  windowHours: 'windowHours',
  availableHours: 'availableHours',
  relayDataRateMbps: 'relayDataRateMbps',
  windowCount: 'windowCount',
  nearestFlatPadAreaKm2: 'nearestFlatPadAreaKm2',
  panelAreaM2: 'panelAreaM2',
  panelEfficiency: 'panelEfficiency',
  systemDerate: 'systemDerate',
  sunlitDays: 'continuousSunDays',
  longestSunWindowDays: 'continuousSunDays',
  requiredBatteryWh: 'requiredBatteryWh',
  powerMarginW: 'powerMarginW',
  dataNeedMb: 'dataNeedMb',
  meanElevationM: 'meanElevationM',
  'ellipse.requiredAreaKm2': 'ellipseRequiredAreaKm2',
  'ellipse.availableAreaKm2': 'ellipseAvailableAreaKm2',
  'ellipse.requiredRadiusM': 'ellipseRadiusM',
  'ellipse.equivalentRadiusM': 'ellipseEquivalentRadiusM',
  'hazard.nearestCraterDiameterM': 'nearestCraterDiameterM',
  'hazard.nearestCraterDepthM': 'nearestCraterDepthM',
  'hazard.cratersWithinReach': 'cratersWithinReach',
  'hazard.reachM': 'hazardReachM',
  'model.panelAreaM2': 'panelAreaM2',
  'model.panelEfficiency': 'panelEfficiency',
  'model.systemDerate': 'systemDerate',
  'model.albedo': 'albedo',
  'model.emissivity': 'emissivity',
  'model.solarConstantWm2': 'solarConstantWm2',

}

function humanize(key) {
  return String(key ?? '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .replace(/^./, (char) => char.toUpperCase())
}

function groupLabel(key) {
  const labelKey = GROUP_LABELS[key]
  if (labelKey && te(labelKey)) return t(labelKey)
  return humanize(key)
}

function metricLabel(key) {
  const leaf = String(key).includes('.') ? String(key).split('.').pop() : String(key)
  if (leaf === 'mastM') return t('autopilot.mast')
  const short = METRIC_LABELS[key] ?? METRIC_LABELS[leaf]
  if (short) {
    const i18nKey = `autopilot.metrics.${short}`
    if (te(i18nKey)) return t(i18nKey)
  }
  return humanize(leaf)
}

function inferUnit(key) {
  const lower = String(key).toLowerCase()
  if (/(fraction|pct|percent|ratio|coverage|difficulty|hazard|score)$/i.test(lower)) return '%'
  if (lower.endsWith('wh')) return 'Wh'
  if (lower.endsWith('w')) return 'W'
  if (lower.endsWith('c') || lower.includes('temp')) return '°C'
  if (lower.includes('days')) return 'days'
  if (/hours?$/.test(lower) || /eclipseh$/.test(lower)) return 'h'
  if (lower.endsWith('min') || lower.includes('minutes')) return 'min'
  if (/km2$/.test(lower)) return 'km²'
  if (/m2$/.test(lower)) return 'm²'
  if (lower.endsWith('km')) return 'km'
  if (lower.endsWith('mb')) return 'Mb'
  if (lower.endsWith('mbps')) return 'Mbps'
  if (lower.includes('count')) return ''
  if (lower.endsWith('m')) return 'm'
  if (lower.includes('deg')) return '°'
  if (lower.includes('mb')) return 'Mb'
  return ''
}

function formatMetric(key, value) {
  if (typeof value === 'boolean') return value ? t('common.yes') : t('common.no')
  if (/solarConstantWm2$/i.test(String(key))) {
    const constant = Number(value)
    if (Number.isFinite(constant)) return `${formatNumber(constant, 0)} W/m²`
  }
  const budgetKey = String(key).toLowerCase()
  if (budgetKey.includes('databudget') && /(ratio|fraction)$/.test(budgetKey)) {
    const ratio = Number(value)
    if (Number.isFinite(ratio)) {
      return t('autopilot.dataBudgetOfNeed', { value: formatNumber(ratio, ratio >= 100 ? 0 : ratio >= 10 ? 1 : 2) })
    }
  }
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return String(value)
  const lower = String(key).toLowerCase()
  const isCountKey = /(count|sunsets?|sunrises?|eclipses|craterswithinreach|windowcount)$/i.test(lower)
  const unit = isCountKey ? '' : inferUnit(key)
  if (unit === '%') {
    const ratio =
      /(fraction|ratio|coverage|difficulty|hazard|proximityscore)$/i.test(lower) ||
      (numeric >= 0 && numeric <= 1)
    const percent = ratio ? numeric * 100 : numeric
    return `${formatNumber(percent, 1)} %`
  }
  const isCount = /(count|sunsets?|sunrises?|eclipses|craterswithinreach|windowcount)$/i.test(lower)
  const magnitude = isCount ? 0 : Math.abs(numeric) >= 100 ? 0 : Math.abs(numeric) >= 10 ? 1 : 2
  const text = `${formatNumber(numeric, magnitude)}${unit ? ` ${unit}` : ''}`
  return text.replace(/ \?°C/, ' °C')
}

function flattenNumbers(value, prefix = '', out = []) {
  if (!value || typeof value !== 'object') return out
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === 'number' && Number.isFinite(entry)) out.push({ key: prefix ? `${prefix}.${key}` : key, value: entry })
    else if (entry && typeof entry === 'object' && !Array.isArray(entry)) flattenNumbers(entry, prefix ? `${prefix}.${key}` : key, out)
  }
  return out
}

function zoneGroups(entry) {
  const metrics = entry?.metrics ?? {}
  const groups = []
  const seen = new Set()
  for (const key of [...GROUP_KEYS, 'missionInputs']) {
    const source = metrics[key] ?? (key === 'missionInputs' ? entry?.metrics?.missionInputs : entry?.[key])
    if (source && typeof source === 'object') {
      const items = flattenNumbers(source)
        .filter((item) => !ALIAS_METRIC_KEYS.has(item.key.split('.').pop()))
        .filter((item) => {
          const dedupeKey = `${metricLabel(item.key)}|${formatMetric(item.key, item.value)}`
          if (seen.has(dedupeKey)) return false
          seen.add(dedupeKey)
          return true
        })
      if (items.length) groups.push({ key, items })
    }
  }
  if (!groups.length) {
    const general = Object.entries(metrics)
      .filter(([key, value]) => typeof value === 'number' && Number.isFinite(value))
      .map(([key, value]) => ({ key, value }))
    if (general.length) groups.push({ key: 'general', items: general })
  }
  return groups
}

function zoneWarnings(entry) {
  const warnings = Array.isArray(entry?.warnings) ? entry.warnings : []
  return warnings.filter((warning) => warning?.code === 'ephemeris-nearest-site' || warning?.code === 'no-nearest-site')
}

const statusLabel = computed(() => {
  switch (activeStatus.value.status) {
    case 'running':
      return t('autopilot.status.running')
    case 'done':
      return t('autopilot.status.done')
    case 'stale':
      return t('autopilot.status.stale')
    case 'error':
      return t('autopilot.status.error')
    default:
      return t('autopilot.status.idle')
  }
})

const statusTone = computed(() => {
  if (activeStatus.value.status === 'error') return 'danger'
  if (activeStatus.value.status === 'running') return 'warn'
  if (activeStatus.value.status === 'done') return 'ok'
  if (activeStatus.value.status === 'unavailable') return 'warn'
  return 'default'
})

const sourceLabel = computed(() => {
  if (activeStatus.value.source === 'worker') return t('autopilot.source.worker')
  if (activeStatus.value.source === 'main') return t('autopilot.source.main')
  return t('common.notAvailable')
})

function missionField(key) {
  return computed({
    get: () => state.mission[key],
    set: (value) => actions.updateMission({ [key]: Number(value) }),
  })
}

const missionDays = missionField('missionDays')
const powerNeedW = missionField('powerNeedW')
const sunDaysNeeded = missionField('sunDaysNeeded')
const perimeterM = missionField('perimeterM')
const mastM = missionField('mastM')

const dateSearchEnabled = computed({
  get: () => state.mission.dateSearchEnabled !== false,
  set: (value) => actions.updateMission({ dateSearchEnabled: Boolean(value) }),
})
const dateSearchStepHours = computed({
  get: () => Number(state.mission.dateSearchStepHours) || 12,
  set: (value) => actions.updateMission({ dateSearchStepHours: Number(value) }),
})
const dateSearchMeta = computed(() => state.landingZonesMeta?.dateSearch ?? null)
const noFeasibleDate = computed(() => {
  if (!dateSearchMeta.value || !zones.value.length) return false
  return Number(dateSearchMeta.value.zonesWithFeasibleDate) === 0
})
async function goToFeasibleDate(entry) {
  if (!entry?.feasibleDate) return
  await actions.selectLandingZone(entry)
  actions.setTime(new Date(entry.feasibleDate).toISOString())
}
function formatFeasibleDate(value) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? String(value) : formatUtc(date.toISOString())
}

const batteryCapacityWh = missionField('batteryCapacityWh')
const heaterMaxW = missionField('heaterMaxW')
const heaterWPerK = missionField('heaterWPerK')
const minOperatingTemperatureC = missionField('minOperatingTemperatureC')
const maxOperatingTemperatureC = missionField('maxOperatingTemperatureC')
const dataNeedMb = missionField('dataNeedMb')
const panelAreaM2 = missionField('panelAreaM2')
const bitrateMbps = missionField('bitrateMbps')

const relayInOrbit = computed({
  get: () => state.mission.relayInOrbit,
  set: (value) => actions.updateMission({ relayInOrbit: Boolean(value) }),
})

function selectSite(id) {
  actions.selectSite(id)
}

const ranking = computed(() => state.scores)
</script>

<template>
  <PanelCard title-key="autopilot.title" :badge="statusLabel" :tone="statusTone">
    <template #actions>
      <button type="button" class="button button--secondary button--small" :disabled="running" @click="runRanking">
        {{ running ? t('autopilot.running') : t('autopilot.run') }}
      </button>
    </template>

    <p class="panel-hint">{{ t('autopilot.hint') }}</p>

    <div class="field-grid">
      <label class="field">
        <span class="field__label">{{ t('autopilot.missionDays') }}</span>
        <input v-model.number="missionDays" class="input" type="number" min="1" max="60" step="1" data-testid="mission-days" />
      </label>
      <label class="field">
        <span class="field__label">{{ t('autopilot.powerNeedW') }}</span>
        <input v-model.number="powerNeedW" class="input" type="number" min="10" max="2000" step="10" data-testid="mission-power-need" />
      </label>
      <label class="field" :title="t('autopilot.sunDaysNeededHint')">
        <span class="field__label">{{ t('autopilot.sunDaysNeeded') }}</span>
        <input
          v-model.number="sunDaysNeeded"
          class="input"
          type="number"
          min="0"
          max="60"
          step="1"
          data-testid="mission-sun-days"
          :aria-label="t('autopilot.sunDaysNeeded')"
          :aria-description="t('autopilot.sunDaysNeededHint')"
        />
      </label>
      <label class="field">
        <span class="field__label">{{ t('autopilot.perimeter') }}</span>
        <input v-model.number="perimeterM" class="input" type="number" min="10" max="5000" step="10" />
      </label>
      <label class="field">
        <span class="field__label">{{ t('autopilot.mast') }}</span>
        <input v-model.number="mastM" class="input" type="number" min="1" max="100" step="1" />
      </label>
      <label class="field field--inline">
        <input v-model="relayInOrbit" type="checkbox" />
        <span>{{ t('autopilot.relay') }}</span>
      </label>
      <label class="field field--inline">
        <input v-model="dateSearchEnabled" type="checkbox" data-testid="ap-date-search-toggle" />
        <span>{{ t('autopilot.dateSearch.enable') }}</span>
      </label>
      <label class="field">
        <span class="field__label">{{ t('autopilot.dateSearch.step') }}</span>
        <select v-model.number="dateSearchStepHours" class="input" data-testid="ap-date-step" :aria-label="t('autopilot.dateSearch.step')">
          <option :value="6">6 h</option>
          <option :value="12">12 h</option>
          <option :value="24">24 h</option>
        </select>
      </label>
      <label class="field">
        <span class="field__label">{{ t('autopilot.powerSource') }}</span>
        <select v-model="powerSource" class="input" data-testid="mission-power-source" :aria-label="t('autopilot.powerSource')">
          <option value="solar">{{ t('autopilot.powerSourceSolar') }}</option>
          <option value="rtg">{{ t('autopilot.powerSourceRtg') }}</option>
        </select>
      </label>
      <label v-if="powerSource === 'rtg'" class="field">
        <span class="field__label">{{ t('autopilot.rtgPowerW') }}</span>
        <input v-model.number="rtgPowerW" class="input" type="number" min="0" max="5000" step="10" data-testid="mission-rtg-power" />
      </label>
      <label class="field">
        <span class="field__label">{{ t('autopilot.mission.batteryCapacityWh') }}</span>
        <input v-model.number="batteryCapacityWh" class="input" type="number" min="0" max="50000" step="1000" data-testid="mission-battery-wh" />
      </label>
      <label class="field">
        <span class="field__label">{{ t('autopilot.mission.heaterMaxW') }}</span>
        <input v-model.number="heaterMaxW" class="input" type="number" min="0" max="2000" step="10" />
      </label>
      <label class="field">
        <span class="field__label">{{ t('autopilot.mission.heaterWPerK') }}</span>
        <input v-model.number="heaterWPerK" class="input" type="number" min="0" max="50" step="0.5" />
      </label>
      <label class="field">
        <span class="field__label">{{ t('autopilot.mission.minOperatingTemperatureC') }}</span>
        <input v-model.number="minOperatingTemperatureC" class="input" type="number" min="-200" max="50" step="5" />
      </label>
      <label class="field">
        <span class="field__label">{{ t('autopilot.mission.maxOperatingTemperatureC') }}</span>
        <input v-model.number="maxOperatingTemperatureC" class="input" type="number" min="-50" max="200" step="5" />
      </label>
      <label class="field">
        <span class="field__label">{{ t('autopilot.mission.dataNeedMb') }}</span>
        <input v-model.number="dataNeedMb" class="input" type="number" min="0" max="100000" step="10" />
      </label>
      <label class="field">
        <span class="field__label">{{ t('autopilot.mission.panelAreaM2') }}</span>
        <input v-model.number="panelAreaM2" class="input" type="number" min="0.2" max="20" step="0.1" />
      </label>
      <label class="field">
        <span class="field__label">{{ t('autopilot.mission.bitrateMbps') }}</span>
        <input v-model.number="bitrateMbps" class="input" type="number" min="0.1" max="1000" step="0.1" />
      </label>
    </div>

    <p class="panel-note">
      {{ t('autopilot.statusLabel') }}: {{ statusLabel }}
      / {{ t('autopilot.sourceLabel') }}: {{ sourceLabel }}
      <template v-if="state.autopilot.durationMs !== null"> / {{ formatDuration(state.autopilot.durationMs / 1000) }}</template>
    </p>
    <p v-if="state.autopilot.error" class="panel-note panel-note--warn">
      {{ t('autopilot.fallbackNote') }}: {{ state.autopilot.error }}
    </p>

    <p v-if="noFeasibleDate" class="feasibility-alert" data-testid="ap-no-feasible-date" role="status">
      {{ t('autopilot.dateSearch.noDateAlert') }}
    </p>
    <p v-if="dateSearchMeta" class="panel-hint date-search-meta" :title="`${dateSearchMeta.rangeStart ?? ''} – ${dateSearchMeta.rangeEnd ?? ''}`">
      {{ t('autopilot.dateSearch.meta', {
        start: dateSearchMeta.rangeStart ? formatFeasibleDate(dateSearchMeta.rangeStart) : t('common.notAvailable'),
        end: dateSearchMeta.rangeEnd ? formatFeasibleDate(dateSearchMeta.rangeEnd) : t('common.notAvailable'),
        step: dateSearchMeta.stepHours ?? dateSearchStepHours,
        withDate: dateSearchMeta.zonesWithFeasibleDate ?? 0,
        withoutDate: dateSearchMeta.zonesWithoutFeasibleDate ?? 0,
      }) }}
    </p>

    <p v-if="noFeasibleZone" class="feasibility-alert" role="status">
      {{ t('autopilot.noFeasibleZone') }}
    </p>
    <div v-if="landingAvailable && zones.length" class="zone-meta" data-testid="landing-zone-signature">
      <p class="panel-hint zone-meta__text" :title="zoneSignature || undefined">
        <template v-if="feasibleCount !== null"> {{ t('autopilot.feasibleCount', { count: feasibleCount, total: zones.length }) }} · </template>
        {{ t('autopilot.computedAt') }}: {{ computedAt }}<template v-if="computeMs !== null"> · {{ formatDuration(computeMs / 1000) }}</template>
        · {{ t('autopilot.signature') }}: <code data-testid="landing-zone-signature">{{ zoneSignature ? zoneSignature.slice(0, 8) : t('common.notAvailable') }}</code>
      </p>
      <button type="button" class="button button--ghost button--small" :disabled="running" @click="actions.runLandingZones()">
        {{ t('autopilot.recalculate') }}
      </button>
    </div>

    <template v-if="landingAvailable">
      <p v-if="state.landingZonesStatus.status === 'unavailable'" class="panel-note panel-note--warn">
        {{ t('autopilot.zonesUnavailable') }}
      </p>
      <p v-else-if="running" class="panel-note">{{ t('autopilot.zonesRunning') }}</p>
      <p v-else-if="state.landingZonesStatus.status === 'error'" class="panel-note panel-note--warn">
        {{ t('autopilot.zonesError') }}: {{ state.landingZonesStatus.error }}
      </p>
      <p v-else-if="state.landingZonesStatus.status === 'stale'" class="panel-note panel-note--warn">
        {{ t('autopilot.zonesStale') }}
      </p>
      <p v-else-if="!zones.length" class="empty">{{ t('autopilot.zonesEmpty') }}</p>
      <ol v-else class="rank-list" :aria-label="t('autopilot.zonesLabel')">
        <li
          v-for="entry in zones"
          :key="entry.zone.id"
          class="rank-item"
          :class="{ 'is-selected': isZoneSelected(entry), 'is-infeasible': isInfeasible(entry) }"
          data-testid="landing-zone-row"
          :data-zone-rank="entry.rank"
          :data-zone-id="entry.zone.id"
        >
          <span
            v-if="isZoneSelected(entry)"
            class="sr-only"
            data-testid="landing-zone-selected"
          >{{ t('autopilot.zoneSelected') }}</span>
          <button type="button" class="rank-item__head" @click="actions.selectLandingZone(entry)">
            <span class="rank-item__rank">#{{ entry.rank }}</span>
            <span class="rank-item__name">{{ t('autopilot.zoneLabel', { lat: formatLat(entry.zone.lat), lon: formatLon(entry.zone.lon) }) }}</span>
            <span
              v-if="feasibilityBadge(entry)"
              class="tag"
              :class="`tag--${feasibilityBadge(entry).tone}`"
            >{{ feasibilityBadge(entry).label }}</span>
            <span v-if="entry.grade" class="tag" :class="{ 'tag--danger': isInfeasible(entry) }">{{ entry.grade }}</span>
            <span class="rank-item__score" :title="entry.rawScore != null ? `${t('autopilot.rawScore')}: ${formatNumber(entry.rawScore, 1)}` : undefined">
              {{ formatNumber(entry.score, 1) }}<template v-if="entry.scoreCapApplied">*</template>
            </span>
          </button>
          <div class="rank-item__bar" aria-hidden="true">
            <span class="rank-item__bar-fill" :style="{ width: `${Math.max(0, Math.min(100, entry.score))}%` }" />
          </div>
          <div class="rank-item__metrics">
            <span>{{ t('autopilot.zoneArea') }} {{ formatNumber(entry.zone.areaKm2, 1) }} km²</span>
            <span>{{ t('autopilot.zoneSlope') }} {{ formatAngle(entry.zone.meanSlopeDeg, 1) }} / {{ formatAngle(entry.zone.maxSlopeDeg, 1) }}</span>
            <span>{{ t('autopilot.zoneElevation') }} {{ formatMeters(entry.zone.elevationM) }}</span>
            <span>{{ t('autopilot.zoneRelief') }} {{ formatMeters(entry.zone.reliefM) }}</span>
          </div>
          <div class="zone-date" :data-testid="`ap-date-${entry.rank}`">
            <template v-if="entry.hasFeasibleDate && entry.feasibleDate">
              <span class="zone-date__value">{{ t('autopilot.dateSearch.feasibleDate') }}: {{ formatFeasibleDate(entry.feasibleDate) }}</span>
              <span v-if="entry.feasibleDateScore != null" class="zone-date__score">{{ t('autopilot.dateSearch.dateScore') }}: {{ formatNumber(entry.feasibleDateScore, 1) }}</span>
              <button type="button" class="rank-item__details" @click.stop="goToFeasibleDate(entry)">
                {{ t('autopilot.dateSearch.goToDate') }}
              </button>
            </template>
            <span v-else class="zone-date__missing">{{ t('autopilot.dateSearch.noDate') }}</span>
          </div>
          <button
            type="button"
            class="rank-item__details"
            data-testid="landing-zone-details"
            :aria-expanded="expandedZoneId === entry.zone.id"
            @click="toggleZone(entry.zone.id)"
          >
            {{ expandedZoneId === entry.zone.id ? t('autopilot.hideDetails') : t('autopilot.showDetails') }}
          </button>
          <div v-if="expandedZoneId === entry.zone.id" class="zone-detail">
            <p v-if="isRtg(entry)" class="panel-note">{{ t('autopilot.rtgNote') }}</p>
            <p
              v-else-if="sunRequirement(entry)"
              class="sun-requirement"
              :class="sunRequirement(entry).met ? 'is-met' : 'is-unmet'"
            >
              {{ sunRequirement(entry).met
                ? t('autopilot.sunRequirementMet', { offered: formatNumber(sunRequirement(entry).offered, 1), needed: sunRequirement(entry).needed })
                : t('autopilot.sunRequirementUnmet', { offered: formatNumber(sunRequirement(entry).offered, 1), needed: sunRequirement(entry).needed }) }}
            </p>
            <section v-for="group in zoneGroups(entry)" :key="group.key" class="zone-detail__group">
              <h4 class="zone-detail__title">{{ groupLabel(group.key) }}</h4>
              <dl class="zone-detail__grid">
                <div v-for="item in group.items" :key="item.key" class="zone-detail__item">
                  <dt>{{ metricLabel(item.key) }}</dt>
                  <dd>{{ formatMetric(item.key, item.value) }}</dd>
                </div>
              </dl>
            </section>
            <p v-if="!zoneGroups(entry).length" class="panel-hint">{{ t('autopilot.noDetails') }}</p>
          </div>
          <ul v-if="visibleViolations(entry).length" class="reason-list violation-list">
            <li
              v-for="(violation, index) in visibleViolations(entry)"
              :key="`${entry.zone.id}-violation-${index}`"
              class="reason"
              :class="violation.severity === 'warn' ? 'reason--approx' : 'reason--danger'"
            >
              {{ violationText(violation) }}
            </li>
          </ul>
          <ul v-if="zoneWarnings(entry).length" class="reason-list">
            <li
              v-for="(warning, index) in zoneWarnings(entry)"
              :key="`${entry.zone.id}-warn-${index}`"
              class="reason reason--approx"
            >
              {{ warning.code === 'no-nearest-site' ? t('autopilot.warningNoNearestSite') : t('autopilot.warningNearestEphemeris', { site: warning.params?.ephemerisSiteId ?? '', distance: formatDistance(warning.params?.distanceM ?? 0) }) }}
            </li>
          </ul>
        </li>
      </ol>
    </template>
    <ol v-if="!landingAvailable && ranking.length" class="rank-list" :aria-label="t('autopilot.rankingLabel')">
      <li v-for="entry in ranking" :key="entry.siteId" class="rank-item" :class="{ 'is-selected': entry.siteId === state.selectedSiteId }">
        <button type="button" class="rank-item__head" @click="selectSite(entry.siteId)">
          <span class="rank-item__rank">#{{ entry.rank }}</span>
          <span class="rank-item__name">{{ siteDisplayName(t, te, entry.site) }}</span>
          <span class="rank-item__score">{{ entry.score.toFixed(1) }}</span>
        </button>
        <div class="rank-item__bar" aria-hidden="true">
          <span class="rank-item__bar-fill" :style="{ width: `${Math.max(0, Math.min(100, entry.score))}%` }" />
        </div>
        <div class="rank-item__metrics">
          <span v-if="Number.isFinite(entry.sunlightDays)">{{ t('autopilot.metricSunlight') }} {{ formatNumber(entry.sunlightDays, 1) }} d</span>
          <span v-if="Number.isFinite(entry.averageW)">{{ t('autopilot.metricPower') }} {{ formatNumber(entry.averageW, 0) }} W</span>
          <span v-if="Number.isFinite(entry.commsHours)">{{ t('autopilot.metricComms') }} {{ formatNumber(entry.commsHours, 1) }} h</span>
        </div>
        <ul v-if="entry.reasons.length" class="reason-list">
          <li
            v-for="(reason, index) in entry.reasons.slice(0, 3)"
            :key="`${entry.siteId}-${index}`"
            class="reason"
            :class="reason.severity ? `reason--${reason.severity}` : null"
          >
            {{ reasonText(t, te, reason) }}
          </li>
          <li v-if="entry.reasons.length > 3" class="reason reason--more">
            {{ t('autopilot.reasons.moreReasons', { count: entry.reasons.length - 3 }) }}
          </li>
        </ul>
      </li>
    </ol>
    <p v-else-if="!landingAvailable" class="empty">{{ t('autopilot.empty') }}</p>
    <p class="panel-note">{{ t('autopilot.workerNote') }}</p>
  </PanelCard>
</template>
