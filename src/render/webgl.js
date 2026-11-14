/**
 * WebGL capability detection for the viewport adapter. Browsers that block or
 * lack WebGL get the Canvas 2D map instead (feature 12 in docs/architecture.md).
 */

/** Returns `{ ok, reason }` describing whether a WebGL context is usable. */
export function detectWebgl() {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return { ok: false, reason: 'no-dom' }
  }
  if (typeof window.WebGLRenderingContext === 'undefined') {
    return { ok: false, reason: 'no-api' }
  }
  const canvas = document.createElement('canvas')
  try {
    const context = canvas.getContext('webgl2') || canvas.getContext('webgl') || canvas.getContext('experimental-webgl')
    if (!context) return { ok: false, reason: 'no-context' }
    // Release the probe context right away.
    const lose = context.getExtension?.('WEBGL_lose_context')
    if (lose) lose.loseContext()
    return { ok: true, reason: null }
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : 'context-error' }
  }
}
