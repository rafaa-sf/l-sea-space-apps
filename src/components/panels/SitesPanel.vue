<script setup>
/**
 * Site list with search and comparator toggles. Rendered inside the Sites
 * surface; the custom-coordinate form lives in its own tab.
 */
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { actions, MAX_COMPARE, selectedSite, state } from '../composables/useAppState.js'
import { siteDisplayName } from '../composables/labels.js'
import { formatLat, formatLon } from '../composables/format.js'

const emit = defineEmits(['compare-added'])
const { t, te } = useI18n()

const search = ref('')

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
  const wasCompared = isCompared(id)
  actions.toggleCompare(id)
  if (!wasCompared) emit('compare-added')
}
</script>

<template>
  <div class="plain-panel">
    <label class="field field--search">
      <span class="sr-only">{{ t('sites.searchLabel') }}</span>
      <input v-model="search" class="input input--search" type="search" :placeholder="t('sites.searchPlaceholder')" />
    </label>

    <ul class="site-list" :aria-label="t('sites.listLabel')">
      <li
        v-for="site in filteredSites"
        :key="site.id"
        class="site-item"
        :class="{ 'is-selected': site.id === state.selectedSiteId }"
      >
        <button type="button" class="site-item__main" :aria-pressed="site.id === state.selectedSiteId" @click="selectSite(site.id)">
          <span class="site-item__name">{{ siteDisplayName(t, te, site) }}</span>
          <span class="site-item__meta">{{ formatLat(site.lat) }} {{ formatLon(site.lon) }}</span>
        </button>
        <button
          type="button"
          class="site-item__compare"
          :class="{ 'is-active': isCompared(site.id) }"
          :disabled="!canCompare(site.id)"
          :aria-pressed="isCompared(site.id)"
          :aria-label="isCompared(site.id) ? t('sites.removeFromCompare', { site: siteDisplayName(t, te, site) }) : t('sites.addToCompare', { site: siteDisplayName(t, te, site) })"
          :title="canCompare(site.id) ? t('sites.compareAction') : t('sites.compareFull')"
          @click="toggleCompare(site.id)"
        >
          {{ isCompared(site.id) ? t('sites.compareActive') : t('sites.compareButton') }}
        </button>
      </li>
    </ul>

    <p v-if="filteredSites.length === 0" class="empty">{{ t('sites.empty') }}</p>

    <p v-if="compareCount >= MAX_COMPARE" class="plain-panel__foot">{{ t('comparator.maxReached', { max: MAX_COMPARE }) }}</p>
    <p v-else class="plain-panel__foot">{{ t('sites.compareCount', { count: compareCount, max: MAX_COMPARE }) }}</p>
    <p v-if="selectedSite" class="plain-panel__foot">{{ t('sites.selectedHint', { site: siteDisplayName(t, te, selectedSite) }) }}</p>
  </div>
</template>
