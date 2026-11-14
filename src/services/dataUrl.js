/**
 * URL helpers for the static data files under `public/data/`.
 *
 * The application is deployed as a static bundle; Vite exposes its base path as
 * `import.meta.env.BASE_URL` (normally `/`). All dataset URLs must be built
 * relative to that base so a deployment under a sub-directory keeps working.
 *
 * @module services/dataUrl
 */

/**
 * Resolve the application base URL (always ending with `/`).
 *
 * @param {string} [override] Explicit base URL.
 * @returns {string}
 */
export function appBaseUrl(override) {
  if (typeof override === 'string' && override.length > 0) {
    return override.endsWith('/') ? override : `${override}/`
  }
  let viteBase = '/'
  try {
    const value = import.meta?.env?.BASE_URL
    if (typeof value === 'string' && value.length > 0) viteBase = value
  } catch {
    /* import.meta.env is unavailable outside a Vite bundle */
  }
  return viteBase.endsWith('/') ? viteBase : `${viteBase}/`
}

/**
 * Resolve the data root URL (`<base>data/`).
 *
 * @param {string} [override] Explicit data root URL.
 * @returns {string}
 */
export function dataRootUrl(override) {
  if (typeof override === 'string' && override.length > 0) {
    return override.endsWith('/') ? override : `${override}/`
  }
  return `${appBaseUrl()}data/`
}

/**
 * Build an absolute URL for a file inside `public/data/`.
 *
 * @param {string} path Path relative to the data root (e.g. `pois.json`).
 * @param {string} [dataRoot] Explicit data root override.
 * @returns {string}
 */
export function dataUrl(path, dataRoot) {
  const root = dataRootUrl(dataRoot)
  return `${root}${String(path).replace(/^\/+/, '')}`
}
