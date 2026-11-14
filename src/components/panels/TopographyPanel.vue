<script setup>
/**
 * Real topography panel: LOLA DEM provenance and statistics plus locally
 * detected craters.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import PanelCard from '../ui/PanelCard.vue'
import StatRow from '../ui/StatRow.vue'
import { state } from '../composables/useAppState.js'
import { sourceLabelKey } from '../composables/labels.js'
import { formatDistance, formatLat, formatLon, formatMeters, formatNumber } from '../composables/format.js'

const { t } = useI18n()

const stats = computed(() => state.data.terrainStats)
const craters = computed(() => state.data.craters ?? [])
const terrain = computed(() => state.terrain)

const resolutionLabel = computed(() => {
  if (!terrain.value) return t('common.notAvailable')
  if (Number.isFinite(Number(terrain.value.pixelSizeM))) {
    return `${formatDistance(Number(terrain.value.pixelSizeM))}/px`
  }
  const radius = 1737400
  const colatMax = Math.max(90 + terrain.value.lat0, 90 + terrain.value.lat1)
  const spanMeters = (Math.max(0.5, colatMax) * Math.PI * radius) / 180
  const pixel = spanMeters / Math.max(1, terrain.value.width)
  return formatDistance(pixel) + '/px'
})

const regionLabel = computed(
  () => state.data.terrainRegionName || state.data.terrainRegionId || t('topo.regionUnknown'),
)
</script>

<template>
  <PanelCard title-key="topo.title" :badge="`${craters.length}`">
    <p class="panel-hint">{{ t('topo.hint') }}</p>
    <StatRow label-key="topo.source" :value="t(sourceLabelKey(state.data.terrainSource))" :mono="false" />
    <StatRow label-key="topo.region" :value="regionLabel" :mono="false" />
    <StatRow label-key="topo.resolution" :value="resolutionLabel" />
    <StatRow
      label-key="topo.grid"
      :value="terrain ? `${terrain.width} × ${terrain.height}` : t('common.notAvailable')"
    />
    <template v-if="stats">
      <StatRow label-key="topo.minElevation" :value="formatMeters(stats.minM)" />
      <StatRow label-key="topo.maxElevation" :value="formatMeters(stats.maxM)" />
      <StatRow label-key="topo.meanElevation" :value="formatMeters(stats.meanM)" />
      <StatRow label-key="topo.relief" :value="formatMeters(stats.reliefM)" />
    </template>
    <p v-if="state.data.terrainSource === 'synthetic'" class="panel-note panel-note--warn">
      {{ t('topo.syntheticNote') }}
    </p>
    <p v-if="state.data.terrainAttribution" class="panel-note">{{ state.data.terrainAttribution }}</p>

    <div class="panel-divider" />
    <h3 class="panel-subtitle">{{ t('topo.craters') }}</h3>
    <ul v-if="craters.length" class="crater-list">
      <li v-for="(crater, index) in craters" :key="`${crater.lat}-${crater.lon}-${index}`" class="crater-item">
        <span class="crater-item__name">#{{ index + 1 }} {{ formatLat(crater.lat) }}, {{ formatLon(crater.lon) }}</span>
        <span class="crater-item__meta">
          {{ t('topo.diameter') }} {{ formatDistance(crater.diameterM) }} · {{ t('topo.depth') }} {{ formatMeters(crater.depthM) }}
        </span>
      </li>
    </ul>
    <p v-else class="empty">{{ t('topo.noCraters') }}</p>
    <p class="panel-note">{{ t('topo.craterNote', { count: craters.length }) }}</p>
    <a
      class="panel-link"
      href="https://pds-geosciences.wustl.edu/missions/lro/lola.htm"
      target="_blank"
      rel="noopener noreferrer"
    >
      {{ t('topo.pdsLink') }} ↗
    </a>
    <p class="panel-note">{{ t('topo.attribution') }}</p>
  </PanelCard>
</template>
