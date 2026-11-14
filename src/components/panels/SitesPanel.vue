<script setup>
/**
 * Site selection panel: POI list with search, comparator toggles, custom
 * latitude/longitude entry and map-pointer capture.
 */
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import PanelCard from '../ui/PanelCard.vue'
import { actions, MAX_COMPARE, selectedSite, state } from '../composables/useAppState.js'
import { siteDisplayName } from '../composables/labels.js'
import { formatLat, formatLon } from '../composables/format.js'

const { t, te } = useI18n()

const search = ref('')
const latInput = ref('-89.5')
const lonInput = ref('0')
const formError = ref('')

const filteredSites = computed(() => {
  const query = search.value.trim().toLowerCase()
  if (!query) return state.sites
  return state.sites.filter((site) => {
    const name = siteDisplayName(t, te, site).toLowerCase()
    return name.includes(query) || site.id.includes(query) || String(site.lat).includes(query)
  })
})

const compareCount = computed(() => state.compareSiteIds.length)

function isCompared(id) {
  return state.compareSiteIds.includes(id)
}

function canCompare(id) {
  return isCompared(id) || compareCount.value < MAX_COMPARE
}

function selectSite(id) {
  actions.selectSite(id)
}

function toggleCompare(id) {
  actions.toggleCompare(id)
}

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
  const site = actions.addCustomSite({ lat, lon })
  if (site) search.value = ''
}

watch(
  () => state.pointer,
  (pointer) => {
    latInput.value = pointer.lat.toFixed(3)
    lonInput.value = pointer.lon.toFixed(3)
  },
  { deep: true },
)

function sourceLabel(source) {
  switch (source) {
    case 'custom':
      return t('sites.source.custom')
    case 'pointer':
      return t('sites.source.pointer')
    case 'poi':
      return t('sites.source.poi')
    default:
      return t('sites.source.unknown')
  }
}
</script>

<template>
  <PanelCard title-key="sites.title" :badge="String(state.sites.length)">
    <template #actions>
      <span class="panel-hint" :title="t('sites.compareHint')">
        {{ t('sites.compareCount', { count: compareCount, max: MAX_COMPARE }) }}
      </span>
    </template>

    <label class="field">
      <span class="field__label sr-only">{{ t('sites.searchLabel') }}</span>
      <input v-model="search" class="input" type="search" :placeholder="t('sites.searchPlaceholder')" />
    </label>

    <ul class="site-list" :aria-label="t('sites.listLabel')">
      <li v-for="site in filteredSites" :key="site.id" class="site-item" :class="{ 'is-selected': site.id === state.selectedSiteId }">
        <button type="button" class="site-item__main" :aria-pressed="site.id === state.selectedSiteId" @click="selectSite(site.id)">
          <span class="site-item__name">{{ siteDisplayName(t, te, site) }}</span>
          <span class="site-item__meta">
            {{ formatLat(site.lat) }} · {{ formatLon(site.lon) }}
            <span class="chip chip--tiny">{{ sourceLabel(site.source) }}</span>
          </span>
        </button>
        <button
          type="button"
          class="icon-button"
          :class="{ 'is-active': isCompared(site.id) }"
          :disabled="!canCompare(site.id)"
          :aria-pressed="isCompared(site.id)"
          :aria-label="isCompared(site.id) ? t('sites.removeFromCompare', { site: siteDisplayName(t, te, site) }) : t('sites.addToCompare', { site: siteDisplayName(t, te, site) })"
          :title="canCompare(site.id) ? t('sites.compareAction') : t('sites.compareFull')"
          @click="toggleCompare(site.id)"
        >
          ⚖
        </button>
      </li>
    </ul>
    <p v-if="filteredSites.length === 0" class="empty">{{ t('sites.empty') }}</p>

    <form class="custom-form" @submit.prevent="addCustomSite">
      <h3 class="panel-subtitle">{{ t('sites.customTitle') }}</h3>
      <div class="field-row">
        <label class="field">
          <span class="field__label">{{ t('sites.lat') }}</span>
          <input v-model="latInput" class="input" type="number" step="0.001" min="-90" max="90" inputmode="decimal" />
        </label>
        <label class="field">
          <span class="field__label">{{ t('sites.lon') }}</span>
          <input v-model="lonInput" class="input" type="number" step="0.001" min="-360" max="360" inputmode="decimal" />
        </label>
      </div>
      <p v-if="formError" class="field-error" role="alert">{{ formError }}</p>
      <div class="button-row">
        <button type="button" class="button button--ghost button--small" @click="fillFromPointer">
          {{ t('sites.usePointer') }}
        </button>
        <button type="submit" class="button button--secondary button--small">{{ t('sites.addCustom') }}</button>
      </div>
      <p class="panel-hint">{{ t('sites.pointerHint') }}</p>
      <p class="panel-hint" v-if="selectedSite">{{ t('sites.selectedHint', { site: siteDisplayName(t, te, selectedSite) }) }}</p>
    </form>
  </PanelCard>
</template>
