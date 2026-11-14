<script setup>
/**
 * Custom site tab: latitude/longitude entry, map-pointer capture and site
 * creation.
 */
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { actions, state } from '../composables/useAppState.js'
import { formatLat, formatLon } from '../composables/format.js'

const { t } = useI18n()

const latInput = ref('-89.5')
const lonInput = ref('0')
const formError = ref('')

watch(
  () => state.pointer,
  (pointer) => {
    latInput.value = pointer.lat.toFixed(3)
    lonInput.value = pointer.lon.toFixed(3)
  },
  { deep: true },
)

function fillFromPointer() {
  latInput.value = state.pointer.lat.toFixed(3)
  lonInput.value = state.pointer.lon.toFixed(3)
  formError.value = ''
}

function addCustomSite() {
  const lat = Number(latInput.value)
  const lon = Number(lonInput.value)
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
    formError.value = t('sites.errors.latRange')
    return
  }
  if (!Number.isFinite(lon) || lon < -360 || lon > 360) {
    formError.value = t('sites.errors.lonRange')
    return
  }
  formError.value = ''
  actions.addCustomSite({ lat, lon })
}
</script>

<template>
  <div class="plain-panel">
    <p class="plain-panel__intro">{{ t('sites.pointerHint') }}</p>

    <form class="field-grid" @submit.prevent="addCustomSite">
      <label class="field">
        <span class="field__label">{{ t('sites.lat') }}</span>
        <input v-model="latInput" class="input" type="number" step="0.001" min="-90" max="90" inputmode="decimal" />
      </label>
      <label class="field">
        <span class="field__label">{{ t('sites.lon') }}</span>
        <input v-model="lonInput" class="input" type="number" step="0.001" min="-360" max="360" inputmode="decimal" />
      </label>
      <p v-if="formError" class="field-error field-grid__full" role="alert">{{ formError }}</p>
      <div class="button-row field-grid__full">
        <button type="button" class="button button--quiet button--small" @click="fillFromPointer">
          {{ t('sites.usePointer') }}
        </button>
        <button type="submit" class="button button--secondary button--small">{{ t('sites.addCustom') }}</button>
      </div>
    </form>

    <dl class="readout">
      <div class="readout__row">
        <dt>{{ t('sites.pointerReadout') }}</dt>
        <dd class="is-mono">{{ formatLat(state.pointer.lat) }} {{ formatLon(state.pointer.lon) }}</dd>
      </div>
      <div class="readout__row">
        <dt>{{ t('sites.customSites') }}</dt>
        <dd>{{ state.sites.filter((site) => site.source === 'custom').length }}</dd>
      </div>
    </dl>
  </div>
</template>
