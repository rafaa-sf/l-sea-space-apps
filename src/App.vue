<script setup>
/**
 * L-SEA application shell: slim header, sites rail, dominant viewport with
 * compact timeline, analysis rail, one-line footer and the secondary-tools
 * drawer. Progressive disclosure: only the primary workflow is visible; layers,
 * terrain and diagnostics live in the drawer.
 */
import { onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import HeaderBar from './components/HeaderBar.vue'
import FooterBar from './components/FooterBar.vue'
import SitesSurface from './components/SitesSurface.vue'
import AnalysisSurface from './components/AnalysisSurface.vue'
import ViewportPanel from './components/ViewportPanel.vue'
import TimelineBar from './components/TimelineBar.vue'
import ToolsDrawer from './components/ToolsDrawer.vue'
import { actions, state } from './components/composables/useAppState.js'

const { t } = useI18n()

const drawer = reactive({ open: false, tab: 'layers' })
const toast = ref(null)
let toastTimer = null

function openTools(tab) {
  drawer.tab = tab
  drawer.open = true
}

function closeTools() {
  drawer.open = false
}

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
    <HeaderBar @open-tools="openTools" />

    <main class="app-main" :aria-busy="!state.booted">
      <SitesSurface />
      <section class="app-center" :aria-label="t('app.centerLabel')">
        <div class="center-stack">
          <ViewportPanel />
          <TimelineBar />
        </div>
      </section>
      <AnalysisSurface />
    </main>

    <FooterBar />
    <ToolsDrawer :open="drawer.open" :tab="drawer.tab" @close="closeTools" @update:tab="drawer.tab = $event" />

    <div v-if="!state.booted" class="boot-overlay" role="status" aria-live="polite">
      <div class="spinner" aria-hidden="true" />
      <span>{{ t('app.loading') }}</span>
    </div>

    <div v-if="toast" class="toast" role="alert">{{ toast }}</div>
  </div>
</template>
