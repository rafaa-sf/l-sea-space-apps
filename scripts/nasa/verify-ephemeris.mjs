#!/usr/bin/env node
// L-SEA Space Apps - independent validation of the shipped Horizons ephemerides.
//
// Re-queries the live JPL Horizons API with the same observer setup used by
// scripts/nasa/fetch-horizons.mjs (topocentric apparent az/el, GEODETIC
// observer on the Moon, CSV) and compares the fresh rows with the pre-computed
// files in public/data/ephemeris/. It is read-only: no files are written and no
// application code is imported.
//
// Usage:
//   node scripts/nasa/verify-ephemeris.mjs
//   node scripts/nasa/verify-ephemeris.mjs --sites=haworth,leibnitz-beta
//   node scripts/nasa/verify-ephemeris.mjs --samples=12 --tol-az=0.1 --tol-el=0.05
//   node scripts/nasa/verify-ephemeris.mjs --delay=3000
//
// Exits 0 only when every sampled timestamp is found in the live response and
// every deviation stays within tolerance. Horizons asks for polite rate
// limiting: requests go out one at a time with --delay ms between them
// (default 1500) and transient failures are retried with exponential backoff.

import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildQueryUrl, parseHorizonsCsv } from './fetch-horizons.mjs'
import { EPHEMERIS_RANGE, SITES } from './sites.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const EPHEMERIS_DIR = path.join(ROOT, 'public', 'data', 'ephemeris')

const BODIES = [
  { key: 'sun', target: '10', label: 'Sun' },
  { key: 'earth', target: '399', label: 'Earth' },
]

const DEFAULTS = {
  samples: 24,
  tolAz: 0.05,
  tolEl: 0.02,
  delay: 1500,
}

const MAX_ATTEMPTS = 4
// Same polite identification the generator sends; Horizons asks for it.
const USER_AGENT =
  'L-SEA-SpaceApps/1.0 (NASA Space Apps Challenge 2026, Malaga; precomputed demo data)'

const MONTHS = {
  Jan: '01',
  Feb: '02',
  Mar: '03',
  Apr: '04',
  May: '05',
  Jun: '06',
  Jul: '07',
  Aug: '08',
  Sep: '09',
  Oct: '10',
  Nov: '11',
  Dec: '12',
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** Read a required non-negative number from `--name=value`. */
function numberOption(name, value) {
  const number = Number(value)
  if (!Number.isFinite(number) || number < 0) {
    throw new Error(`--${name} expects a non-negative number, got "${value}"`)
  }
  return number
}

/** Parse the CLI flags; unknown flags are rejected so typos cannot pass silently. */
function parseArgs(argv) {
  const options = { ...DEFAULTS, sites: null, help: false }
  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') {
      options.help = true
      continue
    }
    const match = /^--([a-z-]+)=(.*)$/.exec(arg)
    if (!match) throw new Error(`unknown argument: ${arg} (try --help)`)
    const [, name, value] = match
    if (name === 'sites') {
      options.sites = value
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean)
      if (options.sites.length === 0) throw new Error('--sites needs at least one site id')
      continue
    }
    const number = numberOption(name, value)
    if (name === 'samples') options.samples = Math.max(1, Math.round(number))
    else if (name === 'tol-az') options.tolAz = number
    else if (name === 'tol-el') options.tolEl = number
    else if (name === 'delay') options.delay = Math.max(200, Math.round(number))
    else throw new Error(`unknown option --${name} (try --help)`)
  }
  return options
}

/** Convert Horizons "YYYY-MMM-DD HH:MM" (UTC) to ISO-8601 "YYYY-MM-DDTHH:MM:00Z". */
function stampToIso(stamp) {
  const [date, time] = stamp.split(' ')
  const [year, month, day] = date.split('-')
  return `${year}-${MONTHS[month]}-${day}T${time}:00Z`
}

/** Smallest absolute difference between two azimuths, both in degrees. */
function azimuthDelta(a, b) {
  const wrapped = (((a - b) % 360) + 540) % 360 - 180
  return Math.abs(wrapped)
}

/** Fetch one Horizons response with the generator's retry policy. */
async function fetchHorizons(url, label) {
  let lastError
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT },
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

