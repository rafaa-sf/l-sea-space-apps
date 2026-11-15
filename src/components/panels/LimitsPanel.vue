<script setup>
/**
 * Assumptions & limits: what the console models, where the data comes from and
 * what it explicitly does not do. Kept next to the data-status panel so the
 * provenance and the caveats are read together.
 */
import { useI18n } from 'vue-i18n'
import PanelCard from '../ui/PanelCard.vue'

const { t } = useI18n()

const items = [
  'limits.ephemeris',
  'limits.terrain',
  'limits.models',
  'limits.validation',
  'limits.status',
]
</script>

<template>
  <PanelCard title-key="limits.title" :badge="t('limits.badge')" :default-open="false">
    <ul class="panel-bullet-list">
      <li v-for="key in items" :key="key">{{ t(key) }}</li>
    </ul>
  </PanelCard>
</template>
