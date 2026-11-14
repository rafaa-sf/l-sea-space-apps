<script setup>
/** Application header: brand, event badge, locale switcher and JSON export. */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { persistLocale } from '../i18n/index.js'
import { actions, selectedSite, state } from './composables/useAppState.js'
import { siteDisplayName } from './composables/labels.js'
import { formatUtc } from './composables/format.js'

const { t, locale, te } = useI18n()

const exportBusy = computed(() => state.export.status === 'busy')
const exportLabel = computed(() => {
  if (state.export.status === 'busy') return t('header.exporting')
  return t('header.export')
})

const selectedName = computed(() => siteDisplayName(t, te, selectedSite.value))
const utcLabel = computed(() => formatUtc(state.time))

const locales = [
  { code: 'en', label: 'EN', titleKey: 'header.english' },
  { code: 'es', label: 'ES', titleKey: 'header.spanish' },
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
    <div class="brand">
      <span class="brand__mark" aria-hidden="true">◒</span>
      <div class="brand__text">
        <span class="brand__name">L-SEA</span>
        <span class="brand__tagline">{{ t('app.subtitle') }}</span>
      </div>
    </div>

    <div class="app-header__context">
      <span class="chip chip--event">{{ t('app.badge') }}</span>
      <span class="header-status" :title="t('header.currentSiteHint')">
        <span class="header-status__label">{{ t('header.currentSite') }}</span>
        <span class="header-status__value">{{ selectedName || t('common.none') }}</span>
      </span>
      <span class="header-status header-status--time" :title="t('header.utcHint')">
        <span class="header-status__label">{{ t('header.utcTime') }}</span>
        <span class="header-status__value">{{ utcLabel }}</span>
      </span>
    </div>

    <div class="app-header__actions">
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
        class="button button--primary"
        :disabled="exportBusy"
        :title="t('header.exportHint')"
        @click="onExport"
      >
        <span aria-hidden="true">⤓</span>
        {{ exportLabel }}
      </button>
    </div>
  </header>
</template>
