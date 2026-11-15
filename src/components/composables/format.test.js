import { afterEach, describe, expect, it } from 'vitest'
import { formatNumber, formatUtc } from './format.js'

/**
 * The formatters read the UI language from `document.documentElement.lang`, and
 * tests either pass an explicit locale or stub that element so the result never
 * depends on the host locale. The test environment has no DOM: `document` is
 * undefined unless a test installs it.
 */

const EN_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const ES_MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']

function isoForMonth(index) {
  return `2026-${String(index + 1).padStart(2, '0')}-15T00:00:00Z`
}

function setDocumentLang(lang) {
  globalThis.document = { documentElement: { lang } }
}

afterEach(() => {
  delete globalThis.document
})

describe('formatUtc month names', () => {
  it('renders English abbreviations for en', () => {
    EN_MONTHS.forEach((month, index) => {
      expect(formatUtc(isoForMonth(index), 'en')).toBe(`15 ${month} 2026 00:00 UTC`)
    })
    expect(formatUtc('2026-11-14T12:00:00.000Z', 'en')).toBe('14 Nov 2026 12:00 UTC')
  })

  it('renders lowercase Spanish abbreviations for es', () => {
    ES_MONTHS.forEach((month, index) => {
      expect(formatUtc(isoForMonth(index), 'es')).toBe(`15 ${month} 2026 00:00 UTC`)
    })
    expect(formatUtc('2026-11-14T12:00:00.000Z', 'es')).toBe('14 nov 2026 12:00 UTC')
  })

  it('keeps two-digit day/hour padding and UTC ordering for es', () => {
    expect(formatUtc('2026-01-05T08:30:00Z', 'es')).toBe('05 ene 2026 08:30 UTC')
    expect(formatUtc('2026-12-31T00:00:00Z', 'es')).toBe('31 dic 2026 00:00 UTC')
    // Month rollover must follow UTC, never the browser zone.
    expect(formatUtc('2026-02-28T23:45:00Z', 'es')).toBe('28 feb 2026 23:45 UTC')
  })

  it('accepts Date and epoch timestamps', () => {
    const ms = Date.parse('2026-11-14T12:00:00.000Z')
    expect(formatUtc(new Date(ms), 'es')).toBe('14 nov 2026 12:00 UTC')
    expect(formatUtc(ms, 'en')).toBe('14 Nov 2026 12:00 UTC')
  })

  it('renders an em dash for non-finite input', () => {
    expect(formatUtc('not-a-date', 'en')).toBe('—')
    expect(formatUtc('2026-13-45T00:00:00Z', 'es')).toBe('—')
    expect(formatUtc(undefined, 'en')).toBe('—')
    expect(formatUtc(null, 'es')).toBe('—')
    expect(formatUtc(NaN, 'en')).toBe('—')
    expect(formatUtc({}, 'es')).toBe('—')
  })
})

describe('formatUtc locale resolution', () => {
  it('falls back to English without a document', () => {
    expect(formatUtc('2026-11-14T12:00:00Z')).toBe('14 Nov 2026 12:00 UTC')
  })

  it('reads document.documentElement.lang', () => {
    setDocumentLang('es-ES')
    expect(formatUtc('2026-11-14T12:00:00Z')).toBe('14 nov 2026 12:00 UTC')
    setDocumentLang('es')
    expect(formatUtc('2026-11-14T12:00:00Z')).toBe('14 nov 2026 12:00 UTC')
    setDocumentLang('en-GB')
    expect(formatUtc('2026-11-14T12:00:00Z')).toBe('14 Nov 2026 12:00 UTC')
    setDocumentLang('')
    expect(formatUtc('2026-11-14T12:00:00Z')).toBe('14 Nov 2026 12:00 UTC')
  })

  it('lets an explicit locale win over the document language', () => {
    setDocumentLang('es-ES')
    expect(formatUtc('2026-11-14T12:00:00Z', 'en')).toBe('14 Nov 2026 12:00 UTC')
    setDocumentLang('en')
    expect(formatUtc('2026-11-14T12:00:00Z', 'es-MX')).toBe('14 nov 2026 12:00 UTC')
  })

  it('falls back to English for unsupported locales', () => {
    expect(formatUtc('2026-11-14T12:00:00Z', 'fr-FR')).toBe('14 Nov 2026 12:00 UTC')
  })
})

describe('formatNumber grouping', () => {
  it('groups thousands with a comma for en', () => {
    expect(formatNumber(1234, 0, 'en')).toBe('1,234')
    expect(formatNumber(1234567, 0, 'en')).toBe('1,234,567')
    expect(formatNumber(1234.5, 1, 'en')).toBe('1,234.5')
  })

  it('groups thousands with a dot and decimals with a comma for es', () => {
    expect(formatNumber(1234, 0, 'es')).toBe('1.234')
    expect(formatNumber(1234567, 0, 'es')).toBe('1.234.567')
    expect(formatNumber(1234.5, 1, 'es')).toBe('1.234,5')
    expect(formatNumber(1234.567, 2, 'es')).toBe('1.234,57')
  })

  it('honours the fixed decimal count and the default of zero', () => {
    expect(formatNumber(42)).toBe('42')
    expect(formatNumber(3.14159, 2, 'en')).toBe('3.14')
    expect(formatNumber(3.14159, 2, 'es')).toBe('3,14')
    expect(formatNumber(0, 0, 'es')).toBe('0')
  })

  it('resolves the locale from the document language', () => {
    expect(formatNumber(1234)).toBe('1,234')
    setDocumentLang('es-ES')
    expect(formatNumber(1234)).toBe('1.234')
    setDocumentLang('es-AR')
    expect(formatNumber(1234)).toBe('1.234')
    setDocumentLang('en-US')
    expect(formatNumber(1234)).toBe('1,234')
  })

  it('renders an em dash for non-finite input', () => {
    expect(formatNumber('abc', 0, 'en')).toBe('—')
    expect(formatNumber(NaN, 0, 'es')).toBe('—')
    expect(formatNumber(Infinity, 0, 'en')).toBe('—')
    expect(formatNumber(undefined, 0, 'es')).toBe('—')
  })
})
