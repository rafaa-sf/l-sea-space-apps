<script setup>
/**
 * Root router for the two surfaces of the application:
 *
 * - `#/`        landing page with the project presentation (default)
 * - `#/tool`    the interactive mission console (lazy-loaded)
 *
 * Hash routing keeps the deployment static (Vercel rewrites everything to
 * `index.html`) and lets the landing link straight to the tool with a button.
 */
import { computed, defineAsyncComponent, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import LandingPage from './landing/LandingPage.vue'

const ToolApp = defineAsyncComponent(() => import('./App.vue'))

const { t } = useI18n()

const route = ref(readRoute())

function readRoute() {
  const hash = window.location.hash.replace(/^#/, '')
  return hash === '/tool' || hash === 'tool' ? 'tool' : 'landing'
}

function syncRoute() {
  route.value = readRoute()
  if (route.value === 'tool') window.scrollTo({ top: 0 })
}

function openTool() {
  window.location.hash = '#/tool'
}

function openHome() {
  window.location.hash = '#/'
}

const isTool = computed(() => route.value === 'tool')

onMounted(() => window.addEventListener('hashchange', syncRoute))
onBeforeUnmount(() => window.removeEventListener('hashchange', syncRoute))
</script>

<template>
  <ToolApp v-if="isTool" />
  <template v-else>
    <LandingPage @open-tool="openTool" />
  </template>
  <a v-if="isTool" class="root-home-link" href="#/" @click.prevent="openHome">
    <span aria-hidden="true">←</span> {{ t('landing.backToProject') }}
  </a>
</template>

<style scoped>
.root-home-link {
  position: fixed;
  left: 12px;
  bottom: 12px;
  z-index: 40;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-sm);
  background: rgba(13, 16, 22, 0.92);
  color: var(--color-text-dim);
  font-family: var(--font-ui);
  font-size: 12px;
  text-decoration: none;
  backdrop-filter: blur(6px);
}

.root-home-link:hover {
  color: var(--color-text);
  border-color: var(--color-accent);
}

.root-home-link:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: 2px;
}
</style>
