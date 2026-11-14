/**
 * File-backed fetch implementation for the L-SEA Monte Carlo logic harness.
 *
 * The real browser services (`src/services/lola.js`, `horizons.js`, `sites.js`)
 * call `fetch()` with URLs relative to the deployment root (usually
 * `/data/...`). This adapter serves those URLs from the read-only repository
 * checkout `public/` directory so the real loaders decode the real files.
 *
 * It returns standard `Response` objects (Node >= 18 global fetch API). No
 * network access is performed. Reads are cached in-memory per process to keep
 * 20k+ trials fast.
 *
 * @module logic/lib/file-fetch
 */
import { readFileSync, existsSync } from 'node:fs'
import { join, extname } from 'node:path'

const MIME = {
  '.json': 'application/json',
  '.bin': 'application/octet-stream',
  '.md': 'text/markdown',
  '.txt': 'text/plain',
  '.geojson': 'application/geo+json',
}

/**
 * @param {string} repoRoot Absolute path to the application repository root.
 * @returns {typeof fetch}
 */
export function createFileFetch(repoRoot) {
  const publicRoot = join(repoRoot, 'public')
  const cache = new Map()

  /**
   * Map any request URL to a path inside `public/`.
   * Accepts `/data/x`, `data/x`, `/.../data/x` and absolute `http(s)://host/data/x`.
   * @param {string} input
   * @returns {string|null} Relative path below `public/`, or null when not a data URL.
   */
  function toPublicPath(input) {
    const raw = String(input)
    let pathname = raw
    if (/^https?:\/\//i.test(raw)) {
      try {
        pathname = new URL(raw).pathname
      } catch {
        return null
      }
    }
    pathname = pathname.split('#')[0].split('?')[0]
    // URLs are relative to the deployment root, which maps to `public/`.
    // `/data/x` -> `public/data/x`, `/data/` -> `public/data/`, etc.
    const marker = pathname.indexOf('/data/')
    if (marker >= 0) return 'data/' + pathname.slice(marker + '/data/'.length)
    if (pathname.startsWith('/data/')) return 'data/' + pathname.slice('/data/'.length)
    if (pathname.startsWith('data/')) return pathname
    // Any other root-relative path is treated as public-relative.
    return pathname.replace(/^\/+/, '')
  }

  /** @type {typeof fetch} */
  async function fileFetch(input, init = {}) {
    const signal = init?.signal
    if (signal?.aborted) {
      throw Object.assign(new Error('The operation was aborted'), { name: 'AbortError' })
    }
    const rel = toPublicPath(typeof input === 'object' && input?.url ? input.url : input)
    if (rel == null) return new Response('', { status: 404, statusText: 'Not Found' })
    const file = join(publicRoot, rel)
    // Directory traversal guard: the resolved file must stay under public/.
    if (!file.startsWith(publicRoot)) return new Response('', { status: 404, statusText: 'Not Found' })

    let body = cache.get(file)
    if (body === undefined) {
      if (!existsSync(file)) {
        cache.set(file, null)
        return new Response('', { status: 404, statusText: 'Not Found' })
      }
      body = readFileSync(file)
      cache.set(file, body)
    }
    if (body === null) return new Response('', { status: 404, statusText: 'Not Found' })
    const type = MIME[extname(file).toLowerCase()] ?? 'application/octet-stream'
    return new Response(body, {
      status: 200,
      statusText: 'OK',
      headers: {
        'content-type': type,
        'content-length': String(body.byteLength),
      },
    })
  }

  return fileFetch
}
