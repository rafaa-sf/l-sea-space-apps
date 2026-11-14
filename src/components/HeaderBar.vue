<script setup>
/**
 * Slim application header: wordmark, product name, current context (site and
 * UTC time), secondary-tools buttons, locale switch and the brief export.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { persistLocale } from '../i18n/index.js'
import { actions, selectedSite, state } from './composables/useAppState.js'
import { siteDisplayName } from './composables/labels.js'
import { formatUtc } from './composables/format.js'

const { t, locale, te } = useI18n()

const emit = defineEmits(['open-tools'])

const exportBusy = computed(() => state.export.status === 'busy')
const exportLabel = computed(() => (exportBusy.value ? t('header.exporting') : t('header.export')))
const selectedName = computed(() => siteDisplayName(t, te, selectedSite.value) || t('common.none'))
const utcLabel = computed(() => formatUtc(state.time))

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

    <div class="app-header__actions">
      <nav class="header-tools" :aria-label="t('header.toolsLabel')">
        <button
          v-for="tool in tools"
          :key="tool.id"
          type="button"
          class="button button--quiet button--small"
          :aria-label="t('header.openTool', { tool: t(tool.labelKey) })"
          @click="emit('open-tools', tool.id)"
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
        class="button button--primary button--small"
        :disabled="exportBusy"
        :title="t('header.exportHint')"
        @click="onExport"
      >
        {{ exportLabel }}
      </button>
    </div>
  </header>
</template>
