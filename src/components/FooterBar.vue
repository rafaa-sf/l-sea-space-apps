<script setup>
/** One-line footer: NASA data attribution and required links. */
import { useI18n } from 'vue-i18n'
import { APP_LINKS, DATA_SOURCES } from './composables/useData.js'

const { t } = useI18n()
</script>

<template>
  <footer class="app-footer">
    <a class="app-footer__home" href="#/">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M19 12H5M11 6l-6 6 6 6" />
      </svg>
      {{ t('landing.backToProject') }}
    </a>
    <span class="app-footer__label">{{ t('footer.data') }}</span>
    <a :href="DATA_SOURCES.horizons.url" target="_blank" rel="noopener noreferrer">{{ DATA_SOURCES.horizons.label }}</a>
    <a :href="DATA_SOURCES.lola.url" target="_blank" rel="noopener noreferrer">{{ t('footer.lola') }}</a>
    <a :href="DATA_SOURCES.moonTrek.url" target="_blank" rel="noopener noreferrer">{{ DATA_SOURCES.moonTrek.label }}</a>
    <a :href="DATA_SOURCES.quickMap.url" target="_blank" rel="noopener noreferrer">{{ DATA_SOURCES.quickMap.label }}</a>

    <span class="app-footer__spacer" />

    <a :href="APP_LINKS.aiUsage" target="_blank" rel="noopener noreferrer">{{ t('footer.aiUsage') }}</a>
    <a href="https://github.com/rafaa-sf/l-sea-space-apps" target="_blank" rel="noopener noreferrer">{{ t('footer.repository') }}</a>
    <span class="app-footer__meta">{{ t('footer.event') }}</span>
  </footer>
</template>
