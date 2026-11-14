/**
 * Client helper for the background compute worker.
 *
 * The UI discovers the worker through Vite's `?worker` glob and usually talks to
 * it directly; this helper is the reusable, framework-agnostic client for any
 * other caller (and for tests). It provides:
 *
 * - a promise-based `request(type, payload)` matching the documented protocol,
 * - cancellation and `AbortSignal` support (best effort: a running task cannot be
 *   preempted, but its queued/running result is dropped and the promise rejects),
 * - automatic worker restart after a crash,
 * - an inline main-thread fallback when `Worker` is unavailable (older browsers,
 *   tests, SSR), so callers never have to branch on the environment.
 *
 * @module services/computeClient
 */

import { runTask } from '../workers/tasks.js'

/** Request id counter shared by all clients. */
let requestCounter = 0

/**
 * Create an abort error that behaves like the DOM one when available.
 *
 * @param {string} [message='Aborted']
 * @returns {Error}
 */
function createAbortError(message = 'Aborted') {
  if (typeof DOMException === 'function') {
    return new DOMException(message, 'AbortError')
  }
  const error = new Error(message)
  error.name = 'AbortError'
  return error
}

/**
 * Create a compute client.
 *
 * @param {{
 *   workerFactory?: () => Worker|null,
 *   inlineFallback?: boolean,
 *   requestTimeoutMs?: number,
 * }} [options]
 * @returns {{
 *   request: (type: string, payload?: Object, options?: {signal?: AbortSignal, timeoutMs?: number}) => Promise<Object>,
 *   cancel: (id: string|number) => boolean,
 *   cancelAll: () => void,
 *   terminate: () => void,
 *   status: () => 'idle'|'busy'|'inline'|'unsupported'|'terminated',
 *   pendingCount: () => number,
 *   isWorkerSupported: () => boolean,
 *   mode: () => 'worker'|'inline',
 * }}
 */
