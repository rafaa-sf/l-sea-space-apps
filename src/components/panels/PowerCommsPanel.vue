<script setup>
/**
 * Power generation estimate and communications budget for the selected site
 * and mission profile.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import PanelCard from '../ui/PanelCard.vue'
import StatRow from '../ui/StatRow.vue'
import { actions, state } from '../composables/useAppState.js'
import { formatDuration, formatNumber, formatPercent } from '../composables/format.js'

const { t } = useI18n()

const power = computed(() => state.analysis.power)
const budget = computed(() => state.analysis.commBudget)
const windows = computed(() => state.analysis.commWindows ?? [])

const powerTone = computed(() => {
  if (!power.value) return 'default'
  return power.value.averageW >= power.value.needW ? 'ok' : 'warn'
})

const relayModel = computed({
  get: () => state.mission.relayInOrbit,
  set: (value) => actions.updateMission({ relayInOrbit: Boolean(value) }),
})

const totalWindowLabel = computed(() =>
  budget.value ? formatDuration(budget.value.totalSeconds) : t('common.notAvailable'),
)

const dataLabel = computed(() =>
  budget.value ? `${formatNumber(budget.value.estimatedMb, 0)} Mb` : t('common.notAvailable'),
)
</script>

<template>
  <PanelCard title-key="power.title">
    <h3 class="panel-subtitle">{{ t('power.solarTitle') }}</h3>
    <template v-if="power">
      <StatRow label-key="power.average" :value="formatNumber(power.averageW, 0)" unit="W" :tone="powerTone" />
      <StatRow label-key="power.peak" :value="formatNumber(power.peakW, 0)" unit="W" />
      <StatRow label-key="power.daily" :value="formatNumber(power.dailyWh, 0)" unit="Wh" />
      <StatRow label-key="power.need" :value="formatNumber(power.needW, 0)" unit="W" />
      <StatRow
        label-key="power.margin"
        :value="formatNumber(power.marginW, 0)"
        unit="W"
        :tone="powerTone"
      />
      <StatRow label-key="power.illuminated" :value="formatPercent(power.illuminatedFraction, 1)" />
      <p class="panel-note">
        {{ t('power.assumptions', { area: formatNumber(power.panelAreaM2, 1), efficiency: formatPercent(power.efficiency, 0) }) }}
      </p>
    </template>
    <p v-else class="empty">{{ t('power.noData') }}</p>

    <div class="panel-divider" />
    <h3 class="panel-subtitle">{{ t('comms.title') }}</h3>
    <StatRow label-key="comms.windows" :value="formatNumber(windows.length, 0)" />
    <StatRow label-key="comms.total" :value="totalWindowLabel" />
    <StatRow label-key="comms.dataBudget" :value="dataLabel" />
    <StatRow
      label-key="comms.earthVisible"
      :value="state.analysis.earthVisible ? t('horizon.visible') : t('horizon.hidden')"
      :tone="state.analysis.earthVisible ? 'ok' : 'warn'"
      :mono="false"
    />
    <label class="field field--inline">
      <input v-model="relayModel" type="checkbox" />
      <span>{{ t('comms.relayInOrbit') }}</span>
    </label>
    <p class="panel-note">{{ t('comms.relayNote') }}</p>
    <p class="panel-note">{{ t('comms.windowNote', { count: windows.length, days: state.mission.missionDays }) }}</p>
  </PanelCard>
</template>
