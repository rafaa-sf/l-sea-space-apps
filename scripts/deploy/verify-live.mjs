#!/usr/bin/env node
/**
 * Verify a deployed L-SEA Space Apps build.
 *
 * Usage:
 *   node scripts/deploy/verify-live.mjs <base-url>
 *
 * Checks the SPA entry point, favicon, NASA data files, the terrain binary, the
 * SPA rewrite (deep link fallback) and the cache headers of the hashed assets.
 * Exits with code 1 when any check fails.
 */
const base = (process.argv[2] || '').replace(/\/$/, '')
if (!base) {
  console.error('Usage: node scripts/deploy/verify-live.mjs <base-url>')
  process.exit(2)
}

const checks = [
  { name: 'app entry', path: '/', expectType: 'text/html' },
  { name: 'favicon', path: '/favicon.svg', expectType: 'image/svg+xml' },
  { name: 'POIs', path: '/data/pois.json', expectType: 'application/json' },
  { name: 'layers catalogue', path: '/data/layers.json', expectType: 'application/json' },
  { name: 'terrain index', path: '/data/terrain/index.json', expectType: 'application/json' },
  { name: 'AI usage declaration', path: '/data/ai-usage.md', expectType: null },
  { name: 'terrain LOLA binary', path: '/data/terrain/south-pole-875s-20m.bin', expectType: null },
  { name: 'SPA deep-link fallback', path: '/mission/shackleton-rim', expectType: 'text/html' },
]

let failures = 0
let indexHtml = ''

for (const check of checks) {
  const url = `${base}${check.path}`
  try {
    const response = await fetch(url, { redirect: 'follow' })
    const contentType = response.headers.get('content-type') || ''
    const body = await response.arrayBuffer()
    const text = Buffer.from(body).toString('utf8')
    const isAppShell = text.includes('<div id="app">')
    const okStatus =
      response.status === 200 ||
      (check.name === 'SPA deep-link fallback' && response.status === 404 && isAppShell)
    const okType = !check.expectType || contentType.toLowerCase().includes(check.expectType)
    const okBody = body.byteLength > 0
    if (check.path === '/') indexHtml = text
    const pass = okStatus && okType && okBody
    if (!pass) failures += 1
    console.log(
      `${pass ? 'PASS' : 'FAIL'}  ${check.name.padEnd(24)} ` +
        `${String(response.status).padEnd(4)} ${contentType.split(';')[0].padEnd(28)} ` +
        `${body.byteLength} bytes`,
    )
  } catch (error) {
    failures += 1
    console.log(`FAIL  ${check.name.padEnd(24)} request failed: ${error.message}`)
  }
}

// Cache headers for a hashed asset referenced by the entry point.
// Local preview servers (vite preview) do not send CDN cache headers: skip the
// strict check there so the script is also useful before deploying.
const isLocal =
  /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(new URL(base).host || '')
const assetMatch = indexHtml.match(/\/assets\/[A-Za-z0-9._-]+\.js/)
if (!assetMatch) {
  failures += 1
  console.log('FAIL  no hashed asset reference found in the entry HTML')
} else if (isLocal) {
  console.log('SKIP  hashed asset cache         local preview (no CDN headers)')
} else {
  try {
    const response = await fetch(`${base}${assetMatch[0]}`)
    const cache = response.headers.get('cache-control') || ''
    const maxAge = Number((cache.match(/max-age=(\d+)/) || [])[1] || 0)
    // Vercel/CDN: immutable long cache. GitHub Pages: 600 s on static assets.
    const immutable = /immutable/i.test(cache) && maxAge >= 100000
    const acceptable = immutable || maxAge >= 600
    if (!acceptable) failures += 1
    console.log(
      `${acceptable ? 'PASS' : 'FAIL'}  ${'hashed asset cache'.padEnd(24)} ` +
        `${response.status} ${cache || '(no cache-control)'}`,
    )
  } catch (error) {
    failures += 1
    console.log(`FAIL  hashed asset cache: ${error.message}`)
  }
}

console.log(
  failures === 0
    ? `\nAll checks passed for ${base}`
    : `\n${failures} check(s) failed for ${base}`,
)
process.exit(failures === 0 ? 0 : 1)
