<script setup>
/**
 * Main viewport: renders the moon scene in 3D (lazy-loaded Three.js) or the
 * Canvas 2D fallback, with the mode switcher, data-source badges, layer status
 * and a keyboard/screen-reader friendly wrapper.
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { actions, selectedSite, state } from './composables/useAppState.js'
import { getCompute } from './composables/useCompute.js'
import { detectWebgl } from '../render/webgl.js'
import { siteDisplayName, sourceLabelKey } from './composables/labels.js'
import { formatLat, formatLon } from './composables/format.js'

const { t, te, locale } = useI18n()

const canvasRef = ref(null)
const canvasKey = ref(0)
const mode = ref('initializing')
const initializing = ref(true)
const webgl = ref(state.system.webgl)
const note = ref(null)

let api = null
let compute = null
let recreateToken = 0
let watchers = []

const labels = computed(() => ({
  sun: t('viewport.sun'),
  earth: t('viewport.earth'),
  scaleKm: t('viewport.scaleKm', { km: 50 }),
}))

const sceneSites = computed(() =>
  state.sites.map((site) => ({ ...site, displayName: siteDisplayName(t, te, site) })),
)

const selectedName = computed(() => siteDisplayName(t, te, selectedSite.value) || t('common.none'))

const modeOptions = computed(() => [
  { value: 'auto', label: t('viewport.mode.auto') },
  { value: '3d', label: t('viewport.mode.threeD') },
  { value: '2d', label: t('viewport.mode.twoD') },
])

const fallbackReason = computed(() => {
  if (mode.value !== '2d') return null
  if (state.system.viewMode === '2d') return t('viewport.fallback.manual')
  if (webgl.value && webgl.value.ok === false) return t(`viewport.fallback.reason.${webgl.value.reason === 'no-context' ? 'noContext' : 'unavailable'}`)
  return note.value ? t('viewport.fallback.reason.error') : t('viewport.fallback.reason.auto')
})

const terrainBadge = computed(() => t(sourceLabelKey(state.data.terrainSource, 'terrain')))
const ephemerisBadge = computed(() => t(sourceLabelKey(state.data.ephemerisSource, 'ephemeris')))

function rendererOptions() {
  return {
    labels: labels.value,
    sampleElevation: (lat, lon) => (compute && state.terrain ? compute.sampleElevation(state.terrain, lat, lon) : 0),
    terrainStats: (terrain) => (compute ? compute.terrainStats(terrain) : { minM: 0, maxM: 1 }),
    onPickSite: (id) => actions.selectSite(id),
    onPickLocation: (coordinates) => actions.setPointerLocation(coordinates),
    onLayerStatus: (id, status) => {
      actions.setLayerStatus(id, status)
    },
  }
}

function pushTerrain() {
  if (api && state.viewTerrain) api.setTerrain(state.viewTerrain)
}

function pushSites() {
  if (!api) return
  api.setSites(sceneSites.value, {
    selectedId: state.selectedSiteId,
    compareIds: state.compareSiteIds,
  })
}

function pushEnvironment() {
  if (!api) return
  api.setSunDirection(state.analysis.sun, state.analysis.sunVisible)
  api.setEarthDirection(state.analysis.earth, state.analysis.earthVisible)
  const ray = state.analysis.ray
  api.setRay(
    ray
      ? {
          ...ray,
          azimuth: state.analysis.sun.az,
          elevation: state.analysis.sun.el,
          elevationM: compute && state.terrain ? compute.sampleElevation(state.terrain, ray.lat, ray.lon) : 0,
        }
      : null,
  )
}

function pushLayers() {
  if (!api) return
  const enabled = Object.keys(state.layerEnabled).filter((id) => state.layerEnabled[id])
  api.setLayers(state.layers, enabled)
}

function pushLabels() {
  api?.setLabels(labels.value)
}

function pushAll() {
  pushTerrain()
  pushSites()
  pushEnvironment()
  pushLayers()
  pushLabels()
}

async function destroyRenderer() {
  if (!api) return
  try {
    api.dispose()
  } catch (error) {
    console.warn('[lsea] renderer dispose failed', error)
  }
  api = null
}

async function createRenderer() {
  const token = (recreateToken += 1)
  initializing.value = true
  note.value = null
  await destroyRenderer()
  // A canvas element that already holds a WebGL context cannot return a 2D
  // context (and vice versa), so mount a fresh canvas for every renderer.
  canvasKey.value += 1
  await nextTick()
  if (!canvasRef.value) return

  const want3d = state.system.viewMode === 'auto' ? Boolean(webgl.value?.ok) : state.system.viewMode === '3d'
  let created = null

  if (want3d && webgl.value?.ok) {
    try {
      const { createMoonScene } = await import('../render/moonScene.js')
      created = await createMoonScene(canvasRef.value, rendererOptions())
    } catch (error) {
      console.warn('[lsea] WebGL scene failed, using the 2D map', error)
      note.value = 'three-failed'
      created = null
    }
  }

  if (!created) {
    try {
      const { createFallback2D } = await import('../render/fallback2d.js')
      created = createFallback2D(canvasRef.value, rendererOptions())
    } catch (error) {
      console.error('[lsea] 2D fallback failed', error)
      note.value = 'fallback-failed'
      initializing.value = false
      mode.value = 'error'
      return
    }
  }

  if (token !== recreateToken) {
    created.dispose()
    return
  }

  api = created
  mode.value = created.kind
  actions.setRenderer(created.kind)
  initializing.value = false
  pushAll()
}

function setupWatchers() {
  watchers.push(
    watch(
      () => state.viewTerrain,
      () => {
        pushTerrain()
        pushSites()
        pushEnvironment()
      },
    ),
    watch(
      () => [state.sites, state.selectedSiteId, state.compareSiteIds],
      () => pushSites(),
      { deep: false },
    ),
    watch(
      () => state.analysis.updatedAt,
      () => pushEnvironment(),
    ),
    watch(
      () => ({ ...state.layerEnabled }),
      () => pushLayers(),
      { deep: true },
    ),
    watch(
      () => state.layers,
      () => pushLayers(),
      { deep: false },
    ),
    watch(
      () => locale.value,
      () => {
        pushLabels()
        pushSites()
      },
    ),
    watch(
      () => state.system.viewMode,
      () => createRenderer(),
    ),
  )
}

function setViewMode(value) {
  if (state.system.viewMode === value) return
  actions.setViewMode(value)
}

function resetView() {
  api?.resetView()
}

function onCanvasKeydown(event) {
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
  event.preventDefault()
  const currentIndex = state.sites.findIndex((site) => site.id === state.selectedSiteId)
  const delta = event.key === 'ArrowDown' ? 1 : -1
  const nextIndex = (currentIndex + delta + state.sites.length) % Math.max(1, state.sites.length)
  const nextSite = state.sites[nextIndex]
  if (nextSite) actions.selectSite(nextSite.id)
}

onMounted(async () => {
  compute = await getCompute()
  webgl.value = detectWebgl()
  actions.setWebglStatus(webgl.value)
  await createRenderer()
  setupWatchers()
})

onBeforeUnmount(() => {
  for (const stop of watchers) stop()
  watchers = []
  destroyRenderer()
})
</script>

<template>
  <section class="viewport" :aria-label="t('viewport.regionLabel')">
    <div class="viewport__stage">
      <canvas
        :key="canvasKey"
        ref="canvasRef"
        class="viewport__canvas"
        tabindex="0"
        role="img"
        :aria-label="t('viewport.canvasLabel', { site: selectedName })"
        @keydown="onCanvasKeydown"
      />
      <p class="sr-only">{{ t('viewport.keyboardHint') }}</p>

      <div class="viewport__badges">
        <span class="toolbar-badge" :class="mode === '3d' ? 'is-ok' : 'is-warn'">
          {{ mode === '3d' ? t('viewport.mode.threeD') : mode === '2d' ? t('viewport.mode.twoD') : t('common.loading') }}
        </span>
        <span class="toolbar-badge" :title="t('viewport.terrainBadgeHint')">{{ terrainBadge }}</span>
        <span class="toolbar-badge" :title="t('viewport.ephemerisBadgeHint')">{{ ephemerisBadge }}</span>
      </div>

      <div class="viewport__controls">
        <div class="segmented" role="group" :aria-label="t('viewport.modeLabel')">
          <button
            v-for="option in modeOptions"
            :key="option.value"
            type="button"
            class="segmented__button"
            :class="{ 'is-active': state.system.viewMode === option.value }"
            :aria-pressed="state.system.viewMode === option.value"
            @click="setViewMode(option.value)"
          >
            {{ option.label }}
          </button>
        </div>
        <button type="button" class="button button--quiet button--small" :title="t('viewport.resetViewHint')" @click="resetView">
          {{ t('viewport.resetView') }}
        </button>
      </div>

      <div v-if="initializing" class="viewport__overlay">
        <div class="spinner" aria-hidden="true" />
        <p>{{ t('viewport.loadingScene') }}</p>
      </div>

      <div v-else-if="mode === 'error'" class="viewport__overlay viewport__overlay--error" role="alert">
        <p>{{ t('viewport.errorScene') }}</p>
        <button type="button" class="button button--ghost" @click="createRenderer">{{ t('common.retry') }}</button>
      </div>

      <div v-if="note === 'three-failed'" class="viewport__banner viewport__banner--warn" role="status">
        {{ t('viewport.banner.threeFailed') }}
      </div>

      <div v-if="mode === '2d'" class="viewport__banner" role="status">
        <strong>{{ t('viewport.banner.fallbackTitle') }}</strong>
        <span>{{ fallbackReason }}</span>
        <button
          v-if="webgl && webgl.ok"
          type="button"
          class="button button--link"
          @click="setViewMode('3d')"
        >
          {{ t('viewport.banner.try3d') }}
        </button>
      </div>

      <div class="viewport__legend" :aria-label="t('viewport.legendLabel')">
        <span class="legend-item"><i class="legend-dot legend-dot--selected" aria-hidden="true" />{{ t('viewport.legend.selected') }}</span>
        <span class="legend-item"><i class="legend-dot legend-dot--compare" aria-hidden="true" />{{ t('viewport.legend.compare') }}</span>
        <span class="legend-item"><i class="legend-dot legend-dot--site" aria-hidden="true" />{{ t('viewport.legend.site') }}</span>
        <span class="legend-item"><i class="legend-dot legend-dot--sun" aria-hidden="true" />{{ t('viewport.legend.sun') }}</span>
        <span class="legend-item"><i class="legend-dot legend-dot--earth" aria-hidden="true" />{{ t('viewport.legend.earth') }}</span>
      </div>

      <div class="viewport__footer-hint">
        <span>{{ t('viewport.hint.marker') }}</span>
        <span>{{ t('viewport.hint.terrain') }}</span>
        <span v-if="state.pointer.at" class="viewport__pointer">
          {{ t('viewport.pointer', { lat: formatLat(state.pointer.lat), lon: formatLon(state.pointer.lon) }) }}
        </span>
      </div>
    </div>
  </section>
</template>
