/**
 * Persistence service: stores the user's sites, mission profile and locale in
 * `localStorage` with a versioned key prefix.
 *
 * Every operation is defensive: a missing/blocked/quota-exceeded
 * `localStorage` degrades to an in-memory fallback so the UI keeps working
 * (private browsing, embedded webviews, SSR/tests).
 *
 * @module services/storage
 */

/** Versioned key prefix, so a future schema change can migrate cleanly. */
export const STORAGE_PREFIX = 'lsea.v1.'

/** Keys used by the application. */
export const STORAGE_KEYS = Object.freeze({
  sites: `${STORAGE_PREFIX}sites`,
  mission: `${STORAGE_PREFIX}mission`,
  locale: `${STORAGE_PREFIX}locale`,
  state: `${STORAGE_PREFIX}state`,
  selectedSiteId: `${STORAGE_PREFIX}selected-site`,
})

/** In-memory fallback when `localStorage` is unavailable. */
const memoryStore = new Map()

/**
 * Check whether `localStorage` is usable.
 *
 * @returns {boolean}
 */
export function isStorageAvailable() {
  try {
    if (typeof localStorage === 'undefined') return false
    const probeKey = `${STORAGE_PREFIX}__probe__`
    localStorage.setItem(probeKey, '1')
    localStorage.removeItem(probeKey)
    return true
  } catch {
    return false
  }
}

/**
 * Read and parse a JSON value from storage.
 *
 * @param {string} key Storage key.
 * @param {*} [fallback=null] Value returned when missing or corrupt.
 * @returns {*}
 */
export function readStorage(key, fallback = null) {
  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(key)
      if (raw == null) return fallback
      return JSON.parse(raw)
    }
  } catch (error) {
    console.warn(`[storage] could not read '${key}': ${error instanceof Error ? error.message : String(error)}`)
  }
  if (memoryStore.has(key)) return memoryStore.get(key)
  return fallback
}

/**
 * Serialize and write a JSON value to storage.
 *
 * @param {string} key Storage key.
 * @param {*} value JSON-serializable value.
 * @returns {boolean} `true` when the value was persisted.
 */
export function writeStorage(key, value) {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(key, JSON.stringify(value))
      return true
    }
  } catch (error) {
    console.warn(`[storage] could not write '${key}': ${error instanceof Error ? error.message : String(error)}`)
  }
  memoryStore.set(key, value)
  return false
}

/**
 * Remove a single key.
 *
 * @param {string} key Storage key.
 * @returns {void}
 */
export function removeStorage(key) {
  try {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(key)
  } catch {
    /* ignore */
  }
  memoryStore.delete(key)
}

/**
 * Load the persisted sites.
 *
 * @returns {Array<Object>} Sites (empty array when nothing was saved).
 */
export function loadSites() {
  const value = readStorage(STORAGE_KEYS.sites, [])
  return Array.isArray(value) ? value : []
}

/**
 * Persist the site list.
 *
 * @param {Array<Object>} sites
 * @returns {boolean}
 */
export function saveSites(sites) {
  return writeStorage(STORAGE_KEYS.sites, Array.isArray(sites) ? sites : [])
}

/**
 * Load the persisted mission profile.
 *
 * @returns {Object|null}
 */
export function loadMission() {
  const value = readStorage(STORAGE_KEYS.mission, null)
  return value && typeof value === 'object' ? value : null
}

/**
 * Persist the mission profile.
 *
 * @param {Object} mission
 * @returns {boolean}
 */
export function saveMission(mission) {
  return writeStorage(STORAGE_KEYS.mission, mission ?? null)
}

/**
 * Load the persisted locale (`'en'` or `'es'`).
 *
 * @returns {string|null}
 */
export function loadLocale() {
  const value = readStorage(STORAGE_KEYS.locale, null)
  return typeof value === 'string' ? value : null
}

/**
 * Persist the locale.
 *
 * @param {string} locale
 * @returns {boolean}
 */
export function saveLocale(locale) {
  return writeStorage(STORAGE_KEYS.locale, locale)
}

/**
 * Load the selected site id.
 *
 * @returns {string|null}
 */
export function loadSelectedSiteId() {
  const value = readStorage(STORAGE_KEYS.selectedSiteId, null)
  return typeof value === 'string' ? value : null
}

/**
 * Persist the selected site id.
 *
 * @param {string|null} siteId
 * @returns {boolean}
 */
export function saveSelectedSiteId(siteId) {
  return writeStorage(STORAGE_KEYS.selectedSiteId, siteId)
}

/**
 * Load the whole persisted application state.
 *
 * @returns {{sites: Array<Object>, mission: Object|null, locale: string|null, selectedSiteId: string|null}}
 */
export function loadState() {
  const state = readStorage(STORAGE_KEYS.state, null)
  if (state && typeof state === 'object') {
    return {
      sites: Array.isArray(state.sites) ? state.sites : loadSites(),
      mission: state.mission && typeof state.mission === 'object' ? state.mission : loadMission(),
      locale: typeof state.locale === 'string' ? state.locale : loadLocale(),
      selectedSiteId:
        typeof state.selectedSiteId === 'string' ? state.selectedSiteId : loadSelectedSiteId(),
    }
  }
  return {
    sites: loadSites(),
    mission: loadMission(),
    locale: loadLocale(),
    selectedSiteId: loadSelectedSiteId(),
  }
}

/**
 * Persist the whole application state (or a partial update).
 *
 * @param {{sites?: Array<Object>, mission?: Object, locale?: string, selectedSiteId?: string|null}} partial
 * @returns {boolean}
 */
export function saveState(partial = {}) {
  const current = loadState()
  const next = { ...current, ...(partial && typeof partial === 'object' ? partial : {}) }
  return writeStorage(STORAGE_KEYS.state, next)
}

/**
 * Remove every key owned by the application.
 *
 * @returns {void}
 */
export function clearState() {
  for (const key of Object.values(STORAGE_KEYS)) removeStorage(key)
  memoryStore.clear()
}

/**
 * Export the persisted state as a JSON string (for debugging/backups).
 *
 * @returns {string}
 */
export function exportStateJson() {
  return JSON.stringify(loadState(), null, 2)
}

/**
 * Import a previously exported state.
 *
 * @param {string|Object} json JSON string or state object.
 * @returns {boolean} `true` when the state was applied.
 */
export function importState(json) {
  try {
    const parsed = typeof json === 'string' ? JSON.parse(json) : json
    if (!parsed || typeof parsed !== 'object') return false
    saveState(parsed)
    return true
  } catch {
    return false
  }
}
