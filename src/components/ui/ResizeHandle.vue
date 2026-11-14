<script setup>
/**
 * Accessible vertical split-pane handle.
 *
 * Drag with the pointer (rAF-throttled) or use the keyboard:
 * ArrowLeft/ArrowRight resize by 16 px (48 px with Shift), Home resets to the
 * default width, End expands to the maximum; double-click also resets.
 * Exposed as an ARIA separator with min/max/now values.
 */
import { onBeforeUnmount, ref } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps({
  side: { type: String, required: true },
  width: { type: Number, required: true },
  min: { type: Number, required: true },
  max: { type: Number, required: true },
  defaultWidth: { type: Number, required: true },
  labelKey: { type: String, required: true },
  testId: { type: String, required: true },
})

const emit = defineEmits(['update:width', 'commit'])
const { t } = useI18n()

const dragging = ref(false)
const clamped = (value) => Math.min(props.max, Math.max(props.min, Math.round(value)))

let startX = 0
let startWidth = 0
let pointerId = null
let pendingX = 0
let rafId = null

function emitWidth(value) {
  emit('update:width', clamped(value))
}

function onPointerDown(event) {
  if (event.button !== 0) return
  dragging.value = true
  startX = event.clientX
  startWidth = props.width
  pointerId = event.pointerId
  pendingX = event.clientX
  try {
    event.currentTarget.setPointerCapture(pointerId)
  } catch {
    /* pointer capture is best effort */
  }
  document.body.classList.add('is-resizing-panes')
  event.preventDefault()
}

function onPointerMove(event) {
  if (!dragging.value) return
  pendingX = event.clientX
  if (rafId !== null) return
  rafId = requestAnimationFrame(() => {
    rafId = null
    const delta = pendingX - startX
    const next = props.side === 'left' ? startWidth + delta : startWidth - delta
    emitWidth(next)
  })
}

function onPointerUp(event) {
  if (!dragging.value) return
  dragging.value = false
  if (rafId !== null) {
    cancelAnimationFrame(rafId)
    rafId = null
  }
  const delta = (event.clientX ?? pendingX) - startX
  const next = props.side === 'left' ? startWidth + delta : startWidth - delta
  emitWidth(next)
  emit('commit')
  document.body.classList.remove('is-resizing-panes')
  if (pointerId !== null) {
    try {
      event.currentTarget.releasePointerCapture(pointerId)
    } catch {
      /* already released */
    }
  }
  pointerId = null
}

function onPointerCancel() {
  if (!dragging.value) return
  dragging.value = false
  document.body.classList.remove('is-resizing-panes')
}

function onKeydown(event) {
  const step = event.shiftKey ? 48 : 16
  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
    event.preventDefault()
    const direction = event.key === 'ArrowRight' ? 1 : -1
    const delta = props.side === 'left' ? direction * step : -direction * step
    emitWidth(props.width + delta)
    emit('commit')
    return
  }
  if (event.key === 'Home') {
    event.preventDefault()
    emitWidth(props.defaultWidth)
    emit('commit')
    return
  }
  if (event.key === 'End') {
    event.preventDefault()
    emitWidth(props.max)
    emit('commit')
  }
}

function reset() {
  emitWidth(props.defaultWidth)
  emit('commit')
}

onBeforeUnmount(() => {
  if (rafId !== null) cancelAnimationFrame(rafId)
  document.body.classList.remove('is-resizing-panes')
})
</script>

<template>
  <div
    class="resize-handle"
    :class="[`resize-handle--${side}`, { 'is-dragging': dragging }]"
    role="separator"
    aria-orientation="vertical"
    :aria-label="t(labelKey)"
    :aria-valuemin="min"
    :aria-valuemax="max"
    :aria-valuenow="width"
    :aria-valuetext="`${width} px`"
    :title="t('layout.resizeHint')"
    :tabindex="0"
    :data-testid="testId"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointercancel="onPointerCancel"
    @keydown="onKeydown"
    @dblclick="reset"
  >
    <span class="resize-handle__line" aria-hidden="true" />
  </div>
</template>
