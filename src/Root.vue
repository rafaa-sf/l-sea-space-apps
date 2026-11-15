<script setup>
/**
 * Root router for the two surfaces of the application:
 *
 * - `#/`        landing page with the project presentation (default)
 * - `#/tool`    the interactive mission console (lazy-loaded)
 *
 * Hash routing keeps the deployment static. The tool chunk is loaded lazily and
 * a chunk/network failure must never leave a blank page (BH-02): the shell shows
 * an explicit error with Retry/Reload. Boot/data failures reported by the tool
 * store (BH-01/BH-03/BH-09) are surfaced in the same shell banner.
 */
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'
import LandingPage from './landing/LandingPage.vue'
import { useI18n } from 'vue-i18n'

const ToolApp = shallowRef(null)
const toolLoading = ref(false)
const toolError = ref(null)
const dataError = ref(null)

const { t } = useI18n()

const route = ref(readRoute())

function readRoute() {
  const hash = window.location.hash.replace(/^#/, '')
  return hash === '/tool' || hash === 'tool' ? 'tool' : 'landing'
}

async function loadTool() {
  if (ToolApp.value || toolLoading.value) return
  toolLoading.value = true
  toolError.value = null
  try {
    const module = await import('./App.vue')
    ToolApp.value = module?.default ?? null
  } catch (error) {
    toolError.value = {
      message: error instanceof Error ? error.message : String(error),
      at: new Date().toISOString(),
    }
  } finally {
    toolLoading.value = false
  }
}

function syncRoute() {
  route.value = readRoute()
  if (route.value === 'tool') {
    window.scrollTo({ top: 0 })
    loadTool()
  }
}

function openTool() {
  window.location.hash = '#/tool'
}

function onDataError(event) {
  dataError.value = event?.detail ?? { scope: 'data', message: 'Data could not be loaded' }
}

function retryData() {
  const scope = dataError.value?.scope
  dataError.value = null
  if (scope === 'terrain' && typeof window.__lseaRetryTerrain === 'function') {
    window.__lseaRetryTerrain()
    return
  }
  if (scope === 'ephemeris' && typeof window.__lseaRetryEphemeris === 'function') {
    window.__lseaRetryEphemeris()
    return
  }
  if (typeof window.__lseaRetryBoot === 'function') window.__lseaRetryBoot()
  else window.location.reload()
}

function reloadTool() {
  window.location.reload()
}

const dataErrorTitle = computed(() => {
  const scope = dataError.value?.scope
  if (scope === 'ephemeris') return t('shell.ephemerisError')
  if (scope === 'sites') return t('shell.sitesError')
  return t('shell.terrainError')
})

const isTool = computed(() => route.value === 'tool')

onMounted(() => {
  window.addEventListener('hashchange', syncRoute)
  window.addEventListener('lsea:data-error', onDataError)
  if (isTool.value) loadTool()
})
onBeforeUnmount(() => {
  window.removeEventListener('hashchange', syncRoute)
  window.removeEventListener('lsea:data-error', onDataError)
})
</script>

<template>
  <component :is="ToolApp" v-if="isTool && ToolApp" />

  <div v-else-if="isTool && toolError" class="shell-error" role="alert">
    <h1>{{ t('shell.loadErrorTitle') }}</h1>
    <p>{{ t('shell.loadErrorBody') }}</p>
    <p class="shell-error__detail">{{ toolError.message }}</p>
    <div class="shell-error__actions">
      <button type="button" class="shell-button" @click="loadTool">{{ t('shell.retry') }}</button>
      <button type="button" class="shell-button" @click="reloadTool">{{ t('shell.reload') }}</button>
    </div>
  </div>

  <div v-else-if="isTool" class="shell-loading" role="status" aria-live="polite">
    <div class="spinner" aria-hidden="true" />
    <span>{{ t('shell.loading') }}</span>
  </div>

  <LandingPage v-else @open-tool="openTool" />

  <div v-if="dataError" class="shell-error shell-error--banner" role="alert">
    <strong>{{ dataErrorTitle }}</strong>
    <span>{{ dataError.message }}</span>
    <div class="shell-error__actions">
      <button type="button" class="shell-button" @click="retryData">{{ t('shell.retry') }}</button>
      <button type="button" class="shell-button" @click="reloadTool">{{ t('shell.reload') }}</button>
    </div>
  </div>
</template>

<style scoped>
.shell-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
  min-height: 60vh;
  color: var(--color-text-muted, #a9b4c2);
}
.shell-error {
  max-width: 42rem;
  margin: 12vh auto;
  padding: 1.5rem;
  border: 1px solid var(--color-danger, #e26969);
  border-radius: 0.75rem;
  background: var(--color-surface, #141a22);
  color: var(--color-text, #eef3f8);
}
.shell-error h1 {
  margin: 0 0 0.5rem;
  font-size: 1.25rem;
}
.shell-error__detail {
  font-family: monospace;
  font-size: 0.8rem;
  opacity: 0.85;
  word-break: break-word;
}
.shell-error__actions {
  display: flex;
  gap: 0.5rem;
  margin-top: 1rem;
}
.shell-button {
  padding: 0.45rem 0.9rem;
  border-radius: 0.4rem;
  border: 1px solid var(--color-border, #3a4656);
  background: var(--color-surface-raised, #1d2630);
  color: inherit;
  cursor: pointer;
}
.shell-error--banner {
  position: fixed;
  right: 1rem;
  bottom: 1rem;
  z-index: 1000;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
  max-width: 32rem;
  margin: 0;
  padding: 0.75rem 1rem;
  font-size: 0.9rem;
}
</style>
