/**
 * Bridge between the UI and the modules owned by other teammates (`src/core/`,
 * `src/services/`, `src/workers/`). Modules are discovered at build time with
 * `import.meta.glob`, so the app builds and runs before those modules exist and
 * starts using them automatically as soon as they are added.
 *
 * Every loader is defensive: when a module is missing or fails, the caller is
 * told through a `null` result so it can fall back to `./localCore.js`.
 */

import * as localCore from './localCore.js'

const coreModules = import.meta.glob(['../../core/*.js', '!../../core/*.test.js'])
const serviceModules = import.meta.glob(['../../services/*.js', '!../../services/*.test.js'])
const workerModules = import.meta.glob('../../workers/*.js', {
  query: '?worker',
  import: 'default',
})

const moduleCache = new Map()

async function loadFrom(map, path, cacheKey) {
  if (moduleCache.has(cacheKey)) return moduleCache.get(cacheKey)
  const loader = map[path]
  if (!loader) {
    moduleCache.set(cacheKey, null)
    return null
  }
  try {
    const module = await loader()
    moduleCache.set(cacheKey, module)
    return module
  } catch (error) {
    console.warn(`[lsea] could not load ${path}, using local fallback`, error)
    moduleCache.set(cacheKey, null)
    return null
  }
}

/** Load `src/core/<name>.js` if the coder module exists. */
export function loadCore(name) {
  return loadFrom(coreModules, `../../core/${name}.js`, `core:${name}`)
}

/** Load `src/services/<name>.js` if the coder module exists. */
export function loadService(name) {
  return loadFrom(serviceModules, `../../services/${name}.js`, `service:${name}`)
}

/** Names of the coder modules currently present in the bundle. */
export function detectedModules() {
  const strip = (prefix, path) => path.replace(prefix, '').replace(/\.js$/, '')
  return {
    core: Object.keys(coreModules).map((path) => strip('../../core/', path)).sort(),
    services: Object.keys(serviceModules).map((path) => strip('../../services/', path)).sort(),
    workers: Object.keys(workerModules).sort(),
    localCoreKeys: Object.keys(localCore),
  }
}

/**
 * Call a core function, falling back to the local implementation when the
 * module or function is unavailable or throws. Only `null`/`undefined` from the
 * core function is treated as "not computed": valid falsy results (0, false)
 * are kept.
 */
export function withFallback(coreModule, functionName, localFunctionName = functionName, options = {}) {
  const local = localCore[localFunctionName]
  return (...args) => {
    const fn = coreModule && typeof coreModule[functionName] === 'function' ? coreModule[functionName] : null
    if (fn) {
      try {
        const result = fn(...args)
        // Some documented core functions legally return `null` (for example a
        // ray with a clear line of sight, or "no set event in the window").
        if (options.nullable) return result
        if (result !== undefined && result !== null) return result
      } catch (error) {
        console.warn(`[lsea] core.${functionName} failed, using local fallback`, error)
      }
    }
    return typeof local === 'function' ? local(...args) : null
  }
}

/* -------------------------------------------------------------------------- */
/* Background worker                                                          */
/* -------------------------------------------------------------------------- */

let workerState = null
let requestCounter = 0
const pending = new Map()

function getWorkerLoader() {
  const key = Object.keys(workerModules)[0]
  return key ? workerModules[key] : null
}

function rejectAllPending(message) {
  for (const [, entry] of pending) {
    clearTimeout(entry.timer)
    entry.reject(new Error(message))
  }
  pending.clear()
}

/**
 * Instantiate the coder's background worker and wire the message protocol from
 * docs/architecture.md. Returns `null` when the worker module is unavailable.
 */
async function createWorker() {
  const loader = getWorkerLoader()
  if (!loader) return null
  const WorkerCtor = (await loader()).default ?? (await loader())
  if (typeof WorkerCtor !== 'function') return null

  const worker = new WorkerCtor()
  worker.addEventListener('message', (event) => {
    const data = event.data ?? {}
    const entry = pending.get(data.id)
    if (!entry) return
    pending.delete(data.id)
    clearTimeout(entry.timer)
    if (data.type === 'error') entry.reject(new Error(data.payload?.message ?? 'worker error'))
    else entry.resolve(data.payload)
  })
  worker.addEventListener('error', (event) => {
    const detail = [
      event?.message || 'worker crashed',
      event?.filename ? `@ ${event.filename}` : null,
      Number.isFinite(event?.lineno) && event.lineno > 0 ? `:${event.lineno}` : null,
    ]
      .filter(Boolean)
      .join(' ')
    rejectAllPending(detail)
    try {
      worker.terminate()
    } catch {
      /* ignore */
    }
    workerState = null
  })
  return worker
}

/**
 * Run a task in the coder's single background worker when available. Resolves
 * with `{ ok, source, payload, error }` and never rejects. Startup failures are
 * retried once with a fresh worker; the main-thread fallback is used only after
 * that real failure.
 */
export async function runInWorker(type, payload, timeoutMs = 60000) {
  let lastError = null
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (!workerState?.worker) {
      try {
        const worker = await createWorker()
        if (!worker) return { ok: false, source: 'main', error: 'worker-missing' }
        workerState = { worker }
      } catch (error) {
        lastError = error
        if (attempt === 0) continue
        return { ok: false, source: 'main', error: `worker-init: ${error.message}` }
      }
    }

    const id = (requestCounter += 1)
    try {
      const response = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id)
          reject(new Error('worker-timeout'))
        }, timeoutMs)
        pending.set(id, { resolve, reject, timer })
        workerState.worker.postMessage({ id, type, payload })
      })
      return { ok: true, source: 'worker', payload: response }
    } catch (error) {
      lastError = error
      // A crashed worker needs a fresh instance: rebuild and retry once.
      if (attempt === 0 && /worker crashed|init|load/i.test(error.message)) {
        workerState = null
        continue
      }
      break
    }
  }
  return { ok: false, source: 'main', error: lastError?.message ?? 'worker failed' }
}

/** True when the worker module is part of the bundle. */
export function hasWorker() {
  return Object.keys(workerModules).length > 0
}
