/**
 * Single-interval playback clock.
 *
 * Owns exactly one `setInterval` handle: starting an already-running clock is a
 * no-op and stopping always clears the handle, so an orphaned timer can never
 * keep advancing the mission time (issue #11). Timers are injectable for tests.
 *
 * @param {Object} options
 * @param {() => void} options.onTick Called on every tick while running.
 * @param {number} [options.intervalMs=220] Tick period.
 * @param {{setInterval: Function, clearInterval: Function}} [options.timers]
 * @returns {{start: () => boolean, stop: () => boolean, toggle: () => boolean,
 *   isRunning: () => boolean, dispose: () => void}}
 */
export function createPlaybackClock({ onTick, intervalMs = 220, timers } = {}) {
  const host =
    timers ?? {
      setInterval: (fn, ms) => globalThis.setInterval(fn, ms),
      clearInterval: (id) => globalThis.clearInterval(id),
    }
  let handle = null

  function isRunning() {
    return handle !== null
  }

  function start() {
    if (handle !== null) return false
    handle = host.setInterval(() => {
      try {
        onTick?.()
      } catch {
        /* keep the clock alive if one tick fails */
      }
    }, intervalMs)
    return true
  }

  function stop() {
    if (handle === null) return false
    host.clearInterval(handle)
    handle = null
    return true
  }

  function toggle() {
    return isRunning() ? (stop(), false) : (start(), true)
  }

  function dispose() {
    stop()
  }

  return { start, stop, toggle, isRunning, dispose }
}