export function createComputeClient(options = {}) {
  const inlineFallback = options.inlineFallback !== false
  const requestTimeoutMs = Number(options.requestTimeoutMs) > 0 ? Number(options.requestTimeoutMs) : 120000
  /** @type {Map<number, {resolve: Function, reject: Function, timer: any, cancelled: boolean}>} */
  const pending = new Map()
  let worker = null
  let terminated = false
  let workerFailed = false
  const inlineCancelled = new Set()

  /**
   * Create the worker lazily; `null` selects the inline fallback.
   *
   * @returns {Worker|null}
   */
  function ensureWorker() {
    if (worker) return worker
    if (terminated) return null
    if (options.workerFactory) {
      try {
        worker = options.workerFactory() ?? null
      } catch (error) {
        console.warn(`[computeClient] worker factory failed: ${error instanceof Error ? error.message : String(error)}`)
        worker = null
      }
    } else if (typeof Worker === 'function') {
      try {
        worker = new Worker(new URL('../workers/compute.worker.js', import.meta.url), {
          type: 'module',
          name: 'lsea-compute',
        })
      } catch (error) {
        console.warn(`[computeClient] could not start the worker: ${error instanceof Error ? error.message : String(error)}`)
        worker = null
      }
    }
    if (!worker) return null

    worker.addEventListener?.('message', (event) => {
      const data = event?.data ?? {}
      if (data.id === undefined || data.id === null) return
      const entry = pending.get(Number(data.id))
      if (!entry) return
      pending.delete(Number(data.id))
      clearTimeout(entry.timer)
      if (data.type === 'error') {
        const error = new Error(data.payload?.message ?? 'Worker task failed')
        error.code = data.payload?.code ?? 'TASK_ERROR'
        entry.reject(error)
      } else {
        entry.resolve(data.payload ?? null)
      }
    })

    const handleFailure = (message) => {
      workerFailed = true
      for (const [id, entry] of pending) {
        clearTimeout(entry.timer)
        entry.reject(new Error(message))
        pending.delete(id)
      }
      try {
        worker?.terminate()
      } catch {
        /* ignore */
      }
      worker = null
    }
    worker.addEventListener?.('error', (event) => {
      handleFailure(event?.message ?? 'Background worker crashed')
    })
    worker.addEventListener?.('messageerror', () => {
      handleFailure('Background worker sent an unreadable message')
    })
    return worker
  }

  /**
   * Reject a pending entry as cancelled.
   *
   * @param {number} id
   * @returns {boolean} `true` when the entry existed.
   */
  function cancelEntry(id) {
    const key = Number(id)
    const entry = pending.get(key)
    if (!entry) return false
    pending.delete(key)
    clearTimeout(entry.timer)
    entry.reject(createAbortError(`Request ${key} cancelled`))
    return true
  }

  /**
   * Execute a task inline on the main thread (fallback mode).
   *
   * @param {number} id
   * @param {string} type
   * @param {Object} payload
   * @param {{signal?: AbortSignal, timeoutMs?: number}} requestOptions
   * @returns {Promise<Object>}
   */
  function runInline(id, type, payload, requestOptions) {
    return new Promise((resolve, reject) => {
      if (inlineCancelled.has(id) || requestOptions.signal?.aborted) {
        inlineCancelled.delete(id)
        reject(createAbortError())
        return
      }
      const timer = setTimeout(() => {
        inlineCancelled.add(id)
        reject(new Error(`Inline task '${type}' timed out`))
      }, requestOptions.timeoutMs ?? requestTimeoutMs)

      runTask(type, payload)
        .then((result) => {
          clearTimeout(timer)
          if (inlineCancelled.has(id) || requestOptions.signal?.aborted) {
            inlineCancelled.delete(id)
            reject(createAbortError())
            return
          }
          resolve(result)
        })
        .catch((error) => {
          clearTimeout(timer)
          inlineCancelled.delete(id)
          reject(error instanceof Error ? error : new Error(String(error)))
        })
    })
  }

  return {
    /**
     * Run a task in the worker (or inline when unavailable).
     *
     * @param {string} type Task type.
     * @param {Object} [payload] Task payload.
     * @param {{signal?: AbortSignal, timeoutMs?: number}} [requestOptions]
     * @returns {Promise<Object>}
     */
    request(type, payload = {}, requestOptions = {}) {
      if (terminated) return Promise.reject(new Error('Compute client terminated'))
      if (!type) return Promise.reject(new TypeError('request expects a task type'))

      const id = (requestCounter += 1)
      const timeoutMs =
        Number(requestOptions.timeoutMs) > 0 ? Number(requestOptions.timeoutMs) : requestTimeoutMs
      const target = ensureWorker()
      if (!target) {
        inlineCancelled.delete(id)
        return runInline(id, type, payload, { ...requestOptions, timeoutMs })
      }

      return new Promise((resolve, reject) => {
        if (requestOptions.signal?.aborted) {
          reject(createAbortError())
          return
        }
        const timer = setTimeout(() => {
          pending.delete(id)
          try {
            target.postMessage({ id, type: 'cancel', payload: { id } })
          } catch {
            /* ignore */
          }
          reject(new Error(`Worker task '${type}' timed out`))
        }, timeoutMs)
        pending.set(id, { resolve, reject, timer, cancelled: false })

        const onAbort = () => {
          const found = pending.get(id)
          if (!found) return
          pending.delete(id)
          clearTimeout(found.timer)
          try {
            target.postMessage({ id, type: 'cancel', payload: { id } })
          } catch {
            /* ignore */
          }
          reject(createAbortError())
        }
        requestOptions.signal?.addEventListener?.('abort', onAbort, { once: true })

        try {
          target.postMessage({ id, type, payload })
        } catch (error) {
          pending.delete(id)
          clearTimeout(timer)
          reject(error instanceof Error ? error : new Error(String(error)))
        }
      })
    },

    /**
     * Cancel one pending request.
     *
     * @param {string|number} id Request id.
     * @returns {boolean} `true` when a request was cancelled.
     */
    cancel(id) {
      if (inlineCancelled.has(Number(id))) {
        inlineCancelled.delete(Number(id))
        return true
      }
      const cancelled = cancelEntry(id)
      if (cancelled && worker) {
        try {
          worker.postMessage({ id: Number(id), type: 'cancel', payload: { id: Number(id) } })
        } catch {
          /* ignore */
        }
      }
      return cancelled
    },

    /** Cancel every pending request. */
    cancelAll() {
      for (const id of [...pending.keys()]) this.cancel(id)
      inlineCancelled.clear()
    },

    /** Terminate the worker and reject pending requests. */
    terminate() {
      terminated = true
      for (const [id, entry] of pending) {
        clearTimeout(entry.timer)
        entry.reject(createAbortError('Compute client terminated'))
        pending.delete(id)
      }
      try {
        worker?.terminate()
      } catch {
        /* ignore */
      }
      worker = null
    },

    /**
     * Current client status.
     *
     * @returns {'idle'|'busy'|'inline'|'unsupported'|'terminated'}
     */
    status() {
      if (terminated) return 'terminated'
      if (pending.size > 0) return 'busy'
      if (worker) return 'idle'
      if (workerFailed && !inlineFallback) return 'unsupported'
      return inlineFallback ? 'inline' : 'unsupported'
    },

    /** @returns {number} Number of in-flight requests. */
    pendingCount() {
      return pending.size
    },

    /** @returns {boolean} Whether a real background worker is in use. */
    isWorkerSupported() {
      return Boolean(worker)
    },

    /** @returns {'worker'|'inline'} Execution mode in use. */
    mode() {
      return worker ? 'worker' : 'inline'
    },
  }
}

/** Shared lazy singleton for callers that do not need their own client. */
let sharedClient = null

/**
 * Get (and lazily create) the shared compute client.
 *
 * @param {Object} [options] See {@link createComputeClient}.
 * @returns {ReturnType<typeof createComputeClient>}
 */
export function getComputeClient(options = {}) {
  if (!sharedClient) sharedClient = createComputeClient(options)
  return sharedClient
}

/**
 * Terminate and drop the shared compute client.
 *
 * @returns {void}
 */
export function resetComputeClient() {
  sharedClient?.terminate()
  sharedClient = null
}
