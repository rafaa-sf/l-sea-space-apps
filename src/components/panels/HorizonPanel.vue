<script setup>
/**
 * Sun and Earth versus the local terrain horizon, with lunar-curvature aware
 * ray tracing for the selected site.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import PanelCard from '../ui/PanelCard.vue'
import StatRow from '../ui/StatRow.vue'
import { state } from '../composables/useAppState.js'
import { formatAngle, formatDistance, formatLat, formatLon } from '../composables/format.js'

const { t } = useI18n()

const sun = computed(() => state.analysis.sun)
const earth = computed(() => state.analysis.earth)
const ray = computed(() => state.analysis.ray)

const sunTone = computed(() => (state.analysis.sunVisible ? 'ok' : 'warn'))
const earthTone = computed(() => (state.analysis.earthVisible ? 'ok' : 'warn'))

const rayLabel = computed(() => {
  if (!ray.value) return t('horizon.rayClear')
  return t('horizon.rayHit', { distance: formatDistance(ray.value.distanceM) })
})
</script>

<template>
  <PanelCard title-key="horizon.title">
    <h3 class="panel-subtitle">{{ t('horizon.sun') }}</h3>
    <StatRow label-key="horizon.azimuth" :value="formatAngle(sun.az, 1)" />
    <StatRow label-key="horizon.elevation" :value="formatAngle(sun.el, 2)" />
    <StatRow label-key="horizon.horizonAngle" :value="formatAngle(state.analysis.horizonSun, 2)" />
    <StatRow
      label-key="horizon.margin"
      :value="formatAngle(state.analysis.sunMargin, 2)"
      :tone="sunTone"
    />
    <StatRow
      label-key="horizon.visibility"
      :value="state.analysis.sunVisible ? t('horizon.visible') : t('horizon.hidden')"
      :tone="sunTone"
      :mono="false"
    />

    <div class="panel-divider" />
    <h3 class="panel-subtitle">{{ t('horizon.earth') }}</h3>
    <StatRow label-key="horizon.azimuth" :value="formatAngle(earth.az, 1)" />
    <StatRow label-key="horizon.elevation" :value="formatAngle(earth.el, 2)" />
    <StatRow label-key="horizon.horizonAngle" :value="formatAngle(state.analysis.horizonEarth, 2)" />
    <StatRow
      label-key="horizon.margin"
      :value="formatAngle(state.analysis.earthMargin, 2)"
      :tone="earthTone"
    />
    <StatRow
      label-key="horizon.visibility"
      :value="state.analysis.earthVisible ? t('horizon.visible') : t('horizon.hidden')"
      :tone="earthTone"
      :mono="false"
    />

    <div class="panel-divider" />
    <h3 class="panel-subtitle">{{ t('horizon.rayTitle') }}</h3>
    <StatRow label-key="horizon.rayResult" :value="rayLabel" :tone="ray ? 'default' : 'ok'" :mono="false" />
    <template v-if="ray">
      <StatRow label-key="horizon.rayLat" :value="formatLat(ray.lat)" />
      <StatRow label-key="horizon.rayLon" :value="formatLon(ray.lon)" />
    </template>
    <p class="panel-note">{{ t('horizon.curvatureNote') }}</p>
    <p class="panel-note">{{ t('horizon.mastNote', { mast: state.mission.mastM }) }}</p>
  </PanelCard>
</template>
