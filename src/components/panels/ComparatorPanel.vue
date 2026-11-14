<script setup>
/**
 * Site comparator: compares the selected site against the compared sites using
 * the autopilot scores plus editable perimeter and antenna-mast dimensions.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import PanelCard from '../ui/PanelCard.vue'
import { actions, MAX_COMPARE, compareSites, selectedSite, state } from '../composables/useAppState.js'
import { siteDisplayName } from '../composables/labels.js'
import { formatAngle, formatLat, formatMeters } from '../composables/format.js'

const { t, te } = useI18n()

const rows = computed(() => {
  const list = []
  if (selectedSite.value) list.push({ ...selectedSite.value, role: 'selected' })
  for (const site of compareSites.value) {
    if (site.id !== selectedSite.value?.id) list.push({ ...site, role: 'compare' })
  }
  return list
})

const scoreBySite = computed(() => {
  const map = new Map()
  for (const entry of state.scores) map.set(entry.siteId, entry)
  return map
})

function scoreOf(id) {
  return scoreBySite.value.get(id) ?? null
}

function updatePerimeter(id, value) {
  actions.updateSite(id, { perimeterM: Math.max(1, Number(value) || 1) })
}

function updateMast(id, value) {
  actions.updateSite(id, { mastM: Math.max(1, Number(value) || 1) })
}

function remove(id) {
  actions.toggleCompare(id)
}

const maxReached = computed(() => state.compareSiteIds.length >= MAX_COMPARE)
</script>

<template>
  <PanelCard title-key="comparator.title" :badge="`${state.compareSiteIds.length}/${MAX_COMPARE}`">
    <p v-if="rows.length === 0" class="empty">{{ t('comparator.empty') }}</p>
    <p v-else class="panel-hint">{{ t('comparator.hint') }}</p>

    <div v-if="rows.length" class="compare-table" role="table" :aria-label="t('comparator.tableLabel')">
      <div class="compare-table__row compare-table__head" role="row">
        <span role="columnheader">{{ t('comparator.site') }}</span>
        <span role="columnheader">{{ t('comparator.score') }}</span>
        <span role="columnheader">{{ t('comparator.sunlight') }}</span>
        <span role="columnheader">{{ t('comparator.comms') }}</span>
      </div>
      <div v-for="row in rows" :key="row.id" class="compare-table__row" role="row">
        <span class="compare-table__site" role="cell">
          <button type="button" class="link-button" @click="actions.selectSite(row.id)">
            {{ siteDisplayName(t, te, row) }}
          </button>
          <span class="compare-table__meta">{{ formatLat(row.lat) }} · {{ formatMeters(row.elevationM ?? 0) }}</span>
        </span>
        <span class="compare-table__score" role="cell">
          <template v-if="scoreOf(row.id)">{{ scoreOf(row.id).score.toFixed(1) }}</template>
          <template v-else>—</template>
        </span>
        <span role="cell">
          <template v-if="scoreOf(row.id) && Number.isFinite(scoreOf(row.id).sunlightDays)">
            {{ scoreOf(row.id).sunlightDays.toFixed(1) }} d
          </template>
          <template v-else>—</template>
        </span>
        <span role="cell">
          <template v-if="scoreOf(row.id) && Number.isFinite(scoreOf(row.id).commsHours)">
            {{ scoreOf(row.id).commsHours.toFixed(1) }} h
          </template>
          <template v-else>—</template>
        </span>
      </div>
    </div>

    <div v-if="rows.length" class="compare-details">
      <div v-for="row in rows" :key="`detail-${row.id}`" class="compare-detail">
        <div class="compare-detail__head">
          <span class="compare-detail__name">{{ siteDisplayName(t, te, row) }}</span>
          <span v-if="row.role === 'selected'" class="chip chip--tiny chip--ok">{{ t('common.selected') }}</span>
          <button
            v-if="row.role === 'compare'"
            type="button"
            class="icon-button"
            :aria-label="t('comparator.remove', { site: siteDisplayName(t, te, row) })"
            @click="remove(row.id)"
          >
            ✕
          </button>
        </div>
        <div class="field-row">
          <label class="field">
            <span class="field__label">{{ t('comparator.perimeter') }}</span>
            <input
              class="input"
              type="number"
              min="1"
              step="10"
              :value="row.perimeterM"
              @change="updatePerimeter(row.id, $event.target.value)"
            />
          </label>
          <label class="field">
            <span class="field__label">{{ t('comparator.mast') }}</span>
            <input
              class="input"
              type="number"
              min="1"
              step="1"
              :value="row.mastM"
              @change="updateMast(row.id, $event.target.value)"
            />
          </label>
        </div>
        <div class="compare-detail__metrics">
          <span>{{ t('comparator.slope') }}: {{ formatAngle(scoreOf(row.id)?.slopeDeg ?? 0, 1) }}</span>
          <span v-if="scoreOf(row.id) && Number.isFinite(scoreOf(row.id).averageW)">{{ t('comparator.power') }}: {{ scoreOf(row.id).averageW.toFixed(0) }} W</span>
          <span v-if="scoreOf(row.id)">{{ t('comparator.rank') }}: #{{ scoreOf(row.id).rank }}</span>
        </div>
      </div>
    </div>

    <p v-if="maxReached" class="panel-hint">{{ t('comparator.maxReached', { max: MAX_COMPARE }) }}</p>
    <p v-if="state.autopilot.status === 'stale'" class="panel-note">{{ t('comparator.staleScores') }}</p>
  </PanelCard>
</template>
