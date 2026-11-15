<script setup>
/**
 * Secondary-tools drawer: layers, terrain and diagnostics are hidden by default
 * and revealed in a right-side slide-over dialog.
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import TabBar from './ui/TabBar.vue'
import LayersPanel from './panels/LayersPanel.vue'
import TopographyPanel from './panels/TopographyPanel.vue'
import OrbitalVariationPanel from './panels/OrbitalVariationPanel.vue'
import WorkerStatusPanel from './panels/WorkerStatusPanel.vue'
import FallbackStatusPanel from './panels/FallbackStatusPanel.vue'

const props = defineProps({
  open: { type: Boolean, default: false },
  tab: { type: String, default: 'layers' },
})

const emit = defineEmits(['close', 'update:tab'])
const { t } = useI18n()

const closeButton = ref(null)
const dialogRef = ref(null)
let lastFocused = null

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ')

const activeTab = computed({
  get: () => props.tab,
  set: (value) => emit('update:tab', value),
})

const tabs = [
  { id: 'layers', labelKey: 'tabs.layers' },
  { id: 'terrain', labelKey: 'tabs.terrain' },
  { id: 'diagnostics', labelKey: 'tabs.diagnostics' },
]

async function onOpen() {
  lastFocused = document.activeElement
  await nextTick()
  closeButton.value?.focus()
}

function onClose() {
  emit('close')
  if (lastFocused && typeof lastFocused.focus === 'function') lastFocused.focus()
}

/** Focusable children of the open dialog, skipping hidden tab panels. */
function focusableItems() {
  const root = dialogRef.value
  if (!root) return []
  return Array.from(root.querySelectorAll(FOCUSABLE_SELECTOR)).filter(
    (element) => element.getClientRects().length > 0,
  )
}

function trapTab(event) {
  const items = focusableItems()
  if (!items.length) {
    event.preventDefault()
    return
  }
  const first = items[0]
  const last = items[items.length - 1]
  const active = document.activeElement
  const inside = Boolean(dialogRef.value && dialogRef.value.contains(active))
  if (event.shiftKey) {
    if (!inside || active === first) {
      event.preventDefault()
      last.focus()
    }
    return
  }
  if (!inside || active === last) {
    event.preventDefault()
    first.focus()
  }
}

function onWindowKeydown(event) {
  if (!props.open) return
  if (event.key === 'Escape') {
    event.preventDefault()
    onClose()
    return
  }
  if (event.key === 'Tab') trapTab(event)
}

watch(
  () => props.open,
  (open) => {
    if (open) onOpen()
  },
)

onMounted(() => window.addEventListener('keydown', onWindowKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onWindowKeydown))
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="drawer-root">
      <div class="drawer-backdrop" @click="onClose" />
      <section ref="dialogRef" class="drawer" role="dialog" aria-modal="true" :aria-label="t('drawer.title')">
        <header class="drawer__head">
          <h2 class="drawer__title">{{ t('drawer.title') }}</h2>
          <button ref="closeButton" type="button" class="button button--quiet button--small drawer__close" @click="onClose">
            <span class="icon-cross" aria-hidden="true" />
            <span>{{ t('drawer.close') }}</span>
          </button>
        </header>
        <TabBar v-model="activeTab" :tabs="tabs" label-key="drawer.tabsLabel" />
        <div class="drawer__body">
          <div v-show="activeTab === 'layers'" role="tabpanel" :aria-label="t('tabs.layers')">
            <LayersPanel />
          </div>
          <div v-show="activeTab === 'terrain'" role="tabpanel" :aria-label="t('tabs.terrain')">
            <p class="panel-note dem-hint-note">{{ t('dem.hint') }}</p>
            <TopographyPanel />
            <OrbitalVariationPanel />
          </div>
          <div v-show="activeTab === 'diagnostics'" role="tabpanel" :aria-label="t('tabs.diagnostics')">
            <WorkerStatusPanel />
            <FallbackStatusPanel />
          </div>
        </div>
      </section>
    </div>
  </Teleport>
</template>
