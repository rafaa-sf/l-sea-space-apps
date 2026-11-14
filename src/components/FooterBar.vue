<script setup>
/** Footer: NASA data attribution, AI-usage declaration link and event note. */
import { useI18n } from 'vue-i18n'
import { APP_LINKS, DATA_SOURCES } from './composables/useData.js'

const { t } = useI18n()
</script>

<template>
  <footer class="app-footer">
    <div class="app-footer__row">
      <span class="app-footer__label">{{ t('footer.data') }}</span>
      <a :href="DATA_SOURCES.horizons.url" target="_blank" rel="noopener noreferrer">{{ DATA_SOURCES.horizons.label }}</a>
      <span aria-hidden="true">·</span>
      <a :href="DATA_SOURCES.lola.url" target="_blank" rel="noopener noreferrer">{{ t('footer.lola') }}</a>
      <span aria-hidden="true">·</span>
      <a :href="DATA_SOURCES.moonTrek.url" target="_blank" rel="noopener noreferrer">{{ DATA_SOURCES.moonTrek.label }}</a>
      <span aria-hidden="true">·</span>
      <a :href="DATA_SOURCES.quickMap.url" target="_blank" rel="noopener noreferrer">{{ DATA_SOURCES.quickMap.label }}</a>
    </div>
    <div class="app-footer__row app-footer__row--meta">
      <a :href="APP_LINKS.aiUsage" target="_blank" rel="noopener noreferrer">{{ t('footer.aiUsage') }}</a>
      <span aria-hidden="true">·</span>
      <span>{{ t('footer.event') }}</span>
      <span aria-hidden="true">·</span>
      <span>{{ t('footer.status') }}</span>
    </div>
  </footer>
</template>
