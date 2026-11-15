<script setup>
/**
 * Mission cycles: aligned weekly strips for Sunlight, direct Earth link and
 * effective link with relay over the mission window. Segments seek the mission
 * clock; the relay toggle is bound to the shared mission profile.
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import PanelCard from '../ui/PanelCard.vue'
import { actions, selectedSite, state } from '../composables/useAppState.js'
import { getCompute } from '../composables/useCompute.js'
import { runInWorker } from '../composables/moduleBridge.js'
import { formatDuration, formatNumber, formatUtc } from '../composables/format.js'

const { t } = useI18n()

const cycles = ref(null)
const status = ref('idle')
const error = ref(null)
let computeApi = null
let requestToken = 0
let timer = null

const relayEnabled = computed({
  get: () => Boolean(state.mission.relayInOrbit),
  set: (value) => actions.updateMission({ relayInOrbit: Boolean(value) }),
})

const windowInfo = computed(() => cycles.value?.window ?? null)
const weeks = computed(() => cycles.value?.weeks ?? [])
const totalMs = computed(() => {
  const window = windowInfo.value
  if (!window) return 1
  return Math.max(1, Number(window.endMs) - Number(window.startMs))
})

const currentFraction = computed(() => {
  const window = windowInfo.value
  if (!window) return null
  const time = new Date(state.time).getTime()
  if (!Number.isFinite(time)) return null
  const fraction = (time - Number(window.startMs)) / totalMs.value
  return fraction >= 0 && fraction <= 1 ? fraction : null
})

function fractionOf(ms) {
  const window = windowInfo.value
  if (!window) return 0
  return Math.min(1, Math.max(0, (Number(ms) - Number(window.startMs)) / totalMs.value))
}

function segmentStyle(segment) {
  const start = fractionOf(segment.startMs)
  const end = fractionOf(segment.endMs)
  return { left: `${start * 100}%`, width: `${Math.max(0.15, (end - start) * 100)}%` }
}

function segmentLabel(segment, row) {
  const kind = segment.kind ?? ''
  const start = formatUtc(new Date(Number(segment.startMs)).toISOString())
  const end = formatUtc(new Date(Number(segment.endMs)).toISOString())
  return t(`cycles.segment.${row}.${kind}`, { start, end })
}

function seek(segment) {
  const start = Number(segment.startMs)
  const end = Number(segment.endMs)
  if (!Number.isFinite(start) || !Number.isFinite(end)) return
  actions.setTime(new Date(start + (end - start) / 2).toISOString())
}

const sunIntervals = computed(() => cycles.value?.sunlight?.intervals ?? [])
const directIntervals = computed(() => cycles.value?.direct?.intervals ?? [])
const relayIntervals = computed(() => {
  if (!relayEnabled.value) return cycles.value?.direct?.intervals ?? []
  return cycles.value?.effective?.intervals ?? cycles.value?.relay?.intervals ?? []
})

const summary = computed(() => {
  const value = cycles.value
  if (!value) return null
  const sunlight = value.sunlight ?? {}
  const direct = value.direct ?? {}
  const relay = value.relay ?? {}
  const effective = value.effective ?? relay
  const directGaps = Number(direct.gapHours)
  const effectiveGaps = Number(effective?.gapHours)
  const benefit = Number(relay.benefitHours ?? value.effective?.benefitHours ?? 0)
  return {
    sunHours: Number(sunlight.sunHours),
    eclipseHours: Number(sunlight.eclipseHours),
    eclipseCount: Number(sunlight.eclipseCount),
    linkHours: Number(direct.linkHours),
    gapHours: directGaps,
    gapCount: Number(direct.gapCount),
    relayBenefitHours: Number.isFinite(benefit) ? benefit : Math.max(0, directGaps - (Number.isFinite(effectiveGaps) ? effectiveGaps : directGaps)),
    effectiveGapHours: effectiveGaps,
    gapReduction: Number.isFinite(effectiveGaps) ? directGaps - effectiveGaps : null,
  }
})

const weekSummaries = computed(() => cycles.value?.perWeek ?? [])

function weekTitle(week) {
  const summaryWeek = weekSummaries.value.find((entry) => Number(entry.index) === Number(week.index))
  if (!summaryWeek) return ''
  return [
    `${t('cycles.week')} ${week.index}`,
    `${t('cycles.sun')}: ${formatNumber(Number(summaryWeek.sunHours ?? 0), 1)} h`,
    `${t('cycles.eclipse')}: ${formatNumber(Number(summaryWeek.eclipseHours ?? 0), 1)} h`,
    `${t('cycles.link')}: ${formatNumber(Number(summaryWeek.linkHours ?? 0), 1)} h`,
    `${t('cycles.gap')}: ${formatNumber(Number(summaryWeek.gapHours ?? 0), 1)} h`,
  ].join(' · ')
}

const dayTicks = computed(() => {
  const window = windowInfo.value
  if (!window) return []
  const days = Math.max(1, Math.round(totalMs.value / 86400000))
  return Array.from({ length: days }, (_, index) => ({
    index: index + 1,
    left: ((index + 0.5) / days) * 100,
  }))
})

async function runCycles() {
  const site = selectedSite.value
  if (!computeApi || !state.terrain || !site) {
    status.value = computeApi ? 'waiting' : 'unavailable'
    return
  }
  const token = ++requestToken
  status.value = 'computing'
  try {
    await Promise.resolve()
    const startTime = state.mission.startTime ?? state.time
    const mission = { ...state.mission, startTime: new Date(startTime).toISOString() }
    const payload = {
      site: { id: site.id, lat: site.lat, lon: site.lon, elevationM: site.elevationM ?? null, ephemerisSiteId: site.ephemerisSiteId ?? null },
      terrain: plainTerrain(state.terrain),
      ephemeris: plainEphemeris(state.ephemeris),
      mission,
    }
    let result = null
    if (state.worker.available) {
      const worker = await runInWorker('missionCycles', payload, 20000)
      if (worker.ok && worker.payload && Array.isArray(worker.payload.weeks)) result = worker.payload
    }
    if (!result) {
      result = computeApi.missionCycles({
        terrain: state.terrain,
        site,
        ephemeris: state.ephemeris,
        mission,
      })
    }
    if (token !== requestToken) return
    if (!result) {
      status.value = 'unavailable'
      cycles.value = null
      return
    }
    cycles.value = result
    status.value = 'ready'
    error.value = null
  } catch (computeError) {
    if (token !== requestToken) return
    status.value = 'error'
    error.value = computeError instanceof Error ? computeError.message : String(computeError)
  }
}

function plainTerrain(terrain) {
  if (!terrain) return null
  return {
    id: terrain.regionId ?? terrain.id ?? 'terrain',
    name: terrain.name ?? null,
    width: terrain.width,
    height: terrain.height,
    pixelSizeM: terrain.pixelSizeM,
    minX: terrain.minX,
    maxX: terrain.maxX,
    minY: terrain.minY,
    maxY: terrain.maxY,
    referenceRadiusM: terrain.datum ?? terrain.referenceRadiusM ?? 1737400,
    dtype: terrain.data instanceof Float32Array ? 'float32' : 'int16',
    attribution: terrain.attribution ?? null,
    synthetic: state.data.terrainSource === 'synthetic',
    data: terrain.data,
  }
}

function plainEphemeris(dataset) {
  if (!dataset?.samples) return undefined
  return {
    siteId: dataset.siteId,
    source: dataset.source,
    start: dataset.start,
    end: dataset.end,
    samples: dataset.samples.map((sample) => ({
      time: sample.time,
      sun: { ...sample.sun },
      earth: { ...sample.earth },
    })),
  }
}

function schedule(delay = 320) {
  if (timer) clearTimeout(timer)
  if (status.value === 'ready') status.value = 'stale'
  timer = setTimeout(() => {
    timer = null
    runCycles()
  }, delay)
}

onMounted(async () => {
  computeApi = await getCompute()
  runCycles()
})

watch(
  () => [state.terrain, selectedSite.value?.id, selectedSite.value?.lat, selectedSite.value?.lon, state.ephemeris],
  () => schedule(120),
)
watch(
  () => [state.mission.missionDays, state.mission.relayInOrbit],
  () => schedule(160),
)
watch(
  () => state.time,
  () => {
    if (!state.playback?.playing) schedule(420)
  },
)

onBeforeUnmount(() => {
  requestToken += 1
  if (timer) clearTimeout(timer)
})

const statusLabel = computed(() => {
  switch (status.value) {
    case 'computing':
      return t('cycles.status.computing')
    case 'stale':
      return t('cycles.status.stale')
    case 'ready':
      return t('cycles.status.ready')
    case 'waiting':
      return t('cycles.status.waiting')
    case 'unavailable':
      return t('cycles.status.unavailable')
    case 'error':
      return t('cycles.status.error')
    default:
      return t('cycles.status.idle')
  }
})
</script>

<template>
  <PanelCard
    title-key="cycles.title"
    :badge="statusLabel"
    :tone="status === 'error' || status === 'unavailable' ? 'warn' : status === 'computing' || status === 'stale' ? 'warn' : status === 'ready' ? 'ok' : 'default'"
    :default-open="true"
  >
    <div class="cycles-toolbar">
      <label class="cycles-relay-toggle">
        <input
          v-model="relayEnabled"
          type="checkbox"
          data-testid="cycles-relay-toggle"
          :aria-label="t('cycles.relayToggle')"
        />
        <span>{{ t('cycles.relayToggle') }}</span>
      </label>
      <span class="cycles-window" aria-live="polite">
        <template v-if="windowInfo">
          {{ formatUtc(new Date(Number(windowInfo.startMs)).toISOString()) }} –
          {{ formatUtc(new Date(Number(windowInfo.endMs)).toISOString()) }}
          · {{ t('cycles.days', { count: Math.round(totalMs / 86400000) }) }}
        </template>
        <template v-else>{{ statusLabel }}</template>
      </span>
    </div>

    <p v-if="status === 'unavailable'" class="panel-note panel-note--warn">{{ t('cycles.unavailable') }}</p>
    <p v-else-if="status === 'error'" class="panel-note panel-note--warn" :title="error || undefined">
      {{ t('cycles.error') }}
    </p>

    <div v-if="cycles" class="cycles-chart">
      <div class="cycles-axis" aria-hidden="true">
        <span
          v-for="week in weeks"
          :key="`week-${week.index}`"
          class="cycles-week-label"
          :style="{ left: `${fractionOf(week.startMs) * 100}%`, width: `${(fractionOf(week.endMs) - fractionOf(week.startMs)) * 100}%` }"
          :title="weekTitle(week)"
        >{{ t('cycles.week') }} {{ week.index }}</span>
        <span
          v-for="tick in dayTicks"
          :key="`tick-${tick.index}`"
          class="cycles-day-tick"
          :style="{ left: `${tick.left}%` }"
        />
      </div>

      <div class="cycles-rows">
        <div class="cycles-row" data-testid="cycles-sun">
          <span class="cycles-row__label">{{ t('cycles.sun') }}</span>
          <div class="cycles-track">
            <button
              v-for="(segment, index) in sunIntervals"
              :key="`sun-${index}`"
              type="button"
              class="cycles-segment"
              :class="`cycles-segment--${segment.kind === 'sun' ? 'sun' : 'eclipse'}`"
              :style="segmentStyle(segment)"
              :title="segmentLabel(segment, 'sun')"
              :aria-label="segmentLabel(segment, 'sun')"
              @click="seek(segment)"
            />
            <span v-if="currentFraction !== null" class="cycles-now" :style="{ left: `${currentFraction * 100}%` }" :aria-hidden="true" />
          </div>
        </div>

        <div class="cycles-row" data-testid="cycles-direct">
          <span class="cycles-row__label">{{ t('cycles.direct') }}</span>
          <div class="cycles-track">
            <button
              v-for="(segment, index) in directIntervals"
              :key="`direct-${index}`"
              type="button"
              class="cycles-segment"
              :class="`cycles-segment--${segment.kind === 'link' ? 'link' : 'gap'}`"
              :style="segmentStyle(segment)"
              :title="segmentLabel(segment, 'direct')"
              :aria-label="segmentLabel(segment, 'direct')"
              @click="seek(segment)"
            />
            <span v-if="currentFraction !== null" class="cycles-now" :style="{ left: `${currentFraction * 100}%` }" :aria-hidden="true" />
          </div>
        </div>

        <div class="cycles-row" :class="{ 'is-relay-off': !relayEnabled }" data-testid="cycles-relay">
          <span class="cycles-row__label">{{ relayEnabled ? t('cycles.relay') : t('cycles.relayOff') }}</span>
          <div class="cycles-track">
            <button
              v-for="(segment, index) in relayIntervals"
              :key="`relay-${index}`"
              type="button"
              class="cycles-segment"
              :class="[`cycles-segment--${segment.kind === 'link' ? 'link' : 'gap'}`, { 'is-relay': relayEnabled }]"
              :style="segmentStyle(segment)"
              :title="segmentLabel(segment, relayEnabled ? 'relay' : 'direct')"
              :aria-label="segmentLabel(segment, relayEnabled ? 'relay' : 'direct')"
              @click="seek(segment)"
            />
            <span v-if="currentFraction !== null" class="cycles-now" :style="{ left: `${currentFraction * 100}%` }" :aria-hidden="true" />
          </div>
        </div>
      </div>
    </div>

    <p v-if="summary" class="cycles-summary" data-testid="cycles-summary">
      {{ t('cycles.summary', {
        sun: formatNumber(summary.sunHours, 1),
        eclipse: formatNumber(summary.eclipseHours, 1),
        eclipses: summary.eclipseCount,
        link: formatNumber(summary.linkHours, 1),
        gap: formatNumber(summary.gapHours, 1),
        gaps: summary.gapCount,
        benefit: formatNumber(summary.relayBenefitHours, 1),
        reduction: formatNumber(Math.max(0, summary.gapReduction ?? 0), 1),
      }) }}
    </p>

    <p class="panel-hint cycles-hint">{{ t('cycles.hint') }}</p>
  </PanelCard>
</template>
