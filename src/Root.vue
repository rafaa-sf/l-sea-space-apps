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
import LandingPage from './landing/LandingPage.vue'

const ToolApp = defineAsyncComponent(() => import('./App.vue'))


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

const isTool = computed(() => route.value === 'tool')

onMounted(() => window.addEventListener('hashchange', syncRoute))
onBeforeUnmount(() => window.removeEventListener('hashchange', syncRoute))
</script>

<template>
  <ToolApp v-if="isTool" />
  <template v-else>
    <LandingPage @open-tool="openTool" />
  </template>
</template>


