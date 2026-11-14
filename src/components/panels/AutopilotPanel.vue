<script setup>
/**
 * Autopilot panel: mission-profile inputs and the ranked site results returned
 * by the background worker (or the main-thread fallback).
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import PanelCard from '../ui/PanelCard.vue'
import { actions, state } from '../composables/useAppState.js'
import { reasonText, siteDisplayName } from '../composables/labels.js'
import { formatDuration, formatNumber } from '../composables/format.js'

const { t, te } = useI18n()

const running = computed(() => state.autopilot.status === 'running')

const statusLabel = computed(() => {
  switch (state.autopilot.status) {
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
  if (state.autopilot.status === 'error') return 'danger'
  if (state.autopilot.status === 'running') return 'warn'
  return state.autopilot.status === 'done' ? 'ok' : 'default'
})

const sourceLabel = computed(() => {
  if (state.autopilot.source === 'worker') return t('autopilot.source.worker')
  if (state.autopilot.source === 'main') return t('autopilot.source.main')
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
      <button type="button" class="button button--secondary button--small" :disabled="running" @click="actions.runAutopilot()">
        {{ running ? t('autopilot.running') : t('autopilot.run') }}
      </button>
    </template>

    <p class="panel-hint">{{ t('autopilot.hint') }}</p>

    <div class="field-grid">
      <label class="field">
        <span class="field__label">{{ t('autopilot.missionDays') }}</span>
        <input v-model.number="missionDays" class="input" type="number" min="1" max="60" step="1" />
      </label>
      <label class="field">
        <span class="field__label">{{ t('autopilot.powerNeedW') }}</span>
        <input v-model.number="powerNeedW" class="input" type="number" min="10" max="2000" step="10" />
      </label>
      <label class="field">
        <span class="field__label">{{ t('autopilot.sunDaysNeeded') }}</span>
        <input v-model.number="sunDaysNeeded" class="input" type="number" min="0" max="60" step="1" />
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
    </div>

    <p class="panel-note">
      {{ t('autopilot.statusLabel') }}: {{ statusLabel }}
      / {{ t('autopilot.sourceLabel') }}: {{ sourceLabel }}
      <template v-if="state.autopilot.durationMs !== null"> / {{ formatDuration(state.autopilot.durationMs / 1000) }}</template>
    </p>
    <p v-if="state.autopilot.error" class="panel-note panel-note--warn">
      {{ t('autopilot.fallbackNote') }}: {{ state.autopilot.error }}
    </p>

    <ol v-if="ranking.length" class="rank-list" :aria-label="t('autopilot.rankingLabel')">
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
    <p v-else class="empty">{{ t('autopilot.empty') }}</p>
    <p class="panel-note">{{ t('autopilot.workerNote') }}</p>
  </PanelCard>
</template>
