/**
 * Small formatting helpers shared by the panels. Everything is UTC: the app
 * never guesses the browser time zone for mission planning.
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** Parse an ISO string or Date into a timestamp (ms). */
export function toTimestamp(value) {
  if (value instanceof Date) return value.getTime()
  if (typeof value === 'number') return value
  if (typeof value === 'string') return Date.parse(value)
  return NaN
}

/** `2026-11-14 12:00 UTC` */
export function formatUtc(value) {
  const ms = toTimestamp(value)
  if (!Number.isFinite(ms)) return '—'
  const date = new Date(ms)
  const day = String(date.getUTCDate()).padStart(2, '0')
  const month = MONTHS[date.getUTCMonth()]
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

/** Localised-ish fixed number, with a dash for missing values. */
export function formatNumber(value, digits = 0) {
  if (!Number.isFinite(Number(value))) return '—'
  return Number(value).toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
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
  return text.length > length ? `${text.slice(0, length - 1)}…` : text
}
