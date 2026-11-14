<script setup>
/**
 * Bottom timeline / status bar: time transport, Sun and Earth elevation
 * timeline over the mission window (click to jump), next-event countdowns and
 * system status chips (background worker, renderer mode).
 */
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import Sparkline from './ui/Sparkline.vue'
import { actions, ephemerisRange, state } from './composables/useAppState.js'
import { getCompute } from './composables/useCompute.js'
import { formatDuration, formatUtc, toTimestamp } from './composables/format.js'

const { t } = useI18n()

const series = ref({ sun: [], earth: [], start: 0, span: 0, markerIndex: -1 })
let refreshToken = 0

const workerLabel = computed(() => {
  if (!state.worker.available) return t('timeline.worker.mainThread')
  if (state.worker.status === 'running') return t('timeline.worker.running')
  if (state.worker.status === 'done') return t('timeline.worker.workerOk')
  if (state.worker.status === 'error') return t('timeline.worker.workerError')
  return t('timeline.worker.workerReady')
})

const workerTone = computed(() => {
  if (!state.worker.available) return 'warn'
  if (state.worker.status === 'error') return 'danger'
  if (state.worker.status === 'done') return 'ok'
  return 'default'
})

const sunsetLabel = computed(() =>
  state.analysis.sunSet ? formatDuration(state.analysis.sunSet.remainingSeconds) : t('timeline.noEvent'),
)
const earthsetLabel = computed(() =>
  state.analysis.earthSet ? formatDuration(state.analysis.earthSet.remainingSeconds) : t('timeline.noEvent'),
)

const chartOptions = computed(() => ({
  series: [
    { points: series.value.earth, color: '#7fd1ff', width: 1.3, dashed: true },
    { points: series.value.sun, color: '#ffd166', width: 1.8, fill: true },
  ],
  markerIndex: series.value.markerIndex,
  height: 64,
  ariaLabel: t('timeline.chartLabel'),
}))

async function refreshSeries() {
  if (!state.ephemeris) {
    series.value = { sun: [], earth: [], start: 0, span: 0, markerIndex: -1 }
    return
  }
  const token = (refreshToken += 1)
  const compute = await getCompute()
  const current = toTimestamp(state.time)
  const start = current - 12 * 3600 * 1000
  const span = (state.mission.missionDays * 24 + 12) * 3600 * 1000
  const count = 120
  const sun = []
  const earth = []
  for (let index = 0; index < count; index += 1) {
    const sample = compute.sampleAt(state.ephemeris, start + (span * index) / (count - 1))
    sun.push(sample.sun.el)
    earth.push(sample.earth.el)
  }
  if (token !== refreshToken) return
  series.value = {
    sun,
    earth,
    start,
    span,
    markerIndex: Math.round(((current - start) / span) * (count - 1)),
  }
}

watch(() => [state.ephemeris, state.time, state.mission.missionDays], refreshSeries, { immediate: true })

function onChartClick(event) {
  if (!series.value.span) return
  const rect = event.currentTarget.getBoundingClientRect()
  const fraction = Math.min(1, Math.max(0, (event.clientX - rect.left) / Math.max(1, rect.width)))
  actions.setTime(series.value.start + fraction * series.value.span)
}

const rangeLabel = computed(() => {
  const range = ephemerisRange.value
  if (!range) return t('timeline.noEphemeris')
  return `${formatUtc(range.start)} → ${formatUtc(range.end)}`
})
</script>

<template>
  <section class="timeline" :aria-label="t('timeline.regionLabel')">
    <div class="timeline__transport">
      <button
        type="button"
        class="button button--icon"
        :aria-label="state.playback.playing ? t('timeline.pause') : t('timeline.play')"
        :title="state.playback.playing ? t('timeline.pause') : t('timeline.play')"
        @click="actions.togglePlayback()"
      >
        {{ state.playback.playing ? '❚❚' : '▶' }}
      </button>
      <div class="timeline__steps">
        <button type="button" class="button button--ghost button--small" @click="actions.shiftTime(-60)">
          −1h
        </button>
        <button type="button" class="button button--ghost button--small" @click="actions.setNow()">
          {{ t('timeline.now') }}
        </button>
        <button type="button" class="button button--ghost button--small" @click="actions.shiftTime(60)">
          +1h
        </button>
      </div>
      <div class="timeline__clock">
        <span class="timeline__time">{{ formatUtc(state.time) }}</span>
        <span class="timeline__range" :title="rangeLabel">{{ t('timeline.window', { days: state.mission.missionDays }) }}</span>
      </div>
    </div>

    <div
      class="timeline__chart"
      role="button"
      tabindex="0"
      :aria-label="t('timeline.chartClickHint')"
      @click="onChartClick"
      @keydown.enter.prevent="actions.setNow()"
    >
      <Sparkline v-bind="chartOptions" />
      <div class="timeline__legend">
        <span><i class="legend-dot legend-dot--sun" aria-hidden="true" />{{ t('timeline.sunElevation') }}</span>
        <span><i class="legend-dot legend-dot--earth" aria-hidden="true" />{{ t('timeline.earthElevation') }}</span>
        <span class="timeline__hint">{{ t('timeline.clickHint') }}</span>
      </div>
    </div>

    <div class="timeline__events">
      <button
        type="button"
        class="event-chip"
        :disabled="!state.analysis.sunSet"
        :title="state.analysis.sunSet ? formatUtc(state.analysis.sunSet.time) : t('timeline.noEvent')"
        @click="actions.jumpToEvent('sun')"
      >
        <span class="event-chip__label">{{ t('timeline.sunset') }}</span>
        <span class="event-chip__value">{{ sunsetLabel }}</span>
      </button>
      <button
        type="button"
        class="event-chip"
        :disabled="!state.analysis.earthSet"
        :title="state.analysis.earthSet ? formatUtc(state.analysis.earthSet.time) : t('timeline.noEvent')"
        @click="actions.jumpToEvent('earth')"
      >
        <span class="event-chip__label">{{ t('timeline.earthset') }}</span>
        <span class="event-chip__value">{{ earthsetLabel }}</span>
      </button>
      <div class="timeline__status">
        <span class="chip" :class="`chip--${workerTone}`" :title="t('timeline.workerHint')">
          {{ t('timeline.workerLabel') }}: {{ workerLabel }}
        </span>
        <span class="chip" :class="state.system.renderer === '2d' ? 'chip--warn' : 'chip--ok'">
          {{ state.system.renderer === '2d' ? t('viewport.mode.twoD') : t('viewport.mode.threeD') }}
        </span>
        <span v-if="state.loading.analysis" class="chip chip--warn">{{ t('common.computing') }}</span>
      </div>
    </div>
  </section>
</template>
