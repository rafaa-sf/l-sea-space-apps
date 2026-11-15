import { describe, expect, it } from 'vitest'
import { markerOpacity, MARKER_OPACITY_DEFAULT, MARKER_OPACITY_WITH_LAYERS } from './markerOpacity.js'

describe('markerOpacity', () => {
  it('is 85% opaque without layers', () => {
    expect(MARKER_OPACITY_DEFAULT).toBe(0.85)
    expect(markerOpacity(false)).toBe(0.85)
  })

  it('is 65% opaque with any layer', () => {
    expect(MARKER_OPACITY_WITH_LAYERS).toBe(0.65)
    expect(markerOpacity(true)).toBe(0.65)
  })
})
