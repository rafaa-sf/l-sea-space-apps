<script setup>
/**
 * Left rail: one Sites surface with progressive disclosure through tabs.
 */
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import TabBar from './ui/TabBar.vue'
import SitesPanel from './panels/SitesPanel.vue'
import CustomSitePanel from './panels/CustomSitePanel.vue'
import ComparatorPanel from './panels/ComparatorPanel.vue'
import { state } from './composables/useAppState.js'

const { t } = useI18n()

const activeTab = ref('sites')

// The map pointer is a transient analysis site, not part of the curated set.
const siteCount = computed(() => state.sites.filter((site) => site.source !== 'pointer').length)

const tabs = computed(() => [
  { id: 'sites', labelKey: 'tabs.sites', count: siteCount.value },
  { id: 'custom', labelKey: 'tabs.custom' },
  { id: 'compare', labelKey: 'tabs.compare', count: state.compareSiteIds.length },
])

function onOpenCompare() {
  activeTab.value = 'compare'
}
</script>

<template>
  <section class="surface app-rail app-rail--left" :aria-label="t('surfaces.sites')">
    <header class="surface__head">
      <h2 class="surface__title">{{ t('surfaces.sites') }}</h2>
      <span class="surface__meta">{{ t('viewport.sites', { count: siteCount }) }}</span>
    </header>
    <TabBar v-model="activeTab" :tabs="tabs" label-key="surfaces.sitesTabs" />
    <div class="surface__body">
      <div v-show="activeTab === 'sites'" role="tabpanel" :aria-label="t('tabs.sites')">
        <SitesPanel @open-compare="onOpenCompare" />
      </div>
      <div v-show="activeTab === 'custom'" role="tabpanel" :aria-label="t('tabs.custom')">
        <CustomSitePanel />
      </div>
      <div v-show="activeTab === 'compare'" role="tabpanel" :aria-label="t('tabs.compare')">
        <ComparatorPanel />
      </div>
    </div>
  </section>
</template>
