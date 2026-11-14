#!/usr/bin/env node
// L-SEA Space Apps - pre-computed JPL Horizons ephemerides for lunar sites.
//
// Queries the real JPL Horizons API for TOPOCENTRIC apparent azimuth/elevation
// of the Sun (10) and the Earth (399) as seen from each lunar south-pole site,
// then writes compact JSON to public/data/ephemeris/<site-id>.json.
//
// Why pre-compute: Horizons does not send CORS headers, so the static app
// cannot call it from the browser. The deployed site reads these files.
//
// Usage:
//   node scripts/nasa/fetch-horizons.mjs                (all sites, skip existing)
//   node scripts/nasa/fetch-horizons.mjs --force         (re-query everything)
//   node scripts/nasa/fetch-horizons.mjs --only=haworth  (single site)
//   node scripts/nasa/fetch-horizons.mjs --dry-run       (print query URLs only)
//
// Rate limiting: JPL asks users to be considerate. Requests are issued strictly
// one at a time with a delay between them (default 1500 ms), with retries and
// exponential backoff for HTTP 429/5xx and network errors.

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { EPHEMERIS_RANGE, MOON_RADIUS_M, SITES } from './sites.mjs'

const HORIZONS_ENDPOINT = 'https://ssd.jpl.nasa.gov/api/horizons.api'
const BODIES = [
  { key: 'sun', target: '10', label: 'Sun' },
  { key: 'earth', target: '399', label: 'Earth' },
]
const API_VERSION = '1.2'
const DEFAULT_DELAY_MS = 1500
const MAX_ATTEMPTS = 4

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const OUT_DIR = path.join(ROOT, 'public', 'data', 'ephemeris')

const args = process.argv.slice(2)
const force = args.includes('--force')
const dryRun = args.includes('--dry-run')
const onlyArg = args.find((a) => a.startsWith('--only='))
const delayArg = args.find((a) => a.startsWith('--delay='))
const only = onlyArg ? onlyArg.slice('--only='.length).split(',') : null
const delayMs = delayArg ? Math.max(200, Number(delayArg.slice('--delay='.length))) : DEFAULT_DELAY_MS

