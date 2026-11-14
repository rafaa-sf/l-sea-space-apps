<script setup>
/**
 * Orbital variation panel: Sun and Earth elevation over the pre-computed
 * ephemeris window, showing the monthly illumination cycle at the selected
 * site.
 */
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import PanelCard from '../ui/PanelCard.vue'
import StatRow from '../ui/StatRow.vue'
import Sparkline from '../ui/Sparkline.vue'
import { state } from '../composables/useAppState.js'
import { getCompute } from '../composables/useCompute.js'
import { formatAngle, formatDuration } from '../composables/format.js'

const { t } = useI18n()

const variation = ref({ sun: [], earth: [], markerIndex: -1, count: 0, spanMs: 0 })
let token = 0

const stats = computed(() => {
  const sun = variation.value.sun.filter((value) => Number.isFinite(value))
  const earth = variation.value.earth.filter((value) => Number.isFinite(value))
  return {
    sunMin: sun.length ? Math.min(...sun) : null,
    sunMax: sun.length ? Math.max(...sun) : null,
    earthMin: earth.length ? Math.min(...earth) : null,
    earthMax: earth.length ? Math.max(...earth) : null,
  }
})

async function refresh() {
  if (!state.ephemeris) {
    variation.value = { sun: [], earth: [], markerIndex: -1, count: 0, spanMs: 0 }
    return
  }
  const current = (token += 1)
  const compute = await getCompute()
  const start = Date.parse(state.ephemeris.start)
  const end = Date.parse(state.ephemeris.end)
  const spanMs = Math.max(1, end - start)
  const count = 180
  const sun = []
  const earth = []
  for (let index = 0; index < count; index += 1) {
    const sample = compute.sampleAt(state.ephemeris, start + (spanMs * index) / (count - 1))
    sun.push(sample.sun.el)
    earth.push(sample.earth.el)
  }
  if (current !== token) return
  variation.value = {
    sun,
    earth,
    count,
    spanMs,
    markerIndex: Math.round(((Date.parse(state.time) - start) / spanMs) * (count - 1)),
  }
}

watch(() => [state.ephemeris, state.selectedSiteId, state.time], refresh, { immediate: true })

const chart = computed(() => ({
  series: [
    { points: variation.value.earth, color: '#7fd1ff', width: 1.3, dashed: true },
    { points: variation.value.sun, color: '#ffd166', width: 1.8, fill: true },
  ],
  markerIndex: variation.value.markerIndex,
  height: 88,
  ariaLabel: t('orbital.chartLabel'),
}))

const windowLabel = computed(() => {
  if (!state.ephemeris) return t('common.notAvailable')
  return formatDuration((Date.parse(state.ephemeris.end) - Date.parse(state.ephemeris.start)) / 1000)
})
</script>

<template>
  <PanelCard title-key="orbital.title">
    <p class="panel-hint">{{ t('orbital.hint') }}</p>
    <Sparkline v-bind="chart" />
    <div class="sparkline-legend">
      <span><i class="legend-dot legend-dot--sun" aria-hidden="true" />{{ t('orbital.sunElevation') }}</span>
      <span><i class="legend-dot legend-dot--earth" aria-hidden="true" />{{ t('orbital.earthElevation') }}</span>
    </div>
    <StatRow v-if="stats.sunMin !== null" label-key="orbital.sunRange" :value="`${formatAngle(stats.sunMin, 2)} → ${formatAngle(stats.sunMax, 2)}`" />
    <StatRow v-if="stats.earthMin !== null" label-key="orbital.earthRange" :value="`${formatAngle(stats.earthMin, 2)} → ${formatAngle(stats.earthMax, 2)}`" />
    <StatRow label-key="orbital.window" :value="windowLabel" :mono="false" />
    <StatRow label-key="orbital.period" :value="t('orbital.synodicPeriod')" :mono="false" />
    <p class="panel-note">{{ t('orbital.librationNote') }}</p>
  </PanelCard>
</template>
