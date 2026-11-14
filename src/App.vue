<script setup>
/**
 * L-SEA application shell: slim header, resizable sites rail, dominant viewport
 * with compact timeline, resizable analysis rail, one-line footer and the
 * secondary-tools drawer.
 *
 * Rail widths are draggable (pointer/keyboard) and persisted in localStorage;
 * they are clamped on window resize so the centre column always keeps room and
 * the page never overflows horizontally.
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
import ResizeHandle from './components/ui/ResizeHandle.vue'
import HorizontalSplitHandle from './components/ui/HorizontalSplitHandle.vue'
import { actions, state } from './components/composables/useAppState.js'

const { t } = useI18n()

const drawer = reactive({ open: false, tab: 'layers' })
const toast = ref(null)
let toastTimer = null

/* -------------------------------------------------------------------------- */
/* Resizable split panes                                                      */
/* -------------------------------------------------------------------------- */

const LAYOUT_SPEC = {
  left: { storageKey: 'lsea.layout.leftWidth', min: 220, defaultWidth: 300, max: 420 },
  right: { storageKey: 'lsea.layout.rightWidth', min: 260, defaultWidth: 360, max: 480 },
}
const PAGE_PADDING_PX = 20
const HANDLE_SPACE_PX = 20
const CENTER_MIN_PX = 420
const COMPACT_BREAKPOINT_PX = 1024

function clampSide(side, value) {
  const spec = LAYOUT_SPEC[side]
  return Math.min(spec.max, Math.max(spec.min, Math.round(Number(value) || spec.defaultWidth)))
}

function readStoredWidth(side) {
  const spec = LAYOUT_SPEC[side]
  try {
    const stored = Number(localStorage.getItem(spec.storageKey))
    if (Number.isFinite(stored) && stored > 0) return clampSide(side, stored)
  } catch {
    /* storage unavailable */
  }
  return spec.defaultWidth
}

const MAP_RATIO_KEY = 'lsea.layout.mapRatio'
const MAP_RATIO_MIN = 0.55
const MAP_RATIO_MAX = 1
const MAP_RATIO_DEFAULT = 0.92

function readStoredRatio() {
  try {
    const raw = localStorage.getItem(MAP_RATIO_KEY)
    const stored = Number(raw)
    if (raw !== null && raw !== '' && Number.isFinite(stored)) {
      return Math.min(MAP_RATIO_MAX, Math.max(MAP_RATIO_MIN, stored))
    }
  } catch {
    /* storage unavailable */
  }
  return MAP_RATIO_DEFAULT
}

const layout = reactive({
  left: readStoredWidth('left'),
  right: readStoredWidth('right'),
})
const mapRatio = ref(readStoredRatio())
const mapSide = ref(480)
const viewportHeightPx = ref(480)
const timelineHeightPx = ref(72)
const centerRef = ref(null)
let centerObserver = null

function saveWidths() {
  try {
    localStorage.setItem(LAYOUT_SPEC.left.storageKey, String(layout.left))
    localStorage.setItem(LAYOUT_SPEC.right.storageKey, String(layout.right))
    localStorage.setItem(MAP_RATIO_KEY, String(Number(mapRatio.value.toFixed(3))))
  } catch {
    /* storage unavailable */
  }
}

function computeMapSide() {
  const el = centerRef.value
  if (!el) return
  const availableHeight = Math.max(220, el.clientHeight)
  const handleSpace = 10
  const gap = 16
  const usable = Math.max(180, availableHeight - handleSpace - gap)
  const share = Math.min(MAP_RATIO_MAX, Math.max(MAP_RATIO_MIN, mapRatio.value))
  // Timeline stays compact by default (64px) and can grow when the user drags
  // the vertical split downwards; the viewport always fills the remainder, so
  // there is no dead space below the timeline.
  const timelineMax = Math.max(64, usable - 220)
  const timelineHeight = Math.round(Math.min(timelineMax, Math.max(64, usable * (1 - share))))
  const viewportHeight = Math.round(usable - timelineHeight)
  mapSide.value = viewportHeight
  viewportHeightPx.value = viewportHeight
  timelineHeightPx.value = timelineHeight
}

function updateMapRatio(value) {
  const next = Math.min(MAP_RATIO_MAX, Math.max(MAP_RATIO_MIN, Number(value) || MAP_RATIO_DEFAULT))
  if (next === mapRatio.value) return
  mapRatio.value = next
  computeMapSide()
  schedulePersist()
}


let persistTimer = null
let resizeRaf = null

