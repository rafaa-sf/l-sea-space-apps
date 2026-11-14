<script setup>
/**
 * L-SEA application shell: header, three-column mission-control layout
 * (site selection / viewport + timeline / analysis) and the attribution footer.
 */
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import HeaderBar from './components/HeaderBar.vue'
import FooterBar from './components/FooterBar.vue'
import ViewportPanel from './components/ViewportPanel.vue'
import TimelineBar from './components/TimelineBar.vue'
import SitesPanel from './components/panels/SitesPanel.vue'
import CoordinatePanel from './components/panels/CoordinatePanel.vue'
import ComparatorPanel from './components/panels/ComparatorPanel.vue'
import TopographyPanel from './components/panels/TopographyPanel.vue'
import DateTimePanel from './components/panels/DateTimePanel.vue'
import HorizonPanel from './components/panels/HorizonPanel.vue'
import CountdownPanel from './components/panels/CountdownPanel.vue'
import PowerCommsPanel from './components/panels/PowerCommsPanel.vue'
import AutopilotPanel from './components/panels/AutopilotPanel.vue'
import LayersPanel from './components/panels/LayersPanel.vue'
import OrbitalVariationPanel from './components/panels/OrbitalVariationPanel.vue'
import WorkerStatusPanel from './components/panels/WorkerStatusPanel.vue'
import FallbackStatusPanel from './components/panels/FallbackStatusPanel.vue'
import { actions, state } from './components/composables/useAppState.js'

const { t } = useI18n()

const toast = ref(null)
let toastTimer = null

function showToast(error) {
  toast.value = `${error.scope}: ${error.message}`
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => {
    toast.value = null
  }, 9000)
}

watch(
  () => state.errors.length,
  (length, previous) => {
    if (length > (previous ?? 0)) showToast(state.errors[length - 1])
  },
)

onMounted(() => {
  actions.boot().catch((error) => {
    console.error('[lsea] boot failed', error)
  })
})

onBeforeUnmount(() => {
  actions.stopPlayback()
  if (toastTimer) clearTimeout(toastTimer)
})
</script>

<template>
  <div class="app-shell">
    <HeaderBar />

    <main class="app-main" :aria-busy="!state.booted">
      <aside class="app-column app-column--left" :aria-label="t('app.leftColumnLabel')">
        <SitesPanel />
        <CoordinatePanel />
        <ComparatorPanel />
      </aside>

      <div class="app-center">
        <ViewportPanel />
        <TimelineBar />
      </div>

      <aside class="app-column app-column--right" :aria-label="t('app.rightColumnLabel')">
        <DateTimePanel />
        <HorizonPanel />
        <CountdownPanel />
        <PowerCommsPanel />
        <AutopilotPanel />
        <LayersPanel :default-open="false" />
        <OrbitalVariationPanel :default-open="false" />
        <TopographyPanel :default-open="false" />
        <WorkerStatusPanel :default-open="false" />
        <FallbackStatusPanel />
      </aside>
    </main>

    <FooterBar />

    <div v-if="!state.booted" class="boot-overlay" role="status" aria-live="polite">
      <div class="spinner" aria-hidden="true" />
      <span>{{ t('app.loading') }}</span>
    </div>

    <div v-if="toast" class="toast" role="alert">{{ toast }}</div>
  </div>
</template>
