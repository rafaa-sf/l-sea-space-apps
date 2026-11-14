<script setup>
/**
 * Background worker status: availability, last run, duration and the coder
 * modules detected in the bundle.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import PanelCard from '../ui/PanelCard.vue'
import StatRow from '../ui/StatRow.vue'
import { hasWorker } from '../composables/moduleBridge.js'
import { state } from '../composables/useAppState.js'
import { formatDuration, formatUtc } from '../composables/format.js'

const { t } = useI18n()

const workerStatus = computed(() => {
  if (!state.worker.available) return t('worker.unavailable')
  switch (state.worker.status) {
    case 'running':
      return t('worker.running')
    case 'done':
      return t('worker.done')
    case 'error':
      return t('worker.error')
    default:
      return t('worker.idle')
  }
})

const workerTone = computed(() => {
  if (!state.worker.available) return 'warn'
  if (state.worker.status === 'error') return 'danger'
  if (state.worker.status === 'done') return 'ok'
  return 'default'
})

const lastRun = computed(() =>
  state.worker.lastRunAt ? formatUtc(state.worker.lastRunAt) : t('common.notAvailable'),
)

const duration = computed(() =>
  state.autopilot.durationMs !== null ? formatDuration(state.autopilot.durationMs / 1000) : t('common.notAvailable'),
)

const coreModules = computed(() => state.data.detected.core ?? [])
const serviceModules = computed(() => state.data.detected.services ?? [])
const workerModules = computed(() => state.data.detected.workers ?? [])

const workerAvailable = computed(() => hasWorker() || state.worker.available)
</script>

<template>
  <PanelCard title-key="worker.title" :badge="workerStatus" :tone="workerTone" :default-open="true">
    <StatRow
      label-key="worker.available"
      :value="workerAvailable ? t('common.yes') : t('common.no')"
      :tone="workerAvailable ? 'ok' : 'warn'"
      :mono="false"
    />
    <StatRow label-key="worker.status" :value="workerStatus" :tone="workerTone" :mono="false" />
    <StatRow label-key="worker.source" :value="state.worker.source === 'worker' ? t('autopilot.source.worker') : t('autopilot.source.main')" :mono="false" />
    <StatRow label-key="worker.lastRun" :value="lastRun" :mono="false" />
    <StatRow label-key="worker.duration" :value="duration" :mono="false" />
    <p v-if="state.worker.error" class="panel-note panel-note--warn">{{ state.worker.error }}</p>
    <p v-if="!workerAvailable" class="panel-note panel-note--warn">{{ t('worker.mainThreadNote') }}</p>
    <p class="panel-note">{{ t('worker.singleThreadNote') }}</p>

    <div class="panel-divider" />
    <h3 class="panel-subtitle">{{ t('worker.modules') }}</h3>
    <div class="module-row">
      <span class="module-row__label">{{ t('worker.core') }}</span>
      <span v-if="coreModules.length" class="chip-row">
        <span v-for="module in coreModules" :key="module" class="chip chip--tiny">{{ module }}</span>
      </span>
      <span v-else class="panel-hint">{{ t('worker.localFallback') }}</span>
    </div>
    <div class="module-row">
      <span class="module-row__label">{{ t('worker.services') }}</span>
      <span v-if="serviceModules.length" class="chip-row">
        <span v-for="module in serviceModules" :key="module" class="chip chip--tiny">{{ module }}</span>
      </span>
      <span v-else class="panel-hint">{{ t('worker.localFallback') }}</span>
    </div>
    <div class="module-row">
      <span class="module-row__label">{{ t('worker.workers') }}</span>
      <span v-if="workerModules.length" class="chip-row">
        <span v-for="module in workerModules" :key="module" class="chip chip--tiny">{{ module }}</span>
      </span>
      <span v-else class="panel-hint">{{ t('worker.localFallback') }}</span>
    </div>
  </PanelCard>
</template>
