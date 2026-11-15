/**
 * Opacity of the selected-site cone marker.
 *
 * Without overlays the cone is nearly opaque; with any layer enabled it becomes
 * more transparent so the layer remains readable underneath the marker.
 */
export const MARKER_OPACITY_DEFAULT = 0.85
export const MARKER_OPACITY_WITH_LAYERS = 0.65

/**
 * @param {boolean} hasLayers True when at least one map layer is enabled.
 * @returns {number} Sprite opacity in [0, 1].
 */
export function markerOpacity(hasLayers) {
  return hasLayers ? MARKER_OPACITY_WITH_LAYERS : MARKER_OPACITY_DEFAULT
}
