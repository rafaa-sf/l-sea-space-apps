<script setup>
/**
 * Autopilot panel: mission-profile inputs and the ranked site results returned
 * by the background worker (or the main-thread fallback).
 */
import { computed, onMounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import PanelCard from '../ui/PanelCard.vue'
import { actions, state } from '../composables/useAppState.js'
import { reasonText, siteDisplayName } from '../composables/labels.js'
import { formatAngle, formatDistance, formatDuration, formatLat, formatLon, formatMeters, formatNumber } from '../composables/format.js'

const { t, te } = useI18n()

const landingAvailable = computed(() => !state.landingZonesStatus.unavailable)
const zones = computed(() => state.landingZones ?? [])
const activeStatus = computed(() => (landingAvailable.value ? state.landingZonesStatus : state.autopilot))
const running = computed(() => activeStatus.value.status === 'running')
const selectedZoneId = computed(() => state.landingZoneEntry?.zone?.id ?? null)

async function runRanking() {
  if (running.value) return
  if (landingAvailable.value) await actions.runLandingZones()
  else await actions.runAutopilot()
}

function maybeRunLandingZones() {
  if (!landingAvailable.value) return
  if (!state.terrain) return
  if (!['idle', 'stale'].includes(state.landingZonesStatus.status)) return
  actions.runLandingZones().catch(() => {})
}

onMounted(async () => {
  await actions.detectLandingZoneSupport()
  maybeRunLandingZones()
})

// The panel can mount before the DEM/worker are ready; run once terrain lands.
watch(() => state.terrain, () => maybeRunLandingZones())
watch(() => state.landingZonesStatus.status, (status) => {
  if (status === 'stale') maybeRunLandingZones()
})

function zoneWarnings(entry) {
  const warnings = Array.isArray(entry?.warnings) ? entry.warnings : []
  return warnings.filter((warning) => warning?.code === 'ephemeris-nearest-site' || warning?.code === 'no-nearest-site')
}

const statusLabel = computed(() => {
  switch (activeStatus.value.status) {
    case 'running':
      return t('autopilot.status.running')
    case 'done':
      return t('autopilot.status.done')
    case 'stale':
      return t('autopilot.status.stale')
    case 'error':
      return t('autopilot.status.error')
    default:
      return t('autopilot.status.idle')
  }
})

const statusTone = computed(() => {
  if (activeStatus.value.status === 'error') return 'danger'
  if (activeStatus.value.status === 'running') return 'warn'
  if (activeStatus.value.status === 'done') return 'ok'
  if (activeStatus.value.status === 'unavailable') return 'warn'
  return 'default'
})

const sourceLabel = computed(() => {
  if (activeStatus.value.source === 'worker') return t('autopilot.source.worker')
  if (activeStatus.value.source === 'main') return t('autopilot.source.main')
  return t('common.notAvailable')
})

function missionField(key) {
  return computed({
    get: () => state.mission[key],
    set: (value) => actions.updateMission({ [key]: Number(value) }),
  })
}

const missionDays = missionField('missionDays')
const powerNeedW = missionField('powerNeedW')
const sunDaysNeeded = missionField('sunDaysNeeded')
const perimeterM = missionField('perimeterM')
const mastM = missionField('mastM')

const relayInOrbit = computed({
  get: () => state.mission.relayInOrbit,
  set: (value) => actions.updateMission({ relayInOrbit: Boolean(value) }),
})

function selectSite(id) {
  actions.selectSite(id)
}

const ranking = computed(() => state.scores)
</script>

<template>
  <PanelCard title-key="autopilot.title" :badge="statusLabel" :tone="statusTone">
    <template #actions>
      <button type="button" class="button button--secondary button--small" :disabled="running" @click="runRanking">
        {{ running ? t('autopilot.running') : t('autopilot.run') }}
      </button>
    </template>

    <p class="panel-hint">{{ t('autopilot.hint') }}</p>

    <div class="field-grid">
      <label class="field">
        <span class="field__label">{{ t('autopilot.missionDays') }}</span>
        <input v-model.number="missionDays" class="input" type="number" min="1" max="60" step="1" />
      </label>
      <label class="field">
        <span class="field__label">{{ t('autopilot.powerNeedW') }}</span>
        <input v-model.number="powerNeedW" class="input" type="number" min="10" max="2000" step="10" />
      </label>
      <label class="field">
        <span class="field__label">{{ t('autopilot.sunDaysNeeded') }}</span>
        <input v-model.number="sunDaysNeeded" class="input" type="number" min="0" max="60" step="1" />
      </label>
      <label class="field">
        <span class="field__label">{{ t('autopilot.perimeter') }}</span>
        <input v-model.number="perimeterM" class="input" type="number" min="10" max="5000" step="10" />
      </label>
      <label class="field">
        <span class="field__label">{{ t('autopilot.mast') }}</span>
        <input v-model.number="mastM" class="input" type="number" min="1" max="100" step="1" />
      </label>
      <label class="field field--inline">
        <input v-model="relayInOrbit" type="checkbox" />
        <span>{{ t('autopilot.relay') }}</span>
      </label>
    </div>

    <p class="panel-note">
      {{ t('autopilot.statusLabel') }}: {{ statusLabel }}
      / {{ t('autopilot.sourceLabel') }}: {{ sourceLabel }}
      <template v-if="state.autopilot.durationMs !== null"> / {{ formatDuration(state.autopilot.durationMs / 1000) }}</template>
    </p>
    <p v-if="state.autopilot.error" class="panel-note panel-note--warn">
      {{ t('autopilot.fallbackNote') }}: {{ state.autopilot.error }}
    </p>

    <template v-if="landingAvailable">
      <p v-if="state.landingZonesStatus.status === 'unavailable'" class="panel-note panel-note--warn">
        {{ t('autopilot.zonesUnavailable') }}
      </p>
      <p v-else-if="running" class="panel-note">{{ t('autopilot.zonesRunning') }}</p>
      <p v-else-if="state.landingZonesStatus.status === 'error'" class="panel-note panel-note--warn">
        {{ t('autopilot.zonesError') }}: {{ state.landingZonesStatus.error }}
      </p>
      <p v-else-if="state.landingZonesStatus.status === 'stale'" class="panel-note panel-note--warn">
        {{ t('autopilot.zonesStale') }}
      </p>
      <p v-else-if="!zones.length" class="empty">{{ t('autopilot.zonesEmpty') }}</p>
      <ol v-else class="rank-list" :aria-label="t('autopilot.zonesLabel')">
        <li
          v-for="entry in zones"
          :key="entry.zone.id"
          class="rank-item"
          :class="{ 'is-selected': entry.zone.id === selectedZoneId }"
          data-testid="landing-zone-row"
          :data-zone-rank="entry.rank"
          :data-zone-id="entry.zone.id"
        >
          <span
            v-if="entry.zone.id === selectedZoneId"
            class="sr-only"
            data-testid="landing-zone-selected"
          >{{ t('autopilot.zoneSelected') }}</span>
          <button type="button" class="rank-item__head" @click="actions.selectLandingZone(entry)">
            <span class="rank-item__rank">#{{ entry.rank }}</span>
            <span class="rank-item__name">{{ t('autopilot.zoneLabel', { rank: entry.rank, lat: formatLat(entry.zone.lat), lon: formatLon(entry.zone.lon) }) }}</span>
            <span v-if="entry.grade" class="tag">{{ entry.grade }}</span>
            <span class="rank-item__score">{{ formatNumber(entry.score, 1) }}</span>
          </button>
          <div class="rank-item__bar" aria-hidden="true">
            <span class="rank-item__bar-fill" :style="{ width: `${Math.max(0, Math.min(100, entry.score))}%` }" />
          </div>
          <div class="rank-item__metrics">
            <span>{{ t('autopilot.zoneArea') }} {{ formatNumber(entry.zone.areaKm2, 1) }} km²</span>
            <span>{{ t('autopilot.zoneSlope') }} {{ formatAngle(entry.zone.meanSlopeDeg, 1) }} / {{ formatAngle(entry.zone.maxSlopeDeg, 1) }}</span>
            <span>{{ t('autopilot.zoneElevation') }} {{ formatMeters(entry.zone.elevationM) }}</span>
            <span>{{ t('autopilot.zoneRelief') }} {{ formatMeters(entry.zone.reliefM) }}</span>
          </div>
          <ul v-if="zoneWarnings(entry).length" class="reason-list">
            <li
              v-for="(warning, index) in zoneWarnings(entry)"
              :key="`${entry.zone.id}-warn-${index}`"
              class="reason reason--approx"
            >
              {{ warning.code === 'no-nearest-site' ? t('autopilot.warningNoNearestSite') : t('autopilot.warningNearestEphemeris', { site: warning.params?.ephemerisSiteId ?? '', distance: formatDistance(warning.params?.distanceM ?? 0) }) }}
            </li>
          </ul>
        </li>
      </ol>
    </template>
    <ol v-if="!landingAvailable && ranking.length" class="rank-list" :aria-label="t('autopilot.rankingLabel')">
      <li v-for="entry in ranking" :key="entry.siteId" class="rank-item" :class="{ 'is-selected': entry.siteId === state.selectedSiteId }">
        <button type="button" class="rank-item__head" @click="selectSite(entry.siteId)">
          <span class="rank-item__rank">#{{ entry.rank }}</span>
          <span class="rank-item__name">{{ siteDisplayName(t, te, entry.site) }}</span>
          <span class="rank-item__score">{{ entry.score.toFixed(1) }}</span>
        </button>
        <div class="rank-item__bar" aria-hidden="true">
          <span class="rank-item__bar-fill" :style="{ width: `${Math.max(0, Math.min(100, entry.score))}%` }" />
        </div>
        <div class="rank-item__metrics">
          <span v-if="Number.isFinite(entry.sunlightDays)">{{ t('autopilot.metricSunlight') }} {{ formatNumber(entry.sunlightDays, 1) }} d</span>
          <span v-if="Number.isFinite(entry.averageW)">{{ t('autopilot.metricPower') }} {{ formatNumber(entry.averageW, 0) }} W</span>
          <span v-if="Number.isFinite(entry.commsHours)">{{ t('autopilot.metricComms') }} {{ formatNumber(entry.commsHours, 1) }} h</span>
        </div>
        <ul v-if="entry.reasons.length" class="reason-list">
          <li
            v-for="(reason, index) in entry.reasons.slice(0, 3)"
            :key="`${entry.siteId}-${index}`"
            class="reason"
            :class="reason.severity ? `reason--${reason.severity}` : null"
          >
            {{ reasonText(t, te, reason) }}
          </li>
          <li v-if="entry.reasons.length > 3" class="reason reason--more">
            {{ t('autopilot.reasons.moreReasons', { count: entry.reasons.length - 3 }) }}
          </li>
        </ul>
      </li>
    </ol>
    <p v-else-if="!landingAvailable" class="empty">{{ t('autopilot.empty') }}</p>
    <p class="panel-note">{{ t('autopilot.workerNote') }}</p>
  </PanelCard>
</template>
