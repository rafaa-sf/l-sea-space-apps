<script setup>
/**
 * Accessible segmented tabs used by the rail surfaces and the tools drawer.
 * Keyboard: Left/Right/Home/End move the selection.
 */
import { useI18n } from 'vue-i18n'

const props = defineProps({
  modelValue: { type: String, required: true },
  tabs: { type: Array, default: () => [] },
  labelKey: { type: String, default: null },
  label: { type: String, default: '' },
})

const emit = defineEmits(['update:modelValue'])
const { t } = useI18n()

function select(id) {
  if (id !== props.modelValue) emit('update:modelValue', id)
}

function onKeydown(event) {
  const index = props.tabs.findIndex((tab) => tab.id === props.modelValue)
  if (index < 0) return
  let nextIndex = null
  if (event.key === 'ArrowRight') nextIndex = (index + 1) % props.tabs.length
  if (event.key === 'ArrowLeft') nextIndex = (index - 1 + props.tabs.length) % props.tabs.length
  if (event.key === 'Home') nextIndex = 0
  if (event.key === 'End') nextIndex = props.tabs.length - 1
  if (nextIndex === null) return
  event.preventDefault()
  select(props.tabs[nextIndex].id)
  const buttons = event.currentTarget.querySelectorAll('[role="tab"]')
  buttons[nextIndex]?.focus()
}
</script>

<template>
  <div class="tabs" role="tablist" :aria-label="labelKey ? t(labelKey) : label" @keydown="onKeydown">
    <button
      v-for="tab in tabs"
      :key="tab.id"
      type="button"
      role="tab"
      class="tabs__tab"
      :class="{ 'is-active': tab.id === modelValue }"
      :aria-selected="tab.id === modelValue"
      :tabindex="tab.id === modelValue ? 0 : -1"
      @click="select(tab.id)"
    >
      {{ tab.labelKey ? t(tab.labelKey) : tab.label }}
      <span v-if="tab.count" class="tabs__count">{{ tab.count }}</span>
    </button>
  </div>
</template>