if (Number.isNaN(delayMs)) {
  console.error('Invalid --delay value')
  process.exit(1)
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** Format an ISO-8601 UTC instant as the "YYYY-MMM-DD HH:MM" Horizons expects. */
function horizonsTime(iso) {
  const d = new Date(iso)
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const p = (n) => String(n).padStart(2, '0')
  return (
    `${d.getUTCFullYear()}-${months[d.getUTCMonth()]}-${p(d.getUTCDate())} ` +
    `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`
  )
}

/** Build the Horizons observer-ephemeris query string for one site and body. */
export function buildQueryUrl(site, target) {
  // CENTER=coord@301 puts the observer on the Moon (NAIF 301). COORD_TYPE
  // GEODETIC takes SITE_COORD as "east-longitude, latitude, altitude-km", which
  // Horizons internally converts to the lunar body-fixed frame. QUANTITIES=4 is
  // apparent azimuth/elevation. TIME_ZONE=0 means the times are UTC; CSV_FORMAT
  // makes the rows easy to parse; ANG_FORMAT=DEG keeps angles in decimal degrees.
  const params = new URLSearchParams({
    format: 'text',
    COMMAND: `'${target}'`,
    OBJ_DATA: 'NO',
    MAKE_EPHEM: 'YES',
    EPHEM_TYPE: 'OBSERVER',
    CENTER: `'coord@301'`,
    COORD_TYPE: `'GEODETIC'`,
    SITE_COORD: `'${site.lon.toFixed(5)},${site.lat.toFixed(5)},0'`,
    QUANTITIES: `'4'`,
    ANG_FORMAT: `'DEG'`,
    CSV_FORMAT: `'YES'`,
    STEP_SIZE: `'${EPHEMERIS_RANGE.stepMinutes}m'`,
    TIME_ZONE: `'0'`,
    START_TIME: `'${horizonsTime(EPHEMERIS_RANGE.start)}'`,
    STOP_TIME: `'${horizonsTime(EPHEMERIS_RANGE.end)}'`,
  })
  return `${HORIZONS_ENDPOINT}?${params.toString()}`
}

/**
 * Extract the rows between $$SOE/$$EOE.
 * CSV row format with QUANTITIES=4 is:
 *   " 2026-Nov-01 00:00,*,i, 285.117929,     1.587011,"
 * i.e. date, solar-presence marker, interferer marker, azimuth, elevation.
 */
export function parseHorizonsCsv(text) {
  const soe = text.indexOf('$$SOE')
  const eoe = text.indexOf('$$EOE')
  if (soe < 0 || eoe < 0) {
    throw new Error('Horizons response missing $$SOE/$$EOE markers')
  }
  const rows = []
  for (const line of text.slice(soe + 5, eoe).split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const fields = trimmed.split(',')
    if (fields.length < 5) continue
    const stamp = fields[0].trim()
    const az = Number(fields[3])
    const el = Number(fields[4])
    if (!/^\d{4}-[A-Za-z]{3}-\d{2} \d{2}:\d{2}$/.test(stamp)) continue
    if (!Number.isFinite(az) || !Number.isFinite(el)) continue
    rows.push({ stamp, az: round3(az), el: round3(el) })
  }
  if (rows.length === 0) throw new Error('Horizons response contained no data rows')
  return rows
}

function round3(n) {
  return Math.round(n * 1000) / 1000
}

/** Convert Horizons "YYYY-MMM-DD HH:MM" (UTC) to ISO-8601 "YYYY-MM-DDTHH:MM:00Z". */
function stampToIso(stamp) {
  const months = {
    Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06',
    Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12',
  }
  const [date, time] = stamp.split(' ')
  const [year, mon, day] = date.split('-')
  return `${year}-${months[mon]}-${day}T${time}:00Z`
}

async function fetchWithRetry(url, label) {
  let lastError
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const response = await fetch(url, {
        headers: {
          // Polite identification, as requested by the Horizons team.
          'User-Agent': 'L-SEA-SpaceApps/1.0 (NASA Space Apps Challenge 2026, Malaga; precomputed demo data)',
        },
        signal: AbortSignal.timeout(90_000),
      })
      if (response.status === 429 || response.status >= 500) {
        throw new Error(`HTTP ${response.status}`)
      }
      if (!response.ok) {
        const body = await response.text()
        throw new Error(`HTTP ${response.status}: ${body.slice(0, 200)}`)
      }
      const text = await response.text()
      if (!text.includes('$$SOE')) {
        throw new Error(`response has no $$SOE marker: ${text.slice(0, 200)}`)
      }
      return text
    } catch (error) {
      lastError = error
      const backoff = Math.min(30_000, 2000 * 2 ** (attempt - 1))
      console.warn(`  ! ${label} attempt ${attempt}/${MAX_ATTEMPTS} failed: ${error.message}`)
      if (attempt < MAX_ATTEMPTS) await sleep(backoff)
    }
  }
  throw lastError
}

