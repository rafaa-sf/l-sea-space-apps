<script setup>
/**
 * Collapsible mission-control panel card used by every feature panel.
 * Keyboard accessible: the header is a button with aria-expanded/controls.
 */
import { useId, ref } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps({
  titleKey: { type: String, default: null },
  title: { type: String, default: '' },
  badge: { type: String, default: '' },
  tone: { type: String, default: 'default' },
  defaultOpen: { type: Boolean, default: true },
  dense: { type: Boolean, default: false },
})

const { t } = useI18n()
const bodyId = `panel-${useId()}`
const open = ref(props.defaultOpen)
</script>

<template>
  <section class="panel-card" :class="[`tone-${tone}`, { 'is-collapsed': !open, 'is-dense': dense }]">
    <header class="panel-card__head">
      <button
        class="panel-card__toggle"
        type="button"
        :aria-expanded="open"
        :aria-controls="bodyId"
        @click="open = !open"
      >
        <span class="panel-card__chev" aria-hidden="true">{{ open ? '▾' : '▸' }}</span>
        <span class="panel-card__title">{{ titleKey ? t(titleKey) : title }}</span>
        <span v-if="badge" class="chip panel-card__badge">{{ badge }}</span>
      </button>
      <div class="panel-card__actions">
        <slot name="actions" />
      </div>
    </header>
    <div v-show="open" :id="bodyId" class="panel-card__body">
      <slot />
    </div>
  </section>
</template>
