<script setup>
/**
 * Moon Trek layer catalogue panel. Toggle raster overlays (WMS/XYZ) when the
 * dataset provides them; reference-only catalogue entries open externally.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import PanelCard from '../ui/PanelCard.vue'
import { actions, state } from '../composables/useAppState.js'
import { layerDisplayName, sourceLabelKey } from '../composables/labels.js'
import { coverageKm, parseLayerBounds } from '../../render/moontrekTiles.js'

const { t, te } = useI18n()

const enabledCount = computed(() =>
  state.layers.filter((layer) => state.layerEnabled[layer.id]).length,
)

const overviewKey = computed(() => sourceLabelKey(state.data.layersSource, 'layers'))

function toggle(layer) {
  actions.setLayerEnabled(layer.id, !state.layerEnabled[layer.id])
}

function isToggleable(layer) {
  return layer.available && ['wms', 'xyz', 'image', 'wmts'].includes(layer.type)
}

function typeLabel(layer) {
  return t(`layers.type.${layer.type}`)
}

function statusOf(layer) {
  return state.layerStatus[layer.id] ?? null
}

function coverageOf(layer) {
  const bounds = parseLayerBounds(layer)
  return bounds ? coverageKm(bounds) : null
}

function statusLabel(layer) {
  const status = statusOf(layer)
  if (!status) return null
  if (status.loading) return t('layers.status.loading')
  if (status.available) return t('layers.status.available')
  return t('layers.status.error')
}
</script>

<template>
  <PanelCard title-key="layers.title" :badge="`${enabledCount}/${state.layers.length}`">
    <p class="panel-hint">{{ t('layers.hint') }}</p>
    <p class="panel-note">
      {{ t('layers.sourceNote') }}: {{ t(overviewKey) }}
    </p>
    <ul class="layer-list" :aria-label="t('layers.listLabel')">
      <li v-for="layer in state.layers" :key="layer.id" class="layer-item">
        <label class="layer-item__main">
          <input
            v-if="isToggleable(layer)"
            type="checkbox"
            :checked="Boolean(state.layerEnabled[layer.id])"
            @change="toggle(layer)"
          />
          <span v-else class="layer-item__dot" aria-hidden="true" />
          <span class="layer-item__text">
            <span class="layer-item__name">{{ layerDisplayName(t, te, layer) }}</span>
            <span class="layer-item__meta">
              <span class="chip chip--tiny">{{ typeLabel(layer) }}</span>
              <span v-if="coverageOf(layer)" class="chip chip--tiny">
                {{ t('layers.coverage', { width: coverageOf(layer).width, height: coverageOf(layer).height }) }}
              </span>
              <span
                v-if="state.layerEnabled[layer.id] && statusOf(layer)?.available && statusOf(layer)?.zoom != null"
                class="chip chip--tiny chip--ok"
              >
                {{ t('layers.zoomTiles', { zoom: statusOf(layer).zoom, tiles: statusOf(layer).tiles }) }}
              </span>
              <span
                v-if="state.layerEnabled[layer.id] && statusLabel(layer)"
                class="chip chip--tiny"
                :class="statusOf(layer)?.available ? 'chip--ok' : statusOf(layer)?.loading ? 'chip--warn' : 'chip--danger'"
              >
                {{ statusLabel(layer) }}
              </span>
            </span>
          </span>
        </label>
      </li>
    </ul>
    <p v-if="state.layers.length === 0" class="empty">{{ t('layers.empty') }}</p>
    <p class="panel-note">{{ t('layers.overlayNote') }}</p>
    <p v-if="state.layers[0]?.attribution" class="panel-note">{{ state.layers[0].attribution }}</p>
  </PanelCard>
</template>
