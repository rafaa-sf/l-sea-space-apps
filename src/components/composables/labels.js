/**
 * Display-name helpers shared by panels. Data files carry English names; when a
 * dataset provides an i18n key the translated label wins. Reason codes from the
 * autopilot are translated when the catalogue has a matching key, otherwise the
 * English text produced by the core is shown.
 */

import { formatLat, formatLon } from './format.js'

/** Resolve a site display name through i18n when the dataset provides a key. */
export function siteDisplayName(t, te, site) {
  if (!site) return ''
  if (site.nameKey && typeof te === 'function' && te(site.nameKey)) return t(site.nameKey)
  if (site.name) return site.name
  if (site.source === 'custom' || site.source === 'pointer') {
    return t('sites.customName', { lat: formatLat(site.lat), lon: formatLon(site.lon) })
  }
  return site.id || ''
}

/** Resolve a layer display name through i18n when the dataset provides a key. */
export function layerDisplayName(t, te, layer) {
  if (!layer) return ''
  if (layer.nameKey && typeof te === 'function' && te(layer.nameKey)) return t(layer.nameKey)
  return layer.name || layer.id || ''
}

/** Translate an autopilot reason: `{ code, params, text }`. */
export function reasonText(t, te, reason) {
  if (!reason) return ''
  if (reason.code) {
    const key = `autopilot.reasons.${reason.code}`
    if (typeof te === 'function' && te(key)) {
      const params = { ...(reason.params ?? {}) }
      // Fraction parameters are exposed as percentages for display.
      if (Number.isFinite(params.fraction)) params.fractionPct = Math.round(params.fraction * 100)
      if (Number.isFinite(params.coverage)) params.coveragePct = Math.round(params.coverage * 100)
      try {
        return t(key, params)
      } catch {
        return t(key)
      }
    }
  }
  return reason.text || reason.code || ''
}

/** Translated label for a site provenance value. */
export function siteSourceLabel(t, te, site) {
  const source = site?.source ?? 'unknown'
  const key = `sites.source.${source}`
  return te(key) ? t(key) : t('sites.source.unknown')
}

/** i18n key describing a data provenance value. */
export function sourceLabelKey(source) {
  switch (source) {
    case 'dataset':
    case 'lola':
      return 'data.source.dataset'
    case 'service':
      return 'data.source.service'
    case 'synthetic':
    case 'fallback':
      return 'data.source.synthetic'
    case 'error':
      return 'data.source.error'
    case 'none':
      return 'data.source.none'
    case 'pending':
      return 'data.source.pending'
    default:
      return 'data.source.unknown'
  }
}
