<script setup>
/**
 * Coordinate and LOLA readout for the selected site: position, sampled
 * elevation, slope/aspect, distance from the pole and physical dimensions.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import PanelCard from '../ui/PanelCard.vue'
import StatRow from '../ui/StatRow.vue'
import { actions, selectedSite, state } from '../composables/useAppState.js'
import { siteDisplayName, siteSourceLabel, sourceLabelKey } from '../composables/labels.js'
import { formatAngle, formatLat, formatLon, formatMeters } from '../composables/format.js'

const { t, te } = useI18n()

const terrainStats = computed(() => state.data.terrainStats ?? null)
const elevation = computed(() => {
  if (!selectedSite.value) return null
  return state.analysis.siteElevationM ?? selectedSite.value.elevationM ?? null
})

const distanceFromPoleKm = computed(() => {
  if (!selectedSite.value) return null
  const radius = 1737400
  const latRad = (selectedSite.value.lat * Math.PI) / 180
  const rho = 2 * radius * Math.tan(Math.PI / 4 + latRad / 2)
  return rho / 1000
})

const regionLabel = computed(() => {
  const region = state.data.terrainRegionName
  if (region) return region
  if (state.data.terrainSource === 'synthetic') return t('coords.syntheticRegion')
  const terrain = state.terrain
  if (terrain) return `${terrain.width} × ${terrain.height} @ ${formatAngle(terrain.lat1, 1)}`
  return t('common.notAvailable')
})

const perimeter = computed({
  get: () => selectedSite.value?.perimeterM ?? state.mission.perimeterM,
  set: (value) => {
    if (selectedSite.value) actions.updateSite(selectedSite.value.id, { perimeterM: Math.max(1, Number(value)) })
  },
})

const mast = computed({
  get: () => selectedSite.value?.mastM ?? state.mission.mastM,
  set: (value) => {
    if (selectedSite.value) actions.updateSite(selectedSite.value.id, { mastM: Math.max(1, Number(value)) })
  },
})
</script>

<template>
  <PanelCard title-key="coords.title" :badge="selectedSite ? formatLat(selectedSite.lat) : ''">
    <p v-if="!selectedSite" class="empty">{{ t('coords.noSite') }}</p>
    <template v-else>
      <p class="panel-site-name">{{ siteDisplayName(t, te, selectedSite) }}</p>
      <StatRow label-key="coords.lat" :value="formatLat(selectedSite.lat)" />
      <StatRow label-key="coords.lon" :value="formatLon(selectedSite.lon)" />
      <StatRow
        label-key="coords.lolaAltitude"
        :value="elevation === null ? t('common.notAvailable') : formatMeters(elevation)"
        :tone="elevation === null ? 'warn' : 'default'"
      />
      <StatRow label-key="coords.slope" :value="formatAngle(state.analysis.slope.slopeDeg, 1)" />
      <StatRow label-key="coords.aspect" :value="formatAngle(state.analysis.slope.aspectDeg, 0)" />
      <StatRow
        label-key="coords.distanceFromPole"
        :value="distanceFromPoleKm === null ? '—' : `${distanceFromPoleKm.toFixed(1)} km`"
      />
      <div class="field-row">
        <label class="field">
          <span class="field__label">{{ t('coords.perimeter') }}</span>
          <input v-model.number="perimeter" class="input" type="number" min="1" step="10" />
        </label>
        <label class="field">
          <span class="field__label">{{ t('coords.mast') }}</span>
          <input v-model.number="mast" class="input" type="number" min="1" step="1" />
        </label>
      </div>
      <div class="panel-divider" />
      <StatRow label-key="coords.datum" :value="`${formatMeters(state.terrain?.datum ?? 1737400)}`" />
      <StatRow v-if="terrainStats" label-key="coords.relief" :value="formatMeters(terrainStats.reliefM)" />
      <StatRow label-key="coords.region" :value="regionLabel" :mono="false" />
      <StatRow
        label-key="coords.terrainSource"
        :value="t(sourceLabelKey(state.data.terrainSource))"
        :tone="state.data.terrainSource === 'synthetic' ? 'warn' : 'ok'"
        :mono="false"
      />
      <StatRow
        label-key="coords.siteSource"
        :value="siteSourceLabel(t, te, selectedSite)"
        :mono="false"
      />
      <p v-if="state.data.terrainAttribution" class="panel-note">{{ state.data.terrainAttribution }}</p>
    </template>
  </PanelCard>
</template>
