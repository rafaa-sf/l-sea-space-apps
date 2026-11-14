<script setup>
/**
 * WebGL / fallback status: whether 3D is available, which renderer is active,
 * and the provenance of the data currently displayed. Also exposes the mode
 * switcher for the viewport.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import PanelCard from '../ui/PanelCard.vue'
import StatRow from '../ui/StatRow.vue'
import { state } from '../composables/useAppState.js'
import { sourceLabelKey } from '../composables/labels.js'
import { formatUtc } from '../composables/format.js'

const { t, te } = useI18n()

const webglOk = computed(() => Boolean(state.system.webgl?.ok))
const webglLabel = computed(() => {
  if (!state.system.webgl) return t('common.loading')
  return webglOk.value ? t('fallback.webglOk') : t('fallback.webglUnavailable')
})
const reasonLabel = computed(() => {
  const reason = state.system.webgl?.reason
  if (!reason) return null
  const key = `fallback.reason.${reason}`
  return te(key) ? t(key) : reason
})

const rendererLabel = computed(() => {
  if (state.system.renderer === '2d') return t('viewport.mode.twoD')
  if (state.system.renderer === '3d') return t('viewport.mode.threeD')
  return t('common.loading')
})

const exportLabel = computed(() => {
  switch (state.export.status) {
    case 'busy':
      return t('export.busy')
    case 'done':
      return t('export.done')
    case 'error':
      return t('export.error')
    default:
      return t('export.idle')
  }
})
</script>

<template>
  <PanelCard title-key="fallback.title" :badge="rendererLabel" :tone="webglOk ? 'ok' : 'warn'">
    <StatRow label-key="fallback.webgl" :value="webglLabel" :tone="webglOk ? 'ok' : 'warn'" :mono="false" />
    <StatRow v-if="reasonLabel" label-key="fallback.reasonLabel" :value="reasonLabel" :mono="false" />
    <StatRow label-key="fallback.renderer" :value="rendererLabel" :mono="false" />
    <StatRow label-key="fallback.terrain" :value="t(sourceLabelKey(state.data.terrainSource, 'terrain'))" :mono="false" />
    <StatRow label-key="fallback.ephemeris" :value="t(sourceLabelKey(state.data.ephemerisSource, 'ephemeris'))" :mono="false" />
    <StatRow label-key="fallback.layers" :value="t(sourceLabelKey(state.data.layersSource, 'layers'))" :mono="false" />

    <p class="panel-note">{{ t('fallback.switchHint') }}</p>
    <p v-if="!webglOk" class="panel-note panel-note--warn">{{ t('fallback.note') }}</p>
    <p v-else class="panel-note">{{ t('fallback.webglNote') }}</p>

    <div class="panel-divider" />
    <StatRow label-key="export.status" :value="exportLabel" :tone="state.export.status === 'error' ? 'danger' : state.export.status === 'done' ? 'ok' : 'default'" :mono="false" />
    <StatRow
      label-key="export.last"
      :value="state.export.lastAt ? formatUtc(state.export.lastAt) : t('common.notAvailable')"
      :mono="false"
    />
    <p v-if="state.export.error" class="panel-note panel-note--warn">{{ state.export.error }}</p>
  </PanelCard>
</template>
