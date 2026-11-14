<script setup>
/**
 * Right rail: one Analysis surface; position, lighting, power/comms and
 * autopilot are revealed through tabs and only the active section is shown.
 */
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import TabBar from './ui/TabBar.vue'
import CoordinatePanel from './panels/CoordinatePanel.vue'
import HorizonPanel from './panels/HorizonPanel.vue'
import CountdownPanel from './panels/CountdownPanel.vue'
import PowerCommsPanel from './panels/PowerCommsPanel.vue'
import AutopilotPanel from './panels/AutopilotPanel.vue'
import { selectedSite } from './composables/useAppState.js'
import { siteDisplayName } from './composables/labels.js'

const { t, te } = useI18n()

const activeTab = ref('position')

const tabs = [
  { id: 'position', labelKey: 'tabs.position', testId: 'analysis-tab-position' },
  { id: 'lighting', labelKey: 'tabs.lighting', testId: 'analysis-tab-lighting' },
  { id: 'power', labelKey: 'tabs.power', testId: 'analysis-tab-power' },
  { id: 'autopilot', labelKey: 'tabs.autopilot', testId: 'analysis-tab-autopilot' },
]
</script>

<template>
  <section class="surface app-rail app-rail--right" :aria-label="t('surfaces.analysis')">
    <header class="surface__head">
      <h2 class="surface__title">{{ t('surfaces.analysis') }}</h2>
      <span class="surface__meta">{{ selectedSite ? siteDisplayName(t, te, selectedSite) : t('common.none') }}</span>
    </header>
    <TabBar v-model="activeTab" :tabs="tabs" label-key="surfaces.analysisTabs" />
    <div class="surface__body">
      <div v-show="activeTab === 'position'" role="tabpanel" :aria-label="t('tabs.position')">
        <CoordinatePanel />
      </div>
      <div v-show="activeTab === 'lighting'" role="tabpanel" :aria-label="t('tabs.lighting')">
        <HorizonPanel />
        <CountdownPanel />
      </div>
      <div v-show="activeTab === 'power'" role="tabpanel" :aria-label="t('tabs.power')">
        <PowerCommsPanel />
      </div>
      <div v-show="activeTab === 'autopilot'" role="tabpanel" :aria-label="t('tabs.autopilot')">
        <AutopilotPanel />
      </div>
    </div>
  </section>
</template>
