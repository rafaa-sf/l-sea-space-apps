<script setup>
/**
 * Coordinate and LOLA readout for the selected site: position, sampled
 * elevation, slope/aspect, distance from the pole and physical dimensions.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import PanelCard from '../ui/PanelCard.vue'
import StatRow from '../ui/StatRow.vue'
import {
  actions,
  distanceFromSouthPoleKm,
  isLandingZoneSite,
  selectedSite,
  state,
} from '../composables/useAppState.js'
import { siteDisplayName, siteSourceLabel, sourceLabelKey } from '../composables/labels.js'
import { formatAngle, formatLat, formatLon, formatMeters } from '../composables/format.js'

const { t, te } = useI18n()

const terrainStats = computed(() => state.data.terrainStats ?? null)
const elevation = computed(() => {
  if (!selectedSite.value) return null
  return state.analysis.siteElevationM ?? selectedSite.value.elevationM ?? null
})

const distanceFromPoleKm = computed(() =>
  selectedSite.value ? distanceFromSouthPoleKm(selectedSite.value.lat) : null,
)

/** Analysis coverage/time warning shown instead of fabricated numbers (BH-04/BH-06). */
const analysisWarning = computed(() => {
  if (state.analysis.unavailable) {
    if (state.analysis.coverageReason === 'site-outside-dem') {
      return t('coords.outsideDem')
    }
    return t('coords.analysisUnavailable')
  }
  const warning = state.analysis.timeWarning
  if (warning?.code === 'ephemeris-window-clamped') {
    return warning.clampedTo
      ? t('coords.ephemerisClamped', {
          start: warning.start,
          end: warning.end,
          clampedTo: warning.clampedTo,
        })
      : t('coords.ephemerisClampedWindow', { start: warning.start, end: warning.end })
  }
  return null
})

const regionLabel = computed(() => {
  const region = state.data.terrainRegionName
  if (region) return region
  if (state.data.terrainSource === 'synthetic') return t('coords.syntheticRegion')
  const terrain = state.terrain
  if (terrain) return `${terrain.width} x ${terrain.height} @ ${formatAngle(terrain.lat1, 1)}`
  return t('common.notAvailable')
})

/**
 * A ranked landing zone is a transient analysis site: its perimeter is the
 * equivalent circle of the zone area, so it is shown as a derived readout
 * instead of an editable mission input.
 */
const zoneDerived = computed(() => isLandingZoneSite(selectedSite.value))

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
      <p v-if="analysisWarning" class="panel-note panel-note--warn" data-testid="coverage-warning">
        {{ analysisWarning }}
      </p>
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
      <StatRow
        v-if="zoneDerived"
        label-key="coords.equivalentPerimeter"
        :value="formatMeters(selectedSite.perimeterM)"
      />
      <div class="field-row">
        <label v-if="!zoneDerived" class="field">
          <span class="field__label">{{ t('coords.perimeter') }}</span>
          <input v-model.number="perimeter" class="input" type="number" min="1" step="10" />
        </label>
        <label class="field">
          <span class="field__label">{{ t('coords.mast') }}</span>
          <input v-model.number="mast" class="input" type="number" min="1" step="1" />
        </label>
      </div>
      <p v-if="zoneDerived" class="panel-note">{{ t('coords.equivalentPerimeterHint') }}</p>
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
