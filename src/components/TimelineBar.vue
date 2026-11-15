<script setup>
/**
 * Compact mission timeline under the viewport: date/time controls, playback,
 * next-event countdowns and system status (background worker and renderer
 * mode). Kept to a single row so it never competes with the viewport.
 */
import { computed } from 'vue'
import TimelineCycles from './TimelineCycles.vue'
import { useI18n } from 'vue-i18n'
import { actions, ephemerisRange, state, workerSummary } from './composables/useAppState.js'
import {
  combineUtc,
  formatDateInput,
  formatDuration,
  formatTimeInput,
} from './composables/format.js'

const { t } = useI18n()

const dateValue = computed(() => formatDateInput(state.time))
const timeValue = computed(() => formatTimeInput(state.time))
const range = computed(() => ephemerisRange.value)
const minDate = computed(() => (range.value ? formatDateInput(range.value.start) : null))
const maxDate = computed(() => (range.value ? formatDateInput(range.value.end) : null))

const playing = computed(() => state.playback.playing)
const playLabel = computed(() => (playing.value ? t('timeline.pause') : t('timeline.play')))

const workerLabel = computed(() => {
  switch (workerSummary.value) {
    case 'main-thread':
      return t('timeline.worker.mainThread')
    case 'running':
      return t('timeline.worker.running')
    case 'ok':
      return t('timeline.worker.workerOk')
    case 'error':
      return t('timeline.worker.workerError')
    default:
      return t('timeline.worker.workerReady')
  }
})

const rendererLabel = computed(() => {
  if (state.system.renderer === '2d') return t('viewport.mode.twoD')
  if (state.system.renderer === '3d') {
    return state.system.viewMode === '2d' ? t('viewport.mode.twoD') : t('viewport.mode.threeD')
  }
  return t('common.loading')
})

const sunsetLabel = computed(() =>
  state.analysis.sunSet ? formatDuration(state.analysis.sunSet.remainingSeconds) : t('timeline.noEvent'),
)
const earthsetLabel = computed(() =>
  state.analysis.earthSet ? formatDuration(state.analysis.earthSet.remainingSeconds) : t('timeline.noEvent'),
)

function apply(dateString, timeString) {
  const iso = combineUtc(dateString, timeString)
  if (iso) actions.setTime(iso)
}

function onDate(event) {
  apply(event.target.value, timeValue.value)
}

function onTime(event) {
  apply(dateValue.value, event.target.value)
}

function onSpeedChange(event) {
  actions.setPlaybackSpeed(Number(event.target.value))
}
</script>

<template>
  <section class="timeline" :aria-label="t('timeline.regionLabel')">
    <div class="timeline__transport">
      <button type="button" class="transport-button" :aria-label="playLabel" :title="playLabel" @click="actions.togglePlayback()">
        <span v-if="playing" class="icon-pause" aria-hidden="true" />
        <span v-else class="icon-play" aria-hidden="true" />
      </button>
      <div class="timeline__steps">
        <button type="button" class="button button--quiet button--tiny" @click="actions.shiftTime(-60)">-1 h</button>
        <button type="button" class="button button--secondary button--tiny" @click="actions.setNow()">{{ t('timeline.now') }}</button>
        <button type="button" class="button button--quiet button--tiny" @click="actions.shiftTime(60)">+1 h</button>
      </div>
      <select
        class="input dem-select__control"
        :value="state.playback.speedMinutes"
        data-testid="playback-speed"
        :aria-label="t('datetime.speed', { minutes: state.playback.speedMinutes })"
        :title="t('datetime.speed', { minutes: state.playback.speedMinutes })"
        @change="onSpeedChange"
      >
        <option :value="5">5</option>
        <option :value="20">20</option>
        <option :value="60">60</option>
      </select>
    </div>

    <div class="timeline__datetime">
      <label class="timeline__field">
        <span class="sr-only">{{ t('datetime.date') }}</span>
        <input class="input input--date" type="date" :value="dateValue" :min="minDate" :max="maxDate" @change="onDate" />
      </label>
      <label class="timeline__field">
        <span class="sr-only">{{ t('datetime.time') }}</span>
        <input class="input input--time" type="time" :value="timeValue" @change="onTime" />
      </label>
      <span class="timeline__utc">UTC</span>
    </div>

    <div class="timeline__events">
      <button
        type="button"
        class="event-chip"
        :disabled="!state.analysis.sunSet"
        :title="state.analysis.sunSet ? t('timeline.chartClickHint') : t('timeline.noEvent')"
        @click="actions.jumpToEvent('sun')"
      >
        <span class="event-chip__label">{{ t('timeline.sunset') }}</span>
        <span class="event-chip__value">{{ sunsetLabel }}</span>
      </button>
      <button
        type="button"
        class="event-chip"
        :disabled="!state.analysis.earthSet"
        :title="state.analysis.earthSet ? t('timeline.chartClickHint') : t('timeline.noEvent')"
        @click="actions.jumpToEvent('earth')"
      >
        <span class="event-chip__label">{{ t('timeline.earthset') }}</span>
        <span class="event-chip__value">{{ earthsetLabel }}</span>
      </button>
    </div>

    <TimelineCycles>
      <template #status>
        <span class="timeline__status-inline">
          <span class="status-text">{{ t('timeline.workerLabel') }}: {{ workerLabel }}</span>
          <span class="status-separator" aria-hidden="true" />
          <span class="status-text">{{ rendererLabel }}</span>
          <span v-if="state.loading.analysis" class="status-text">{{ t('common.computing') }}</span></span>
      </template>
    </TimelineCycles>
  </section>
</template>
