<script setup>
/**
 * Lightweight SVG sparkline for the timeline and orbital-variation panels.
 * Series are plotted against a shared vertical scale; `markerIndex` draws the
 * current-time cursor. No dependency on a charting library.
 */
import { computed } from 'vue'

const props = defineProps({
  series: { type: Array, default: () => [] },
  min: { type: Number, default: null },
  max: { type: Number, default: null },
  markerIndex: { type: Number, default: -1 },
  height: { type: Number, default: 96 },
  zeroLine: { type: Boolean, default: true },
  ariaLabel: { type: String, default: '' },
})

const bounds = computed(() => {
  const values = []
  for (const entry of props.series) {
    for (const value of entry.points ?? []) {
      if (Number.isFinite(value)) values.push(value)
    }
  }
  let min = props.min
  let max = props.max
  if (!Number.isFinite(min)) min = values.length ? Math.min(...values) : -1
  if (!Number.isFinite(max)) max = values.length ? Math.max(...values) : 1
  if (max - min < 0.001) {
    max += 0.5
    min -= 0.5
  }
  const padding = (max - min) * 0.08
  return { min: min - padding, max: max + padding }
})

function toY(value) {
  const { min, max } = bounds.value
  const ratio = (value - min) / (max - min)
  return 100 - Math.min(100, Math.max(0, ratio)) * 100
}

function toX(index, length) {
  if (length <= 1) return 100
  return (index / (length - 1)) * 100
}

function polyline(points) {
  return (points ?? [])
    .map((value, index) => {
      const y = Number.isFinite(value) ? toY(value) : 100
      return `${toX(index, points.length).toFixed(2)},${y.toFixed(2)}`
    })
    .join(' ')
}

function areaPath(points) {
  if (!points?.length) return ''
  const line = polyline(points)
  return `M0,100 L${line.replaceAll(' ', ' L')} L100,100 Z`
}

const markerX = computed(() => {
  const first = props.series[0]?.points?.length ?? 0
  if (props.markerIndex < 0 || first <= 1) return null
  return toX(props.markerIndex, first)
})
</script>

<template>
  <div class="sparkline" :style="{ height: `${height}px` }">
    <svg
      class="sparkline__svg"
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      role="img"
      :aria-label="ariaLabel"
    >
      <line v-if="zeroLine && bounds.min < 0 && bounds.max > 0" x1="0" :y1="toY(0)" x2="100" :y2="toY(0)" class="sparkline__zero" />
      <template v-for="(entry, seriesIndex) in series" :key="seriesIndex">
        <path
          v-if="entry.fill"
          :d="areaPath(entry.points)"
          class="sparkline__area"
          :fill="entry.color"
          :opacity="entry.fillOpacity ?? 0.12"
        />
        <polyline
          :points="polyline(entry.points)"
          class="sparkline__line"
          :stroke="entry.color"
          :stroke-width="entry.width ?? 1.6"
          :stroke-dasharray="entry.dashed ? '3 2' : undefined"
        />
      </template>
      <line v-if="markerX !== null" :x1="markerX" y1="0" :x2="markerX" y2="100" class="sparkline__marker" />
    </svg>
    <div v-if="$slots.default" class="sparkline__legend">
      <slot />
    </div>
  </div>
</template>