/**
 * Pick `count` shipped samples evenly spread across the whole shipped range,
 * always including the first and last sample.
 */
function pickSamples(samples, count) {
  const total = Math.min(count, samples.length)
  const picked = []
  for (let i = 0; i < total; i += 1) {
    const index = total === 1 ? 0 : Math.round((i * (samples.length - 1)) / (total - 1))
    picked.push({ index, sample: samples[index] })
  }
  return picked
}

/** Print a compact fixed-width table of the per-site/body deviations. */
function printTable(rows) {
  const columns = [
    ['site', 24],
    ['body', 5],
    ['matched', 8],
    ['missing', 8],
    ['max|Δaz|', 9],
    ['mean|Δaz|', 10],
    ['max|Δel|', 9],
    ['mean|Δel|', 10],
    ['status', 9],
  ]
  const format = (value, width) => String(value).padEnd(width)
  const degrees = (value) => (Number.isFinite(value) ? value.toFixed(4) : '—')

  console.log(columns.map(([header, width]) => format(header, width)).join(' '))
  console.log(columns.map(([, width]) => '-'.repeat(width)).join(' '))
  for (const row of rows) {
    const cells = [
      row.site,
      row.body,
      `${row.matched}/${row.total}`,
      String(row.missing),
      degrees(row.maxAz),
      degrees(row.meanAz),
      degrees(row.maxEl),
      degrees(row.meanEl),
      row.status,
    ]
    console.log(cells.map((cell, index) => format(cell, columns[index][1])).join(' '))
  }
}

/**
 * Fetch fresh Horizons rows for one site and compare the sampled shipped
 * timestamps with them. Returns the table rows and the list of failures.
 */
async function verifySite(site, options) {
  const file = path.join(EPHEMERIS_DIR, `${site.id}.json`)
  const shipped = JSON.parse(await readFile(file, 'utf8'))
  const failures = []
  const rows = []

  if (
    shipped.range?.start !== EPHEMERIS_RANGE.start ||
    shipped.range?.end !== EPHEMERIS_RANGE.end ||
    shipped.stepMinutes !== EPHEMERIS_RANGE.stepMinutes
  ) {
    failures.push(
      `${site.id}: shipped range/cadence ${shipped.range?.start}..${shipped.range?.end} ` +
        `every ${shipped.stepMinutes} min does not match the Horizons query ` +
        `${EPHEMERIS_RANGE.start}..${EPHEMERIS_RANGE.end} every ${EPHEMERIS_RANGE.stepMinutes} min`,
    )
  }

  const samples = Array.isArray(shipped.samples) ? shipped.samples : []
  if (samples.length === 0) {
    failures.push(`${site.id}: shipped file has no samples`)
    return { rows, failures }
  }

  const picked = pickSamples(samples, options.samples)

  for (const body of BODIES) {
    const baseRow = {
      site: site.id,
      body: body.label,
      matched: 0,
      missing: picked.length,
      total: picked.length,
      maxAz: Number.NaN,
      meanAz: Number.NaN,
      maxEl: Number.NaN,
      meanEl: Number.NaN,
      status: 'request',
    }

    let freshByIso = null
    try {
      const url = buildQueryUrl(site, body.target)
      console.log(`  query ${site.id} ${body.label} ...`)
      const text = await fetchHorizons(url, `${site.id}/${body.label}`)
      const freshRows = parseHorizonsCsv(text)
      freshByIso = new Map(freshRows.map((row) => [stampToIso(row.stamp), row]))
      console.log(`  ${site.id} ${body.label}: ${freshRows.length} fresh rows`)
    } catch (error) {
      failures.push(`${site.id}/${body.label}: request failed: ${error.message}`)
      rows.push(baseRow)
      await sleep(options.delay)
      continue
    }

    let matched = 0
    let missing = 0
    let maxAz = 0
    let maxEl = 0
    let sumAz = 0
    let sumEl = 0
    let overTolerance = 0

    for (const { sample } of picked) {
      const shippedBody = sample[body.key]
      const fresh = freshByIso.get(sample.time)
      if (
        !fresh ||
        !shippedBody ||
        !Number.isFinite(shippedBody.az) ||
        !Number.isFinite(shippedBody.el)
      ) {
        missing += 1
        continue
      }
      matched += 1
      const dAz = azimuthDelta(fresh.az, shippedBody.az)
      const dEl = Math.abs(fresh.el - shippedBody.el)
      maxAz = Math.max(maxAz, dAz)
      maxEl = Math.max(maxEl, dEl)
      sumAz += dAz
      sumEl += dEl
      if (dAz > options.tolAz || dEl > options.tolEl) overTolerance += 1
    }

    if (missing > 0) {
      failures.push(
        `${site.id}/${body.label}: ${missing} of ${picked.length} sampled timestamps missing from the live response`,
      )
    }
    if (overTolerance > 0) {
      failures.push(
        `${site.id}/${body.label}: ${overTolerance} sample(s) exceed tolerance ` +
          `(az ${options.tolAz} deg / el ${options.tolEl} deg)`,
      )
    }

    rows.push({
      ...baseRow,
      matched,
      missing,
      maxAz,
      meanAz: matched > 0 ? sumAz / matched : Number.NaN,
      maxEl,
      meanEl: matched > 0 ? sumEl / matched : Number.NaN,
      status: missing > 0 ? 'missing' : overTolerance > 0 ? 'tolerance' : 'ok',
    })
    await sleep(options.delay)
  }

  return { rows, failures }
}

