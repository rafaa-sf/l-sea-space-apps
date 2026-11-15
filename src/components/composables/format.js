/**
 * Small formatting helpers shared by the panels. Everything is UTC: the app
 * never guesses the browser time zone for mission planning.
 *
 * Copy is bilingual (EN/ES): helpers resolve the UI locale from
 * `document.documentElement.lang` (kept in sync with the i18n locale) and fall
 * back to English. Tests pass the locale explicitly as the last argument.
 */

const MONTHS = {
  en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
  es: ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'],
}

const INTL_LOCALES = { en: 'en-US', es: 'es-ES' }

/**
 * Locale used by the formatters: an explicit argument wins, then the document
 * language (`es*` → es), then English for anything else or in non-DOM tests.
 * @param {string} [locale] Explicit BCP-47 tag, e.g. `'es'`, `'es-ES'`.
 * @returns {'en'|'es'}
 */
function resolveLocale(locale) {
  let tag = locale
  if (tag == null && typeof document !== 'undefined' && document.documentElement) {
    tag = document.documentElement.lang
  }
  return String(tag ?? '').toLowerCase().startsWith('es') ? 'es' : 'en'
}

/** Parse an ISO string or Date into a timestamp (ms). */
export function toTimestamp(value) {
  if (value instanceof Date) return value.getTime()
  if (typeof value === 'number') return value
  if (typeof value === 'string') return Date.parse(value)
  return NaN
}

/**
 * `14 Nov 2026 12:00 UTC` in English, `14 nov 2026 12:00 UTC` in Spanish.
 * @param {Date|string|number} value Mission instant (always rendered in UTC).
 * @param {string} [locale] Optional locale override; defaults to the UI locale.
 */
export function formatUtc(value, locale) {
  const ms = toTimestamp(value)
  if (!Number.isFinite(ms)) return '—'
  const date = new Date(ms)
  const lang = resolveLocale(locale)
  const day = String(date.getUTCDate()).padStart(2, '0')
  const month = MONTHS[lang][date.getUTCMonth()]
  const year = date.getUTCFullYear()
  const hours = String(date.getUTCHours()).padStart(2, '0')
  const minutes = String(date.getUTCMinutes()).padStart(2, '0')
  return `${day} ${month} ${year} ${hours}:${minutes} UTC`
}

/** `2026-11-14` in UTC, ready for `<input type="date">`. */
export function formatDateInput(value) {
  const ms = toTimestamp(value)
  if (!Number.isFinite(ms)) return ''
  return new Date(ms).toISOString().slice(0, 10)
}

/** `12:30` in UTC, ready for `<input type="time">`. */
export function formatTimeInput(value) {
  const ms = toTimestamp(value)
  if (!Number.isFinite(ms)) return ''
  return new Date(ms).toISOString().slice(11, 16)
}

/** Combine a `YYYY-MM-DD` date and a `HH:MM` UTC time into an ISO string. */
export function combineUtc(dateString, timeString) {
  if (!dateString || !timeString) return null
  const iso = `${dateString}T${timeString.length === 5 ? `${timeString}:00` : timeString}Z`
  const ms = Date.parse(iso)
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null
}

/** `3 d 4 h 12 min`, `4 h 12 min`, `12 min 30 s`, `45 s`. */
export function formatDuration(seconds) {
  if (!Number.isFinite(seconds)) return '—'
  const total = Math.max(0, Math.round(seconds))
  const days = Math.floor(total / 86400)
  const hours = Math.floor((total % 86400) / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const secs = total % 60
  if (days > 0) return `${days} d ${hours} h ${minutes} min`
  if (hours > 0) return `${hours} h ${minutes} min`
  if (minutes > 0) return `${minutes} min ${secs} s`
  return `${secs} s`
}

/**
 * Localised fixed number, with a dash for missing values: `1,234` (en) /
 * `1.234` (es).
 * @param {number|string} value Numeric value; non-finite renders as `—`.
 * @param {number} [digits] Fixed number of decimals.
 * @param {string} [locale] Optional locale override; defaults to the UI locale.
 */
export function formatNumber(value, digits = 0, locale) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return '—'
  // `useGrouping: 'always'` keeps the Spanish thousands dot on 4-digit values
  // (es-ES otherwise leaves `1234` ungrouped); older engines treat it as auto.
  return numeric.toLocaleString(INTL_LOCALES[resolveLocale(locale)], {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
    useGrouping: 'always',
  })
}

/** `−90.00°` style angle, always one or two decimals. */
export function formatAngle(value, digits = 2) {
  if (!Number.isFinite(Number(value))) return '—'
  return `${formatNumber(value, digits)}°`
}

/** Elevation in meters with a sign. */
export function formatMeters(value, digits = 0) {
  if (!Number.isFinite(Number(value))) return '—'
  return `${formatNumber(value, digits)} m`
}

/** Distance in meters, converted to km above 10 km. */
export function formatDistance(meters) {
  if (!Number.isFinite(Number(meters))) return '—'
  const value = Number(meters)
  if (Math.abs(value) >= 10000) return `${formatNumber(value / 1000, 1)} km`
  return `${formatNumber(value, 0)} m`
}

/** `75 %` */
export function formatPercent(fraction, digits = 0) {
  if (!Number.isFinite(Number(fraction))) return '—'
  return `${formatNumber(Number(fraction) * 100, digits)} %`
}

/** Latitude with hemisphere letter: `89.45° S`. */
export function formatLat(lat) {
  if (!Number.isFinite(Number(lat))) return '—'
  const value = Number(lat)
  return `${formatNumber(Math.abs(value), 2)}° ${value < 0 ? 'S' : 'N'}`
}

/** Longitude in the 0–360 east convention: `129.20° E`. */
export function formatLon(lon) {
  if (!Number.isFinite(Number(lon))) return '—'
  const value = ((Number(lon) % 360) + 360) % 360
  return `${formatNumber(value, 2)}° E`
}

/** Truncate a display string without cutting surrogate pairs. */
export function truncate(value, length = 60) {
  const text = String(value ?? '')
  return text.length > length ? `${text.slice(0, length - 3)}...` : text
}
