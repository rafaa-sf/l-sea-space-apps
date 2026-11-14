<script setup>
/** Label/value row used across the analysis panels. */
import { useI18n } from 'vue-i18n'

defineProps({
  labelKey: { type: String, default: null },
  label: { type: String, default: '' },
  value: { type: [String, Number], default: '—' },
  unit: { type: String, default: '' },
  tone: { type: String, default: 'default' },
  mono: { type: Boolean, default: true },
  hint: { type: String, default: '' },
})

const { t } = useI18n()
</script>

<template>
  <div class="stat-row" :class="`tone-${tone}`">
    <span class="stat-row__label">
      {{ labelKey ? t(labelKey) : label }}
      <abbr v-if="hint" class="stat-row__hint" :title="hint">?</abbr>
    </span>
    <span class="stat-row__value" :class="{ 'is-mono': mono }">
      {{ value }}<span v-if="unit" class="stat-row__unit"> {{ unit }}</span>
    </span>
  </div>
</template>
