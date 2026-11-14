#!/usr/bin/env node
/**
 * Verify that the shipped datasets come from official NASA sources.
 *
 * Checks:
 *   1. The shipped LOLA terrain metadata matches the PDS Geosciences products
 *      (file names, native grid, reference radius, scaling factor).
 *   2. The PDS JP2 products are still downloadable with the recorded sizes.
 *   3. The PDS label declares the official data set (LRO-L-LOLA-4-GDR-V1.0).
 *   4. JPL Horizons (ssd.jpl.nasa.gov) answers a minimal API request.
 *   5. NASA Moon Trek exposes the south-pole WMTS layer catalogue.
 *   6. LROC QuickMap answers.
 *   7. No non-NASA ephemeris library (Skyfield, astropy, pyephem) is a project
 *      dependency, and none is imported anywhere in src/ or scripts/.
 *   8. The application entry point loads no external scripts or styles (the UI
 *      consumes only the pre-computed data from the same origin).
 *
 * Usage:
 *   node scripts/nasa/verify-sources.mjs
 *
 * Network access is required. Exit code 0 when every check passes.
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = new URL('../../', import.meta.url)
const PDS_BASE =
  'https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/polar/jp2'

const EXPECTED = {
  highRes: {
    file: 'south-pole-875s-20m',
    sourceFile: 'ldem_875s_20m.jp2',
    sourceShape: [7584, 7584],
    bytes: 21_462_406,
    toleranceM: 2,
  },
  wide: {
    file: 'south-pole-80s-80m',
    sourceFile: 'ldem_80s_80m.jp2',
    sourceShape: [7600, 7600],
    bytes: 29_837_992,
    toleranceM: 2,
  },
}

const results = []
const record = (name, ok, detail) => {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

const readJson = (relativePath) =>
  JSON.parse(readFileSync(new URL(relativePath, ROOT), 'utf8'))

async function checkTerrainMetadata() {
  for (const key of ['highRes', 'wide']) {
    const expected = EXPECTED[key]
    const meta = readJson(`public/data/terrain/${expected.file}.json`)
    const bin = new URL(`public/data/terrain/${expected.file}.bin`, ROOT)
    const ok =
      meta.sourceFile === expected.sourceFile &&
      meta.sourceShape.width === expected.sourceShape[0] &&
      meta.sourceShape.height === expected.sourceShape[1] &&
      meta.referenceRadiusM === 1_737_400 &&
      /PDS Geosciences/.test(meta.source) &&
      existsSync(bin)
    record(
      `terrain ${expected.file}: PDS product metadata`,
      ok,
      `${meta.sourceFile}, ${meta.sourceShape.width}x${meta.sourceShape.height}, R=${meta.referenceRadiusM} m`,
    )
  }
  const index = readJson('public/data/terrain/index.json')
  record(
    'terrain index references both regions',
    Array.isArray(index.regions) && index.regions.length === 2,
    `${index.regions?.length ?? 0} regions`,
  )
}

async function checkPdsFiles() {
  for (const key of ['highRes', 'wide']) {
    const expected = EXPECTED[key]
    const url = `${PDS_BASE}/${expected.sourceFile}`
    try {
      const response = await fetch(url, { method: 'HEAD' })
      const bytes = Number(response.headers.get('content-length') ?? 0)
      record(
        `PDS ${expected.sourceFile} downloadable`,
        response.status === 200 && bytes === expected.bytes,
        `HTTP ${response.status}, ${bytes} bytes`,
      )
    } catch (error) {
      record(`PDS ${expected.sourceFile} downloadable`, false, error.message)
    }
  }
}

async function checkPdsLabel() {
  const url = `${PDS_BASE}/ldem_875s_20m_jp2.lbl`
  try {
    const text = await (await fetch(url)).text()
    const dataset = /DATA_SET_ID\s*=\s*"([^"]+)"/.exec(text)?.[1]
    const scaling = /SCALING_FACTOR\s*=\s*([0-9.]+)/.exec(text)?.[1]
    const offset = /OFFSET\s*=\s*([0-9.]+)/.exec(text)?.[1]
    const lines = /LINES\s*=\s*([0-9]+)/.exec(text)?.[1]
    const samples = /LINE_SAMPLES\s*=\s*([0-9]+)/.exec(text)?.[1]
    const ok =
      dataset === 'LRO-L-LOLA-4-GDR-V1.0' &&
      Number(scaling) === 0.5 &&
      Number(offset) === 1_737_400 &&
      Number(lines) === 7584 &&
      Number(samples) === 7584
    record(
      'PDS label declares official LOLA GDR data set',
      ok,
      `${dataset}, scaling ${scaling}, offset ${offset}, ${lines}x${samples}`,
    )
  } catch (error) {
    record('PDS label declares official LOLA GDR data set', false, error.message)
  }
}

async function checkHorizons() {
  const params = new URLSearchParams({
    format: 'text',
    COMMAND: "'10'",
    OBJ_DATA: "'NO'",
    MAKE_EPHEM: "'NO'",
  })
  try {
    const response = await fetch(`https://ssd.jpl.nasa.gov/api/horizons.api?${params}`)
    const text = await response.text()
    const ok = response.status === 200 && /JPL Horizons/i.test(text)
    record('JPL Horizons API reachable', ok, `HTTP ${response.status}`)
  } catch (error) {
    record('JPL Horizons API reachable', false, error.message)
  }
}

async function checkMoonTrek() {
  const url =
    'https://trek.nasa.gov/moon/TrekServices/ws/index/polar/listVisibleLayers' +
    '?proj=urn:ogc:def:crs:IAU2000::30120&start=0&rows=1'
  try {
    const response = await fetch(url)
    const body = await response.text()
    const ok = response.status === 200 && body.includes('"docs"')
    record('NASA Moon Trek layer catalogue reachable', ok, `HTTP ${response.status}`)
  } catch (error) {
    record('NASA Moon Trek layer catalogue reachable', false, error.message)
  }
}

async function checkQuickMap() {
  try {
    const response = await fetch('https://quickmap.lroc.asu.edu/', { redirect: 'follow' })
    record('LROC QuickMap reachable', response.status === 200, `HTTP ${response.status}`)
  } catch (error) {
    record('LROC QuickMap reachable', false, error.message)
  }
}

function walkFiles(directory, extensions) {
  const files = []
  const visit = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name)
      if (entry.isDirectory()) visit(full)
      else if (extensions.some((extension) => entry.name.endsWith(extension))) files.push(full)
    }
  }
  visit(directory)
  return files
}

function checkSourceTreeForForbiddenImports() {
  const root = new URL('../../', import.meta.url)
  const files = [
    ...walkFiles(join(root.pathname, 'src'), ['.js', '.mjs', '.vue']),
    ...walkFiles(join(root.pathname, 'scripts'), ['.js', '.mjs']),
  ].filter((file) => !file.endsWith('verify-sources.mjs'))
  const hits = files.filter((file) => /skyfield|astropy|pyephem/i.test(readFileSync(file, 'utf8')))
  record(
    'no forbidden ephemeris library imported in source',
    hits.length === 0,
    hits.length ? hits.join(', ') : 'none',
  )
}

function checkNoExternalEntryPointAssets() {
  const html = readFileSync(new URL('index.html', ROOT), 'utf8')
  const external = [...html.matchAll(/(?:src|href)="(https?:\/\/[^"]+)"/g)].map((match) => match[1])
  record(
    'entry point loads no external scripts or styles',
    external.length === 0,
    external.length ? external.join(', ') : 'none',
  )
}

function checkNoNonNasaEphemerisLibraries() {
  const pkg = readJson('package.json')
  const mcpPkg = readJson('mcp/miro/package.json')
  const all = JSON.stringify({ pkg, mcpPkg })
  const forbidden = ['skyfield', 'astropy', 'pyephem', 'ephem']
  const found = forbidden.filter((name) => all.toLowerCase().includes(`"${name}`))
  record(
    'no non-NASA ephemeris library in dependencies',
    found.length === 0,
    found.length ? found.join(', ') : 'none',
  )
}

await checkTerrainMetadata()
await checkPdsFiles()
await checkPdsLabel()
await checkHorizons()
await checkMoonTrek()
await checkQuickMap()
checkNoNonNasaEphemerisLibraries()
checkSourceTreeForForbiddenImports()
checkNoExternalEntryPointAssets()

const failed = results.filter((entry) => !entry.ok)
console.log(
  failed.length === 0
    ? `\nAll ${results.length} source checks passed.`
    : `\n${failed.length} of ${results.length} source checks failed.`,
)
process.exit(failed.length === 0 ? 0 : 1)