function schedulePersist() {
  if (persistTimer) clearTimeout(persistTimer)
  persistTimer = setTimeout(() => {
    persistTimer = null
    saveWidths()
  }, 250)
}

/**
 * Keep the rails inside their own bounds AND leave at least CENTER_MIN_PX for
 * the centre column. Below the compact breakpoint the layout stacks, so only
 * the per-rail bounds apply.
 */
function clampLayout() {
  const viewportWidth = window.innerWidth
  let left = clampSide('left', layout.left)
  let right = clampSide('right', layout.right)
  if (viewportWidth > COMPACT_BREAKPOINT_PX) {
    const maxRails = Math.max(
      LAYOUT_SPEC.left.min + LAYOUT_SPEC.right.min,
      viewportWidth - PAGE_PADDING_PX - HANDLE_SPACE_PX - CENTER_MIN_PX,
    )
    if (left + right > maxRails) {
      right = Math.max(LAYOUT_SPEC.right.min, Math.min(right, maxRails - left))
      if (left + right > maxRails) {
        left = Math.max(LAYOUT_SPEC.left.min, Math.min(left, maxRails - right))
      }
    }
  }
  layout.left = left
  layout.right = right
}

function updateWidth(side, value) {
  const spec = LAYOUT_SPEC[side]
  layout[side] = Math.min(spec.max, Math.max(spec.min, Math.round(Number(value) || spec.defaultWidth)))
  clampLayout()
  schedulePersist()
}

function resetWidth(side) {
  updateWidth(side, LAYOUT_SPEC[side].defaultWidth)
  saveWidths()
}

function onWindowResize() {
  if (resizeRaf !== null) return
  resizeRaf = requestAnimationFrame(() => {
    resizeRaf = null
    clampLayout()
    computeMapSide()
    saveWidths()
  })
}

/* -------------------------------------------------------------------------- */
/* Drawer, toast and boot                                                     */
/* -------------------------------------------------------------------------- */

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
  clampLayout()
  computeMapSide()
  centerObserver = new ResizeObserver(() => computeMapSide())
  if (centerRef.value) centerObserver.observe(centerRef.value)
  window.addEventListener('resize', onWindowResize)
  actions.boot().catch((error) => {
    console.error('[lsea] boot failed', error)
  })
})

onBeforeUnmount(() => {
  actions.stopPlayback()
  if (toastTimer) clearTimeout(toastTimer)
  if (persistTimer) clearTimeout(persistTimer)
  if (resizeRaf !== null) cancelAnimationFrame(resizeRaf)
  if (centerObserver) centerObserver.disconnect()
  window.removeEventListener('resize', onWindowResize)
  document.body.classList.remove('is-resizing-panes')
})
</script>

<template>
  <div
    class="app-shell"
    :style="{ '--layout-left': `${layout.left}px`, '--layout-right': `${layout.right}px` }"
  >
    <HeaderBar @open-tools="openTools" />

    <main class="app-main" :aria-busy="!state.booted">
      <SitesSurface data-testid="layout-left-rail" />
      <ResizeHandle
        side="left"
        :width="layout.left"
        :min="LAYOUT_SPEC.left.min"
        :max="LAYOUT_SPEC.left.max"
        :default-width="LAYOUT_SPEC.left.defaultWidth"
        label-key="layout.resizeLeft"
        test-id="resize-handle-left"
        @update:width="updateWidth('left', $event)"
        @commit="saveWidths"
      />
      <section ref="centerRef" class="app-center" data-testid="layout-center" :aria-label="t('app.centerLabel')">
        <div
          class="center-stack"
          :style="{ '--viewport-height': `${viewportHeightPx}px`, '--timeline-height': `${timelineHeightPx}px` }"
        >
          <div class="center-map">
            <ViewportPanel />
          </div>
          <HorizontalSplitHandle
            :ratio="mapRatio"
            :min="MAP_RATIO_MIN"
            :max="MAP_RATIO_MAX"
            :default-ratio="MAP_RATIO_DEFAULT"
            @update:ratio="updateMapRatio"
            @commit="saveWidths"
          />
          <TimelineBar />
        </div>
      </section>
      <ResizeHandle
        side="right"
        :width="layout.right"
        :min="LAYOUT_SPEC.right.min"
        :max="LAYOUT_SPEC.right.max"
        :default-width="LAYOUT_SPEC.right.defaultWidth"
        label-key="layout.resizeRight"
        test-id="resize-handle-right"
        @update:width="updateWidth('right', $event)"
        @commit="saveWidths"
      />
      <AnalysisSurface data-testid="layout-right-rail" />
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
