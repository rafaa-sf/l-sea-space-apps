<script setup>
/**
 * Compact mission-cycle band for the timeline: Sun (sunlit/eclipse) and Earth
 * link (direct/relay) over the mission window, aligned with week/day ticks and
 * the current mission time. Segments seek the clock; the relay state mirrors
 * the mission profile. Data comes from the existing `missionCycles` worker
 * task with a local core fallback (no new science here).
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { actions, selectedSite, state } from './composables/useAppState.js'
import { getCompute } from './composables/useCompute.js'
import { runInWorker } from './composables/moduleBridge.js'
import { formatUtc } from './composables/format.js'

const { t } = useI18n()
const cycles = ref(null)
const status = ref('idle')
let computeApi = null
let requestToken = 0
let timer = null

const relayEnabled = computed(() => state.mission.relayInOrbit === true)
const windowInfo = computed(() => cycles.value?.window ?? null)
const weeks = computed(() => cycles.value?.weeks ?? [])
const totalMs = computed(() => {
  const window = windowInfo.value
  return window ? Math.max(1, Number(window.endMs) - Number(window.startMs)) : 1
})
const currentFraction = computed(() => {
  const window = windowInfo.value
  if (!window) return null
  const time = new Date(state.time).getTime()
  const fraction = (time - Number(window.startMs)) / totalMs.value
  return Number.isFinite(fraction) && fraction >= 0 && fraction <= 1 ? fraction : null
})

function fractionOf(ms) {
  const window = windowInfo.value
  if (!window) return 0
  return Math.min(1, Math.max(0, (Number(ms) - Number(window.startMs)) / totalMs.value))
}

function segmentStyle(segment) {
  const start = fractionOf(segment.startMs)
  const end = fractionOf(segment.endMs)
  return { left: `${start * 100}%`, width: `${Math.max(0.2, (end - start) * 100)}%` }
}

function segmentLabel(segment, row) {
  const start = formatUtc(new Date(Number(segment.startMs)).toISOString())
  const end = formatUtc(new Date(Number(segment.endMs)).toISOString())
  return t(`cycles.segment.${row}.${segment.kind}`, { start, end })
}

function seek(segment) {
  const start = Number(segment.startMs)
  const end = Number(segment.endMs)
  if (!Number.isFinite(start) || !Number.isFinite(end)) return
  actions.setTime(new Date(start + (end - start) / 2).toISOString())
}

const sunIntervals = computed(() => cycles.value?.sunlight?.intervals ?? [])
const linkIntervals = computed(() => {
  if (relayEnabled.value) return cycles.value?.effective?.intervals ?? []
  return cycles.value?.direct?.intervals ?? []
})
const dayTicks = computed(() => {
  if (!windowInfo.value) return []
  const count = Math.max(1, Math.round(totalMs.value / 86400000))
  return Array.from({ length: count }, (_, index) => ({ index, left: ((index + 0.5) / count) * 100 }))
})

const statusLabel = computed(() => {
  switch (status.value) {
    case 'computing':
      return t('cycles.status.computing')
    case 'stale':
      return t('cycles.status.stale')
    case 'waiting':
      return t('cycles.status.waiting')
    case 'ready':
      return t('cycles.status.ready')
    case 'unavailable':
      return t('cycles.status.unavailable')
    case 'error':
      return t('cycles.status.error')
    default:
      return t('cycles.status.idle')
  }
})

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

async function runCycles() {
  const site = selectedSite.value
  if (!computeApi || !site || !state.terrain) {
    status.value = computeApi ? 'waiting' : 'unavailable'
    return
  }
  const token = ++requestToken
  const previous = cycles.value
  status.value = previous ? 'stale' : 'computing'
  try {
    const mission = { ...state.mission, startTime: new Date(state.time).toISOString() }
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
      return
    }
    cycles.value = result
    status.value = 'ready'
  } catch {
    if (token === requestToken) status.value = 'error'
  }
}

function schedule(delay = 300) {
  if (timer) clearTimeout(timer)
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
  () => schedule(150),
)
watch(
  () => [state.mission.missionDays, state.mission.relayInOrbit],
  () => schedule(200),
)
watch(
  () => state.time,
  () => {
    if (!state.playback?.playing) schedule(450)
  },
)

onBeforeUnmount(() => {
  requestToken += 1
  if (timer) clearTimeout(timer)
})
</script>

<template>
  <div
    class="timeline-cycles"
    role="group"
    :aria-label="t('timeline.cyclesTitle')"
    :title="t('cycles.timelineNote')"
    :aria-description="t('cycles.timelineNote')"
  >
    <div class="timeline-cycles__body">
      <span class="timeline-cycles__status" role="status" aria-live="polite">
        <template v-if="status !== 'ready'">{{ statusLabel }} · </template>
        <slot name="status" />
      </span>
      <div v-if="cycles" class="timeline-cycles__axis" aria-hidden="true">
        <span
          v-for="week in weeks"
          :key="`week-${week.index}`"
          class="timeline-cycles__week"
          :style="{ left: `${fractionOf(week.startMs) * 100}%`, width: `${(fractionOf(week.endMs) - fractionOf(week.startMs)) * 100}%` }"
        >{{ t('cycles.week') }} {{ week.index }}</span>
        <span v-for="tick in dayTicks" :key="`tick-${tick.index}`" class="timeline-cycles__tick" :style="{ left: `${tick.left}%` }" />
      </div>

      <div v-if="cycles" class="timeline-cycles__row" data-testid="timeline-cycles-sun">
        <span class="timeline-cycles__label">{{ t('cycles.sun') }}</span>
        <div class="timeline-cycles__track">
          <button
            v-for="(segment, index) in sunIntervals"
            :key="`sun-${index}`"
            type="button"
            class="timeline-cycles__segment"
            :class="`timeline-cycles__segment--${segment.kind}`"
            :style="segmentStyle(segment)"
            :title="segmentLabel(segment, 'sun')"
            :aria-label="segmentLabel(segment, 'sun')"
            @click="seek(segment)"
          />
          <span v-if="currentFraction !== null" class="timeline-cycles__now" data-testid="timeline-cycles-now" :style="{ left: `${currentFraction * 100}%` }" />
        </div>
      </div>

      <div v-if="cycles" class="timeline-cycles__row" data-testid="timeline-cycles-link">
        <span
          class="timeline-cycles__label"
          :title="relayEnabled ? t('cycles.relay') : t('cycles.direct')"
        >{{ relayEnabled ? t('cycles.linkRelayShort') : t('cycles.linkDirectShort') }}</span>
        <div class="timeline-cycles__track">
          <button
            v-for="(segment, index) in linkIntervals"
            :key="`link-${index}`"
            type="button"
            class="timeline-cycles__segment"
            :class="[`timeline-cycles__segment--${segment.kind}`, { 'is-relay': relayEnabled }]"
            :style="segmentStyle(segment)"
            :title="segmentLabel(segment, relayEnabled ? 'relay' : 'direct')"
            :aria-label="segmentLabel(segment, relayEnabled ? 'relay' : 'direct')"
            @click="seek(segment)"
          />
        </div>
      </div>

      <p v-if="status === 'unavailable'" class="timeline-cycles__note">{{ t('cycles.unavailable') }}</p>
      <p v-else-if="status === 'error'" class="timeline-cycles__note">{{ t('cycles.error') }}</p>
    </div>
  </div>
</template>
