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

const { t, te } = useI18n()

const enabledCount = computed(() =>
  state.layers.filter((layer) => state.layerEnabled[layer.id]).length,
)

const overviewKey = computed(() => sourceLabelKey(state.data.layersSource))

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
          <span v-else class="layer-item__dot" aria-hidden="true">◇</span>
          <span class="layer-item__text">
            <span class="layer-item__name">{{ layerDisplayName(t, te, layer) }}</span>
            <span class="layer-item__meta">
              <span class="chip chip--tiny">{{ typeLabel(layer) }}</span>
              <span
                v-if="state.layerEnabled[layer.id] && statusLabel(layer)"
                class="chip chip--tiny"
                :class="statusOf(layer)?.available ? 'chip--ok' : statusOf(layer)?.loading ? 'chip--warn' : 'chip--danger'"
              >
                {{ statusLabel(layer) }}
              </span>
              {{ layer.attribution }}
            </span>
          </span>
        </label>
        <a
          v-if="layer.attributionUrl || layer.url"
          class="icon-button"
          :href="layer.attributionUrl || layer.url"
          target="_blank"
          rel="noopener noreferrer"
          :title="t('layers.openExternal')"
          :aria-label="t('layers.openExternal')"
        >
          ↗
        </a>
      </li>
    </ul>
    <p v-if="state.layers.length === 0" class="empty">{{ t('layers.empty') }}</p>
    <p class="panel-note">{{ t('layers.overlayNote') }}</p>
  </PanelCard>
</template>
