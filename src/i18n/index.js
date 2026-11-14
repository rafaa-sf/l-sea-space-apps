import { createI18n } from 'vue-i18n'
import en from './en'
import es from './es'

const STORAGE_KEY = 'lsea.locale'
const supported = ['en', 'es']

function urlLocale() {
  try {
    const requested = new URLSearchParams(window.location.search).get('lang')
    return requested && supported.includes(requested.toLowerCase()) ? requested.toLowerCase() : null
  } catch {
    return null
  }
}

function initialLocale() {
  const fromUrl = urlLocale()
  if (fromUrl) return fromUrl
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved && supported.includes(saved)) return saved
    const browser = (navigator.language || 'en').slice(0, 2).toLowerCase()
    return supported.includes(browser) ? browser : 'en'
  } catch {
    return 'en'
  }
}

export function persistLocale(locale) {
  try {
    localStorage.setItem(STORAGE_KEY, locale)
  } catch {
    /* storage unavailable */
  }
}

export default createI18n({
  legacy: false,
  locale: initialLocale(),
  fallbackLocale: 'en',
  messages: { en, es },
})
