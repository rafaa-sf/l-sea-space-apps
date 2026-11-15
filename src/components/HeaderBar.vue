<script setup>
/**
 * Slim application header: wordmark, product name, current context (site and
 * UTC time), secondary-tools buttons, locale switch and the brief export.
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { persistLocale } from '../i18n/index.js'
import { actions, selectedSite, state } from './composables/useAppState.js'
import { siteDisplayName } from './composables/labels.js'
import { formatUtc } from './composables/format.js'

const { t, locale, te } = useI18n()

const emit = defineEmits(['open-tools'])

const menuOpen = ref(false)

function toggleMenu() {
  menuOpen.value = !menuOpen.value
}

function openTool(id) {
  menuOpen.value = false
  emit('open-tools', id)
}

function onKeydown(event) {
  if (event.key === 'Escape') menuOpen.value = false
}

function onDocumentClick(event) {
  if (!menuOpen.value) return
  const actions = event.target?.closest?.('.app-header__actions')
  if (!actions) menuOpen.value = false
}

onMounted(() => {
  document.addEventListener('keydown', onKeydown)
  document.addEventListener('click', onDocumentClick)
})

onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKeydown)
  document.removeEventListener('click', onDocumentClick)
})

const exportBusy = computed(() => state.export.status === 'busy')
const exportLabel = computed(() => (exportBusy.value ? t('header.exporting') : t('header.export')))
const selectedName = computed(() => siteDisplayName(t, te, selectedSite.value) || t('common.none'))
const utcLabel = computed(() => formatUtc(state.time, locale.value))

const locales = [
  { code: 'en', label: 'EN', titleKey: 'header.english' },
  { code: 'es', label: 'ES', titleKey: 'header.spanish' },
]

const tools = [
  { id: 'layers', labelKey: 'tabs.layers' },
  { id: 'terrain', labelKey: 'tabs.terrain' },
  { id: 'diagnostics', labelKey: 'tabs.diagnostics' },
]

function setLocale(code) {
  locale.value = code
  persistLocale(code)
  document.documentElement.lang = code
}

async function onExport() {
  if (exportBusy.value) return
  await actions.runExport()
}
</script>

<template>
  <header class="app-header">
    <div class="app-header__brand">
      <span class="brand-mark" aria-hidden="true" />
      <span class="brand-wordmark">L-SEA</span>
      <span class="brand-product">{{ t('app.productName') }}</span>
    </div>

    <div class="app-header__context">
      <span class="context-event">{{ t('app.badge') }}</span>
      <span class="context-separator" aria-hidden="true" />
      <span class="context-item" :title="t('header.currentSiteHint')">
        <span class="context-label">{{ t('header.currentSite') }}</span>
        <span class="context-value">{{ selectedName }}</span>
      </span>
      <span class="context-separator" aria-hidden="true" />
      <span class="context-item" :title="t('header.utcHint')">
        <span class="context-label">{{ t('header.utcTime') }}</span>
        <span class="context-value context-value--mono">{{ utcLabel }}</span>
      </span>
    </div>

    <div class="app-header__actions" :class="{ 'is-menu-open': menuOpen }">
      <button
        type="button"
        class="icon-button header-menu-toggle"
        :aria-label="t('header.toolsLabel')"
        :aria-expanded="menuOpen"
        aria-controls="header-tools-menu"
        @click="toggleMenu"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 7h16M4 12h16M4 17h16" />
        </svg>
      </button>
      <nav id="header-tools-menu" class="header-tools" :aria-label="t('header.toolsLabel')">
        <button
          v-for="tool in tools"
          :key="tool.id"
          type="button"
          class="button button--quiet button--small"
          :aria-label="t('header.openTool', { tool: t(tool.labelKey) })"
          @click="openTool(tool.id)"
        >
          {{ t(tool.labelKey) }}
        </button>
      </nav>
      <div class="locale-switcher" role="group" :aria-label="t('header.language')">
        <button
          v-for="entry in locales"
          :key="entry.code"
          type="button"
          class="locale-switcher__button"
          :class="{ 'is-active': locale === entry.code }"
          :aria-pressed="locale === entry.code"
          :title="t(entry.titleKey)"
          @click="setLocale(entry.code)"
        >
          {{ entry.label }}
        </button>
      </div>
      <button
        type="button"
        class="button button--primary button--small header-export"
        :disabled="exportBusy"
        :title="t('header.exportHint')"
        :aria-label="exportLabel"
        @click="onExport"
      >
        <svg class="header-export__icon" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 3v11m0 0 4-4m-4 4-4-4M5 17v3h14v-3" />
        </svg>
        <span class="header-export__label">{{ exportLabel }}</span>
      </button>
    </div>
  </header>
</template>
