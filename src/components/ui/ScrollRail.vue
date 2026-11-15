<script setup>
/**
 * Mobile-only vertical scroll rail: up/down buttons and a draggable thumb.
 * It gives explicit page navigation when the map canvas captures touch gestures.
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

const scrollTop = ref(0)
const viewportHeight = ref(0)
const documentHeight = ref(0)
const trackRef = ref(null)
let frame = 0

const maxScroll = computed(() => Math.max(0, documentHeight.value - viewportHeight.value))
const thumbHeight = computed(() => {
  const ratio = viewportHeight.value / Math.max(1, documentHeight.value)
  return `${Math.max(14, Math.min(100, ratio * 100))}%`
})
const thumbTop = computed(() => {
  if (maxScroll.value <= 0) return '0%'
  const height = Math.max(14, Math.min(100, (viewportHeight.value / Math.max(1, documentHeight.value)) * 100))
  return `${(scrollTop.value / maxScroll.value) * (100 - height)}%`
})

function measure() {
  scrollTop.value = Math.max(0, window.scrollY)
  viewportHeight.value = window.innerHeight
  documentHeight.value = document.documentElement.scrollHeight
}

function onScroll() {
  if (frame) return
  frame = requestAnimationFrame(() => {
    frame = 0
    measure()
  })
}

function scrollByPage(direction) {
  window.scrollBy({ top: direction * window.innerHeight * 0.75, behavior: 'smooth' })
}

function startDrag(event) {
  if (!trackRef.value || event.button === 2) return
  const track = trackRef.value
  const move = (moveEvent) => {
    const rect = track.getBoundingClientRect()
    const ratio = Math.min(1, Math.max(0, (moveEvent.clientY - rect.top) / Math.max(1, rect.height)))
    window.scrollTo({ top: ratio * maxScroll.value, behavior: 'auto' })
  }
  move(event)
  track.setPointerCapture?.(event.pointerId)
  track.addEventListener('pointermove', move)
  const stop = () => {
    track.removeEventListener('pointermove', move)
    track.removeEventListener('pointerup', stop)
    track.removeEventListener('pointercancel', stop)
  }
  track.addEventListener('pointerup', stop, { once: true })
  track.addEventListener('pointercancel', stop, { once: true })
}

onMounted(() => {
  measure()
  window.addEventListener('scroll', onScroll, { passive: true })
  window.addEventListener('resize', measure)
})

onBeforeUnmount(() => {
  window.removeEventListener('scroll', onScroll)
  window.removeEventListener('resize', measure)
  if (frame) cancelAnimationFrame(frame)
})
</script>

<template>
  <div v-if="maxScroll > 0" class="scroll-rail" role="group" :aria-label="t('scrollRail.label')">
    <button
      type="button"
      class="scroll-rail__button"
      :disabled="scrollTop <= 0"
      :aria-label="t('scrollRail.up')"
      :title="t('scrollRail.up')"
      @click="scrollByPage(-1)"
    >
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 14l6-6 6 6" /></svg>
    </button>
    <div ref="trackRef" class="scroll-rail__track" @pointerdown.prevent="startDrag">
      <div class="scroll-rail__thumb" :style="{ height: thumbHeight, top: thumbTop }" />
    </div>
    <button
      type="button"
      class="scroll-rail__button"
      :disabled="scrollTop >= maxScroll - 1"
      :aria-label="t('scrollRail.down')"
      :title="t('scrollRail.down')"
      @click="scrollByPage(1)"
    >
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 10l6 6 6-6" /></svg>
    </button>
  </div>
</template>
