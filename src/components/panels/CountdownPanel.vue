<script setup>
/**
 * Time remaining until the next sunset and earthset, computed against the local
 * terrain horizon.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import PanelCard from '../ui/PanelCard.vue'
import { actions, state } from '../composables/useAppState.js'
import { formatDuration, formatUtc } from '../composables/format.js'

const { t } = useI18n()

const sunSet = computed(() => state.analysis.sunSet)
const earthSet = computed(() => state.analysis.earthSet)

function eventTimeLabel(event) {
  return event ? formatUtc(event.time) : t('common.notAvailable')
}

function remainingLabel(event) {
  return event ? formatDuration(event.remainingSeconds) : t('countdown.none')
}
</script>

<template>
  <PanelCard title-key="countdown.title">
    <div class="countdown-grid">
      <div class="countdown-card" :class="{ 'is-warn': !sunSet }">
        <span class="countdown-card__label">{{ t('countdown.sunset') }}</span>
        <strong class="countdown-card__value">{{ remainingLabel(sunSet) }}</strong>
        <span class="countdown-card__meta">{{ eventTimeLabel(sunSet) }}</span>
        <button
          type="button"
          class="button button--link button--small"
          :disabled="!sunSet"
          @click="actions.jumpToEvent('sun')"
        >
          {{ t('countdown.jump') }}
        </button>
      </div>
      <div class="countdown-card" :class="{ 'is-warn': !earthSet }">
        <span class="countdown-card__label">{{ t('countdown.earthset') }}</span>
        <strong class="countdown-card__value">{{ remainingLabel(earthSet) }}</strong>
        <span class="countdown-card__meta">{{ eventTimeLabel(earthSet) }}</span>
        <button
          type="button"
          class="button button--link button--small"
          :disabled="!earthSet"
          @click="actions.jumpToEvent('earth')"
        >
          {{ t('countdown.jump') }}
        </button>
      </div>
    </div>
    <p class="panel-note">{{ t('countdown.note') }}</p>
  </PanelCard>
</template>
