<script setup>
/**
 * Comparator tab: compares the selected site with the compared sites using the
 * autopilot scores plus editable perimeter and mast dimensions.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import StatRow from '../ui/StatRow.vue'
import { actions, MAX_COMPARE, compareSites, isLandingZoneSite, selectedSite, state } from '../composables/useAppState.js'
import { siteDisplayName } from '../composables/labels.js'
import { formatAngle, formatLat, formatNumber } from '../composables/format.js'

const { t, te } = useI18n()

// Zone-derived rows (transient `zone-<id>` sites) carry the equivalent-circle
// perimeter of the landing-zone area, not a mission requirement: editing it
// never persists, so it is rendered as a read-only readout (same treatment as
// the Position tab).
const rows = computed(() => {
  const list = []
  if (selectedSite.value) list.push({ ...selectedSite.value, role: 'selected', zoneDerived: isLandingZoneSite(selectedSite.value) })
  for (const site of compareSites.value) {
    if (site.id !== selectedSite.value?.id) list.push({ ...site, role: 'compare', zoneDerived: isLandingZoneSite(site) })
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

const maxReached = computed(() => state.compareSiteIds.length >= MAX_COMPARE)

/**
 * Finite number or `null`; missing score fields (null/undefined/'') stay
 * missing instead of collapsing to 0.
 */
function numericOr(value) {
  if (value === null || value === undefined || value === '') return null
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

/** Fixed-point text that never leaks `NaN`/`undefined` into the table. */
function fixedText(value, digits) {
  const numeric = numericOr(value)
  return numeric === null ? '\u2014' : numeric.toFixed(digits)
}

/** Power in watts, or a bare dash when the score has no usable average. */
function wattText(value) {
  const numeric = numericOr(value)
  return numeric === null ? '\u2014' : `${formatNumber(numeric, 0)} W`
}

/** `#3`, or a bare dash when the rank is missing. */
function rankText(value) {
  const numeric = numericOr(value)
  return numeric === null ? '\u2014' : `#${numeric}`
}

</script>

<template>
  <div class="plain-panel">
    <h3 class="section-label">{{ t('comparator.title') }}</h3>

    <p v-if="rows.length === 0" class="empty">{{ t('comparator.empty') }}</p>
    <template v-else>
      <div class="compare-table" role="table" :aria-label="t('comparator.tableLabel')">
        <div class="compare-table__row compare-table__head" role="row">
          <span role="columnheader">{{ t('comparator.site') }}</span>
          <span role="columnheader">{{ t('comparator.score') }}</span>
        </div>
        <div v-for="row in rows" :key="row.id" class="compare-table__row" role="row">
          <span class="compare-table__site" role="cell">
            <button type="button" class="link-button" @click="actions.selectSite(row.id)">
              {{ siteDisplayName(t, te, row) }}
            </button>
            <span class="compare-table__meta">
              {{ formatLat(row.lat) }}
              <template v-if="scoreOf(row.id) && Number.isFinite(scoreOf(row.id).sunlightDays)"> / {{ fixedText(scoreOf(row.id).sunlightDays, 1) }} d</template>
              <template v-if="scoreOf(row.id) && Number.isFinite(scoreOf(row.id).commsHours)"> / {{ fixedText(scoreOf(row.id).commsHours, 1) }} h</template>
            </span>
          </span>
          <span class="compare-table__score" role="cell">{{ scoreOf(row.id) ? fixedText(scoreOf(row.id).score, 1) : '—' }}</span>
        </div>
      </div>

      <div class="compare-details">
        <div v-for="row in rows" :key="`detail-${row.id}`" class="compare-detail">
          <div class="compare-detail__head">
            <span class="compare-detail__name">{{ siteDisplayName(t, te, row) }}</span>
            <span v-if="row.role === 'selected'" class="tag">{{ t('common.selected') }}</span>
            <button
              v-if="row.role === 'compare'"
              type="button"
              class="button button--quiet button--tiny compare-detail__remove"
              :aria-label="t('comparator.remove', { site: siteDisplayName(t, te, row) })"
              @click="actions.toggleCompare(row.id)"
            >
              {{ t('common.remove') }}
            </button>
          </div>
          <StatRow
            v-if="row.zoneDerived"
            label-key="coords.equivalentPerimeter"
            :value="formatNumber(row.perimeterM, 0)"
          />
          <div class="field-row">
            <label v-if="!row.zoneDerived" class="field">
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
          <p v-if="row.zoneDerived" class="panel-note">{{ t('coords.equivalentPerimeterHint') }}</p>
          <div class="compare-detail__metrics">
            <span v-if="scoreOf(row.id) && Number.isFinite(scoreOf(row.id).slopeDeg)">{{ t('comparator.slope') }} {{ formatAngle(scoreOf(row.id).slopeDeg, 1) }}</span>
            <span v-else>{{ t('comparator.slope') }} —</span>
            <span v-if="scoreOf(row.id)">{{ t('comparator.power') }} {{ wattText(scoreOf(row.id).averageW) }}</span>
            <span v-if="scoreOf(row.id)">{{ t('comparator.rank') }} {{ rankText(scoreOf(row.id).rank) }}</span>
          </div>
        </div>
      </div>
    </template>

    <p v-if="maxReached" class="plain-panel__foot">{{ t('comparator.maxReached', { max: MAX_COMPARE }) }}</p>
    <p v-if="state.autopilot.status === 'stale'" class="plain-panel__foot">{{ t('comparator.staleScores') }}</p>
  </div>
</template>