function printHelp() {
  console.log(`Usage: node scripts/nasa/verify-ephemeris.mjs [options]

Re-query JPL Horizons and compare it with the shipped ephemerides.

Options:
  --sites=a,b     only validate these shipped site ids (default: all)
  --samples=N     shipped timestamps sampled per site (default: ${DEFAULTS.samples})
  --tol-az=deg    azimuth tolerance in degrees (default: ${DEFAULTS.tolAz})
  --tol-el=deg    elevation tolerance in degrees (default: ${DEFAULTS.tolEl})
  --delay=ms      wait between API requests in ms (default: ${DEFAULTS.delay})
  -h, --help      show this help

Exits 0 when every sample matches within tolerance, 1 otherwise.`)
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    printHelp()
    return 0
  }

  const index = JSON.parse(await readFile(path.join(EPHEMERIS_DIR, 'index.json'), 'utf8'))
  const shippedIds = (index.files ?? []).map((file) => file.siteId)
  if (shippedIds.length === 0) throw new Error('ephemeris index.json lists no sites')

  const sitesById = new Map(SITES.map((site) => [site.id, site]))
  const missingFromSites = shippedIds.filter((id) => !sitesById.has(id))
  if (missingFromSites.length > 0) {
    throw new Error(`shipped site(s) missing from scripts/nasa/sites.mjs: ${missingFromSites.join(', ')}`)
  }

  const requested = options.sites ?? shippedIds
  const unknown = requested.filter((id) => !shippedIds.includes(id))
  if (unknown.length > 0) throw new Error(`--sites id(s) not shipped: ${unknown.join(', ')}`)

  const selected = requested.map((id) => sitesById.get(id))
  console.log(
    `JPL Horizons validation: ${selected.length} site(s), ${options.samples} sampled timestamp(s) each, ` +
      `tolerances az ${options.tolAz} deg / el ${options.tolEl} deg`,
  )
  console.log(
    `shipped range ${EPHEMERIS_RANGE.start} .. ${EPHEMERIS_RANGE.end} every ${EPHEMERIS_RANGE.stepMinutes} min`,
  )

  const rows = []
  const failures = []
  for (const site of selected) {
    const result = await verifySite(site, options)
    rows.push(...result.rows)
    failures.push(...result.failures)
  }

  console.log('')
  printTable(rows)

  const compared = rows.reduce((sum, row) => sum + row.matched, 0)
  console.log(`\ncompared ${compared} sample(s) across ${rows.length} site/body check(s)`)

  if (failures.length > 0) {
    console.error(`\nFAILED: ${failures.length} issue(s)`)
    for (const failure of failures) console.error(`  - ${failure}`)
    return 1
  }

  console.log('OK: all sampled timestamps match live JPL Horizons within tolerance')
  return 0
}

main()
  .then((code) => {
    process.exitCode = code
  })
  .catch((error) => {
    console.error(`FAILED: ${error.message}`)
    process.exitCode = 1
  })