async function buildSite(site) {
  const target = path.join(OUT_DIR, `${site.id}.json`)
  if (!force && existsSync(target)) {
    console.log(`= ${site.id}: already present, skipping (use --force to refresh)`)
    return { skipped: true }
  }

  const byBody = {}
  for (const body of BODIES) {
    const url = buildQueryUrl(site, body.target)
    if (dryRun) {
      byBody[body.key] = []
      console.log(`  query ${site.id} ${body.label}: ${url}`)
      continue
    }
    console.log(`  query ${site.id} ${body.label} ...`)
    const text = await fetchWithRetry(url, `${site.id}/${body.label}`)
    byBody[body.key] = parseHorizonsCsv(text)
    console.log(`  ${site.id} ${body.label}: ${byBody[body.key].length} rows`)
    await sleep(delayMs) // be polite between every request
  }
  if (dryRun) return { skipped: true }

  const sun = byBody.sun ?? []
  const earth = byBody.earth ?? []
  if (sun.length !== earth.length) {
    throw new Error(`${site.id}: Sun rows (${sun.length}) != Earth rows (${earth.length})`)
  }

  const samples = sun.map((row, index) => {
    const earthRow = earth[index]
    // Guard against a time-alignment mismatch between the two responses.
    if (row.stamp !== earthRow.stamp) {
      throw new Error(`${site.id}: time mismatch at row ${index}: "${row.stamp}" vs "${earthRow.stamp}"`)
    }
    return {
      time: stampToIso(row.stamp),
      sun: { az: row.az, el: row.el },
      earth: { az: earthRow.az, el: earthRow.el },
    }
  })

  const payload = {
    siteId: site.id,
    site: { lat: site.lat, lon: site.lon },
    moonRadiusM: MOON_RADIUS_M,
    source: 'NASA/JPL Horizons API (DE441), topocentric apparent az/el',
    center: 'coord@301 (Moon), GEODETIC site coordinates, airless (no refraction)',
    units: { az: 'degrees east of selenographic north, 0..360', el: 'degrees above local horizon' },
    generated: new Date().toISOString(),
    apiVersion: API_VERSION,
    range: { start: EPHEMERIS_RANGE.start, end: EPHEMERIS_RANGE.end },
    stepMinutes: EPHEMERIS_RANGE.stepMinutes,
    sampleCount: samples.length,
    samples,
  }
  await writeFile(target, JSON.stringify(payload) + '\n', 'utf8')
  console.log(`  wrote ${path.relative(ROOT, target)} (${samples.length} samples, ${(JSON.stringify(payload).length / 1024).toFixed(0)} KiB)`)
  return { skipped: false, samples: samples.length }
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true })
  const sites = only ? SITES.filter((s) => only.includes(s.id)) : SITES
  if (sites.length === 0) {
    console.error(`No matching sites for --only=${only?.join(',')}`)
    process.exit(1)
  }
  console.log(
    `JPL Horizons pre-compute: ${sites.length} site(s), ` +
      `${EPHEMERIS_RANGE.start} .. ${EPHEMERIS_RANGE.end} every ${EPHEMERIS_RANGE.stepMinutes} min`,
  )
  const results = []
  for (const site of sites) {
    const result = await buildSite(site)
    results.push({ id: site.id, ...result })
  }

  if (!dryRun) {
    const index = {
      generated: new Date().toISOString(),
      source: 'NASA/JPL Horizons API (DE441), topocentric apparent az/el from each site',
      range: { start: EPHEMERIS_RANGE.start, end: EPHEMERIS_RANGE.end },
      stepMinutes: EPHEMERIS_RANGE.stepMinutes,
      sampleCount: results.find((r) => r.samples)?.samples ?? null,
      files: sites.map((s) => ({ siteId: s.id, file: `${s.id}.json`, lat: s.lat, lon: s.lon })),
    }
    await rename(
      await writeIndex(index),
      path.join(OUT_DIR, 'index.json'),
    )
    console.log(`wrote ${path.relative(ROOT, path.join(OUT_DIR, 'index.json'))}`)
  }
  console.log('done')
}

async function writeIndex(index) {
  const tmp = path.join(OUT_DIR, '.index.json.tmp')
  await writeFile(tmp, JSON.stringify(index, null, 2) + '\n', 'utf8')
  return tmp
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`FAILED: ${error.message}`)
    process.exit(1)
  })
}

// Exported for unit tests / reuse by the dev-only live proxy.
export { parseHorizonsCsv as _parseHorizonsCsv, buildQueryUrl as _buildQueryUrl, readFile }
