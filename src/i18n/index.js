import { createI18n } from 'vue-i18n'
import en from './en'
import es from './es'

const STORAGE_KEY = 'lsea.locale'
const supported = ['en', 'es']

function initialLocale() {
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
