<script setup>
/**
 * Accessible horizontal split handle between the map and the timeline.
 * Drag up/down to change the map share of the centre column; keyboard
 * ArrowUp/ArrowDown (Shift = larger steps), Home or double-click resets.
 */
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps({
  ratio: { type: Number, required: true },
  min: { type: Number, default: 0.45 },
  max: { type: Number, default: 1 },
  defaultRatio: { type: Number, required: true },
})

const emit = defineEmits(['update:ratio', 'commit'])
const { t } = useI18n()
const dragging = ref(false)

let startY = 0
let startRatio = props.ratio
let pendingY = 0
let rafId = null

const clampRatio = (value) => Math.min(props.max, Math.max(props.min, value))

function emitRatio(value) {
  emit('update:ratio', clampRatio(value))
}

function onPointerDown(event) {
  if (event.button !== 0) return
  dragging.value = true
  startY = event.clientY
  startRatio = props.ratio
  pendingY = event.clientY
  try {
    event.currentTarget.setPointerCapture(event.pointerId)
  } catch {
    /* best effort */
  }
  document.body.classList.add('is-resizing-panes')
  event.preventDefault()
}

function onPointerMove(event) {
  if (!dragging.value) return
  pendingY = event.clientY
  if (rafId !== null) return
  rafId = requestAnimationFrame(() => {
    rafId = null
    const delta = pendingY - startY
    const height = Math.max(120, window.innerHeight - 160)
    // Dragging down enlarges the map (it is the top pane of the split).
    emitRatio(startRatio + delta / height)
  })
}

function onPointerUp(event) {
  if (!dragging.value) return
  dragging.value = false
  if (rafId !== null) {
    cancelAnimationFrame(rafId)
    rafId = null
  }
  const delta = (event.clientY ?? pendingY) - startY
  const height = Math.max(120, window.innerHeight - 160)
  emitRatio(startRatio + delta / height)
  emit('commit')
  document.body.classList.remove('is-resizing-panes')
}

function reset() {
  emitRatio(props.defaultRatio)
  emit('commit')
}

function onKeydown(event) {
  const step = event.shiftKey ? 0.12 : 0.04
  if (event.key === 'ArrowDown') {
    event.preventDefault()
    emitRatio(props.ratio + step)
    emit('commit')
    return
  }
  if (event.key === 'ArrowUp') {
    event.preventDefault()
    emitRatio(props.ratio - step)
    emit('commit')
    return
  }
  if (event.key === 'Home') {
    event.preventDefault()
    emitRatio(props.defaultRatio)
    emit('commit')
    return
  }
  if (event.key === 'End') {
    event.preventDefault()
    emitRatio(props.max)
    emit('commit')
  }
}
</script>

<template>
  <div
    class="split-handle-horizontal"
    :class="{ 'is-dragging': dragging }"
    role="separator"
    aria-orientation="horizontal"
    :aria-label="t('layout.resizeVertical')"
    :aria-valuemin="Math.round(min * 100)"
    :aria-valuemax="Math.round(max * 100)"
    :aria-valuenow="Math.round(ratio * 100)"
    :aria-valuetext="`${Math.round(ratio * 100)}%`"
    :title="t('layout.resizeVerticalHint')"
    tabindex="0"
    data-testid="split-handle-vertical"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointercancel="dragging = false"
    @keydown="onKeydown"
    @dblclick="reset"
  >
    <span class="split-handle-horizontal__line" aria-hidden="true" />
  </div>
</template>
