<script setup>
/**
 * Date and time controls (UTC). The ephemeris dataset is sampled at the chosen
 * instant; playback animates the mission clock.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import PanelCard from '../ui/PanelCard.vue'
import StatRow from '../ui/StatRow.vue'
import { actions, ephemerisRange, state } from '../composables/useAppState.js'
import { combineUtc, formatDateInput, formatTimeInput, formatUtc } from '../composables/format.js'

const { t } = useI18n()

const dateValue = computed(() => formatDateInput(state.time))
const timeValue = computed(() => formatTimeInput(state.time))
const range = computed(() => ephemerisRange.value)

const minDate = computed(() => (range.value ? formatDateInput(range.value.start) : null))
const maxDate = computed(() => (range.value ? formatDateInput(range.value.end) : null))

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

</script>

<template>
  <PanelCard title-key="datetime.title">
    <div class="field-row">
      <label class="field">
        <span class="field__label">{{ t('datetime.date') }}</span>
        <input class="input" type="date" :value="dateValue" :min="minDate" :max="maxDate" @change="onDate" />
      </label>
      <label class="field">
        <span class="field__label">{{ t('datetime.time') }}</span>
        <input class="input" type="time" :value="timeValue" @change="onTime" />
      </label>
    </div>
    <p class="panel-hint">{{ t('datetime.utcHint') }}</p>

    <div class="button-row">
      <button type="button" class="button button--ghost button--small" @click="actions.shiftTime(-1440)">−1 d</button>
      <button type="button" class="button button--ghost button--small" @click="actions.shiftTime(-60)">−1 h</button>
      <button type="button" class="button button--secondary button--small" @click="actions.setNow()">{{ t('datetime.now') }}</button>
      <button type="button" class="button button--ghost button--small" @click="actions.shiftTime(60)">+1 h</button>
      <button type="button" class="button button--ghost button--small" @click="actions.shiftTime(1440)">+1 d</button>
    </div>

    <div class="button-row">
      <button
        type="button"
        class="button button--primary button--small"
        :aria-label="state.playback.playing ? t('datetime.pause') : t('datetime.play')"
        @click="actions.togglePlayback()"
      >
        {{ state.playback.playing ? t('datetime.pause') : t('datetime.play') }}
      </button>
      <span class="panel-hint">{{ t('datetime.speed', { minutes: state.playback.speedMinutes }) }}</span>
    </div>

    <div class="panel-divider" />
    <StatRow label-key="datetime.selectedTime" :value="formatUtc(state.time)" />
    <StatRow
      label-key="datetime.ephemerisRange"
      :value="range ? `${formatDateInput(range.start)} → ${formatDateInput(range.end)}` : t('common.notAvailable')"
      :mono="false"
    />
    <p class="panel-hint">{{ t('datetime.eventsHint') }}</p>
  </PanelCard>
</template>
