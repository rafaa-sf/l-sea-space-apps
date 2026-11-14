/**
 * Background compute worker (single CPU thread).
 *
 * The UI instantiates this file with Vite's `?worker` import. Tasks are queued
 * and executed sequentially on the worker thread; the protocol is the one in
 * `docs/architecture.md`:
 *
 * ```js
 * // request
 * { id, type: 'autopilot', payload: { sites, mission, region } }
 * // response
 * { id, type: 'result', payload: { scores } }
 * // error
 * { id, type: 'error', payload: { message } }
 * // cancellation (client → worker)
 * { id, type: 'cancel', payload: { id } }
 * ```
 *
 * Cancellation is best-effort: a JavaScript worker cannot preempt a running
 * task, so a cancel request drops the queued task (if it has not started) or the
 * result (if it already finished) and the client rejects its promise. Errors are
 * caught per task so one failure never kills the worker.
 *
 * This file has no imports of browser UI code and works in any module worker.
 */

import { runTask, TASK_TYPES } from './tasks.js'

/** Ids requested to be cancelled while queued or running. */
const cancelled = new Set()

/** Serialises task execution on the single CPU thread. */
let queue = Promise.resolve()

/**
 * Post a message to the main thread, ignoring errors during teardown.
 *
 * @param {Object} message
 * @returns {void}
 */
function post(message) {
  try {
    self.postMessage(message)
  } catch {
    /* the worker is being torn down */
  }
}

/**
 * Handle one request message.
 *
 * @param {MessageEvent} event
 * @returns {void}
 */
function handleMessage(event) {
  const data = event?.data
  if (!data || data.id === undefined || data.id === null) return
  const id = String(data.id)

  if (data.type === 'cancel') {
    const targetId = String(data.payload?.id ?? data.id)
    cancelled.add(targetId)
    return
  }

  if (cancelled.has(id)) {
    cancelled.delete(id)
    return
  }

  queue = queue
    .then(async () => {
      if (cancelled.has(id)) {
        cancelled.delete(id)
        return
      }
      try {
        const result = await runTask(data.type, data.payload ?? {})
        if (!cancelled.has(id)) post({ id: data.id, type: 'result', payload: result })
      } catch (error) {
        post({
          id: data.id,
          type: 'error',
          payload: {
            message: error instanceof Error ? error.message : String(error),
            code: error?.code ?? 'TASK_ERROR',
            type: data.type ?? null,
          },
        })
      } finally {
        cancelled.delete(id)
      }
    })
    .catch(() => {
      /* keep the queue alive after an unexpected rejection */
    })
}

// `self` is the worker global scope; the listener is registered for every task.
self.addEventListener('message', handleMessage)

// Announce readiness so a client can distinguish "worker loaded" from "no worker".
post({ type: 'ready', payload: { taskTypes: TASK_TYPES, startedAt: new Date().toISOString() } })
